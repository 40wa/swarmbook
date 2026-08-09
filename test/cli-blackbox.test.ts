import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DatabaseHandle } from "../src/db/database";
import { createDatabase } from "../src/db/database";
import { SwarmbookService } from "../src/core/service";
import { createApp } from "../src/server/app";

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  json: Record<string, any> | undefined;
}

const projectRoot = resolve(import.meta.dir, "..");
const bun = Bun.which("bun") ?? process.execPath;
let database: DatabaseHandle;
let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let amberHome: string;
let cobaltHome: string;

beforeAll(() => {
  database = createDatabase(":memory:");
  const service = new SwarmbookService(database.db, { threadPostLimit: 3 });
  const app = createApp(service);
  server = Bun.serve({ port: 0, fetch: app.fetch });
  baseUrl = `http://127.0.0.1:${server.port}`;
  amberHome = mkdtempSync(join(tmpdir(), "swarmbook-amber-"));
  cobaltHome = mkdtempSync(join(tmpdir(), "swarmbook-cobalt-"));
});

afterAll(() => {
  server.stop(true);
  database.close();
  rmSync(amberHome, { recursive: true, force: true });
  rmSync(cobaltHome, { recursive: true, force: true });
});

async function cli(home: string, args: string[], stdin?: string): Promise<CliResult> {
  const child = Bun.spawn({
    cmd: [bun, "src/cli/main.ts", ...args],
    cwd: projectRoot,
    env: { ...process.env, HOME: home },
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  let parsed: Record<string, any> | undefined;
  try {
    parsed = stdout ? (JSON.parse(stdout) as Record<string, any>) : undefined;
  } catch {
    parsed = undefined;
  }
  return { stdout, stderr, exitCode, json: parsed };
}

describe("CLI as a separate process", () => {
  test("runs the complete command surface with isolated stored identities", async () => {
    const amberAuth = await cli(amberHome, [
      "auth",
      "--server",
      baseUrl,
      "--name",
      "amber-ant",
    ]);
    expect(amberAuth).toMatchObject({ exitCode: 0, stderr: "" });
    expect(amberAuth.json).toEqual({ handle: "amber-ant", server: baseUrl });

    const configPath = join(amberHome, ".swarmbook", "config.json");
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(configPath, "utf8")).toContain("amber-ant");

    const cobaltAuth = await cli(cobaltHome, [
      "auth",
      "--server",
      baseUrl,
      "--name",
      "cobalt-ant",
    ]);
    expect(cobaltAuth.json?.handle).toBe("cobalt-ant");

    expect((await cli(amberHome, ["whoami"])).json).toEqual({ handle: "amber-ant" });
    expect((await cli(amberHome, ["boards"])).json?.boards).toHaveLength(3);

    const opening = await cli(amberHome, [
      "start",
      "til",
      "CLI black-box thread",
      "--body",
      "Opening body",
    ]);
    expect(opening).toMatchObject({ exitCode: 0, stderr: "" });
    expect(opening.json?.id).toBeNumber();

    const reply = await cli(cobaltHome, [
      "reply",
      String(opening.json?.id),
      "--body",
      "Reply from cobalt",
    ]);
    expect(reply.json?.id).toBeNumber();

    const thread = await cli(amberHome, ["read", String(reply.json?.id)]);
    expect(thread.json).toMatchObject({
      thread_id: opening.json?.id,
      posts: [
        { author: "amber-ant", body: "Opening body" },
        { author: "cobalt-ant", body: "Reply from cobalt" },
      ],
    });

    const recent = await cli(amberHome, [
      "recent",
      "--since",
      String(opening.json?.id),
      "--by",
      "cobalt-ant",
      "--board",
      "til",
    ]);
    expect(recent.json).toMatchObject({ posts: [{ id: reply.json?.id }] });

    const search = await cli(amberHome, ["search", "cobalt", "--board", "til"]);
    expect(search.json).toMatchObject({ results: [{ post_id: reply.json?.id }] });

    const finalReply = await cli(
      amberHome,
      ["reply", String(reply.json?.id)],
      "Thread cap",
    );
    expect(finalReply.exitCode).toBe(0);

    const full = await cli(
      cobaltHome,
      ["reply", String(opening.json?.id)],
      "Rejected",
    );
    expect(full.exitCode).toBe(1);
    expect(full.stdout).toBe("");
    expect(JSON.parse(full.stderr)).toMatchObject({ error: "thread_full" });

    const successor = await cli(
      cobaltHome,
      [
        "start",
        "til",
        "CLI black-box thread, continued",
        "--successor-of",
        String(reply.json?.id),
        "--body",
        "Continuation",
      ],
    );
    expect(successor.json?.id).toBeNumber();
  }, 20_000);

  test("emits JSON errors on stderr with a failing exit code", async () => {
    const unconfiguredHome = mkdtempSync(join(tmpdir(), "swarmbook-none-"));
    try {
      const missing = await cli(unconfiguredHome, ["whoami"]);
      expect(missing).toMatchObject({ exitCode: 1, stdout: "" });
      expect(JSON.parse(missing.stderr)).toEqual({
        error: "not_authenticated",
        message: "Run `swarmbook auth` first.",
      });

      const unknown = await cli(unconfiguredHome, ["does-not-exist"]);
      expect(unknown.exitCode).toBe(1);
      expect(JSON.parse(unknown.stderr)).toMatchObject({ error: "invalid_command" });
    } finally {
      rmSync(unconfiguredHome, { recursive: true, force: true });
    }
  });

  test("supports the interactive auth prompts without polluting JSON stdout", async () => {
    const promptedHome = mkdtempSync(join(tmpdir(), "swarmbook-prompted-"));
    try {
      const result = await cli(
        promptedHome,
        ["auth"],
        `${baseUrl}\nprompted-ant\n`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.json).toEqual({ handle: "prompted-ant", server: baseUrl });
      expect(result.stderr).toContain("Server [http://localhost:3000]");
      expect(result.stderr).toContain("Choose a mininame");
    } finally {
      rmSync(promptedHome, { recursive: true, force: true });
    }
  });

  test("logout removes only the local credential", async () => {
    expect((await cli(amberHome, ["logout"])).json).toEqual({ logged_out: true });
    const whoami = await cli(amberHome, ["whoami"]);
    expect(whoami.exitCode).toBe(1);
    expect(JSON.parse(whoami.stderr).error).toBe("not_authenticated");
  });
});
