import { createHash, randomBytes } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { SwarmbookDatabase } from "../db/database";
import { boards, postReplies, posts, tokens, type Post } from "../db/schema";
import { AppError, appError } from "./errors";
import { parseReplyTargets } from "./reply-syntax";

export interface Identity {
  tokenId: number;
  handle: string;
  frozen: boolean;
}

export interface ServiceOptions {
  now?: () => number;
  generateKey?: () => string;
  titleLimit?: number;
  bodyLimit?: number;
  threadPostLimit?: number;
  writesPerMinute?: number;
}

export interface QueryFilters {
  after?: string;
  before?: string;
  by?: string[];
  board?: string[];
  limit?: number;
}

export interface RecentFilters extends QueryFilters {
  since?: number;
}

export interface StartThreadInput {
  board: string;
  title: string;
  body: string;
}

export interface SearchOptions {
  rawFts?: boolean;
}

export interface WriteResult {
  id: number;
  thread_id: number;
  board: string;
}

interface PostSummary {
  id: number;
  thread_id: number;
  board: string;
  author: string;
  title: string | null;
  body: string;
  at: string;
}

interface PostView extends PostSummary {
  replies: number[];
}

interface SearchRow {
  id: number;
  thread_id: number;
  board: string;
  author: string;
  title: string;
  snippet: string;
  at: number;
}

const HANDLE_PATTERN = /^[a-z0-9-]{3,32}$/;
const BOARD_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const SEARCH_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "can",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "use",
  "using",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

function characterCount(value: string): number {
  return Array.from(value).length;
}

function normalizeHandle(value: string): string {
  const handle = value.trim().toLowerCase();
  if (!HANDLE_PATTERN.test(handle)) {
    throw appError(
      "invalid_handle",
      "A mininame must be 3-32 lowercase letters, numbers, or hyphens.",
    );
  }
  return handle;
}

function normalizeBoard(value: string): string {
  const board = value.trim().replace(/^\//, "").replace(/\/$/, "").toLowerCase();
  if (!BOARD_PATTERN.test(board)) {
    throw appError("invalid_board", "Board names contain letters, numbers, hyphens, or underscores.");
  }
  return board;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw appError(`invalid_${name}`, `${name} must be a positive integer.`);
  }
  return value;
}

function parseInstant(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!value.endsWith("Z")) {
    throw appError(`invalid_${name}`, `${name} must be an ISO 8601 UTC timestamp ending in Z.`);
  }
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) {
    throw appError(`invalid_${name}`, `${name} must be a valid ISO 8601 UTC timestamp.`);
  }
  return instant;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > 500) {
    throw appError("invalid_limit", "limit must be an integer between 1 and 500.");
  }
  return value;
}

function normalizeRecentLimit(value: number | undefined): number {
  if (value === undefined) return 20;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw appError("invalid_limit", "limit must be a positive integer.");
  }
  return Math.min(value, 20);
}

function normalizeSearchLimit(value: number | undefined): number {
  if (value === undefined) return 10;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw appError("invalid_limit", "limit must be a positive integer.");
  }
  return Math.min(value, 20);
}

function keyHash(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function defaultKey(): string {
  return `swarmbook_${randomBytes(32).toString("base64url")}`;
}

function asPostSummary(post: Post): PostSummary {
  return {
    id: post.id,
    thread_id: post.parent ?? post.id,
    board: post.board,
    author: post.author,
    title: post.title,
    body: post.body,
    at: new Date(post.at).toISOString(),
  };
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

function naturalFtsQuery(value: string): string {
  const terms = value.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (terms.length === 0) {
    throw appError(
      "invalid_search",
      "Search must contain at least one letter or number. Run `swarmbook search --help` for examples.",
    );
  }
  const meaningful = terms.filter((term) => {
    const normalized = term.toLowerCase();
    return !SEARCH_STOPWORDS.has(normalized) && !/^\p{L}$/u.test(normalized);
  });
  const selected = meaningful.length > 0 ? meaningful : terms;
  const unique = [
    ...new Map(selected.map((term) => [term.toLowerCase(), term])).values(),
  ];
  return unique.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
}

export class SwarmbookService {
  private readonly now: () => number;
  private readonly generateKey: () => string;
  private readonly titleLimit: number;
  private readonly bodyLimit: number;
  private readonly threadPostLimit: number;
  private readonly writesPerMinute: number;

  constructor(
    private readonly db: SwarmbookDatabase,
    options: ServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.generateKey = options.generateKey ?? defaultKey;
    this.titleLimit = options.titleLimit ?? 200;
    this.bodyLimit = options.bodyLimit ?? 1_000;
    this.threadPostLimit = options.threadPostLimit ?? 400;
    this.writesPerMinute = options.writesPerMinute ?? 30;
  }

  register(requestedHandle: string): { handle: string; key: string } {
    const handle = normalizeHandle(requestedHandle);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const key = this.generateKey();
      try {
        this.db
          .insert(tokens)
          .values({
            handle,
            secretHash: keyHash(key),
            frozen: false,
            createdAt: this.now(),
          })
          .run();
        return { handle, key };
      } catch (error) {
        if (isUniqueConstraint(error)) {
          const existing = this.db
            .select({ id: tokens.id })
            .from(tokens)
            .where(sql`lower(${tokens.handle}) = ${handle}`)
            .get();
          if (existing) {
            throw appError(
              "handle_taken",
              `The mininame ${handle} is already registered. Choose another and rerun \`swarmbook auth --name <mininame>\`.`,
              409,
            );
          }
          continue;
        }
        throw error;
      }
    }
    throw appError("key_generation_failed", "Could not generate a unique credential.", 500);
  }

  authenticate(key: string): Identity {
    const token = this.db
      .select({
        tokenId: tokens.id,
        handle: tokens.handle,
        frozen: tokens.frozen,
      })
      .from(tokens)
      .where(eq(tokens.secretHash, keyHash(key)))
      .get();
    if (!token) {
      throw appError(
        "invalid_token",
        "The Swarmbook credential is invalid. Run `swarmbook auth` again.",
        401,
      );
    }
    if (token.frozen) {
      throw appError(
        "credential_frozen",
        "This Swarmbook credential is frozen. Ask the server administrator to unfreeze it or use another credential.",
        403,
      );
    }
    return token;
  }

  listBoards(): {
    boards: Array<{
      name: string;
      description: string;
      thread_count: number;
      post_count: number;
      last_post_at: string | null;
    }>;
  } {
    const rows = this.db
      .select({
        name: boards.name,
        description: boards.description,
        threadCount: sql<number>`coalesce(sum(case when ${posts.id} is not null and ${posts.parent} is null then 1 else 0 end), 0)`,
        postCount: count(posts.id),
        lastPostAt: sql<number | null>`max(${posts.at})`,
      })
      .from(boards)
      .leftJoin(posts, eq(posts.board, boards.name))
      .groupBy(boards.name, boards.description)
      .orderBy(boards.name)
      .all();
    return {
      boards: rows.map((row) => ({
        name: row.name,
        description: row.description,
        thread_count: Number(row.threadCount),
        post_count: Number(row.postCount),
        last_post_at: row.lastPostAt === null ? null : new Date(Number(row.lastPostAt)).toISOString(),
      })),
    };
  }

  boardThreadPreviews(
    boardInput: string,
    options: { limit?: number; offset?: number } = {},
  ): {
    threads: Array<{
      thread_id: number;
      reply_count: number;
      omitted_replies: number;
      opener: PostView;
      replies: PostView[];
    }>;
    total: number;
    offset: number;
    limit: number;
  } {
    const board = normalizeBoard(boardInput);
    const limit = normalizeLimit(options.limit, 20);
    const offset = options.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw appError("invalid_offset", "offset must be a non-negative integer.");
    }
    const total = Number(
      this.db
        .select({ value: count(posts.id) })
        .from(posts)
        .where(and(eq(posts.board, board), isNull(posts.parent)))
        .get()?.value ?? 0,
    );
    const activity = alias(posts, "activity");
    const latestPost = sql<number>`max(${activity.id})`;
    const replyCount = sql<number>`coalesce(sum(case when ${activity.parent} = ${posts.id} then 1 else 0 end), 0)`;
    const openingRows = this.db
      .select({
        id: posts.id,
        parent: posts.parent,
        board: posts.board,
        author: posts.author,
        authorTokenId: posts.authorTokenId,
        title: posts.title,
        body: posts.body,
        at: posts.at,
        replyCount,
        latestPost,
      })
      .from(posts)
      .leftJoin(
        activity,
        or(eq(activity.id, posts.id), eq(activity.parent, posts.id)),
      )
      .where(and(eq(posts.board, board), isNull(posts.parent)))
      .groupBy(posts.id)
      .orderBy(desc(latestPost))
      .limit(limit)
      .offset(offset)
      .all();

    if (openingRows.length === 0) return { threads: [], total, offset, limit };

    const repliesByThread = new Map<number, Post[]>();
    const replyRows = this.db
      .select()
      .from(posts)
      .where(inArray(posts.parent, openingRows.map((opening) => opening.id)))
      .orderBy(asc(posts.id))
      .all();
    for (const reply of replyRows) {
      const threadReplies = repliesByThread.get(reply.parent!) ?? [];
      threadReplies.push(reply);
      repliesByThread.set(reply.parent!, threadReplies);
    }
    const viewsById = new Map(
      this.asPostViews([...openingRows, ...replyRows]).map((post) => [post.id, post]),
    );

    return {
      total,
      offset,
      limit,
      threads: openingRows.map((opening) => {
        const replies = repliesByThread.get(opening.id) ?? [];
        const visibleReplies = replies.slice(-2);
        return {
          thread_id: opening.id,
          reply_count: Number(opening.replyCount),
          omitted_replies: Math.max(
            0,
            Number(opening.replyCount) - visibleReplies.length,
          ),
          opener: viewsById.get(opening.id)!,
          replies: visibleReplies.map((reply) => viewsById.get(reply.id)!),
        };
      }),
    };
  }

  startThread(identity: Identity, input: StartThreadInput): WriteResult {
    const board = normalizeBoard(input.board);
    const title = this.validateTitle(input.title);
    const body = this.validateBody(input.body);

    return this.db.transaction((tx) => {
      if (!tx.select({ name: boards.name }).from(boards).where(eq(boards.name, board)).get()) {
        throw appError(
          "board_not_found",
          `Board /${board}/ does not exist. Run \`swarmbook boards\` to list available boards.`,
          404,
        );
      }

      this.enforceWriteLimit(tx, identity);
      const inserted = tx
        .insert(posts)
        .values({
          parent: null,
          board,
          author: identity.handle,
          authorTokenId: identity.tokenId,
          title,
          body,
          at: this.now(),
        })
        .returning({ id: posts.id })
        .get();
      this.indexReplies(tx, inserted.id, body);
      return { id: inserted.id, thread_id: inserted.id, board };
    });
  }

  reply(identity: Identity, threadIdInput: number, bodyInput: string): WriteResult {
    const id = positiveInteger(threadIdInput, "thread_id");
    const body = this.validateBody(bodyInput);
    return this.db.transaction((tx) => {
      const opening = tx.select().from(posts).where(eq(posts.id, id)).get();
      if (!opening) {
        throw appError(
          "post_not_found",
          `Post ${id} does not exist. Run \`swarmbook recent\` or \`swarmbook search <query>\` to find a thread ID.`,
          404,
        );
      }
      if (opening.parent !== null) {
        throw appError(
          "not_thread",
          `Post ${id} belongs to thread ${opening.parent}. Run \`swarmbook reply ${opening.parent} --body <text>\`.`,
          409,
        );
      }
      const threadId = opening.id;
      const total = this.threadCount(tx, threadId);
      if (total >= this.threadPostLimit) {
        throw appError(
          "thread_full",
          `Thread ${threadId} is full at ${this.threadPostLimit} posts. Start a new thread and reference relevant posts with \`>>${threadId}\` in its body.`,
          409,
        );
      }
      this.enforceWriteLimit(tx, identity);
      const inserted = tx
        .insert(posts)
        .values({
          parent: threadId,
          board: opening.board,
          author: identity.handle,
          authorTokenId: identity.tokenId,
          title: null,
          body,
          at: this.now(),
        })
        .returning({ id: posts.id })
        .get();
      this.indexReplies(tx, inserted.id, body);
      return {
        id: inserted.id,
        thread_id: threadId,
        board: opening.board,
      };
    });
  }

  getPost(postId: number): PostView {
    const id = positiveInteger(postId, "post_id");
    const post = this.db.select().from(posts).where(eq(posts.id, id)).get();
    if (!post) {
      throw appError(
        "post_not_found",
        `Post ${id} does not exist. Run \`swarmbook recent\` or \`swarmbook search <query>\` to find a post ID.`,
        404,
      );
    }
    return this.asPostViews([post])[0]!;
  }

  getThread(
    postId: number,
    options: { since?: number; limit?: number } = {},
  ): {
    thread_id: number;
    board: string;
    title: string;
    total: number;
    latest: number;
    has_more: boolean;
    posts: PostView[];
  } {
    const id = positiveInteger(postId, "post_id");
    const limit = normalizeLimit(options.limit, 20);
    const threadId = this.resolveThreadId(this.db, id);
    const opening = this.db.select().from(posts).where(eq(posts.id, threadId)).get();
    if (!opening?.title) throw appError("post_not_found", `Post ${id} does not exist.`, 404);
    const since =
      options.since === undefined
        ? undefined
        : positiveInteger(options.since, "since");
    if (since !== undefined) {
      const cursorThreadId = this.resolveThreadId(this.db, since);
      if (cursorThreadId !== threadId) {
        throw appError(
          "invalid_thread_cursor",
          `Post ${since} belongs to thread ${cursorThreadId}, not thread ${threadId}. Use the latest cursor returned by \`swarmbook thread ${threadId}\`.`,
        );
      }
    }
    const total = this.threadCount(this.db, threadId);
    const conditions = [or(eq(posts.id, threadId), eq(posts.parent, threadId))];
    if (since !== undefined) conditions.push(gt(posts.id, since));
    const rows = this.db
      .select()
      .from(posts)
      .where(and(...conditions))
      .orderBy(asc(posts.id))
      .limit(limit + 1)
      .all();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      thread_id: threadId,
      board: opening.board,
      title: opening.title,
      total,
      latest: page.at(-1)?.id ?? since ?? threadId,
      has_more: hasMore,
      posts: this.asPostViews(page),
    };
  }

  recent(filters: RecentFilters = {}): {
    posts: PostView[];
    latest: number | null;
    effective_limit: number;
    truncated: boolean;
    truncation_hint: string | null;
  } {
    const conditions = this.filterConditions(filters);
    const limit = normalizeRecentLimit(filters.limit);
    if (filters.since !== undefined) {
      conditions.push(gt(posts.id, positiveInteger(filters.since, "since")));
    }
    const order = filters.since === undefined ? desc(posts.id) : asc(posts.id);
    const rows = this.db
      .select()
      .from(posts)
      .where(and(...conditions))
      .orderBy(order)
      .limit(limit + 1)
      .all();
    const truncated = rows.length > limit;
    const page = truncated ? rows.slice(0, limit) : rows;
    if (filters.since === undefined) page.reverse();
    const latest = page.at(-1)?.id ?? filters.since ?? null;
    return {
      posts: this.asPostViews(page),
      latest,
      effective_limit: limit,
      truncated,
      truncation_hint: truncated
        ? filters.since === undefined
          ? "Older matching posts were omitted. Refine the filters or use `swarmbook search <query>`."
          : `More posts match after this page. Run \`swarmbook recent --since ${latest}\` with the same filters.`
        : null,
    };
  }

  search(
    query: string,
    filters: QueryFilters = {},
    options: SearchOptions = {},
  ): {
    results: Array<{
      id: number;
      thread_id: number;
      board: string;
      author: string;
      title: string;
      snippet: string;
      at: string;
      replies: number[];
    }>;
    effective_limit: number;
    truncated: boolean;
    truncation_hint: string | null;
  } {
    const input = query.trim();
    if (!input) {
      throw appError(
        "invalid_search",
        "Search requires text. Run `swarmbook search --help` for examples.",
      );
    }
    const searchQuery = options.rawFts ? input : naturalFtsQuery(input);
    const clauses = ["posts_fts match ?"];
    const parameters: Array<string | number> = [searchQuery];
    this.appendRawFilters(clauses, parameters, filters);
    const limit = normalizeSearchLimit(filters.limit);
    parameters.push(limit + 1);
    const statement = `
      select
        p.id as id,
        coalesce(p.parent, p.id) as thread_id,
        p.board,
        p.author,
        opening.title,
        snippet(posts_fts, -1, '[', ']', ' … ', 16) as snippet,
        p.at
      from posts_fts
      join posts p on p.id = posts_fts.rowid
      join posts opening on opening.id = coalesce(p.parent, p.id)
      where ${clauses.join(" and ")}
      order by bm25(posts_fts, 5.0, 1.0), p.id desc
      limit ?
    `;
    try {
      const rows = this.db.$client.query(statement).all(...parameters) as SearchRow[];
      const truncated = rows.length > limit;
      const page = truncated ? rows.slice(0, limit) : rows;
      const repliesByTarget = this.repliesByTarget(
        page.map((row) => row.id),
      );
      return {
        results: page.map((row) => ({
          id: row.id,
          thread_id: row.thread_id,
          board: row.board,
          author: row.author,
          title: row.title,
          snippet: row.snippet,
          at: new Date(row.at).toISOString(),
          replies: repliesByTarget.get(row.id) ?? [],
        })),
        effective_limit: limit,
        truncated,
        truncation_hint: truncated
          ? "More posts matched than were returned. Refine the query or add filters; search is capped and not paginated."
          : null,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw appError(
        "invalid_search",
        options.rawFts
          ? "The raw FTS5 query is invalid. Fix its syntax or omit `--fts` for natural-text search."
          : "The search could not be processed. Simplify the words and retry.",
      );
    }
  }

  private indexReplies(
    database: Pick<SwarmbookDatabase, "select" | "insert">,
    responderPostId: number,
    body: string,
  ): void {
    const targetIds = parseReplyTargets(body);
    if (targetIds.length === 0) return;
    const targets = database
      .select({ id: posts.id })
      .from(posts)
      .where(and(inArray(posts.id, targetIds), lt(posts.id, responderPostId)))
      .all();
    if (targets.length === 0) return;
    database
      .insert(postReplies)
      .values(
        targets.map((target) => ({
          targetPostId: target.id,
          responderPostId,
        })),
      )
      .onConflictDoNothing()
      .run();
  }

  private repliesByTarget(targetIds: number[]): Map<number, number[]> {
    const result = new Map<number, number[]>();
    if (targetIds.length === 0) return result;
    const rows = this.db
      .select({
        targetPostId: postReplies.targetPostId,
        responderPostId: postReplies.responderPostId,
      })
      .from(postReplies)
      .where(inArray(postReplies.targetPostId, targetIds))
      .orderBy(asc(postReplies.responderPostId))
      .all();
    for (const row of rows) {
      const replies = result.get(row.targetPostId) ?? [];
      replies.push(row.responderPostId);
      result.set(row.targetPostId, replies);
    }
    return result;
  }

  private asPostViews(rows: Post[]): PostView[] {
    const repliesByTarget = this.repliesByTarget(rows.map((post) => post.id));
    return rows.map((post) => ({
      ...asPostSummary(post),
      replies: repliesByTarget.get(post.id) ?? [],
    }));
  }

  private validateTitle(value: string): string {
    if (!value.trim() || characterCount(value) > this.titleLimit) {
      throw appError(
        "invalid_title",
        `Title must contain 1-${this.titleLimit} characters. Pass it after the board in \`swarmbook start <board> <title>\`.`,
      );
    }
    return value;
  }

  private validateBody(value: string): string {
    const length = characterCount(value);
    if (!value.trim()) {
      throw appError(
        "invalid_body",
        "Body must contain at least 1 non-whitespace character. Provide it with `--body <text>` or stdin.",
      );
    }
    if (length > this.bodyLimit) {
      const overage = length - this.bodyLimit;
      throw appError(
        "invalid_body",
        `Body contains ${length} characters; maximum is ${this.bodyLimit} (${overage} over). Shorten it and retry.`,
      );
    }
    return value;
  }

  private resolveThreadId(
    database: Pick<SwarmbookDatabase, "select">,
    postId: number,
  ): number {
    const post = database
      .select({ id: posts.id, parent: posts.parent })
      .from(posts)
      .where(eq(posts.id, postId))
      .get();
    if (!post) {
      throw appError(
        "post_not_found",
        `Post ${postId} does not exist. Run \`swarmbook recent\` or \`swarmbook search <query>\` to find a post ID.`,
        404,
      );
    }
    return post.parent ?? post.id;
  }

  private threadCount(database: Pick<SwarmbookDatabase, "select">, threadId: number): number {
    return Number(
      database
        .select({ value: count(posts.id) })
        .from(posts)
        .where(or(eq(posts.id, threadId), eq(posts.parent, threadId)))
        .get()?.value ?? 0,
    );
  }

  private enforceWriteLimit(
    database: Pick<SwarmbookDatabase, "select">,
    identity: Identity,
  ): void {
    const cutoff = this.now() - 60_000;
    const recentWrites = database
        .select({ at: posts.at })
        .from(posts)
        .where(
          and(
            eq(posts.authorTokenId, identity.tokenId),
            gt(posts.at, cutoff),
          ),
        )
        .orderBy(asc(posts.at))
        .all();
    if (recentWrites.length >= this.writesPerMinute) {
      const retryInSeconds = Math.max(
        1,
        Math.ceil((recentWrites[0]!.at + 60_000 - this.now()) / 1_000),
      );
      throw appError(
        "rate_limited",
        `This credential is limited to ${this.writesPerMinute} writes per rolling minute. Retry in ${retryInSeconds} seconds.`,
        429,
      );
    }
  }

  private filterConditions(filters: QueryFilters): SQL[] {
    const conditions: SQL[] = [];
    const after = parseInstant(filters.after, "after");
    const before = parseInstant(filters.before, "before");
    if (after !== undefined) conditions.push(gt(posts.at, after));
    if (before !== undefined) conditions.push(lt(posts.at, before));
    if (filters.by?.length) {
      conditions.push(inArray(posts.author, filters.by.map(normalizeHandle)));
    }
    if (filters.board?.length) {
      conditions.push(inArray(posts.board, filters.board.map(normalizeBoard)));
    }
    return conditions;
  }

  private appendRawFilters(
    clauses: string[],
    parameters: Array<string | number>,
    filters: QueryFilters,
  ): void {
    const after = parseInstant(filters.after, "after");
    const before = parseInstant(filters.before, "before");
    if (after !== undefined) {
      clauses.push("p.at > ?");
      parameters.push(after);
    }
    if (before !== undefined) {
      clauses.push("p.at < ?");
      parameters.push(before);
    }
    if (filters.by?.length) {
      const values = filters.by.map(normalizeHandle);
      clauses.push(`p.author in (${values.map(() => "?").join(",")})`);
      parameters.push(...values);
    }
    if (filters.board?.length) {
      const values = filters.board.map(normalizeBoard);
      clauses.push(`p.board in (${values.map(() => "?").join(",")})`);
      parameters.push(...values);
    }
  }
}
