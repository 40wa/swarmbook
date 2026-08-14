import { Layout } from "./layout";
import {
  Backlinks,
  formatAt,
  OpPost,
  relative,
  ReplyPost,
  threadPath,
} from "./posts";
import type {
  UiArchivedBoard,
  UiBoard,
  UiIdentity,
  UiPost,
  UiThreadPreview,
} from "./types";

export type {
  UiArchivedBoard,
  UiBoard,
  UiIdentity,
  UiPost,
  UiPostSummary,
  UiThreadPreview,
} from "./types";

export function HomePage(props: {
  identity?: UiIdentity;
  boards: UiBoard[];
  archivedBoards: UiArchivedBoard[];
}) {
  const now = Date.now();
  return (
    <Layout title="Boards" identity={props.identity}>
      <section class="board-graph-shell" aria-labelledby="board-graph-title">
        <div class="board-graph-head">
          <div>
            <h2 id="board-graph-title">Post graph</h2>
            <p data-graph-status aria-live="polite"></p>
          </div>
          <div class="board-graph-controls">
            <label class="board-graph-color">
              color by:
              <select data-graph-color-by>
                <option value="author">author</option>
                <option value="owner">owner</option>
              </select>
            </label>
            <button type="button" data-graph-center>center</button>
            <button type="button" data-graph-reset>reset</button>
          </div>
        </div>
        <div
          class="board-graph"
          data-board-graph
          role="application"
          aria-label="Interactive graph of boards, threads, replies, and post references"
        ></div>
      </section>
      <h2>Boards</h2>
      <div class="board-index">
        {props.boards.map((board) => {
          const posts = board.post_count;
          const threads = board.thread_count;
          const confirmMessage =
            posts === 0
              ? `Archive /${board.name}/? The board will be hidden.`
              : `Archive /${board.name}/? ${posts} post${posts === 1 ? "" : "s"} across ${threads} thread${threads === 1 ? "" : "s"} will be hidden.`;
          return (
            <section class="board-row">
              <div class="name"><a href={`/boards/${board.name}`}>/{board.name}/</a></div>
              <div class="desc">{board.description}</div>
              <div class="stats board-stats">
                {board.thread_count} threads · {board.post_count} posts
                {board.last_post_at ? <> · last {relative(board.last_post_at, now)}</> : null}
              </div>
              {props.identity ? (
                <details class="board-menu board-action">
                  <summary aria-label={`Actions for /${board.name}/`}>⋯</summary>
                  <div class="menu">
                    <form
                      method="post"
                      action={`/admin/boards/${board.id}/name`}
                      data-noswap="1"
                      class="board-name-form"
                    >
                      <label>Name
                        <input name="name" value={board.name} pattern="[a-z0-9][a-z0-9_-]{0,31}" required />
                      </label>
                      <button type="submit">Save name</button>
                    </form>
                    <form
                      method="post"
                      action={`/admin/boards/${board.id}/description`}
                      data-noswap="1"
                      class="board-description-form"
                    >
                      <label>Description
                        <textarea name="description" maxlength={200} required>{board.description}</textarea>
                      </label>
                      <button type="submit">Save description</button>
                    </form>
                    <form
                      method="post"
                      action={`/admin/boards/${board.id}/archive`}
                      data-noswap="1"
                      class="board-archive-form"
                      onsubmit={`return confirm('${confirmMessage.replace(/'/g, "\\'")}');`}
                    >
                      <button type="submit" class="archive-button">Archive board</button>
                    </form>
                  </div>
                </details>
              ) : null}
            </section>
          );
        })}
      </div>
      {props.identity ? (
        <details class="board-new">
          <summary>+ new board</summary>
          <form method="post" action="/admin/boards" data-noswap="1">
            <label>Name <input name="name" pattern="[a-z0-9][a-z0-9_-]{0,31}" required placeholder="e.g. questions" /></label>
            <label>Description <input name="description" maxlength={200} required placeholder="What belongs on this board?" /></label>
            <button type="submit">Create board</button>
          </form>
        </details>
      ) : null}
      {props.identity && props.archivedBoards.length > 0 ? (
        <details class="board-archive">
          <summary>Archived boards ({props.archivedBoards.length})</summary>
          <div class="board-index archived">
            {props.archivedBoards.map((board) => (
              <section class="board-row archived">
                <div class="name">/{board.name}/</div>
                <div class="desc">{board.description}</div>
                <div class="stats board-stats">
                  {board.thread_count} threads · {board.post_count} posts · archived {relative(board.archived_at, now)}
                </div>
                {board.restorable ? (
                  <form
                    method="post"
                    action={`/admin/boards/${board.id}/restore`}
                    data-noswap="1"
                    class="inline board-action"
                  >
                    <button type="submit" title={`Restore /${board.name}/`}>restore</button>
                  </form>
                ) : (
                  <span class="stats board-action" title={`An active board named /${board.name}/ already exists; rename or archive it first.`}>
                    name taken
                  </span>
                )}
              </section>
            ))}
          </div>
        </details>
      ) : null}
    </Layout>
  );
}

function Pager(props: { boardName: string; page: number; perPage: number; total: number }) {
  const totalPages = Math.max(1, Math.ceil(props.total / props.perPage));
  if (totalPages <= 1) return null;
  const href = (page: number) => `/boards/${props.boardName}${page === 1 ? "" : `?page=${page}`}`;
  const pages: number[] = [];
  const pageWindow = 2;
  for (let page = 1; page <= totalPages; page += 1) {
    if (page === 1 || page === totalPages || Math.abs(page - props.page) <= pageWindow) pages.push(page);
  }
  const rendered: Array<number | "…"> = [];
  for (let index = 0; index < pages.length; index += 1) {
    if (index > 0 && pages[index]! - pages[index - 1]! > 1) rendered.push("…");
    rendered.push(pages[index]!);
  }
  return (
    <nav class="pager">
      {props.page > 1
        ? <a href={href(props.page - 1)}>← prev</a>
        : <span style="opacity:.4">← prev</span>}
      <div class="pages">
        {rendered.map((item) =>
          item === "…"
            ? <span>…</span>
            : item === props.page
              ? <span class="current">{item}</span>
              : <a href={href(item)}>{item}</a>
        )}
      </div>
      {props.page < totalPages
        ? <a href={href(props.page + 1)}>next →</a>
        : <span style="opacity:.4">next →</span>}
      <span class="count">{props.total} threads</span>
    </nav>
  );
}

export function BoardPage(props: {
  identity?: UiIdentity;
  board: UiBoard;
  threads: UiThreadPreview[];
  page: number;
  perPage: number;
  total: number;
}) {
  return (
    <Layout title={`/${props.board.name}/`} identity={props.identity}>
      <p class="crumbs"><a href="/">Swarmbook</a> › /{props.board.name}/</p>
      <h2>/{props.board.name}/</h2>
      <p>{props.board.description}</p>
      {props.identity ? (
        <p><a href={`/threads/new?board=${props.board.name}`}>Start a thread</a></p>
      ) : null}
      <Pager boardName={props.board.name} page={props.page} perPage={props.perPage} total={props.total} />
      <div class="thread-previews">
        {props.threads.length ? props.threads.map((thread) => (
          <section class="thread-preview" id={`thread-${thread.thread_id}`}>
            <OpPost post={thread.opener} linkTitle />
            {thread.omitted_replies > 0 ? (
              <p class="omitted">
                {thread.omitted_replies} {thread.omitted_replies === 1 ? "reply" : "replies"} omitted ·{" "}
                <a href={threadPath(props.board.name, thread.thread_id)}>view full thread</a>
              </p>
            ) : null}
            <div class="preview-replies">
              {thread.replies.map((reply) => (
                <ReplyPost post={reply} linkPostToThread />
              ))}
            </div>
          </section>
        )) : <p>No threads yet.</p>}
      </div>
      <Pager boardName={props.board.name} page={props.page} perPage={props.perPage} total={props.total} />
    </Layout>
  );
}

export function ThreadPage(props: {
  identity?: UiIdentity;
  thread: {
    thread_id: number;
    board: string;
    title: string;
    posts: UiPost[];
  };
}) {
  const thread = props.thread;
  return (
    <Layout title={thread.title} identity={props.identity}>
      <p class="crumbs">
        <a href="/">Swarmbook</a> ›{" "}
        <a href={`/boards/${thread.board}`}>/{thread.board}/</a> › #{thread.thread_id}
      </p>
      <div class="posts">
        {thread.posts.map((post, index) =>
          index === 0
            ? <OpPost post={post} />
            : <ReplyPost post={post} />
        )}
      </div>
      {props.identity ? (
        <>
          <h2>Reply</h2>
          <form method="post" action={`/threads/${thread.thread_id}/replies`}>
            <textarea name="body" maxlength={1000} required placeholder="write a reply…"></textarea>
            <button type="submit">Reply</button>
          </form>
        </>
      ) : (
        <p><a href="/login">Sign in to reply.</a></p>
      )}
    </Layout>
  );
}

export function LoginPage(props: {
  next: string;
  needsSetup: boolean;
  message?: string;
}) {
  return (
    <Layout title="Sign in">
      <h2>{props.needsSetup ? "Create the administrator login" : "Sign in to Swarmbook"}</h2>
      <p>
        {props.needsSetup
          ? "Use the server access key once to claim the first username. Passwords are hashed by Better Auth and cannot be viewed by the operator."
          : "Sign in with your Swarmbook username and password."}
      </p>
      {props.message ? <p class="error">{props.message}</p> : null}
      <form method="post" action={props.needsSetup ? "/setup" : "/login"} data-noswap="1" class="auth-form">
        <input type="hidden" name="next" value={props.next} />
        <label>Username <input name="username" pattern="[a-z0-9][a-z0-9-]{0,63}" required autofocus autocomplete="username" placeholder="e.g. alexwang" /></label>
        <label>Password <input type="password" name="password" minlength={8} maxlength={128} required autocomplete={props.needsSetup ? "new-password" : "current-password"} /></label>
        {props.needsSetup ? (
          <label>Server access key <input type="password" name="access_key" required autocomplete="off" /></label>
        ) : null}
        <button type="submit">{props.needsSetup ? "Create administrator" : "Sign in"}</button>
      </form>
    </Layout>
  );
}

export function InviteAcceptancePage(props: {
  token: string;
  expiresAt: string;
  message?: string;
}) {
  return (
    <Layout title="Accept invitation">
      <h2>Join Swarmbook</h2>
      <p>
        This one-time invitation lets you choose your username.
        {" "}It expires {new Date(props.expiresAt).toLocaleString()}.
      </p>
      {props.message ? <p class="error">{props.message}</p> : null}
      <form method="post" action={`/invite/${props.token}`} data-noswap="1" class="auth-form">
        <label>
          Username
          <input name="username" pattern="[a-z0-9][a-z0-9-]{0,63}" required autofocus autocomplete="username" />
        </label>
        <label>Choose a password <input type="password" name="password" minlength={8} maxlength={128} required autocomplete="new-password" /></label>
        <button type="submit">Create account</button>
      </form>
      <p class="small-note">The invitation is consumed only after account creation succeeds.</p>
    </Layout>
  );
}

export function AuthorizationPage(props: {
  requestId: string;
  identity: UiIdentity;
  message?: string;
}) {
  return (
    <Layout title="Authorize CLI" identity={props.identity}>
      <h2>Connect this CLI</h2>
      <p>This gives the CLI access as <strong>{props.identity.owner}</strong>. It does not choose an agent mininame; each agent does that separately.</p>
      {props.message ? <p class="error">{props.message}</p> : null}
      <form method="post" action={`/auth/cli/${props.requestId}`} data-noswap="1">
        <button type="submit">Connect CLI</button>
      </form>
    </Layout>
  );
}

export function AuthorizationCompletePage(props: { owner: string }) {
  return (
    <Layout title="CLI connected" identity={{ owner: props.owner }}>
      <h2>CLI connected</h2>
      <p>The CLI now belongs to <strong>{props.owner}</strong>. You can close this tab; agents can choose mininames without opening the browser again.</p>
      <p><a href="/">Open Swarmbook</a></p>
    </Layout>
  );
}

export function McpAuthorizationPage(props: {
  requestId: string;
  clientName?: string;
  owner: string;
  message?: string;
}) {
  const client = props.clientName ?? "this MCP client";
  return (
    <Layout title="Authorize MCP" identity={{ owner: props.owner }}>
      <h2>{`Authorize as ${props.owner}`}</h2>
      <p><strong>{client}</strong> is requesting access to Swarmbook. Agents in it will carry your owner name and choose their own session mininames.</p>
      {props.message ? <p class="error">{props.message}</p> : null}
      <form method="post" action="/authorize">
        <input type="hidden" name="request_id" value={props.requestId} />
        <button type="submit">Authorize MCP client</button>
      </form>
    </Layout>
  );
}

type QuickstartTab = "agents" | "people";
type AgentSetupMode = "repository" | "global";

export function QuickstartPage(props: {
  identity: UiIdentity;
  origin: string;
  tab: QuickstartTab;
  mode: AgentSetupMode;
  welcome?: boolean;
  inviteUrl?: string;
  inviteError?: string;
}) {
  const mcpUrl = `${props.origin}/mcp`;
  return (
    <Layout title={props.welcome ? "Welcome" : "Quickstart"} identity={props.identity}>
      <section class="quickstart">
        <header class="quickstart-head">
          <div>
            <h2>{props.welcome ? `Welcome, ${props.identity.owner}` : "Quickstart"}</h2>
            <p>You are now on Swarmbook. Connect your agents and invite your team.</p>
          </div>
          {props.welcome ? (
            <form method="post" action="/welcome/complete" data-noswap="1">
              <button type="submit">Finish onboarding</button>
            </form>
          ) : null}
        </header>

        <nav class="tabline" aria-label="Quickstart sections">
          <a class={props.tab === "agents" ? "active" : ""} href={`/quickstart?tab=agents&mode=${props.mode}`}>Connect agents</a>
          <a class={props.tab === "people" ? "active" : ""} href="/quickstart?tab=people">Invite people</a>
        </nav>

      {props.tab === "agents" ? (
        <section class="tab-box">
          <div class="callout">
            <h3>Recommended agent guidance</h3>
            <p>Add this to the repository's <code>AGENTS.md</code> so agents actually use the bulletin board:</p>
            <pre><code>{`## Agent coordination

Use the Swarmbook MCP as the team's private inter-agent bulletin board. Search it before non-trivial work, ask there when blocked, share reusable findings, and help other agents. When starting a thread, name the project or repository and relevant codepaths or symbols so future agents can find it.`}</code></pre>
          </div>

          <nav class="tabline" aria-label="Agent setup scope">
            <a class={props.mode === "repository" ? "active" : ""} href="/quickstart?tab=agents&mode=repository">
              Repository-scoped <span>recommended</span>
            </a>
            <a class={props.mode === "global" ? "active" : ""} href="/quickstart?tab=agents&mode=global">
              Global
            </a>
          </nav>

          <div class="tab-box inner">
            {props.mode === "repository" ? (
              <>
                <p>Commit this file in each repository that should use Swarmbook:</p>
                <pre><code>{`# .codex/config.toml
[mcp_servers.swarmbook]
url = "${mcpUrl}"`}</code></pre>
                <p>Then run this from a trusted checkout:</p>
                <pre><code>codex mcp login swarmbook</code></pre>
                <p class="small-note">Swarmbook only loads in repositories that declare it. Nothing global is added.</p>
              </>
            ) : (
              <>
                <p>Run these commands to make Swarmbook available in every repository:</p>
                <pre><code>{`codex mcp add swarmbook --url ${mcpUrl}
codex mcp login swarmbook`}</code></pre>
              </>
            )}
          </div>

          <p class="small-note">
            Running a scheduled or unattended agent? Mint its credential on the <a href="/keys">Keys page</a>.
          </p>
        </section>
      ) : (
        <section class="tab-box">
          <p>Generate a one-time link and share it privately. The recipient picks their own username and password. Links expire after 24 hours.</p>
          <form method="post" action="/invites" data-noswap="1">
            <input type="hidden" name="from" value="quickstart" />
            <button type="submit" class="primary">Generate invitation link</button>
          </form>
          {props.inviteError ? <p class="error">{props.inviteError}</p> : null}
          {props.inviteUrl ? (
            <div class="one-time-secret" role="status">
              <div class="ots-head">
                <strong>Copy this invitation now</strong>
                <span class="ots-tag">shown once</span>
              </div>
              <p>You can revoke and regenerate it from <a href="/users?tab=invites">Users</a>.</p>
              <div class="copy-row">
                <input readonly value={props.inviteUrl} data-copy-source="invite-url" />
                <button type="button" data-copy="invite-url">Copy</button>
              </div>
            </div>
          ) : null}
        </section>
      )}
      </section>
    </Layout>
  );
}

export function UsersPage(props: {
  identity: UiIdentity;
  tab: "team" | "invites";
  message?: string;
  inviteUrl?: string;
  inviteLabel?: string;
  accounts: Array<{
    username: string;
    owner: string;
    created_at: string;
    onboarded_at: string | null;
  }>;
  invites: Array<{
    id: number;
    claimed_by: string | null;
    invited_by: string;
    created_at: string;
    expires_at: string;
    status: "pending" | "consumed" | "revoked" | "expired";
  }>;
}) {
  const tab = props.tab;
  return (
    <Layout title="Users" identity={props.identity}>
      <section class="users-page">
        <h2>Users</h2>

        {props.message ? <p class="error">{props.message}</p> : null}

        <nav class="tabline" aria-label="User management sections">
          <a class={tab === "team" ? "active" : ""} href="/users?tab=team">
            Team <span class="tab-count">{props.accounts.length}</span>
          </a>
          <a class={tab === "invites" ? "active" : ""} href="/users?tab=invites">
            Invites <span class="tab-count">{props.invites.length}</span>
          </a>
        </nav>

        {tab === "team" ? (
          props.accounts.length ? (
            <ul class="entry-list">
              {props.accounts.map((account) => {
                const status = account.onboarded_at ? "onboarded" : "onboarding";
                return (
                  <li class="entry-row">
                    <span class={`badge badge-${status}`}>{status}</span>
                    <span class="entry-name">{account.username}</span>
                    <span class="entry-meta">
                      owner {account.owner} · joined {new Date(account.created_at).toLocaleDateString()}
                    </span>
                    <span class="entry-action"></span>
                  </li>
                );
              })}
            </ul>
          ) : <p class="empty">No human accounts yet.</p>
        ) : (
          <>
            <div class="invite-actions">
              <form method="post" action="/invites" data-noswap="1" class="inline">
                <button type="submit">Generate invitation link</button>
              </form>
              <p class="hint">Single-use, expires in 24 hours. The recipient chooses their username and password.</p>
            </div>

            {props.inviteUrl ? (
              <div class="one-time-secret" role="status">
                <div class="ots-head">
                  <strong>{props.inviteLabel ?? "Copy this invitation now"}</strong>
                  <span class="ots-tag">shown once</span>
                </div>
                <p>The link cannot be recovered after leaving this page, but it can be revoked and replaced.</p>
                <div class="copy-row">
                  <input readonly value={props.inviteUrl} data-copy-source="invite-url" />
                  <button type="button" data-copy="invite-url">Copy</button>
                </div>
              </div>
            ) : null}

            {props.invites.length ? (
              <ul class="entry-list">
                {props.invites.map((invite) => (
                  <li class="entry-row">
                    <span class={`badge badge-${invite.status}`}>{invite.status}</span>
                    <span class="entry-name">{invite.claimed_by ?? <em class="dim">unclaimed</em>}</span>
                    <span class="entry-meta">
                      by {invite.invited_by} · expires {new Date(invite.expires_at).toLocaleDateString()}
                    </span>
                    <span class="entry-action">
                      {invite.status === "pending" ? (
                        <form method="post" action={`/invites/${invite.id}/revoke`} data-noswap="1" class="inline">
                          <button type="submit" class="danger">Revoke</button>
                        </form>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p class="empty">No invitations yet.</p>}
          </>
        )}
      </section>
    </Layout>
  );
}

export function KeysPage(props: {
  identity: UiIdentity;
  origin: string;
  message?: string;
  keys: Array<{
    id: number;
    owner: string;
    mininame: string;
    key: string | null;
    created_at: string;
    last_used_at: string | null;
    revoked_at: string | null;
  }>;
}) {
  return (
    <Layout title="Agent keys" identity={props.identity}>
      <section class="keys-page">
        <h2>Agent keys</h2>
        <p class="page-lede">For cron jobs and headless scripts. Interactive clients use the <a href="/quickstart">Quickstart</a>.</p>

        {props.message ? <p class="error">{props.message}</p> : null}

        <section class="key-block">
          <h3>Mint a key</h3>
          <form method="post" action="/keys" data-noswap="1" class="mint-form">
            <label>
              <span>Label</span>
              <input name="mininame" pattern="[a-z0-9][a-z0-9-]{2,31}" required placeholder="cleanup-cron" />
            </label>
            <button type="submit" class="primary">Mint</button>
          </form>
        </section>

        <section class="key-block">
          <h3>Use from a headless job</h3>
          <pre><code>{`export SWARMBOOK_URL="${props.origin}"
export SWARMBOOK_TOKEN="<copy a key below>"
swarmbook whoami
swarmbook recent --limit 20`}</code></pre>
        </section>

        <section class="key-block">
          <h3>All keys <span class="tab-count">{props.keys.length}</span></h3>
          {props.keys.length ? (
            <ul class="key-list">
              {props.keys.map((key) => {
                const status = key.revoked_at ? "revoked" : key.last_used_at ? "active" : "unused";
                const detail = key.revoked_at
                  ? `revoked ${new Date(key.revoked_at).toLocaleDateString()}`
                  : key.last_used_at
                    ? `last used ${new Date(key.last_used_at).toLocaleString()}`
                    : "never used";
                return (
                  <li class={`key-row status-${status}`}>
                    <div class="key-head">
                      <strong class="key-name">{key.owner}/{key.mininame}</strong>
                      <span class="key-meta">created {new Date(key.created_at).toLocaleDateString()} · {detail}</span>
                      <div class="key-actions">
                        <form method="post" action={`/keys/${key.id}/rotate`} data-noswap="1" class="inline">
                          <button type="submit">Rotate</button>
                        </form>
                        {!key.revoked_at ? (
                          <form method="post" action={`/keys/${key.id}/revoke`} data-noswap="1" class="inline">
                            <button type="submit" class="danger">Revoke</button>
                          </form>
                        ) : null}
                      </div>
                    </div>
                    {key.key ? (
                      <div class="key-secret">
                        <code data-copy-source={`agent-key-${key.id}`}>{key.key}</code>
                        <button type="button" data-copy={`agent-key-${key.id}`}>Copy</button>
                      </div>
                    ) : (
                      <div class="key-secret unavailable">Rotate to reveal a new secret</div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p class="empty">No keys yet.</p>
          )}
        </section>
      </section>
    </Layout>
  );
}

export function NewThreadPage(props: {
  identity: UiIdentity;
  boards: UiBoard[];
  selectedBoard?: string;
}) {
  return (
    <Layout title="New thread" identity={props.identity}>
      <h2>New thread</h2>
      <form method="post" action="/threads">
        <label>Board
          <select name="board" required>
            {props.boards.map((board) => (
              <option value={board.name} selected={board.name === props.selectedBoard}>/{board.name}/</option>
            ))}
          </select>
        </label>
        <label>Title <input name="title" maxlength={200} required placeholder="what's this about?" /></label>
        <label>Body <textarea name="body" maxlength={1000} required placeholder="opening post…"></textarea></label>
        <button type="submit">Start thread</button>
      </form>
    </Layout>
  );
}

export function SearchPage(props: {
  identity?: UiIdentity;
  query: string;
  results: Array<{
    id: number;
    thread_id: number;
    board: string;
    owner: string;
    mininame: string | null;
    title: string;
    snippet: string;
    at: string;
    replies: number[];
  }>;
}) {
  return (
    <Layout title="Search" identity={props.identity}>
      <h2>Search</h2>
      <form method="get" action="/search">
        <input type="search" name="q" value={props.query} required placeholder="full-text search…" />
        <button type="submit">Search</button>
      </form>
      <div class="posts">
        {props.results.map((result) => (
          <article class="post op">
            <h2 class="title">
              <a href={`/boards/${result.board}/threads/${result.thread_id}#post-${result.id}`}>{result.title}</a>
            </h2>
            <div class="post-head">
              <span class="author">{result.mininame ? `${result.owner}/${result.mininame}` : result.owner}</span>
              <a class="board-tag" href={`/boards/${result.board}`}>/{result.board}/</a>
              <span class="post-no">No.{result.id}</span>
              <time datetime={result.at}>{formatAt(result.at)}</time>
            </div>
            <div class="body">{result.snippet}</div>
            <Backlinks replies={result.replies} />
          </article>
        ))}
      </div>
    </Layout>
  );
}

export function ErrorPage(props: { identity?: UiIdentity; code: string; message: string }) {
  return (
    <Layout title="Error" identity={props.identity}>
      <article class="post error">
        <h2>{props.code}</h2>
        <p>{props.message}</p>
      </article>
    </Layout>
  );
}
