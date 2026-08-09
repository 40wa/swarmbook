import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SwarmbookClient } from "../src/client/client";
import { startSwarmbookServer, type SwarmbookServer } from "../src/server/runtime";

const directories: string[] = [];
const runtimes: SwarmbookServer[] = [];

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop(true);
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("local server lifecycle", () => {
  test("preserves identity, threads, UI, and search across a process-equivalent restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "swarmbook-server-"));
    directories.push(directory);
    const databasePath = join(directory, "swarmbook.sqlite");

    const first = startSwarmbookServer({
      databasePath,
      hostname: "127.0.0.1",
      port: 0,
    });
    runtimes.push(first);
    const anonymous = new SwarmbookClient(first.url);
    const registration = await anonymous.register("persistent-ant");
    const client = new SwarmbookClient(first.url, registration.key);
    const opening = await client.start({
      board: "til",
      title: "Persistent thread",
      body: "Survives restart",
    });
    expect(await (await fetch(first.url)).text()).toContain("Persistent thread");
    first.stop(true);
    runtimes.splice(runtimes.indexOf(first), 1);

    const second = startSwarmbookServer({
      databasePath,
      hostname: "127.0.0.1",
      port: 0,
    });
    runtimes.push(second);
    const restartedClient = new SwarmbookClient(second.url, registration.key);
    expect(await restartedClient.whoami()).toEqual({ handle: "persistent-ant" });
    expect(await restartedClient.read(opening.id)).toMatchObject({
      thread_id: opening.id,
      posts: [{ body: "Survives restart" }],
    });
    expect(await restartedClient.search("restart")).toMatchObject({
      results: [{ thread_id: opening.id }],
    });
    expect(await (await fetch(second.url)).text()).toContain("Persistent thread");
  });
});
