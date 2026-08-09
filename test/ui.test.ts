import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DatabaseHandle } from "../src/db/database";
import { createDatabase } from "../src/db/database";
import { SwarmbookService } from "../src/core/service";
import { createApp } from "../src/server/app";

let database: DatabaseHandle;
let service: SwarmbookService;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  database = createDatabase(":memory:");
  service = new SwarmbookService(database.db);
  app = createApp(service);
});

afterEach(() => database.close());

describe("server-rendered web UI", () => {
  test("allows open inspection without a browser identity", async () => {
    const key = service.register("amber-ant").key;
    const identity = service.authenticate(key);
    service.startThread(identity, {
      board: "til",
      title: "Visible thread",
      body: "Visible body",
    });

    const home = await app.request("/");
    expect(home.status).toBe(200);
    const html = await home.text();
    expect(html).toContain("Swarmbook");
    expect(html).toContain("Visible body");
    expect(html).toContain("/til/");
    expect(html).toContain("choose identity");
  });

  test("registers a browser identity and posts threads and replies", async () => {
    const registration = await app.request("/register", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ handle: "browser-ant" }),
    });
    expect(registration.status).toBe(302);
    const cookie = registration.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toStartWith("swarmbook_key=");

    const created = await app.request("/threads", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookie!,
      },
      body: new URLSearchParams({
        board: "meta",
        title: "Browser thread",
        body: "<script>plain text only</script>",
      }),
    });
    expect(created.status).toBe(302);
    const location = created.headers.get("location")!;
    expect(location).toMatch(/^\/boards\/meta\/threads\/\d+$/);
    const threadId = Number(location.split("/").pop());
    const threadUrl = location;

    const reply = await app.request(`/threads/${threadId}/replies`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookie!,
      },
      body: new URLSearchParams({ body: "Browser reply" }),
    });
    expect(reply.status).toBe(302);
    expect(reply.headers.get("location")).toMatch(
      new RegExp(`^/boards/meta/threads/${threadId}#post-\\d+$`),
    );

    const legacyThread = await app.request(`/threads/${threadId}`);
    expect(legacyThread.status).toBe(302);
    expect(legacyThread.headers.get("location")).toBe(threadUrl);

    const page = await app.request(threadUrl, { headers: { cookie: cookie! } });
    const html = await page.text();
    expect(html).toContain("Browser thread");
    expect(html).toContain("Browser reply");
    expect(html).toContain("&lt;script&gt;plain text only&lt;/script&gt;");
    expect(html).not.toContain("<script>plain text only</script>");
    expect(html).toContain("browser-ant");
  });

  test("renders board pages and search results", async () => {
    const registration = service.register("amber-ant");
    service.startThread(service.authenticate(registration.key), {
      board: "incidents",
      title: "Unexpected timeout",
      body: "A worker timed out while indexing.",
    });

    const board = await (await app.request("/boards/incidents")).text();
    expect(board).toContain("Unexpected timeout");
    const search = await (await app.request("/search?q=timeout")).text();
    expect(search).toContain("Unexpected timeout");
    expect(search).toContain("[timeout]");
  });

  test("groups board pages into bumped thread previews", async () => {
    const registration = service.register("amber-ant");
    const identity = service.authenticate(registration.key);
    const busy = service.startThread(identity, {
      board: "til",
      title: "Busy thread",
      body: "Opening post stays visible",
    });
    service.reply(identity, busy.id, "Old reply one");
    service.reply(identity, busy.id, "Old reply two");
    service.startThread(identity, {
      board: "til",
      title: "Quieter thread",
      body: "A second opener",
    });
    service.reply(identity, busy.id, "Recent reply three");
    service.reply(identity, busy.id, "Recent reply four");

    const board = await (await app.request("/boards/til")).text();
    expect(board).toContain('class="thread-preview"');
    expect(board).toContain("Opening post stays visible");
    expect(board).toContain("2 replies omitted");
    expect(board).not.toContain("Old reply one");
    expect(board).not.toContain("Old reply two");
    expect(board).toContain("Recent reply three");
    expect(board).toContain("Recent reply four");
    expect(board.indexOf("Busy thread")).toBeLessThan(
      board.indexOf("Quieter thread"),
    );
  });

  test("paginates board threads and redirects past the final page", async () => {
    const registration = service.register("amber-ant");
    const identity = service.authenticate(registration.key);
    service.startThread(identity, {
      board: "meta",
      title: "Oldest marker",
      body: "Only on page two",
    });
    for (let index = 0; index < 14; index += 1) {
      service.startThread(identity, {
        board: "meta",
        title: `Middle thread ${index}`,
        body: "Pagination filler",
      });
    }
    service.startThread(identity, {
      board: "meta",
      title: "Newest marker",
      body: "Only on page one",
    });

    const first = await (await app.request("/boards/meta")).text();
    expect(first).toContain("Newest marker");
    expect(first).not.toContain("Oldest marker");

    const second = await (await app.request("/boards/meta?page=2")).text();
    expect(second).toContain("Oldest marker");
    expect(second).not.toContain("Newest marker");

    const pastEnd = await app.request("/boards/meta?page=99");
    expect(pastEnd.status).toBe(302);
    expect(pastEnd.headers.get("location")).toBe("/boards/meta?page=2");
  });

  test("requires a browser identity only for posting", async () => {
    const response = await app.request("/threads/new");
    expect(response.status).toBe(401);
    expect(await response.text()).toContain("browser_identity_required");
  });
});
