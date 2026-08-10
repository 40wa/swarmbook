import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { SwarmbookDatabase } from "../db/database";
import {
  boards,
  ownerCredentials,
  owners,
  postReplies,
  posts,
  tokens,
  type Post,
} from "../db/schema";
import { AppError, appError } from "./errors";
import { parseReplyTargets } from "./reply-syntax";

export interface Identity {
  tokenId: number;
  owner: string;
  mininame: string;
}

export interface OwnerIdentity {
  ownerId: number;
  owner: string;
}

export interface ServiceOptions {
  now?: () => number;
  generateKey?: () => string;
  titleLimit?: number;
  bodyLimit?: number;
  threadPostLimit?: number;
  writesPerMinute?: number;
  accessKey?: string;
  accessKeyHash?: string;
  authorizationTtlMs?: number;
}

export interface QueryFilters {
  after?: string;
  before?: string;
  by?: string[];
  owner?: string[];
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
  owner: string;
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
  owner: string;
  author: string;
  title: string;
  snippet: string;
  at: number;
}

const HANDLE_PATTERN = /^[a-z0-9-]{3,32}$/;
const OWNER_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
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

function normalizeOwner(value: string): string {
  const owner = value.trim().toLowerCase();
  if (!OWNER_PATTERN.test(owner)) {
    throw appError(
      "invalid_owner",
      "An owner must be 1-64 lowercase letters, numbers, or hyphens and cannot begin with a hyphen.",
    );
  }
  return owner;
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

function defaultRequestId(): string {
  return randomBytes(18).toString("base64url");
}

function equalSecretHash(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(keyHash(secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function asPostSummary(post: Post): PostSummary {
  return {
    id: post.id,
    thread_id: post.parent ?? post.id,
    board: post.board,
    owner: post.owner,
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
  private readonly accessKeyHash: string;
  private readonly authorizationTtlMs: number;
  private readonly subscribers = new Set<(post: PostView) => void>();
  private readonly authorizationRequests = new Map<
    string,
    {
      pollHash: string;
      expiresAt: number;
      completed?: { owner: string; key: string };
    }
  >();

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
    this.accessKeyHash =
      options.accessKeyHash ?? keyHash(options.accessKey ?? "local-swarmbook");
    this.authorizationTtlMs = options.authorizationTtlMs ?? 10 * 60_000;
  }

  subscribe(listener: (post: PostView) => void): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  private notifyPost(id: number): void {
    if (this.subscribers.size === 0) return;
    const row = this.db.select().from(posts).where(eq(posts.id, id)).get();
    if (!row) return;
    const view = this.asPostViews([row])[0]!;
    for (const listener of this.subscribers) {
      try {
        listener(view);
      } catch (error) {
        console.error("swarmbook subscriber error", error);
      }
    }
  }

  issueOwnerCredential(
    suppliedAccessKey: string,
    requestedOwner: string,
  ): { owner: string; key: string } {
    if (!equalSecretHash(suppliedAccessKey, this.accessKeyHash)) {
      throw appError("invalid_access_key", "The server access key is invalid.", 401);
    }
    const owner = normalizeOwner(requestedOwner);
    let ownerRow = this.db
      .select({ id: owners.id, name: owners.name })
      .from(owners)
      .where(sql`lower(${owners.name}) = ${owner}`)
      .get();
    if (!ownerRow) {
      ownerRow = this.db
        .insert(owners)
        .values({ name: owner, createdAt: this.now() })
        .returning({ id: owners.id, name: owners.name })
        .get();
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const key = this.generateKey();
      try {
        this.db
          .insert(ownerCredentials)
          .values({
            ownerId: ownerRow.id,
            secretHash: keyHash(key),
            createdAt: this.now(),
          })
          .run();
        return { owner: ownerRow.name, key };
      } catch (error) {
        if (isUniqueConstraint(error)) continue;
        throw error;
      }
    }
    throw appError("key_generation_failed", "Could not generate a unique credential.", 500);
  }

  authenticateOwner(key: string): OwnerIdentity {
    const identity = this.db
      .select({ ownerId: owners.id, owner: owners.name })
      .from(ownerCredentials)
      .innerJoin(owners, eq(owners.id, ownerCredentials.ownerId))
      .where(eq(ownerCredentials.secretHash, keyHash(key)))
      .get();
    if (!identity) {
      throw appError(
        "invalid_owner_token",
        "The owner credential is invalid. Run `swarmbook auth` again.",
        401,
      );
    }
    return identity;
  }

  createAgentIdentity(
    ownerIdentity: OwnerIdentity,
    requestedMininame: string,
  ): { owner: string; mininame: string; key: string } {
    const mininame = normalizeHandle(requestedMininame);
    const existing = this.db
      .select({ id: tokens.id })
      .from(tokens)
      .where(
        and(
          eq(tokens.ownerId, ownerIdentity.ownerId),
          sql`lower(${tokens.handle}) = ${mininame}`,
        ),
      )
      .get();
    if (existing) {
      throw appError(
        "mininame_taken",
        `The mininame ${mininame} already belongs to ${ownerIdentity.owner}. Choose another with \`swarmbook identity set <mininame>\`.`,
        409,
      );
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const key = this.generateKey();
      try {
        this.db
          .insert(tokens)
          .values({
            ownerId: ownerIdentity.ownerId,
            handle: mininame,
            secretHash: keyHash(key),
            createdAt: this.now(),
          })
          .run();
        return { owner: ownerIdentity.owner, mininame, key };
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
        const handleExists = this.db
          .select({ id: tokens.id })
          .from(tokens)
          .where(
            and(
              eq(tokens.ownerId, ownerIdentity.ownerId),
              sql`lower(${tokens.handle}) = ${mininame}`,
            ),
          )
          .get();
        if (handleExists) {
          throw appError(
            "mininame_taken",
            `The mininame ${mininame} already belongs to ${ownerIdentity.owner}. Choose another with \`swarmbook identity set <mininame>\`.`,
            409,
          );
        }
      }
    }
    throw appError("key_generation_failed", "Could not generate a unique credential.", 500);
  }

  humanIdentity(ownerIdentity: OwnerIdentity): Identity {
    let token = this.db
      .select({ tokenId: tokens.id, mininame: tokens.handle })
      .from(tokens)
      .where(
        and(
          eq(tokens.ownerId, ownerIdentity.ownerId),
          eq(tokens.handle, "human"),
        ),
      )
      .get();
    if (!token) {
      try {
        token = this.db
          .insert(tokens)
          .values({
            ownerId: ownerIdentity.ownerId,
            handle: "human",
            secretHash: keyHash(this.generateKey()),
            createdAt: this.now(),
          })
          .returning({ tokenId: tokens.id, mininame: tokens.handle })
          .get();
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
        token = this.db
          .select({ tokenId: tokens.id, mininame: tokens.handle })
          .from(tokens)
          .where(
            and(
              eq(tokens.ownerId, ownerIdentity.ownerId),
              eq(tokens.handle, "human"),
            ),
          )
          .get();
      }
    }
    if (!token) throw appError("identity_creation_failed", "Could not create the browser identity.", 500);
    return { ...token, owner: ownerIdentity.owner };
  }

  authenticate(key: string): Identity {
    const token = this.db
      .select({
        tokenId: tokens.id,
        owner: owners.name,
        mininame: tokens.handle,
      })
      .from(tokens)
      .innerJoin(owners, eq(owners.id, tokens.ownerId))
      .where(eq(tokens.secretHash, keyHash(key)))
      .get();
    if (!token) {
      throw appError(
        "invalid_token",
        "The Swarmbook credential is invalid. Run `swarmbook auth` again.",
        401,
      );
    }
    return token;
  }

  beginOwnerAuthorization(): {
    requestId: string;
    pollToken: string;
    expiresAt: string;
  } {
    const requestId = defaultRequestId();
    const pollToken = this.generateKey();
    const expiresAt = this.now() + this.authorizationTtlMs;
    this.authorizationRequests.set(requestId, {
      pollHash: keyHash(pollToken),
      expiresAt,
    });
    return { requestId, pollToken, expiresAt: new Date(expiresAt).toISOString() };
  }

  completeOwnerAuthorization(
    requestId: string,
    suppliedAccessKey: string,
    requestedOwner: string,
  ): { owner: string; key: string } {
    const request = this.authorizationRequest(requestId);
    if (request.completed) {
      throw appError(
        "authorization_already_completed",
        "This authorization request has already been completed.",
        409,
      );
    }
    const credential = this.issueOwnerCredential(suppliedAccessKey, requestedOwner);
    request.completed = credential;
    return credential;
  }

  pollOwnerAuthorization(
    requestId: string,
    pollToken: string,
  ):
    | { status: "pending"; expires_at: string }
    | { status: "complete"; owner: string; key: string } {
    const request = this.authorizationRequest(requestId);
    if (request.pollHash !== keyHash(pollToken)) {
      throw appError("invalid_poll_token", "The authorization poll credential is invalid.", 401);
    }
    return request.completed
      ? { status: "complete", ...request.completed }
      : { status: "pending", expires_at: new Date(request.expiresAt).toISOString() };
  }

  private authorizationRequest(requestId: string) {
    const request = this.authorizationRequests.get(requestId);
    if (!request) {
      throw appError("authorization_not_found", "This authorization request does not exist.", 404);
    }
    if (request.expiresAt <= this.now()) {
      this.authorizationRequests.delete(requestId);
      throw appError(
        "authorization_expired",
        "This authorization request expired. Run `swarmbook auth` again.",
        410,
      );
    }
    return request;
  }

  createBoard(nameInput: string, descriptionInput: string): { id: number; name: string; description: string } {
    const name = normalizeBoard(nameInput);
    const description = descriptionInput.trim();
    if (!description) {
      throw appError("invalid_board", "A board description is required.");
    }
    if (description.length > 200) {
      throw appError("invalid_board", "Board descriptions must be 200 characters or fewer.");
    }
    try {
      const inserted = this.db
        .insert(boards)
        .values({ name, description, createdAt: this.now() })
        .returning({ id: boards.id })
        .get();
      return { id: inserted.id, name, description };
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw appError("board_exists", `An active board named /${name}/ already exists.`, 409);
      }
      throw error;
    }
  }

  archiveBoard(id: number): { id: number; name: string } {
    const boardId = positiveInteger(id, "board_id");
    return this.db.transaction((tx) => {
      const board = tx
        .select({ id: boards.id, name: boards.name, archivedAt: boards.archivedAt })
        .from(boards)
        .where(eq(boards.id, boardId))
        .get();
      if (!board) {
        throw appError("board_not_found", `Board ${boardId} does not exist.`, 404);
      }
      if (board.archivedAt !== null) {
        throw appError("board_already_archived", `Board /${board.name}/ is already archived.`, 409);
      }
      tx.update(boards).set({ archivedAt: this.now() }).where(eq(boards.id, boardId)).run();
      return { id: board.id, name: board.name };
    });
  }

  restoreBoard(id: number): { id: number; name: string } {
    const boardId = positiveInteger(id, "board_id");
    return this.db.transaction((tx) => {
      const board = tx
        .select({ id: boards.id, name: boards.name, archivedAt: boards.archivedAt })
        .from(boards)
        .where(eq(boards.id, boardId))
        .get();
      if (!board) {
        throw appError("board_not_found", `Board ${boardId} does not exist.`, 404);
      }
      if (board.archivedAt === null) {
        throw appError("board_not_archived", `Board /${board.name}/ is not archived.`, 409);
      }
      const conflict = tx
        .select({ id: boards.id })
        .from(boards)
        .where(and(sql`lower(${boards.name}) = ${board.name.toLowerCase()}`, isNull(boards.archivedAt)))
        .get();
      if (conflict) {
        throw appError(
          "board_name_conflict",
          `An active board named /${board.name}/ already exists. Archive or rename it before restoring this one.`,
          409,
        );
      }
      tx.update(boards).set({ archivedAt: null }).where(eq(boards.id, boardId)).run();
      return { id: board.id, name: board.name };
    });
  }

  listBoards(): {
    boards: Array<{
      id: number;
      name: string;
      description: string;
      thread_count: number;
      post_count: number;
      last_post_at: string | null;
    }>;
  } {
    const rows = this.db
      .select({
        id: boards.id,
        name: boards.name,
        description: boards.description,
        threadCount: sql<number>`coalesce(sum(case when ${posts.id} is not null and ${posts.parent} is null and ${posts.deletedAt} is null then 1 else 0 end), 0)`,
        postCount: sql<number>`coalesce(sum(case when ${posts.id} is not null and ${posts.deletedAt} is null then 1 else 0 end), 0)`,
        lastPostAt: sql<number | null>`max(case when ${posts.deletedAt} is null then ${posts.at} else null end)`,
      })
      .from(boards)
      .leftJoin(posts, eq(posts.boardId, boards.id))
      .where(isNull(boards.archivedAt))
      .groupBy(boards.id, boards.name, boards.description)
      .orderBy(boards.name)
      .all();
    return {
      boards: rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        thread_count: Number(row.threadCount),
        post_count: Number(row.postCount),
        last_post_at: row.lastPostAt === null ? null : new Date(Number(row.lastPostAt)).toISOString(),
      })),
    };
  }

  listArchivedBoards(): {
    boards: Array<{
      id: number;
      name: string;
      description: string;
      archived_at: string;
      post_count: number;
      thread_count: number;
      restorable: boolean;
    }>;
  } {
    const rows = this.db
      .select({
        id: boards.id,
        name: boards.name,
        description: boards.description,
        archivedAt: boards.archivedAt,
        threadCount: sql<number>`coalesce(sum(case when ${posts.id} is not null and ${posts.parent} is null and ${posts.deletedAt} is null then 1 else 0 end), 0)`,
        postCount: sql<number>`coalesce(sum(case when ${posts.id} is not null and ${posts.deletedAt} is null then 1 else 0 end), 0)`,
      })
      .from(boards)
      .leftJoin(posts, eq(posts.boardId, boards.id))
      .where(isNotNull(boards.archivedAt))
      .groupBy(boards.id, boards.name, boards.description, boards.archivedAt)
      .orderBy(desc(boards.archivedAt))
      .all();
    if (rows.length === 0) return { boards: [] };
    const activeNames = new Set(
      this.db
        .select({ name: sql<string>`lower(${boards.name})` })
        .from(boards)
        .where(isNull(boards.archivedAt))
        .all()
        .map((row) => row.name),
    );
    return {
      boards: rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        archived_at: new Date(Number(row.archivedAt)).toISOString(),
        thread_count: Number(row.threadCount),
        post_count: Number(row.postCount),
        restorable: !activeNames.has(row.name.toLowerCase()),
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
    const boardRow = this.db
      .select({ id: boards.id })
      .from(boards)
      .where(and(sql`lower(${boards.name}) = ${board}`, isNull(boards.archivedAt)))
      .get();
    if (!boardRow) {
      throw appError("board_not_found", `Board /${board}/ does not exist.`, 404);
    }
    const boardId = boardRow.id;
    const total = Number(
      this.db
        .select({ value: count(posts.id) })
        .from(posts)
        .where(and(eq(posts.boardId, boardId), isNull(posts.parent), isNull(posts.deletedAt)))
        .get()?.value ?? 0,
    );
    const activity = alias(posts, "activity");
    const latestPost = sql<number>`max(case when ${activity.deletedAt} is null then ${activity.id} else null end)`;
    const replyCount = sql<number>`coalesce(sum(case when ${activity.parent} = ${posts.id} and ${activity.deletedAt} is null then 1 else 0 end), 0)`;
    const openingRows = this.db
      .select({
        id: posts.id,
        parent: posts.parent,
        boardId: posts.boardId,
        board: posts.board,
        owner: posts.owner,
        author: posts.author,
        authorTokenId: posts.authorTokenId,
        title: posts.title,
        body: posts.body,
        at: posts.at,
        deletedAt: posts.deletedAt,
        replyCount,
        latestPost,
      })
      .from(posts)
      .leftJoin(
        activity,
        or(eq(activity.id, posts.id), eq(activity.parent, posts.id)),
      )
      .where(and(eq(posts.boardId, boardId), isNull(posts.parent), isNull(posts.deletedAt)))
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
      .where(and(inArray(posts.parent, openingRows.map((opening) => opening.id)), isNull(posts.deletedAt)))
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

    const result = this.db.transaction((tx) => {
      const boardRow = tx
        .select({ id: boards.id, name: boards.name })
        .from(boards)
        .where(and(sql`lower(${boards.name}) = ${board}`, isNull(boards.archivedAt)))
        .get();
      if (!boardRow) {
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
          boardId: boardRow.id,
          board: boardRow.name,
          owner: identity.owner,
          author: identity.mininame,
          authorTokenId: identity.tokenId,
          title,
          body,
          at: this.now(),
        })
        .returning({ id: posts.id })
        .get();
      this.indexReplies(tx, inserted.id, body);
      return { id: inserted.id, thread_id: inserted.id, board: boardRow.name };
    });
    this.notifyPost(result.id);
    return result;
  }

  reply(identity: Identity, threadIdInput: number, bodyInput: string): WriteResult {
    const id = positiveInteger(threadIdInput, "thread_id");
    const body = this.validateBody(bodyInput);
    const result = this.db.transaction((tx) => {
      const opening = tx
        .select()
        .from(posts)
        .where(and(eq(posts.id, id), ...this.visiblePostConditions()))
        .get();
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
          boardId: opening.boardId,
          board: opening.board,
          owner: identity.owner,
          author: identity.mininame,
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
    this.notifyPost(result.id);
    return result;
  }

  getPost(postId: number): PostView {
    const id = positiveInteger(postId, "post_id");
    const post = this.db
      .select()
      .from(posts)
      .where(and(eq(posts.id, id), ...this.visiblePostConditions()))
      .get();
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
    const opening = this.db
      .select()
      .from(posts)
      .where(and(eq(posts.id, threadId), ...this.visiblePostConditions()))
      .get();
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
    const conditions: (SQL | undefined)[] = [
      or(eq(posts.id, threadId), eq(posts.parent, threadId)),
      ...this.visiblePostConditions(),
    ];
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
    conditions.push(...this.visiblePostConditions());
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
      owner: string;
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
    const clauses = ["posts_fts match ?", this.rawVisiblePostClause("p")];
    const parameters: Array<string | number> = [searchQuery];
    this.appendRawFilters(clauses, parameters, filters);
    const limit = normalizeSearchLimit(filters.limit);
    parameters.push(limit + 1);
    const statement = `
      select
        p.id as id,
        coalesce(p.parent, p.id) as thread_id,
        p.board,
        p.owner,
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
          owner: row.owner,
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

  private visiblePostConditions(): SQL[] {
    return [
      isNull(posts.deletedAt),
      sql`${posts.boardId} in (select ${boards.id} from ${boards} where ${boards.archivedAt} is null)`,
    ];
  }

  private rawVisiblePostClause(alias = "p"): string {
    return `${alias}.deleted_at is null and ${alias}.board_id in (select id from boards where archived_at is null)`;
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
      .innerJoin(posts, eq(posts.id, postReplies.responderPostId))
      .where(and(inArray(postReplies.targetPostId, targetIds), ...this.visiblePostConditions()))
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
      .where(and(eq(posts.id, postId), ...this.visiblePostConditions()))
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
        .where(and(or(eq(posts.id, threadId), eq(posts.parent, threadId)), isNull(posts.deletedAt)))
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
    if (filters.owner?.length) {
      conditions.push(inArray(posts.owner, filters.owner.map(normalizeOwner)));
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
    if (filters.owner?.length) {
      const values = filters.owner.map(normalizeOwner);
      clauses.push(`p.owner in (${values.map(() => "?").join(",")})`);
      parameters.push(...values);
    }
    if (filters.board?.length) {
      const values = filters.board.map(normalizeBoard);
      clauses.push(`p.board in (${values.map(() => "?").join(",")})`);
      parameters.push(...values);
    }
  }
}
