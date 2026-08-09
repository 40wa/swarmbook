import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { decodeApiToon } from "../src/transport/toon";

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const enabled = process.env.RUN_DOCKER_TESTS === "1";
const dockerTest = enabled ? test : test.skip;
const projectRoot = resolve(import.meta.dir, "..");
const bun = Bun.which("bun") ?? process.execPath;

async function command(command: string[], options: { stdin?: string; env?: Record<string, string> } = {}) {
  const child = Bun.spawn({
    cmd: command,
    cwd: projectRoot,
    env: { ...process.env, ...options.env },
    stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode } satisfies CommandResult;
}

async function checked(commandLine: string[]): Promise<string> {
  const result = await command(commandLine);
  if (result.exitCode !== 0) {
    throw new Error(
      `${commandLine.join(" ")} failed (${result.exitCode})\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

async function cli(
  home: string,
  arguments_: string[],
  stdin?: string,
): Promise<CommandResult & { json?: Record<string, any> }> {
  const result = await command([bun, "src/cli/main.ts", ...arguments_], {
    stdin,
    env: { HOME: home },
  });
  let json: Record<string, any> | undefined;
  try {
    json = result.stdout
      ? (decodeApiToon(result.stdout) as Record<string, any>)
      : undefined;
  } catch {
    json = undefined;
  }
  return { ...result, json };
}

async function publishedUrl(container: string): Promise<string> {
  const published = await checked(["docker", "port", container, "3000/tcp"]);
  const port = published.split("\n")[0]?.match(/:(\d+)$/)?.[1];
  if (!port) throw new Error(`Could not parse Docker port output: ${published}`);
  return `http://127.0.0.1:${port}`;
}

async function waitForHealth(baseUrl: string, container: string): Promise<void> {
  let lastError = "";
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(250);
  }
  const logs = await command(["docker", "logs", container]);
  throw new Error(`Container did not become healthy: ${lastError}\n${logs.stdout}\n${logs.stderr}`);
}

describe("Docker acceptance", () => {
  dockerTest(
    "builds cleanly and preserves the complete board across container replacement",
    async () => {
      const suffix = `${process.pid}-${Date.now().toString(36)}`;
      const image = `swarmbook-acceptance:${suffix}`;
      const volume = `swarmbook-acceptance-${suffix}`;
      const firstContainer = `swarmbook-acceptance-first-${suffix}`;
      const secondContainer = `swarmbook-acceptance-second-${suffix}`;
      const amberHome = mkdtempSync(join(tmpdir(), "swarmbook-docker-amber-"));
      const cobaltHome = mkdtempSync(join(tmpdir(), "swarmbook-docker-cobalt-"));

      try {
        await checked(["docker", "build", "--tag", image, "."]);
        await checked(["docker", "volume", "create", volume]);
        await checked([
          "docker",
          "run",
          "--detach",
          "--name",
          firstContainer,
          "--publish",
          "127.0.0.1::3000",
          "--volume",
          `${volume}:/data`,
          image,
        ]);
        const firstUrl = await publishedUrl(firstContainer);
        await waitForHealth(firstUrl, firstContainer);

        expect(
          await cli(amberHome, ["auth", "--server", firstUrl, "--name", "amber-ant"]),
        ).toMatchObject({ exitCode: 0, stderr: "" });
        expect(
          await cli(cobaltHome, ["auth", "--server", firstUrl, "--name", "cobalt-ant"]),
        ).toMatchObject({ exitCode: 0, stderr: "" });

        const opening = await cli(
          amberHome,
          ["start", "til", "Docker persistence"],
          "Opening from amber",
        );
        expect(opening.json?.id).toBeNumber();
        const openingId = opening.json!.id as number;
        const firstReply = await cli(
          cobaltHome,
          ["reply", String(openingId)],
          "Reply from cobalt",
        );
        expect(firstReply.json?.id).toBeNumber();

        expect(await (await fetch(firstUrl)).text()).toContain("Docker persistence");
        expect(
          (await cli(amberHome, ["thread", String(firstReply.json?.id)])).json,
        ).toMatchObject({ thread_id: openingId, total: 2 });
        expect(
          (await cli(amberHome, ["recent", "--since", String(openingId)])).json,
        ).toMatchObject({ posts: [{ id: firstReply.json?.id }] });
        expect(
          (await cli(amberHome, ["search", "cobalt", "--board", "til"])).json,
        ).toMatchObject({ results: [{ id: firstReply.json?.id }] });

        for (let index = 0; index < 48; index += 1) {
          const home = index % 2 === 0 ? amberHome : cobaltHome;
          const reply = await cli(home, ["reply", String(openingId)], `Fill ${index}`);
          expect(reply.exitCode).toBe(0);
        }
        const pastOldBoundary = await cli(
          cobaltHome,
          ["reply", String(openingId)],
          "Post 51 is accepted",
        );
        expect(pastOldBoundary.exitCode).toBe(0);
        const related = await cli(
          cobaltHome,
          [
            "start",
            "til",
            "Docker persistence, related",
            "--body",
            `>>${openingId} >>${firstReply.json?.id} Distilled continuation`,
          ],
        );
        expect(related.json?.id).toBeNumber();

        await checked(["docker", "stop", "--time", "10", firstContainer]);
        expect(
          await checked([
            "docker",
            "inspect",
            "--format",
            "{{.State.ExitCode}}",
            firstContainer,
          ]),
        ).toBe("0");
        await checked(["docker", "rm", firstContainer]);

        await checked([
          "docker",
          "run",
          "--detach",
          "--name",
          secondContainer,
          "--publish",
          "127.0.0.1::3000",
          "--volume",
          `${volume}:/data`,
          image,
        ]);
        const secondUrl = await publishedUrl(secondContainer);
        await waitForHealth(secondUrl, secondContainer);

        const amberConfig = JSON.parse(
          await Bun.file(join(amberHome, ".swarmbook", "config.json")).text(),
        );
        amberConfig.server = secondUrl;
        await Bun.write(
          join(amberHome, ".swarmbook", "config.json"),
          `${JSON.stringify(amberConfig, null, 2)}\n`,
        );

        expect((await cli(amberHome, ["whoami"])).json).toEqual({ handle: "amber-ant" });
        const reopenedThread = (await cli(
          amberHome,
          ["thread", String(openingId), "--limit", "500"],
        )).json;
        expect(reopenedThread).toMatchObject({
          thread_id: openingId,
          total: 51,
        });
        expect(reopenedThread?.posts[0]).toMatchObject({
          replies: [related.json?.id],
        });
        const walked = (await cli(
          amberHome,
          ["thread", String(firstReply.json?.id), "--limit", "500"],
        )).json;
        expect(
          walked?.posts.find((post: { id: number }) => post.id === firstReply.json?.id),
        ).toMatchObject({ replies: [related.json?.id] });
        expect((await cli(amberHome, ["search", "Docker"])).json).toMatchObject({
          results: [
            { thread_id: openingId, replies: [related.json?.id] },
            { thread_id: related.json?.id, replies: [] },
          ],
        });
        expect(await (await fetch(secondUrl)).text()).toContain("Docker persistence");
      } finally {
        await command(["docker", "rm", "--force", firstContainer]);
        await command(["docker", "rm", "--force", secondContainer]);
        await command(["docker", "volume", "rm", volume]);
        await command(["docker", "image", "rm", image]);
        rmSync(amberHome, { recursive: true, force: true });
        rmSync(cobaltHome, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
