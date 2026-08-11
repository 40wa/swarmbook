import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
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

async function browserAuth(
  home: string,
  baseUrl: string,
  owner: string,
  accessKey: string,
  inviterCookie?: string,
): Promise<CommandResult & { json?: Record<string, any>; cookie?: string }> {
  const child = Bun.spawn({
    cmd: [bun, "src/cli/main.ts", "auth", "--server", baseUrl, "--no-open"],
    cwd: projectRoot,
    env: { ...process.env, HOME: home },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutPromise = new Response(child.stdout).text();
  const reader = child.stderr.getReader();
  const decoder = new TextDecoder();
  let stderr = "";
  let verificationUrl: string | undefined;
  while (!verificationUrl) {
    const chunk = await reader.read();
    if (chunk.done) break;
    stderr += decoder.decode(chunk.value, { stream: true });
    verificationUrl = stderr.match(/https?:\/\/[^\s]+\/auth\/cli\/[^\s]+/)?.[0];
  }
  if (!verificationUrl) throw new Error(`CLI did not print an authorization URL: ${stderr}`);
  let enrollment: Response;
  if (inviterCookie) {
    const invitation = await fetch(`${baseUrl}/invites`, {
      method: "POST",
      headers: {
        cookie: inviterCookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ username: owner }),
    });
    const token = (await invitation.text()).match(/swarmbook_invite_[A-Za-z0-9_-]+/)?.[0];
    if (!token) throw new Error("Invitation did not return its one-time token.");
    enrollment = await fetch(`${baseUrl}/invite/${token}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: owner, password: `password-${owner}` }),
      redirect: "manual",
    });
  } else {
    enrollment = await fetch(`${baseUrl}/setup`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: owner,
        password: `password-${owner}`,
        access_key: accessKey,
      }),
      redirect: "manual",
    });
  }
  if (enrollment.status !== 302) {
    throw new Error(`Browser enrollment failed: ${enrollment.status}`);
  }
  const cookie = enrollment.headers.get("set-cookie")?.split(";", 1)[0];
  const completion = await fetch(verificationUrl, {
    method: "POST",
    headers: { cookie: cookie! },
  });
  if (!completion.ok) throw new Error(`Browser authorization failed: ${completion.status}`);
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    stderr += decoder.decode(chunk.value, { stream: true });
  }
  stderr += decoder.decode();
  const [stdout, exitCode] = await Promise.all([stdoutPromise, child.exited]);
  return {
    stdout,
    stderr,
    exitCode,
    json: stdout ? (decodeApiToon(stdout) as Record<string, any>) : undefined,
    cookie,
  };
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
      const accessKey = `docker-access-${suffix}`;
      const rotatedAccessKey = `${accessKey}-rotated`;
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
          "--env",
          `SWARMBOOK_ACCESS_KEY=${accessKey}`,
          "--volume",
          `${volume}:/data`,
          image,
        ]);
        const firstUrl = await publishedUrl(firstContainer);
        await waitForHealth(firstUrl, firstContainer);
        const firstLogs = await checked(["docker", "logs", firstContainer]);
        expect(firstLogs).toContain(
          "Swarmbook access key: configured via SWARMBOOK_ACCESS_KEY (secret not printed)",
        );
        expect(firstLogs).not.toContain(accessKey);

        const amberAuth = await browserAuth(amberHome, firstUrl, "alex", accessKey);
        expect(amberAuth).toMatchObject({ exitCode: 0 });
        expect(
          await browserAuth(cobaltHome, firstUrl, "casey", accessKey, amberAuth.cookie),
        ).toMatchObject({ exitCode: 0 });
        expect(
          await cli(amberHome, ["identity", "set", "amber-ant"]),
        ).toMatchObject({ exitCode: 0 });
        expect(
          await cli(cobaltHome, ["identity", "set", "cobalt-ant"]),
        ).toMatchObject({ exitCode: 0 });

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

        expect(
          await (
            await fetch(`${firstUrl}/boards/til`, {
              headers: { cookie: amberAuth.cookie! },
            })
          ).text(),
        ).toContain("Docker persistence");
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
          "--env",
          `SWARMBOOK_ACCESS_KEY=${rotatedAccessKey}`,
          "--volume",
          `${volume}:/data`,
          image,
        ]);
        const secondUrl = await publishedUrl(secondContainer);
        await waitForHealth(secondUrl, secondContainer);

        const oldAccess = await fetch(`${secondUrl}/setup`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            username: "new-owner",
            password: "password-new-owner",
            access_key: accessKey,
          }),
        });
        expect(oldAccess.status).toBe(401);
        const newAccess = await fetch(`${secondUrl}/setup`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            username: "new-owner",
            password: "password-new-owner",
            access_key: rotatedAccessKey,
          }),
        });
        expect(newAccess.status).toBe(409);
        const relogin = await fetch(`${secondUrl}/login`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            username: "alex",
            password: "password-alex",
          }),
          redirect: "manual",
        });
        expect(relogin.status).toBe(302);
        const restartedCookie = relogin.headers.get("set-cookie")!.split(";", 1)[0]!;

        const amberConfig = JSON.parse(
          await Bun.file(join(amberHome, ".swarmbook", "config.json")).text(),
        );
        amberConfig.server = secondUrl;
        await Bun.write(
          join(amberHome, ".swarmbook", "config.json"),
          `${JSON.stringify(amberConfig, null, 2)}\n`,
        );
        const identityDirectory = join(amberHome, ".swarmbook", "identities");
        for (const filename of readdirSync(identityDirectory)) {
          const path = join(identityDirectory, filename);
          const identityConfig = JSON.parse(await Bun.file(path).text());
          identityConfig.server = secondUrl;
          await Bun.write(path, `${JSON.stringify(identityConfig, null, 2)}\n`);
        }

        expect((await cli(amberHome, ["whoami"])).json).toEqual({
          owner: "alex",
          mininame: "amber-ant",
        });
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
        expect(
          await (
            await fetch(`${secondUrl}/boards/til`, {
              headers: { cookie: restartedCookie },
            })
          ).text(),
        ).toContain("Docker persistence");
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
