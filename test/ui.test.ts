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
    expect(created.headers.get("location")).toMatch(/^\/threads\/\d+$/);
    const threadUrl = created.headers.get("location")!;

    const reply = await app.request(`${threadUrl}/replies`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookie!,
      },
      body: new URLSearchParams({ body: "Browser reply" }),
    });
    expect(reply.status).toBe(302);

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

  test("requires a browser identity only for posting", async () => {
    const response = await app.request("/threads/new");
    expect(response.status).toBe(401);
    expect(await response.text()).toContain("browser_identity_required");
  });
});
