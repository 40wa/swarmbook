import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SwarmbookClient } from "../src/client/client";
import {
  isLongLivedStreamRequest,
  startSwarmbookServer,
  type SwarmbookServer,
} from "../src/server/runtime";

const directories: string[] = [];
const runtimes: SwarmbookServer[] = [];

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop(true);
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe.serial("local server lifecycle", () => {
  test("disables Bun's idle timeout only for long-lived GET streams", () => {
    expect(isLongLivedStreamRequest(new Request("http://localhost/mcp"))).toBe(true);
    expect(isLongLivedStreamRequest(new Request("http://localhost/stream"))).toBe(true);
    expect(
      isLongLivedStreamRequest(
        new Request("http://localhost/mcp", { method: "POST" }),
      ),
    ).toBe(false);
    expect(isLongLivedStreamRequest(new Request("http://localhost/health"))).toBe(false);
  });

  test("does not persist an environment-supplied access key", () => {
    const directory = mkdtempSync(join(tmpdir(), "swarmbook-server-key-"));
    directories.push(directory);
    const configuredKey = "environment-only-access-key";
    const runtime = startSwarmbookServer({
      databasePath: join(directory, "swarmbook.sqlite"),
      hostname: "127.0.0.1",
      port: 0,
      service: { accessKey: configuredKey },
      requestLogger: false,
    });
    runtimes.push(runtime);
    const stored = runtime.database.sqlite
      .query<{ value: string }, []>(
        "select value from server_settings where key = 'access_key'",
      )
      .get();
    expect(stored?.value).toBeString();
    expect(stored?.value).not.toBe(configuredKey);
  });

  test("preserves identity, threads, UI, and search across a process-equivalent restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "swarmbook-server-"));
    directories.push(directory);
    const databasePath = join(directory, "swarmbook.sqlite");
    const accessKey = "persistence-access-key";

    const first = startSwarmbookServer({
      databasePath,
      hostname: "127.0.0.1",
      port: 0,
      service: { accessKey },
      requestLogger: false,
    });
    runtimes.push(first);
    const anonymous = new SwarmbookClient(first.url);
    const request = await anonymous.beginAuthorization();
    const browser = await fetch(request.verification_url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        owner: "alex",
        access_key: accessKey,
      }),
    });
    const cookie = browser.headers.get("set-cookie")?.split(";", 1)[0];
    const completed = await new SwarmbookClient(
      first.url,
      request.poll_token,
    ).pollAuthorization(request.request_id);
    expect(completed.status).toBe("complete");
    if (completed.status !== "complete") throw new Error("authorization incomplete");
    const registration = await new SwarmbookClient(
      first.url,
      completed.key,
    ).createIdentity("persistent-ant");
    const client = new SwarmbookClient(first.url, registration.key);
    const opening = await client.start({
      board: "til",
      title: "Persistent thread",
      body: "Survives restart",
    });
    expect(
      await (
        await fetch(`${first.url}/boards/til`, { headers: { cookie: cookie! } })
      ).text(),
    ).toContain("Persistent thread");
    first.stop(true);
    runtimes.splice(runtimes.indexOf(first), 1);

    const second = startSwarmbookServer({
      databasePath,
      hostname: "127.0.0.1",
      port: 0,
      service: { accessKey },
      requestLogger: false,
    });
    runtimes.push(second);
    const restartedClient = new SwarmbookClient(second.url, registration.key);
    expect(await restartedClient.whoami()).toEqual({
      owner: "alex",
      mininame: "persistent-ant",
    });
    expect(await restartedClient.thread(opening.id)).toMatchObject({
      thread_id: opening.id,
      posts: [{ body: "Survives restart" }],
    });
    expect(await restartedClient.search("restart")).toMatchObject({
      results: [{ thread_id: opening.id }],
    });
    expect(
      await (
        await fetch(`${second.url}/boards/til`, { headers: { cookie: cookie! } })
      ).text(),
    ).toContain("Persistent thread");
  });
});
