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
  app = createApp(service, { requestLogger: false });
});

afterEach(() => database.close());

function agent(mininame: string, ownerName = "alex") {
  const ownerCredential = service.issueOwnerCredential("local-swarmbook", ownerName);
  const owner = service.authenticateOwner(ownerCredential.key);
  return service.authenticate(service.createAgentIdentity(owner, mininame).key);
}

async function login(owner = "alex"): Promise<string> {
  const response = await app.request("/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      owner,
      access_key: "local-swarmbook",
      next: "/",
    }),
  });
  expect(response.status).toBe(302);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  expect(cookie).toStartWith("swarmbook_owner_key=");
  return cookie!;
}

describe("server-rendered web UI", () => {
  test("protects the entire board UI and live stream", async () => {
    service.startThread(agent("amber-ant"), {
      board: "til",
      title: "Private thread",
      body: "Private body",
    });

    for (const path of ["/", "/boards/til", "/search?q=private", "/stream"]) {
      const response = await app.request(path);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toStartWith("/login?next=");
    }
    const loginPage = await app.request("/login");
    expect(loginPage.status).toBe(200);
    expect(await loginPage.text()).toContain("Server access key");
  });

  test("signs in an owner and posts threads and replies as owner/human", async () => {
    const cookie = await login("alex");

    const created = await app.request("/threads", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie,
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

    const reply = await app.request(`/threads/${threadId}/replies`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie,
      },
      body: new URLSearchParams({
        body: `>>${threadId} and >>999 can both be referenced`,
      }),
    });
    expect(reply.status).toBe(302);
    expect(reply.headers.get("location")).toMatch(
      new RegExp(`^/boards/meta/threads/${threadId}#post-\\d+$`),
    );
    const replyId = Number(reply.headers.get("location")!.split("#post-")[1]);

    const legacyThread = await app.request(`/threads/${threadId}`, {
      headers: { cookie },
    });
    expect(legacyThread.status).toBe(302);
    expect(legacyThread.headers.get("location")).toBe(location);

    const page = await app.request(location, { headers: { cookie } });
    const html = await page.text();
    expect(html).toContain("Browser thread");
    expect(html).toContain(`href="/threads/${threadId}#post-${threadId}"`);
    expect(html).toContain(`&gt;&gt;${threadId}</a>`);
    expect(html).toContain('href="/threads/999#post-999"');
    expect(html).toContain('class="backlinks"');
    expect(html).toContain(`href="/threads/${replyId}#post-${replyId}"`);
    expect(html).toContain("&lt;script&gt;plain text only&lt;/script&gt;");
    expect(html).not.toContain("<script>plain text only</script>");
    expect(html).toContain("alex/human");
    expect(html).toContain('maxlength="1000"');
  });

  test("renders attributed board pages and search results", async () => {
    service.startThread(agent("amber-ant", "alex"), {
      board: "incidents",
      title: "Unexpected timeout",
      body: "A worker timed out while indexing.",
    });
    const cookie = await login("alex");

    const board = await (
      await app.request("/boards/incidents", { headers: { cookie } })
    ).text();
    expect(board).toContain("Unexpected timeout");
    expect(board).toContain("alex/amber-ant");
    const search = await (
      await app.request("/search?q=timeout", { headers: { cookie } })
    ).text();
    expect(search).toContain("Unexpected timeout");
    expect(search).toContain("[timeout]");
    expect(search).toContain("alex/amber-ant");
  });

  test("groups board pages into bumped thread previews", async () => {
    const identity = agent("amber-ant");
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
    const cookie = await login();

    const board = await (
      await app.request("/boards/til", { headers: { cookie } })
    ).text();
    expect(board).toContain('class="thread-preview"');
    expect(board).toContain("Opening post stays visible");
    expect(board).toContain("2 replies omitted");
    expect(board).not.toContain("Old reply one");
    expect(board).not.toContain("Old reply two");
    expect(board).toContain("Recent reply three");
    expect(board).toContain("Recent reply four");
    expect(board.indexOf("Busy thread")).toBeLessThan(board.indexOf("Quieter thread"));
  });

  test("paginates board threads and redirects past the final page", async () => {
    const identity = agent("amber-ant");
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
    const cookie = await login();

    const first = await (
      await app.request("/boards/meta", { headers: { cookie } })
    ).text();
    expect(first).toContain("Newest marker");
    expect(first).not.toContain("Oldest marker");

    const second = await (
      await app.request("/boards/meta?page=2", { headers: { cookie } })
    ).text();
    expect(second).toContain("Oldest marker");
    expect(second).not.toContain("Newest marker");

    const pastEnd = await app.request("/boards/meta?page=99", {
      headers: { cookie },
    });
    expect(pastEnd.status).toBe(302);
    expect(pastEnd.headers.get("location")).toBe("/boards/meta?page=2");
  });

  test("rejects a bad access key and clears the owner cookie on logout", async () => {
    const bad = await app.request("/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ owner: "alex", access_key: "wrong", next: "/" }),
    });
    expect(bad.status).toBe(401);
    expect(await bad.text()).toContain("server access key is invalid");

    const cookie = await login();
    const logout = await app.request("/logout", {
      method: "POST",
      headers: { cookie },
    });
    expect(logout.status).toBe(302);
    expect(logout.headers.get("location")).toBe("/login");
    expect(logout.headers.get("set-cookie")).toContain("swarmbook_owner_key=");
  });
});
