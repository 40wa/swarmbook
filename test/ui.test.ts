import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DatabaseHandle } from "../src/db/database";
import { createDatabase } from "../src/db/database";
import { SwarmbookService } from "../src/core/service";
import { createApp } from "../src/server/app";
import { graphScript } from "../src/ui/scripts/graph";
import { liveTailScript } from "../src/ui/scripts/live-tail";
import { navigationScript } from "../src/ui/scripts/navigation";
import { postRefScript } from "../src/ui/scripts/post-refs";
import { THEMES, themeScript } from "../src/ui/scripts/theme";
import { styles } from "../src/ui/styles";

let database: DatabaseHandle;
let service: SwarmbookService;
let app: ReturnType<typeof createApp>;
let ownerCredentialKeys: Map<string, string>;

beforeEach(() => {
  database = createDatabase(":memory:");
  service = new SwarmbookService(database.db);
  app = createApp(service, { requestLogger: false });
  ownerCredentialKeys = new Map();
});

afterEach(() => database.close());

function agent(mininame: string, ownerName = "alex") {
  let ownerKey = ownerCredentialKeys.get(ownerName);
  if (!ownerKey) {
    ownerKey = service.issueOwnerCredential("local-swarmbook", ownerName).key;
    ownerCredentialKeys.set(ownerName, ownerKey);
  }
  const owner = service.authenticateOwner(ownerKey);
  return service.authenticate(service.createAgentIdentity(owner, mininame).key);
}

async function login(owner = "alex"): Promise<string> {
  const existing = ownerCredentialKeys.get(owner);
  if (existing) return `swarmbook_owner_key=${existing}`;
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
  ownerCredentialKeys.set(owner, cookie!.slice("swarmbook_owner_key=".length));
  return cookie!;
}

describe("server-rendered web UI", () => {
  test("renders every theme with a complete palette and stable picker controls", async () => {
    const cookie = await login();
    const html = await (
      await app.request("/", { headers: { cookie } })
    ).text();

    for (const theme of THEMES) {
      expect(html).toContain(`data-theme-id="${theme.id}"`);
      expect(html).toContain(`data-theme="${theme.id}"`);
      expect(html).toContain(theme.label);
    }
    expect(html.match(/class="theme-option(?: |")/g)?.length).toBe(THEMES.length);
    expect(themeScript).toContain("localStorage.setItem(key, selected)");
    expect(themeScript).not.toContain("addEventListener('focus'");
    for (const theme of THEMES.filter((item) => item.id !== "system")) {
      expect(styles).toContain(`html[data-theme="${theme.id}"]`);
      expect(html).toContain(`html[data-theme="${theme.id}"]`);
    }
    expect(html).not.toContain("html[data-theme=&quot;");
    expect(styles).not.toContain("background: Canvas");
  });

  test("uses one global main-content navigator and leaves the live tail mounted", async () => {
    const cookie = await login();
    const html = await (
      await app.request("/", { headers: { cookie } })
    ).text();

    expect(html).toContain('data-shell="owner:alex"');
    expect(html).toContain('<nav class="site-nav"><div class="site-links">');
    expect(html).toContain('class="tail-toggle" aria-expanded="false" aria-controls="live-tail"');
    expect(html).toContain('id="live-tail" class="live-tail"');
    expect(html).toContain('class="tail-close" aria-label="Close live posts"');
    expect(html).toContain('<details class="user-menu" data-noswap="1"><summary>alex</summary>');
    expect(html).not.toContain('class="chev"');
    expect(navigationScript).toContain("document.addEventListener('click'");
    expect(navigationScript).toContain("main.replaceWith(nextMain)");
    expect(navigationScript).toContain("tail.scrollTop = tailScroll");
    expect(liveTailScript).not.toContain("partialSwap");
    expect(liveTailScript).toContain("document.body.classList.add('tail-open')");
    expect(liveTailScript).toContain("close.addEventListener('click'");
    expect(postRefScript).not.toContain("scrollIntoView");
    expect(postRefScript).toContain("fetch(anchor.href");
    expect(postRefScript).toContain("page.getElementById('post-' + targetId)");
    expect(postRefScript).toContain("Opens this post on another page ↗");
    expect(postRefScript).not.toContain("is not on this page");
    expect(styles).toContain("--shell-header-height: 3.5rem");
    expect(styles).toContain("min-height: 0; overflow-y: auto");
    expect(styles).toContain("flex: 0 0 var(--shell-header-height)");
    expect(styles).toContain("padding: 1.25rem .5rem 3rem");
    expect(styles).toContain("width: 100%; margin: 0");
    expect(styles).toContain("padding-right: max(1.75rem, calc(50% - 490px + .5rem))");
    expect(styles).toContain("header.site .site-nav");
    expect(styles).toContain("min-width: 0; overflow: visible");
    expect(styles).toContain("header.site .site-links");
    expect(styles).toContain("min-width: 0; overflow-x: auto");
    expect(styles).toContain("@media (min-width: 1000px) { .tail-toggle { display: none; } }");
  });

  test("renders a one-request interactive post graph and self-hosts its canvas library", async () => {
    const identity = agent("graph-ant");
    const older = service.startThread(identity, {
      board: "til",
      title: "Graph target",
      body: "An older graph node.",
    });
    const newer = service.startThread(identity, {
      board: "meta",
      title: "Graph source",
      body: `Connect this node to >>${older.id}.`,
    });
    const cookie = await login();

    const html = await (await app.request("/", { headers: { cookie } })).text();
    expect(html).toContain('id="board-graph-title">Post graph</h2>');
    expect(html).toContain("data-board-graph");
    expect(html).toContain("data-graph-references");
    expect(html).toContain("Interactive graph of boards, threads, replies, and post references");
    expect(graphScript).toContain("window.cytoscape");
    expect(() => new Function(graphScript)).not.toThrow();
    expect(graphScript).toContain("name: 'cose'");
    expect(graphScript).toContain("fetch('/graph.json?limit=200&reference_depth=2'");
    expect(graphScript.match(/fetch\(/g)?.length).toBe(1);
    expect(graphScript).toContain("location.assign(event.target.data('href'))");

    const unauthorized = await app.request("/graph.json");
    expect(unauthorized.status).toBe(302);
    expect(unauthorized.headers.get("location")).toStartWith("/login?next=");

    const response = await app.request("/graph.json?limit=10&reference_depth=2", {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toStartWith("application/json");
    expect(await response.json()).toMatchObject({
      limit: 10,
      reference_depth: 2,
      total_posts: 2,
      truncated: false,
      posts: [{ id: older.id }, { id: newer.id }],
      edges: expect.arrayContaining([{
        source: `post:${newer.id}`,
        target: `post:${older.id}`,
        kind: "reference",
      }]),
    });

    const asset = await app.request("/assets/cytoscape-3.34.0.min.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toStartWith("text/javascript");
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect((await asset.text()).length).toBeGreaterThan(400_000);
  });

  test("shows instance-specific global and repository-scoped MCP connection instructions", async () => {
    const cookie = await login();
    const response = await app.request("/connect", { headers: { cookie } });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("http://localhost/mcp");
    expect(html).toContain("Option A: global");
    expect(html).toContain("codex mcp add swarmbook --url http://localhost/mcp");
    expect(html).toContain("Option B: repository-scoped (recommended)");
    expect(html).toContain("# .codex/config.toml");
    expect(html).toContain("[mcp_servers.swarmbook]");
    expect(html).toContain('url = &quot;http://localhost/mcp&quot;');
    expect(html).toContain("codex mcp login swarmbook");
    expect(html).toContain("adds nothing globally");
    expect(html).not.toContain("Claude Code");
    expect(html).toContain("No Swarmbook package or local MCP process is installed.");
    expect(html).toContain("Recommended agent guidance");
    expect(html).toContain("## Agent coordination");
    expect(html).toContain("Use the Swarmbook MCP as the team");
    expect(html).toContain("private inter-agent bulletin board");
    expect(html).toContain("relevant codepaths or symbols");
  });

  test("renders two-line board rows and edits board names and descriptions from the board menu", async () => {
    const cookie = await login();
    const board = service.listBoards().boards.find((candidate) => candidate.name === "til")!;
    const initial = await (await app.request("/", { headers: { cookie } })).text();

    expect(initial).toContain('class="stats board-stats"');
    expect(initial).toContain(`action="/admin/boards/${board.id}/name"`);
    expect(initial).toContain('class="board-name-form"');
    expect(initial).toContain(`action="/admin/boards/${board.id}/description"`);
    expect(initial).toContain('class="board-description-form"');
    expect(styles).toContain('grid-template-areas: "name stats action" "desc desc desc"');
    expect(styles).toContain("width: min(28rem");
    expect(styles).toContain("min-height: 7rem");
    expect(styles).toContain("font-size: .78rem");
    expect(styles).toContain("font-size: .8rem");
    expect(styles).toContain("font-size: .86rem");

    const updated = await app.request(`/admin/boards/${board.id}/description`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie,
      },
      body: new URLSearchParams({ description: "Hard-won technical learnings." }),
    });
    expect(updated.status).toBe(302);
    expect(updated.headers.get("location")).toBe("/");

    const renamed = await app.request(`/admin/boards/${board.id}/name`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie,
      },
      body: new URLSearchParams({ name: "learnings" }),
    });
    expect(renamed.status).toBe(302);
    expect(renamed.headers.get("location")).toBe("/");

    const refreshed = await (await app.request("/", { headers: { cookie } })).text();
    expect(refreshed).toContain("Hard-won technical learnings.");
    expect(refreshed).toContain('href="/boards/learnings"');
    expect((await app.request("/boards/learnings", { headers: { cookie } })).status).toBe(200);
    expect((await app.request("/boards/til", { headers: { cookie } })).status).toBe(404);
  });

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
    expect(service.getPost(threadId)).toMatchObject({ owner: "alex", mininame: null });
    expect(service.getPost(replyId)).toMatchObject({ owner: "alex", mininame: null });
    expect(html).toContain('<span class="author">alex</span>');
    expect(html).not.toContain("alex/human");
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
