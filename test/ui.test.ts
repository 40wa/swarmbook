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
let browserCookies: Map<string, string>;

beforeEach(() => {
  database = createDatabase(":memory:");
  service = new SwarmbookService(database.db);
  app = createApp(service, { requestLogger: false });
  ownerCredentialKeys = new Map();
  browserCookies = new Map();
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
  const existing = browserCookies.get(owner);
  if (existing) return existing;
  let response: Response;
  if (!service.hasHumanAccounts()) {
    response = await app.request("/setup", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: owner,
        password: `password-${owner}`,
        access_key: "local-swarmbook",
        next: "/",
      }),
    });
  } else {
    const inviter = browserCookies.values().next().value as string;
    const invitation = await app.request("/invites", {
      method: "POST",
      headers: {
        cookie: inviter,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ username: owner }),
    });
    const token = (await invitation.text()).match(/swarmbook_invite_[A-Za-z0-9_-]+/)?.[0];
    expect(token).toBeString();
    response = await app.request(`/invite/${token}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: owner, password: `password-${owner}` }),
    });
  }
  expect(response.status).toBe(302);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  expect(cookie).toContain("swarmbook.session_token=");
  browserCookies.set(owner, cookie!);
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
    expect(html).toContain('src="/assets/swarmbook-logo-horizontal.svg" alt="Swarmbook"');
    expect(html).not.toContain('<h1><a href="/">Swarmbook</a></h1>');
    expect(html).not.toContain('data-header-mcp');
    expect(html).not.toContain('Copy MCP endpoint');
    expect(html).toContain('<nav class="site-nav"><div class="site-links">');
    expect(html).toContain('class="tail-toggle" aria-expanded="false" aria-controls="live-tail"');
    expect(html).toContain('id="live-tail" class="live-tail"');
    expect(html).toContain('class="tail-close" aria-label="Close live posts"');
    expect(html).toContain('<details class="user-menu" data-noswap="1"><summary>alex</summary>');
    expect(html).toContain('href="/quickstart">quickstart</a>');
    expect(html).toContain('href="/users" class="menu-item">Users</a>');
    expect(html).toContain('href="/keys" class="menu-item">Keys</a>');
    expect(html).not.toContain('href="/keys">keys</a>');
    expect(html).not.toContain('href="/threads/new">+thread</a>');
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

  test("renders a one-request live physics graph and self-hosts its canvas library", async () => {
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
    expect(html).toContain('class="board-graph-controls"');
    expect(html).toContain("data-graph-center");
    expect(html).toContain("data-graph-reset");
    expect(html).not.toContain("data-graph-fit");
    expect(html).not.toContain("data-graph-layout");
    expect(html).not.toContain("data-graph-references");
    expect(html).not.toContain("board-graph-legend");
    expect(html.indexOf("board-graph-shell")).toBeLessThan(html.indexOf("<h2>Boards</h2>"));
    expect(html).toContain("Interactive graph of boards, threads, replies, and post references");
    expect(graphScript).toContain("window.ForceGraph");
    expect(() => new Function(graphScript)).not.toThrow();
    expect(graphScript).toContain("cooldownTime(Infinity)");
    expect(graphScript).toContain("d3ReheatSimulation()");
    expect(graphScript).toContain("function gourceHierarchyForce(links)");
    expect(graphScript).toContain("surface-to-surface");
    expect(graphScript).toContain("minimumDistance - distance");
    expect(graphScript).toContain("var targetX = parent.x + branchX / branchLength * restDistance");
    expect(graphScript).toContain("graph.d3Force('gource-hierarchy', gourceHierarchyForce(data.links))");
    expect(graphScript).toContain("d3Force('charge', null)");
    expect(graphScript).toContain("d3Force('link', null)");
    expect(graphScript).toContain("d3Force('center', null)");
    expect(graphScript).toContain("center.addEventListener('click', centerGraph)");
    expect(graphScript).toContain("postsByDistance.length * .98");
    expect(graphScript).toContain("graph.zoomToFit(400, 36");
    expect(graphScript).toContain("graph.d3ReheatSimulation();\n    centerGraph();");
    expect(graphScript).not.toContain("onEngineTick");
    expect(graphScript).not.toContain("globalGravity");
    expect(graphScript).toContain("nodeCanvasObjectMode(function () { return 'replace'; })");
    expect(graphScript).toContain("linkCanvasObjectMode(function () { return 'replace'; })");
    expect(graphScript).toContain("context.shadowBlur");
    expect(graphScript).toContain("link.kind === 'reference' ? .52 : .58");
    expect(graphScript).toContain("link.kind === 'reference' ? .9 : .8");
    expect(graphScript).not.toContain("physics live");
    expect(html).not.toContain("posts · physics live");
    expect(graphScript).toContain("fillText('/' + node.board + '/'");
    expect(graphScript).toContain("randomiseHierarchy(data)");
    expect(graphScript).toContain("var data = graphData(payload);\n    randomiseHierarchy(data);");
    expect(graphScript).not.toContain("ringRadius");
    expect(graphScript).not.toContain("massWellForce");
    expect(graphScript).not.toContain("setTimeout(function ()");
    expect(graphScript).not.toContain("linkVisibility");
    expect(graphScript).toContain("fetch('/graph.json?limit=1000&reference_depth=2'");
    expect(graphScript.match(/fetch\(/g)?.length).toBe(1);
    expect(graphScript).toContain("onNodeClick(function (node) { location.assign(node.url); })");
    expect(graphScript).not.toContain("post.title");
    expect(graphScript).not.toContain("post.preview");

    const forceSourceEnd = graphScript.indexOf("  function graphData");
    const exposed = {} as {
      force: (links: Array<Record<string, string>>) => {
        (alpha: number): void;
        initialize(nodes: Array<Record<string, number | string | undefined>>): void;
      };
    };
    new Function(
      "exposed",
      `${graphScript.slice(0, forceSourceEnd)}exposed.force = gourceHierarchyForce;})();`,
    )(exposed);
    const colliding = [
      { id: "a", kind: "reply", board: "til", x: 0, y: 0, vx: 0, vy: 0 },
      { id: "b", kind: "reply", board: "meta", x: 4, y: 0, vx: 0, vy: 0 },
    ];
    const collisionForce = exposed.force([]);
    collisionForce.initialize(colliding);
    collisionForce(1);
    expect(colliding[0]!.vx).toBeLessThan(0);
    expect(colliding[1]!.vx).toBeGreaterThan(0);

    const hierarchy = [
      { id: "board", kind: "board", postCount: 4, x: 200, y: 0, vx: 0, vy: 0 },
      { id: "thread", kind: "thread", threadSize: 2, x: 250, y: 0, vx: 0, vy: 0 },
      { id: "reply", kind: "reply", x: 250, y: 50, vx: 0, vy: 0 },
    ];
    const hierarchyForce = exposed.force([
      { source: "board", target: "thread", kind: "contains" },
      { source: "thread", target: "reply", kind: "reply" },
    ]);
    hierarchyForce.initialize(hierarchy);
    hierarchyForce(1);
    expect(hierarchy[0]!.vx).toBeLessThan(0);
    expect(hierarchy[2]!.vx).toBeGreaterThan(0);
    expect(hierarchy[2]!.vy).toBeLessThan(0);

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

    const asset = await app.request("/assets/force-graph-1.51.4.min.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toStartWith("text/javascript");
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect((await asset.text()).length).toBeGreaterThan(150_000);

    const mark = await app.request("/assets/swarmbook-mark.svg");
    expect(mark.status).toBe(200);
    expect(mark.headers.get("content-type")).toStartWith("image/svg+xml");
    expect(mark.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await mark.text()).toContain('aria-label="Swarmbook"');
    expect(html).toContain('<link rel="icon" href="/favicon.ico" type="image/x-icon" sizes="16x16 32x32 48x48 64x64"/>');
    expect(html).toContain('<link rel="icon" href="/assets/swarmbook-mark.svg" type="image/svg+xml" sizes="any"/>');

    const favicon = await app.request("/favicon.ico");
    expect(favicon.status).toBe(200);
    expect(favicon.headers.get("content-type")).toStartWith("image/x-icon");
    expect(favicon.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect((await favicon.arrayBuffer()).byteLength).toBeGreaterThan(1_000);

    const horizontalLogo = await app.request("/assets/swarmbook-logo-horizontal.svg");
    expect(horizontalLogo.status).toBe(200);
    expect(horizontalLogo.headers.get("content-type")).toStartWith("image/svg+xml");
    const horizontalLogoSvg = await horizontalLogo.text();
    expect(horizontalLogoSvg).toContain('aria-label="Swarmbook"');
    expect(horizontalLogoSvg).toContain('transform="translate(32 32) scale(1.3) translate(-32 -32)"');
    expect(horizontalLogoSvg).toContain('transform="translate(76 42) scale(.017 -.017)"');
    expect(horizontalLogoSvg).not.toContain("<text");
  });

  test("shows instance-specific global and repository-scoped MCP connection instructions", async () => {
    const cookie = await login();
    const legacy = await app.request("/connect", { headers: { cookie } });
    expect(legacy.status).toBe(302);
    expect(legacy.headers.get("location")).toBe("/quickstart");
    const response = await app.request("/quickstart?tab=agents&mode=repository", { headers: { cookie } });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("http://localhost/mcp");
    expect(html).toContain("Connect agents");
    expect(html).toContain("Invite people");
    expect(html).toContain("Repository-scoped");
    expect(html).toContain("# .codex/config.toml");
    expect(html).toContain("[mcp_servers.swarmbook]");
    expect(html).toContain('url = &quot;http://localhost/mcp&quot;');
    expect(html).toContain("codex mcp login swarmbook");
    expect(html).toContain("Nothing global is added");
    expect(html).not.toContain("Claude Code");
    expect(html).toContain("Recommended agent guidance");
    expect(html).toContain("## Agent coordination");
    expect(html).toContain("Use the Swarmbook MCP as the team");
    expect(html).toContain("private inter-agent bulletin board");
    expect(html).toContain("relevant codepaths or symbols");
    const global = await (
      await app.request("/quickstart?tab=agents&mode=global", { headers: { cookie } })
    ).text();
    expect(global).toContain("codex mcp add swarmbook --url http://localhost/mcp");

    const inviteResponse = await app.request("/invites", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ from: "quickstart" }),
    });
    expect(inviteResponse.status).toBe(200);
    const inviteHtml = await inviteResponse.text();
    expect(inviteHtml).toContain("Copy this invitation now");
    expect(inviteHtml).toContain("swarmbook_invite_");
    expect(inviteHtml).toContain('href="/quickstart?tab=people"');
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

  test("onboards invited humans and manages recoverable instance-wide agent keys", async () => {
    const alexCookie = await login("alex");
    const welcome = await (
      await app.request("/welcome", { headers: { cookie: alexCookie } })
    ).text();
    expect(welcome).toContain("Welcome, alex");
    expect(welcome).toContain("You are now on Swarmbook. Connect your agents and invite your team.");

    const invitation = await app.request("/invites", {
      method: "POST",
      headers: {
        cookie: alexCookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(),
    });
    const invitationHtml = await invitation.text();
    const token = invitationHtml.match(/swarmbook_invite_[A-Za-z0-9_-]+/)?.[0];
    expect(token).toBeString();
    expect(invitationHtml).toContain("Copy this invitation now");
    expect(invitationHtml).toContain("The recipient chooses their username and password");
    expect(
      database.sqlite.query<{ token_hash: string }, []>("select token_hash from human_invites").get()?.token_hash,
    ).not.toBe(token);
    const acceptanceForm = await (await app.request(`/invite/${token}`)).text();
    expect(acceptanceForm).toContain("lets you choose your username");
    expect(acceptanceForm).toContain('name="username"');

    const accepted = await app.request(`/invite/${token}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: "casey", password: "casey-password" }),
    });
    expect(accepted.status).toBe(302);
    expect(accepted.headers.get("location")).toBe("/welcome");
    const caseyCookie = accepted.headers.get("set-cookie")!.split(";", 1)[0]!;
    const account = database.sqlite
      .query<{ password: string }, []>(
        "select password from auth_accounts where provider_id = 'credential'",
      )
      .all()
      .find((row) => row.password !== null);
    expect(account?.password).toBeString();
    expect(account?.password).not.toBe("casey-password");

    const minted = await app.request("/keys", {
      method: "POST",
      headers: {
        cookie: caseyCookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ mininame: "cleanup-cron" }),
    });
    const mintedHtml = await minted.text();
    const key = mintedHtml.match(/swarmbook_[A-Za-z0-9_-]{20,}/)?.[0];
    expect(key).toBeString();
    expect(mintedHtml).toContain("All keys");
    expect(mintedHtml).toContain("<h2>Agent keys</h2>");
    expect(mintedHtml).not.toContain("Keys for headless agents");
    expect(
      database.sqlite.query<{ recoverable_secret: string }, []>(
        "select recoverable_secret from tokens join owners on owners.id = tokens.owner_id where owners.name = 'casey' and tokens.handle = 'cleanup-cron'",
      ).get()?.recoverable_secret,
    ).toBe(key);
    const alexKeys = await (
      await app.request("/keys", { headers: { cookie: alexCookie } })
    ).text();
    expect(alexKeys).toContain(key!);
    expect(alexKeys).toContain("casey/cleanup-cron");
    expect(service.authenticate(key!)).toMatchObject({
      owner: "casey",
      mininame: "cleanup-cron",
    });
    const keyId = database.sqlite.query<{ id: number }, []>(
      "select tokens.id from tokens join owners on owners.id = tokens.owner_id where owners.name = 'casey' and tokens.handle = 'cleanup-cron'",
    ).get()!.id;
    await app.request(`/keys/${keyId}/revoke`, {
      method: "POST",
      headers: { cookie: alexCookie },
    });
    expect(() => service.authenticate(key!)).toThrow("invalid");
    expect((await app.request(`/invite/${token}`)).status).toBe(410);
  });

  test("implicitly attaches an invited signup to an existing owner without a human login", async () => {
    const existingIdentity = agent("historian", "existing-owner");
    const existingOwnerId = database.sqlite.query<{ id: number }, []>(
      "select id from owners where name = 'existing-owner'",
    ).get()!.id;
    const alexCookie = await login("alex");

    const users = await (
      await app.request("/users", { headers: { cookie: alexCookie } })
    ).text();
    expect(users).toContain("<h2>Users</h2>");
    expect(users).toContain("Team");
    expect(users).toContain("Invites");
    expect(users).not.toContain("Legacy");
    expect(users).not.toContain("existing-owner");

    const invitation = await app.request("/invites", {
      method: "POST",
      headers: { cookie: alexCookie },
    });
    const token = (await invitation.text()).match(/swarmbook_invite_[A-Za-z0-9_-]+/)?.[0];
    expect(token).toBeString();

    const accepted = await app.request(`/invite/${token}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: "existing-owner", password: "existing-password" }),
    });
    expect(accepted.status).toBe(302);
    expect(
      database.sqlite.query<{ owner_id: number }, []>(
        "select owner_id from human_owner_links join auth_users on auth_users.id = human_owner_links.auth_user_id where auth_users.username = 'existing-owner'",
      ).get()?.owner_id,
    ).toBe(existingOwnerId);
    expect(service.authenticate(database.sqlite.query<{ recoverable_secret: string }, [number]>(
      "select recoverable_secret from tokens where id = ?",
    ).get(existingIdentity.tokenId)!.recoverable_secret)).toMatchObject({
      owner: "existing-owner",
      mininame: "historian",
    });
  });

  test("rejects a bad bootstrap key and clears the Better Auth session on logout", async () => {
    const bad = await app.request("/setup", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: "alex",
        password: "password-alex",
        access_key: "wrong",
        next: "/",
      }),
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
    expect(logout.headers.get("set-cookie")).toContain("swarmbook.session_token=");
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
