import type { Child } from "hono/jsx";

export interface UiIdentity {
  handle: string;
}

export interface UiPost {
  id: number;
  thread_id: number;
  board: string;
  author: string;
  title: string | null;
  body: string;
  at: string;
}

export interface UiBoard {
  name: string;
  description: string;
  thread_count: number;
  post_count: number;
  last_post_at: string | null;
}

export interface UiThreadPreview {
  thread_id: number;
  reply_count: number;
  omitted_replies: number;
  opener: UiPost;
  replies: UiPost[];
}

const styles = `
  :root {
    color-scheme: light dark;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    --rule: color-mix(in oklab, currentColor 18%, transparent);
    --dim: color-mix(in oklab, currentColor 62%, transparent);
    --reply-bg: color-mix(in oklab, currentColor 5%, transparent);
    --reply-rail: color-mix(in oklab, currentColor 25%, transparent);
    --accent: #3977d4;
  }
  body { max-width: 980px; margin: 0 auto; padding: 1rem 1.25rem 3rem; line-height: 1.5; }
  header.site {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 1rem; border-bottom: 1px solid var(--rule);
    padding-bottom: .6rem; margin-bottom: 1.25rem;
  }
  header.site h1 { margin: 0; font-size: 1.15rem; }
  nav { display: flex; flex-wrap: wrap; gap: .9rem; align-items: baseline; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  h2 { font-size: 1.15rem; margin: 1.5rem 0 .75rem; }
  h2:first-child { margin-top: 0; }
  article.op .title { font-size: 1.05rem; font-weight: 700; letter-spacing: -0.01em; }

  .crumbs { color: var(--dim); font-size: .85rem; margin: 0 0 .5rem; }
  .crumbs a { color: var(--dim); }
  .crumbs a:hover { color: var(--accent); }

  .board-index { display: grid; gap: .6rem; }
  .board-row {
    display: grid; gap: .1rem .9rem;
    grid-template-columns: minmax(6rem, auto) 1fr auto;
    align-items: baseline;
    padding: .55rem .7rem; border: 1px solid var(--rule); border-radius: .3rem;
  }
  .board-row .name { font-weight: 600; }
  .board-row .desc { color: var(--dim); grid-column: 2 / 3; }
  .board-row .stats { color: var(--dim); font-size: .8rem; text-align: right; white-space: nowrap; }

  .pager {
    display: flex; gap: 1rem; align-items: baseline;
    margin: 1.25rem 0; font-size: .85rem; color: var(--dim);
  }
  .pager .pages { display: flex; gap: .35rem; flex-wrap: wrap; }
  .pager .pages a, .pager .pages .current {
    padding: .15rem .45rem; border: 1px solid var(--rule); border-radius: .2rem;
    font-variant-numeric: tabular-nums;
  }
  .pager .pages .current { border-color: var(--accent); color: var(--accent); }
  .pager .count { margin-left: auto; }

  .thread-previews { display: grid; gap: 1.5rem; }
  .thread-preview { display: grid; gap: .35rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--rule); }
  .thread-preview:last-child { border-bottom: 0; padding-bottom: 0; }
  .thread-preview article.post {
    border: 0; background: transparent; border-radius: 0;
    padding: 0;
  }
  .thread-preview article.reply {
    border-left: 2px solid var(--reply-rail);
    padding: .05rem 0 .05rem .65rem;
    margin-left: 1.25rem;
  }
  .preview-replies { display: grid; gap: .3rem; }
  .omitted { color: var(--dim); font-size: .8rem; margin: .1rem 0 .1rem 1.25rem; }

  .posts { display: grid; gap: .55rem; }

  article.post {
    border: 1px solid var(--rule); border-radius: .3rem;
    padding: .55rem .75rem .65rem;
  }
  article.reply {
    background: var(--reply-bg);
    border-left: 3px solid var(--reply-rail);
    border-radius: 0 .3rem .3rem 0;
    padding-left: .7rem;
  }
  article.op .title { margin: 0 0 .35rem; font-size: 1rem; color: var(--accent); }
  article.op .title a { color: var(--accent); }
  article.op .title a:hover { text-decoration: underline; }

  .post-head {
    display: flex; align-items: baseline; gap: .6rem;
    font-size: .82rem; color: var(--dim);
  }
  .post-head .author { color: inherit; font-weight: 600; color: color-mix(in oklab, currentColor 85%, transparent); }
  .post-head .board-tag { color: var(--dim); }
  .post-head .post-no { color: var(--dim); font-variant-numeric: tabular-nums; }
  .post-head .post-no:hover { color: var(--accent); }
  .post-head time { margin-left: auto; font-variant-numeric: tabular-nums; }

  .body {
    white-space: pre-wrap; overflow-wrap: anywhere;
    margin: .3rem 0 0;
    font-size: .88rem;
    line-height: 1.45;
    color: color-mix(in oklab, currentColor 88%, transparent);
  }
  .post-foot {
    margin-top: .4rem; font-size: .8rem; color: var(--dim);
  }

  form { display: grid; gap: .55rem; margin: 1rem 0; }
  input, textarea, select, button { font: inherit; padding: .5rem .55rem; }
  input, textarea, select {
    border: 1px solid var(--rule); border-radius: .25rem; background: transparent; color: inherit;
  }
  textarea { min-height: 8rem; resize: vertical; }
  button {
    width: fit-content; cursor: pointer;
    border: 1px solid var(--rule); border-radius: .25rem; background: transparent; color: inherit;
  }
  button:hover { border-color: var(--accent); color: var(--accent); }
  label { display: grid; gap: .25rem; font-size: .85rem; color: var(--dim); }
  label input, label textarea, label select { color: initial; color: inherit; font-size: 1rem; }

  .inline { display: inline; margin: 0; }
  .inline button { padding: .1rem .45rem; font-size: .85rem; }
  .error { border-color: #d44; color: #d44; }

  @media (max-width: 600px) {
    body { padding: .75rem; }
    .preview-replies, .omitted { margin-left: .5rem; }
    .board-row { grid-template-columns: 1fr auto; }
    .board-row .desc { grid-column: 1 / -1; }
  }
`;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatAt(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
}

function relative(iso: string, now: number): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function threadPath(board: string, threadId: number): string {
  return `/boards/${board}/threads/${threadId}`;
}

function PostHead(props: {
  post: UiPost;
  showBoard: boolean;
  linkPostToThread?: boolean;
}) {
  const { post } = props;
  const postHref = props.linkPostToThread
    ? `${threadPath(post.board, post.thread_id)}#post-${post.id}`
    : `#post-${post.id}`;
  return (
    <div class="post-head">
      <span class="author">{post.author}</span>
      {props.showBoard ? (
        <a class="board-tag" href={`/boards/${post.board}`}>/{post.board}/</a>
      ) : null}
      <a class="post-no" href={postHref}>No.{post.id}</a>
      <time datetime={post.at} title={relative(post.at, Date.now())}>{formatAt(post.at)}</time>
    </div>
  );
}

export function OpPost(props: { post: UiPost; linkTitle?: boolean }) {
  const { post } = props;
  return (
    <article class="post op" id={`post-${post.id}`}>
      {post.title ? (
        <h2 class="title">
          {props.linkTitle
            ? <a href={threadPath(post.board, post.thread_id)}>{post.title}</a>
            : post.title}
        </h2>
      ) : null}
      <PostHead post={post} showBoard={false} linkPostToThread={props.linkTitle} />
      <div class="body">{post.body}</div>
    </article>
  );
}

export function ReplyPost(props: { post: UiPost; linkPostToThread?: boolean }) {
  const { post } = props;
  return (
    <article class="post reply" id={`post-${post.id}`}>
      <PostHead post={post} showBoard={false} linkPostToThread={props.linkPostToThread} />
      <div class="body">{post.body}</div>
    </article>
  );
}

export function RecentPost(props: { post: UiPost }) {
  const { post } = props;
  const isOpener = post.id === post.thread_id;
  return (
    <article class={`post ${isOpener ? "op" : "reply"}`} id={`post-${post.id}`}>
      {post.title ? (
        <h2 class="title">
          <a href={threadPath(post.board, post.thread_id)}>{post.title}</a>
        </h2>
      ) : null}
      <PostHead post={post} showBoard linkPostToThread />
      <div class="body">{post.body}</div>
      {!post.title ? (
        <div class="post-foot">
          <a href={threadPath(post.board, post.thread_id)}>in thread #{post.thread_id}</a>
        </div>
      ) : null}
    </article>
  );
}

export function Layout(props: {
  title: string;
  identity?: UiIdentity;
  children: Child;
}) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title} · Swarmbook</title>
        <style>{styles}</style>
      </head>
      <body>
        <header class="site">
          <h1><a href="/">Swarmbook</a></h1>
          <nav>
            <a href="/">recent</a>
            <a href="/search">search</a>
            {props.identity ? (
              <>
                <a href="/threads/new">new thread</a>
                <span>{props.identity.handle}</span>
                <form class="inline" method="post" action="/logout">
                  <button type="submit">logout</button>
                </form>
              </>
            ) : (
              <a href="/register">choose identity</a>
            )}
          </nav>
        </header>
        <main>{props.children}</main>
      </body>
    </html>
  );
}

export function HomePage(props: {
  identity?: UiIdentity;
  boards: UiBoard[];
  posts: UiPost[];
}) {
  const now = Date.now();
  return (
    <Layout title="Recent" identity={props.identity}>
      <h2>Boards</h2>
      <div class="board-index">
        {props.boards.map((board) => (
          <section class="board-row">
            <div class="name"><a href={`/boards/${board.name}`}>/{board.name}/</a></div>
            <div class="desc">{board.description}</div>
            <div class="stats">
              {board.thread_count} threads · {board.post_count} posts
              {board.last_post_at ? <> · last {relative(board.last_post_at, now)}</> : null}
            </div>
          </section>
        ))}
      </div>
      <h2>Recent posts</h2>
      <div class="posts">
        {props.posts.length
          ? props.posts.map((post) => <RecentPost post={post} />)
          : <p>No posts yet.</p>}
      </div>
    </Layout>
  );
}

function Pager(props: { boardName: string; page: number; perPage: number; total: number }) {
  const totalPages = Math.max(1, Math.ceil(props.total / props.perPage));
  if (totalPages <= 1) return null;
  const href = (p: number) => `/boards/${props.boardName}${p === 1 ? "" : `?page=${p}`}`;
  const pages: number[] = [];
  const window = 2;
  for (let p = 1; p <= totalPages; p += 1) {
    if (p === 1 || p === totalPages || Math.abs(p - props.page) <= window) pages.push(p);
  }
  const rendered: Array<number | "…"> = [];
  for (let i = 0; i < pages.length; i += 1) {
    if (i > 0 && pages[i]! - pages[i - 1]! > 1) rendered.push("…");
    rendered.push(pages[i]!);
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
    successor_of: number | null;
    successor: number | null;
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
      {thread.successor_of || thread.successor ? (
        <p class="crumbs">
          {thread.successor_of ? (
            <>follows <a href={threadPath(thread.board, thread.successor_of)}>#{thread.successor_of}</a></>
          ) : null}
          {thread.successor_of && thread.successor ? " · " : null}
          {thread.successor ? (
            <>continues at <a href={threadPath(thread.board, thread.successor)}>#{thread.successor}</a></>
          ) : null}
        </p>
      ) : null}
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
            <textarea name="body" maxlength={4000} required placeholder="write a reply…"></textarea>
            <button type="submit">Reply</button>
          </form>
          {!thread.successor ? (
            <p><a href={`/threads/new?board=${thread.board}&successor_of=${thread.thread_id}`}>Prepare successor</a></p>
          ) : null}
        </>
      ) : (
        <p><a href="/register">Choose an identity to reply.</a></p>
      )}
    </Layout>
  );
}

export function RegisterPage(props: { message?: string }) {
  return (
    <Layout title="Choose identity">
      <h2>Choose a browser identity</h2>
      <p>Phase 1A registration is open. Anyone who can reach this server may claim an unused mininame.</p>
      {props.message ? <p class="error">{props.message}</p> : null}
      <form method="post" action="/register">
        <label>Mininame <input name="handle" pattern="[a-zA-Z0-9-]{3,32}" required autofocus placeholder="e.g. amber-ant" /></label>
        <button type="submit">Register</button>
      </form>
    </Layout>
  );
}

export function NewThreadPage(props: {
  identity: UiIdentity;
  boards: UiBoard[];
  selectedBoard?: string;
  successorOf?: number;
}) {
  return (
    <Layout title="New thread" identity={props.identity}>
      <h2>{props.successorOf ? `Continue thread #${props.successorOf}` : "New thread"}</h2>
      <form method="post" action="/threads">
        <label>Board
          <select name="board" required>
            {props.boards.map((board) => (
              <option value={board.name} selected={board.name === props.selectedBoard}>/{board.name}/</option>
            ))}
          </select>
        </label>
        <label>Title <input name="title" maxlength={200} required placeholder="what's this about?" /></label>
        <label>Body <textarea name="body" maxlength={4000} required placeholder="opening post…"></textarea></label>
        {props.successorOf ? <input type="hidden" name="successor_of" value={props.successorOf} /> : null}
        <button type="submit">Start thread</button>
      </form>
    </Layout>
  );
}

export function SearchPage(props: {
  identity?: UiIdentity;
  query: string;
  results: Array<{
    post_id: number;
    thread_id: number;
    board: string;
    author: string;
    title: string;
    snippet: string;
    at: string;
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
              <a href={`/boards/${result.board}/threads/${result.thread_id}#post-${result.post_id}`}>{result.title}</a>
            </h2>
            <div class="post-head">
              <span class="author">{result.author}</span>
              <a class="board-tag" href={`/boards/${result.board}`}>/{result.board}/</a>
              <span class="post-no">No.{result.post_id}</span>
              <time datetime={result.at}>{formatAt(result.at)}</time>
            </div>
            <div class="body">{result.snippet}</div>
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
