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
}

const styles = `
  :root { color-scheme: light dark; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  body { max-width: 980px; margin: 0 auto; padding: 1rem; line-height: 1.45; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; border-bottom: 1px solid #8886; margin-bottom: 1.5rem; }
  nav { display: flex; flex-wrap: wrap; gap: .8rem; align-items: center; }
  a { color: #3977d4; }
  .boards, .posts { display: grid; gap: .75rem; }
  .board, article { border: 1px solid #8886; border-radius: .35rem; padding: .8rem; }
  article h2, article h3, .board h3 { margin: 0 0 .35rem; }
  .meta { opacity: .7; font-size: .85rem; }
  .body { white-space: pre-wrap; overflow-wrap: anywhere; }
  form { display: grid; gap: .6rem; margin: 1rem 0; }
  input, textarea, select, button { font: inherit; padding: .55rem; }
  textarea { min-height: 9rem; }
  button { width: fit-content; cursor: pointer; }
  .inline { display: inline; margin: 0; }
  .inline button { padding: .15rem .4rem; }
  .error { border-color: #d44; }
`;

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
        <header>
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

export function PostCard(props: { post: UiPost; showTitle?: boolean }) {
  const { post } = props;
  return (
    <article id={`post-${post.id}`}>
      {props.showTitle && post.title ? (
        <h2><a href={`/threads/${post.thread_id}`}>{post.title}</a></h2>
      ) : null}
      <div class="meta">
        #{post.id} · <a href={`/boards/${post.board}`}>/{post.board}/</a> · {post.author} · {post.at}
      </div>
      <div class="body">{post.body}</div>
      {!props.showTitle ? <a href={`/threads/${post.thread_id}`}>thread #{post.thread_id}</a> : null}
    </article>
  );
}

export function HomePage(props: {
  identity?: UiIdentity;
  boards: UiBoard[];
  posts: UiPost[];
}) {
  return (
    <Layout title="Recent" identity={props.identity}>
      <h2>Boards</h2>
      <div class="boards">
        {props.boards.map((board) => (
          <section class="board">
            <h3><a href={`/boards/${board.name}`}>/{board.name}/</a></h3>
            <div>{board.description}</div>
            <div class="meta">{board.thread_count} threads · {board.post_count} posts</div>
          </section>
        ))}
      </div>
      <h2>Recent posts</h2>
      <div class="posts">
        {props.posts.length ? props.posts.map((post) => <PostCard post={post} showTitle={post.title !== null} />) : <p>No posts yet.</p>}
      </div>
    </Layout>
  );
}

export function BoardPage(props: {
  identity?: UiIdentity;
  board: UiBoard;
  posts: UiPost[];
}) {
  return (
    <Layout title={`/${props.board.name}/`} identity={props.identity}>
      <h2>/{props.board.name}/</h2>
      <p>{props.board.description}</p>
      {props.identity ? <p><a href={`/threads/new?board=${props.board.name}`}>Start a thread</a></p> : null}
      <div class="posts">
        {props.posts.length ? props.posts.map((post) => <PostCard post={post} showTitle={post.title !== null} />) : <p>No posts yet.</p>}
      </div>
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
      <h2>{thread.title}</h2>
      <p class="meta">
        thread #{thread.thread_id}
        {thread.successor_of ? <> · follows <a href={`/threads/${thread.successor_of}`}>#{thread.successor_of}</a></> : null}
        {thread.successor ? <> · continues at <a href={`/threads/${thread.successor}`}>#{thread.successor}</a></> : null}
      </p>
      <div class="posts">
        {thread.posts.map((post, index) => <PostCard post={post} showTitle={index === 0} />)}
      </div>
      {props.identity ? (
        <>
          <h3>Reply</h3>
          <form method="post" action={`/threads/${thread.thread_id}/replies`}>
            <textarea name="body" maxlength={4000} required></textarea>
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
        <label>Mininame <input name="handle" pattern="[a-zA-Z0-9-]{3,32}" required autofocus /></label>
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
        <label>Title <input name="title" maxlength={200} required /></label>
        <label>Body <textarea name="body" maxlength={4000} required></textarea></label>
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
        <input type="search" name="q" value={props.query} required />
        <button type="submit">Search</button>
      </form>
      <div class="posts">
        {props.results.map((result) => (
          <article>
            <h3><a href={`/threads/${result.thread_id}#post-${result.post_id}`}>{result.title}</a></h3>
            <div class="meta">#{result.post_id} · /{result.board}/ · {result.author} · {result.at}</div>
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
      <article class="error">
        <h2>{props.code}</h2>
        <p>{props.message}</p>
      </article>
    </Layout>
  );
}
