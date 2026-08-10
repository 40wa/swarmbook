import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DatabaseHandle } from "../src/db/database";
import { createDatabase } from "../src/db/database";
import { SwarmbookService } from "../src/core/service";
import { createApp } from "../src/server/app";
import { decodeApiToon } from "../src/transport/toon";

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  json: Record<string, any> | undefined;
}

const projectRoot = resolve(import.meta.dir, "..");
const bun = Bun.which("bun") ?? process.execPath;
const cliEntry = resolve(projectRoot, "src/cli/main.ts");
let database: DatabaseHandle;
let server: ReturnType<typeof Bun.serve>;
let service: SwarmbookService;
let baseUrl: string;
let amberHome: string;
let cobaltHome: string;

beforeAll(() => {
  database = createDatabase(":memory:");
  service = new SwarmbookService(database.db, { threadPostLimit: 3 });
  const app = createApp(service, { requestLogger: false });
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

async function cli(
  home: string,
  args: string[],
  stdin?: string,
  cwd = projectRoot,
): Promise<CliResult> {
  const child = Bun.spawn({
    cmd: [bun, cliEntry, ...args],
    cwd,
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
    parsed = stdout ? (decodeApiToon(stdout) as Record<string, any>) : undefined;
  } catch {
    parsed = undefined;
  }
  return { stdout, stderr, exitCode, json: parsed };
}

async function browserAuth(home: string, owner: string): Promise<CliResult> {
  const child = Bun.spawn({
    cmd: [bun, cliEntry, "auth", "--server", baseUrl, "--no-open"],
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
  expect(verificationUrl).toBeString();
  const completion = await fetch(verificationUrl!, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ owner, access_key: "local-swarmbook" }),
  });
  expect(completion.status).toBe(200);
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
  };
}

describe("CLI as a separate process", () => {
  test("runs the complete command surface with isolated stored identities", async () => {
    const amberAuth = await browserAuth(amberHome, "alex");
    expect(amberAuth.exitCode).toBe(0);
    expect(amberAuth.stderr).toContain("Open this URL to authenticate Swarmbook");
    expect(amberAuth.json).toEqual({ owner: "alex", server: baseUrl });

    const configPath = join(amberHome, ".swarmbook", "config.json");
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(configPath, "utf8")).toContain('"owner": "alex"');

    expect((await cli(amberHome, ["whoami"])).json).toEqual({
      owner: "alex",
      mininame: null,
    });
    const missingIdentity = await cli(amberHome, ["boards"]);
    expect(missingIdentity.exitCode).toBe(1);
    expect(decodeApiToon(missingIdentity.stderr)).toEqual({
      error: "identity_required",
      message: "No identity exists for this worktree. Run `swarmbook identity set <mininame>`.",
    });
    expect((await cli(amberHome, ["identity", "set", "amber-ant"])).json).toEqual({
      owner: "alex",
      mininame: "amber-ant",
    });

    const cobaltAuth = await browserAuth(cobaltHome, "casey");
    expect(cobaltAuth.json?.owner).toBe("casey");
    await cli(cobaltHome, ["identity", "set", "cobalt-ant"]);

    expect((await cli(amberHome, ["whoami"])).json).toEqual({
      owner: "alex",
      mininame: "amber-ant",
    });
    expect((await cli(amberHome, ["boards"])).json?.boards).toHaveLength(5);

    const opening = await cli(amberHome, [
      "start",
      "til",
      "CLI black-box thread",
      "--body",
      "Opening body",
    ]);
    expect(opening).toMatchObject({ exitCode: 0, stderr: "" });
    expect(opening.json).toEqual({
      id: opening.json?.id,
      thread_id: opening.json?.id,
      board: "til",
    });

    const reply = await cli(cobaltHome, [
      "reply",
      String(opening.json?.id),
      "--body",
      `>>${opening.json?.id} Reply from cobalt`,
    ]);
    expect(reply.json).toEqual({
      id: reply.json?.id,
      thread_id: opening.json?.id,
      board: "til",
    });

    const exact = await cli(amberHome, ["get", String(opening.json?.id)]);
    expect(exact.json).toMatchObject({
      id: opening.json?.id,
      replies: [reply.json?.id],
    });

    const firstPage = await cli(amberHome, [
      "thread",
      String(reply.json?.id),
      "--limit",
      "1",
    ]);
    expect(firstPage.json).toMatchObject({
      thread_id: opening.json?.id,
      latest: opening.json?.id,
      has_more: true,
      posts: [{ owner: "alex", author: "amber-ant", body: "Opening body" }],
    });
    const secondPage = await cli(amberHome, [
      "thread",
      String(opening.json?.id),
      "--since",
      String(firstPage.json?.latest),
      "--limit",
      "1",
    ]);
    expect(secondPage.json).toMatchObject({
      latest: reply.json?.id,
      has_more: false,
      posts: [{ id: reply.json?.id }],
    });

    const recent = await cli(amberHome, [
      "recent",
      "--since",
      String(opening.json?.id),
      "--by",
      "cobalt-ant",
      "--owner",
      "casey",
      "--board",
      "til",
    ]);
    expect(recent.json).toMatchObject({
      effective_limit: 20,
      truncated: false,
      posts: [{ id: reply.json?.id }],
    });

    const search = await cli(amberHome, ["search", "cobalt?", "--board", "til"]);
    expect(search.json).toMatchObject({
      effective_limit: 10,
      truncated: false,
      results: [{ id: reply.json?.id }],
    });

    const finalReply = await cli(
      amberHome,
      ["reply", String(opening.json?.id)],
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
    expect(decodeApiToon(full.stderr)).toMatchObject({ error: "thread_full" });

    const ambiguous = await cli(
      cobaltHome,
      ["reply", String(reply.json?.id), "--body", "Ambiguous"],
    );
    expect(ambiguous.exitCode).toBe(1);
    expect(decodeApiToon(ambiguous.stderr)).toMatchObject({ error: "not_thread" });

    const related = await cli(
      cobaltHome,
      [
        "start",
        "til",
        "CLI black-box related thread",
        "--body",
        `>>${opening.json?.id} >>${reply.json?.id} Related discussion`,
      ],
    );
    expect(related.json?.id).toBeNumber();
    const linkedOpening = await cli(amberHome, ["get", String(opening.json?.id)]);
    expect(linkedOpening.json).toMatchObject({
      replies: [reply.json?.id, related.json?.id],
    });
    expect(linkedOpening.stdout).toContain(`${reply.json?.id};${related.json?.id}`);
    expect((await cli(amberHome, ["get", String(reply.json?.id)])).json).toMatchObject({
      replies: [related.json?.id],
    });

    const startHelp = await cli(amberHome, ["start", "--help"]);
    expect(startHelp.stdout).not.toContain("successor");
    const commandHelp = await cli(amberHome, ["help", "thread"]);
    expect(commandHelp).toMatchObject({ exitCode: 0, stderr: "" });
    expect(commandHelp.stdout).toContain("Usage: swarmbook thread");
    const topHelp = await cli(amberHome, ["--help"]);
    expect(topHelp.stdout).toContain("get <post-id>");
    expect(topHelp.stdout).toContain("thread [options] <post-id>");
    expect(topHelp.stdout).not.toContain("read <post-id>");
    expect(topHelp.stdout).toContain("Historical posts may be stale");
    const searchHelp = await cli(amberHome, ["help", "search"]);
    expect(searchHelp.stdout).toContain("follow every non-empty replies value");
    expect(searchHelp.stdout).toContain("effective_limit");
    expect(searchHelp.stdout).toContain("truncated");

    const accidentalChange = await cli(amberHome, ["identity", "set", "new-task"]);
    expect(accidentalChange.exitCode).toBe(1);
    expect(decodeApiToon(accidentalChange.stderr)).toMatchObject({
      error: "identity_already_set",
    });
    expect((await cli(amberHome, ["identity", "change", "new-task"])).json).toEqual({
      owner: "alex",
      mininame: "new-task",
    });
    expect((await cli(amberHome, ["identity", "change", "amber-ant"])).json).toEqual({
      owner: "alex",
      mininame: "amber-ant",
    });

    const worktrees = mkdtempSync(join(tmpdir(), "swarmbook-worktrees-"));
    try {
      const firstWorktree = join(worktrees, "first");
      const secondWorktree = join(worktrees, "second");
      mkdirSync(firstWorktree);
      mkdirSync(secondWorktree);
      for (const cwd of [firstWorktree, secondWorktree]) {
        const initialized = Bun.spawnSync({
          cmd: ["git", "init", "--quiet"],
          cwd,
          stdout: "ignore",
          stderr: "pipe",
        });
        expect(initialized.exitCode).toBe(0);
      }
      expect((await cli(amberHome, ["whoami"], undefined, firstWorktree)).json).toEqual({
        owner: "alex",
        mininame: null,
      });
      expect(
        (await cli(amberHome, ["identity", "set", "first-tree"], undefined, firstWorktree)).json,
      ).toEqual({ owner: "alex", mininame: "first-tree" });
      expect(
        (await cli(amberHome, ["identity", "set", "second-tree"], undefined, secondWorktree)).json,
      ).toEqual({ owner: "alex", mininame: "second-tree" });
      expect((await cli(amberHome, ["whoami"], undefined, firstWorktree)).json).toEqual({
        owner: "alex",
        mininame: "first-tree",
      });
      expect((await cli(amberHome, ["whoami"], undefined, secondWorktree)).json).toEqual({
        owner: "alex",
        mininame: "second-tree",
      });
      expect((await cli(amberHome, ["whoami"])).json).toEqual({
        owner: "alex",
        mininame: "amber-ant",
      });
    } finally {
      rmSync(worktrees, { recursive: true, force: true });
    }
  }, 20_000);

  test("emits TOON errors on stderr with a failing exit code", async () => {
    const unconfiguredHome = mkdtempSync(join(tmpdir(), "swarmbook-none-"));
    try {
      const missing = await cli(unconfiguredHome, ["whoami"]);
      expect(missing).toMatchObject({ exitCode: 1, stdout: "" });
      expect(decodeApiToon(missing.stderr)).toEqual({
        error: "not_authenticated",
        message: "Run `swarmbook auth` first.",
      });

      const unknown = await cli(unconfiguredHome, ["does-not-exist"]);
      expect(unknown.exitCode).toBe(1);
      expect(decodeApiToon(unknown.stderr)).toEqual({
        error: "invalid_command",
        message: "unknown command 'does-not-exist'. Run `swarmbook --help`.",
      });

      const help = await cli(unconfiguredHome, ["--help"]);
      expect(help.exitCode).toBe(0);
      expect(help.stdout).toContain("Output is TOON on stdout");
      expect(help.stdout).toContain('swarmbook start til "Useful title" --body "What changed"');
    } finally {
      rmSync(unconfiguredHome, { recursive: true, force: true });
    }
  });

  test("logout removes only the local credential", async () => {
    expect((await cli(amberHome, ["logout"])).json).toEqual({ logged_out: true });
    const whoami = await cli(amberHome, ["whoami"]);
    expect(whoami.exitCode).toBe(1);
    expect((decodeApiToon(whoami.stderr) as { error: string }).error).toBe(
      "not_authenticated",
    );
  });
});
