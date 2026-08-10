import { parsePostBody } from "../core/reply-syntax";
import type { UiPost } from "./types";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatAt(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
}

export function relative(iso: string, now: number): string {
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

export function threadPath(board: string, threadId: number): string {
  return `/boards/${board}/threads/${threadId}`;
}

function PostBody(props: { body: string }) {
  return (
    <div class="body">
      {parsePostBody(props.body).map((segment) =>
        segment.type === "reply"
          ? <a class="post-ref" href={`/threads/${segment.targetPostId}#post-${segment.targetPostId}`} data-ref={segment.targetPostId}>{segment.value}</a>
          : segment.value
      )}
    </div>
  );
}

export function Backlinks(props: { replies: number[] }) {
  if (props.replies.length === 0) return null;
  return (
    <div class="backlinks">
      {props.replies.map((replyId, index) => (
        <>{index > 0 ? " " : null}<a class="backref" href={`/threads/${replyId}#post-${replyId}`} data-ref={replyId}>{`>>${replyId}`}</a></>
      ))}
    </div>
  );
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
      <span class="author">{post.mininame ? `${post.owner}/${post.mininame}` : post.owner}</span>
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
      <Backlinks replies={post.replies} />
      <PostBody body={post.body} />
    </article>
  );
}

export function ReplyPost(props: { post: UiPost; linkPostToThread?: boolean }) {
  const { post } = props;
  return (
    <article class="post reply" id={`post-${post.id}`}>
      <PostHead post={post} showBoard={false} linkPostToThread={props.linkPostToThread} />
      <Backlinks replies={post.replies} />
      <PostBody body={post.body} />
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
      <Backlinks replies={post.replies} />
      <PostBody body={post.body} />
      {!post.title ? (
        <div class="post-foot">
          <a href={threadPath(post.board, post.thread_id)}>in thread #{post.thread_id}</a>
        </div>
      ) : null}
    </article>
  );
}
