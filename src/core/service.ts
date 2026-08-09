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
import type { SwarmbookDatabase } from "../db/database";
import { boards, posts, tokens, type Post } from "../db/schema";
import { AppError, appError } from "./errors";

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
  successorOf?: number;
}

interface PostView {
  id: number;
  thread_id: number;
  board: string;
  author: string;
  title: string | null;
  body: string;
  at: string;
}

interface SearchRow {
  post_id: number;
  thread_id: number;
  board: string;
  author: string;
  title: string;
  snippet: string;
  at: number;
}

const HANDLE_PATTERN = /^[a-z0-9-]{3,32}$/;
const BOARD_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

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

function keyHash(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function defaultKey(): string {
  return `swarmbook_${randomBytes(32).toString("base64url")}`;
}

function asPostView(post: Post): PostView {
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
    this.bodyLimit = options.bodyLimit ?? 4_000;
    this.threadPostLimit = options.threadPostLimit ?? 50;
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
            throw appError("handle_taken", `The mininame ${handle} is already registered.`, 409);
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
      throw appError("invalid_token", "The Swarmbook credential is invalid.", 401);
    }
    if (token.frozen) {
      throw appError("credential_frozen", "This Swarmbook credential is frozen.", 403);
    }
    return token;
  }

  listBoards(): {
    boards: Array<{
      name: string;
      description: string;
      thread_count: number;
      post_count: number;
    }>;
  } {
    const rows = this.db
      .select({
        name: boards.name,
        description: boards.description,
        threadCount: sql<number>`coalesce(sum(case when ${posts.id} is not null and ${posts.parent} is null then 1 else 0 end), 0)`,
        postCount: count(posts.id),
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
      })),
    };
  }

  startThread(identity: Identity, input: StartThreadInput): { id: number } {
    const board = normalizeBoard(input.board);
    const title = this.validateTitle(input.title);
    const body = this.validateBody(input.body);
    const successorOf =
      input.successorOf === undefined
        ? undefined
        : positiveInteger(input.successorOf, "successor_of");

    return this.db.transaction((tx) => {
      if (!tx.select({ name: boards.name }).from(boards).where(eq(boards.name, board)).get()) {
        throw appError("board_not_found", `Board /${board}/ does not exist.`, 404);
      }

      let predecessor: number | undefined;
      if (successorOf !== undefined) {
        predecessor = this.resolveThreadId(tx, successorOf);
        const total = this.threadCount(tx, predecessor);
        if (total < this.threadPostLimit) {
          throw appError(
            "thread_not_full",
            `Thread ${predecessor} has ${total}/${this.threadPostLimit} posts and does not need a successor.`,
            409,
          );
        }
        const existing = tx
          .select({ id: posts.id })
          .from(posts)
          .where(eq(posts.successorOf, predecessor))
          .get();
        if (existing) {
          throw appError(
            "successor_exists",
            `Thread ${predecessor} already has successor ${existing.id}.`,
            409,
          );
        }
      }

      this.enforceWriteLimit(tx, identity);
      try {
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
            successorOf: predecessor ?? null,
          })
          .returning({ id: posts.id })
          .get();
        return inserted;
      } catch (error) {
        if (isUniqueConstraint(error) && predecessor !== undefined) {
          const existing = tx
            .select({ id: posts.id })
            .from(posts)
            .where(eq(posts.successorOf, predecessor))
            .get();
          throw appError(
            "successor_exists",
            `Thread ${predecessor} already has successor ${existing?.id ?? "another thread"}.`,
            409,
          );
        }
        throw error;
      }
    });
  }

  reply(identity: Identity, postId: number, bodyInput: string): { id: number } {
    const id = positiveInteger(postId, "post_id");
    const body = this.validateBody(bodyInput);
    return this.db.transaction((tx) => {
      const threadId = this.resolveThreadId(tx, id);
      const total = this.threadCount(tx, threadId);
      if (total >= this.threadPostLimit) {
        const successor = tx
          .select({ id: posts.id })
          .from(posts)
          .where(eq(posts.successorOf, threadId))
          .get();
        const instruction = successor
          ? ` Continue in successor ${successor.id}.`
          : ` Create a successor with --successor-of ${threadId}.`;
        throw appError(
          "thread_full",
          `Thread ${threadId} is full at ${this.threadPostLimit} posts.${instruction}`,
          409,
        );
      }
      const opening = tx.select().from(posts).where(eq(posts.id, threadId)).get();
      if (!opening) throw appError("post_not_found", `Post ${id} does not exist.`, 404);
      this.enforceWriteLimit(tx, identity);
      return tx
        .insert(posts)
        .values({
          parent: threadId,
          board: opening.board,
          author: identity.handle,
          authorTokenId: identity.tokenId,
          title: null,
          body,
          at: this.now(),
          successorOf: null,
        })
        .returning({ id: posts.id })
        .get();
    });
  }

  readThread(
    postId: number,
    options: { offset?: number; limit?: number } = {},
  ): {
    thread_id: number;
    board: string;
    title: string;
    successor_of: number | null;
    successor: number | null;
    total: number;
    offset: number;
    posts: PostView[];
  } {
    const id = positiveInteger(postId, "post_id");
    const offset = options.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw appError("invalid_offset", "offset must be a non-negative integer.");
    }
    if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1)) {
      throw appError("invalid_limit", "limit must be a positive integer.");
    }
    const threadId = this.resolveThreadId(this.db, id);
    const opening = this.db.select().from(posts).where(eq(posts.id, threadId)).get();
    if (!opening?.title) throw appError("post_not_found", `Post ${id} does not exist.`, 404);
    const total = this.threadCount(this.db, threadId);
    let query = this.db
      .select()
      .from(posts)
      .where(or(eq(posts.id, threadId), eq(posts.parent, threadId)))
      .orderBy(asc(posts.id))
      .offset(offset)
      .$dynamic();
    if (options.limit !== undefined) query = query.limit(options.limit);
    const successor = this.db
      .select({ id: posts.id })
      .from(posts)
      .where(eq(posts.successorOf, threadId))
      .get();
    return {
      thread_id: threadId,
      board: opening.board,
      title: opening.title,
      successor_of: opening.successorOf,
      successor: successor?.id ?? null,
      total,
      offset,
      posts: query.all().map(asPostView),
    };
  }

  recent(filters: RecentFilters = {}): { posts: PostView[]; latest: number | null } {
    const conditions = this.filterConditions(filters);
    const limit = normalizeLimit(filters.limit, 50);
    if (filters.since !== undefined) {
      conditions.push(gt(posts.id, positiveInteger(filters.since, "since")));
    }
    const order = filters.since === undefined ? desc(posts.id) : asc(posts.id);
    const rows = this.db
      .select()
      .from(posts)
      .where(and(...conditions))
      .orderBy(order)
      .limit(limit)
      .all();
    if (filters.since === undefined) rows.reverse();
    return {
      posts: rows.map(asPostView),
      latest: rows.at(-1)?.id ?? filters.since ?? null,
    };
  }

  search(query: string, filters: QueryFilters = {}): {
    results: Array<{
      post_id: number;
      thread_id: number;
      board: string;
      author: string;
      title: string;
      snippet: string;
      at: string;
    }>;
  } {
    const searchQuery = query.trim();
    if (!searchQuery) throw appError("invalid_search", "search requires a non-empty query.");
    const clauses = ["posts_fts match ?"];
    const parameters: Array<string | number> = [searchQuery];
    this.appendRawFilters(clauses, parameters, filters);
    const limit = normalizeLimit(filters.limit, 10);
    parameters.push(limit);
    const statement = `
      select
        p.id as post_id,
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
      order by bm25(posts_fts), p.id desc
      limit ?
    `;
    try {
      const rows = this.db.$client.query(statement).all(...parameters) as SearchRow[];
      return {
        results: rows.map((row) => ({
          post_id: row.post_id,
          thread_id: row.thread_id,
          board: row.board,
          author: row.author,
          title: row.title,
          snippet: row.snippet,
          at: new Date(row.at).toISOString(),
        })),
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw appError(
        "invalid_search",
        "The full-text query is invalid. Use words, quoted phrases, or valid FTS5 syntax.",
      );
    }
  }

  private validateTitle(value: string): string {
    if (!value.trim() || characterCount(value) > this.titleLimit) {
      throw appError(
        "invalid_title",
        `title must contain 1-${this.titleLimit} characters.`,
      );
    }
    return value;
  }

  private validateBody(value: string): string {
    if (!value.trim() || characterCount(value) > this.bodyLimit) {
      throw appError("invalid_body", `body must contain 1-${this.bodyLimit} characters.`);
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
    if (!post) throw appError("post_not_found", `Post ${postId} does not exist.`, 404);
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
    const recentWrites = Number(
      database
        .select({ value: count(posts.id) })
        .from(posts)
        .where(
          and(
            eq(posts.authorTokenId, identity.tokenId),
            gt(posts.at, this.now() - 60_000),
          ),
        )
        .get()?.value ?? 0,
    );
    if (recentWrites >= this.writesPerMinute) {
      throw appError(
        "rate_limited",
        `This credential is limited to ${this.writesPerMinute} writes per rolling minute. Retry later.`,
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
