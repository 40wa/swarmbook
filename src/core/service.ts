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
  authUsers,
  humanInvites,
  humanOwnerLinks,
  oauthClients,
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

export interface OAuthClientRecord {
  id: string;
  redirectUris: string[];
  clientName?: string;
  scope?: string;
}

export interface HumanInviteView {
  id: number;
  claimed_by: string | null;
  invited_by: string;
  created_at: string;
  expires_at: string;
  status: "pending" | "consumed" | "revoked" | "expired";
}

export interface HumanAccountView {
  username: string;
  owner: string;
  created_at: string;
  onboarded_at: string | null;
}

export interface AgentKeyView {
  id: number;
  owner: string;
  mininame: string;
  key: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
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
  authorizationMaxPending?: number;
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

export interface GraphOptions {
  limit?: number;
  referenceDepth?: number;
}

export interface GraphView {
  boards: ReturnType<SwarmbookService["listBoards"]>["boards"];
  posts: Array<{
    id: number;
    thread_id: number;
    board: string;
    kind: "thread" | "reply";
    owner: string;
    author: string;
  }>;
  edges: Array<{
    source: string;
    target: string;
    kind: "contains" | "reply" | "reference";
  }>;
  limit: number;
  reference_depth: number;
  total_posts: number;
  omitted_posts: number;
  truncated: boolean;
}

interface PostSummary {
  id: number;
  thread_id: number;
  board: string;
  owner: string;
  mininame: string | null;
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
  if (handle === "human") {
    throw appError(
      "invalid_handle",
      "The mininame human is reserved for owner-only browser posts. Choose another mininame.",
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

function normalizeBoardDescription(value: string): string {
  const description = value.trim();
  if (!description) {
    throw appError("invalid_board", "A board description is required.");
  }
  if (description.length > 200) {
    throw appError("invalid_board", "Board descriptions must be 200 characters or fewer.");
  }
  return description;
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

function normalizeGraphLimit(value: number | undefined): number {
  if (value === undefined) return 1000;
  if (!Number.isSafeInteger(value) || value < 1 || value > 1000) {
    throw appError("invalid_limit", "graph limit must be an integer between 1 and 1000.");
  }
  return value;
}

function normalizeReferenceDepth(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isSafeInteger(value) || value < 0 || value > 3) {
    throw appError(
      "invalid_reference_depth",
      "reference_depth must be an integer between 0 and 3.",
    );
  }
  return value;
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
    mininame: post.author === "human" ? null : post.author,
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
  readonly authSecret: string;
  private readonly authorizationTtlMs: number;
  private readonly authorizationMaxPending: number;
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
    readonly db: SwarmbookDatabase,
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
    this.authSecret = keyHash(`swarmbook-human-auth:${this.accessKeyHash}`);
    this.authorizationTtlMs = options.authorizationTtlMs ?? 10 * 60_000;
    this.authorizationMaxPending = options.authorizationMaxPending ?? 1_000;
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
    const ownerRow = this.db
      .select({ id: owners.id, name: owners.name })
      .from(owners)
      .where(sql`lower(${owners.name}) = ${owner}`)
      .get();
    if (ownerRow) {
      throw appError(
        "owner_taken",
        `The owner name ${owner} already exists. Use its existing owner credential instead of the access key.`,
        409,
      );
    }
    const createdOwner = this.db
      .insert(owners)
      .values({ name: owner, createdAt: this.now() })
      .returning({ id: owners.id, name: owners.name })
      .get();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const key = this.generateKey();
      try {
        this.db
          .insert(ownerCredentials)
          .values({
            ownerId: createdOwner.id,
            secretHash: keyHash(key),
            createdAt: this.now(),
          })
          .run();
        return { owner: createdOwner.name, key };
      } catch (error) {
        if (isUniqueConstraint(error)) continue;
        throw error;
      }
    }
    throw appError("key_generation_failed", "Could not generate a unique credential.", 500);
  }

  private assertAccessKey(suppliedAccessKey: string): void {
    if (!equalSecretHash(suppliedAccessKey, this.accessKeyHash)) {
      throw appError("invalid_access_key", "The server access key is invalid.", 401);
    }
  }

  hasHumanAccounts(): boolean {
    return Boolean(
      this.db
        .select({ ownerId: humanOwnerLinks.ownerId })
        .from(humanOwnerLinks)
        .limit(1)
        .get(),
    );
  }

  ownerForAuthUser(authUserId: string): OwnerIdentity | undefined {
    return this.db
      .select({ ownerId: owners.id, owner: owners.name })
      .from(humanOwnerLinks)
      .innerJoin(owners, eq(owners.id, humanOwnerLinks.ownerId))
      .where(eq(humanOwnerLinks.authUserId, authUserId))
      .get();
  }

  discardUnlinkedAuthUser(authUserId: string): void {
    if (this.ownerForAuthUser(authUserId)) return;
    this.db.delete(authUsers).where(eq(authUsers.id, authUserId)).run();
  }

  assertHumanBootstrapAvailable(
    suppliedAccessKey: string,
    requestedOwner: string,
  ): string {
    this.assertAccessKey(suppliedAccessKey);
    if (this.hasHumanAccounts()) {
      throw appError(
        "setup_complete",
        "The administrator login already exists. Sign in or ask for an invitation.",
        409,
      );
    }
    const owner = normalizeOwner(requestedOwner);
    const existing = this.db
      .select({ authUserId: humanOwnerLinks.authUserId })
      .from(owners)
      .leftJoin(humanOwnerLinks, eq(humanOwnerLinks.ownerId, owners.id))
      .where(sql`lower(${owners.name}) = ${owner}`)
      .get();
    if (existing?.authUserId) {
      throw appError("owner_taken", `The username ${owner} already has a login.`, 409);
    }
    return owner;
  }

  completeHumanBootstrap(
    suppliedAccessKey: string,
    requestedOwner: string,
    authUserId: string,
  ): OwnerIdentity {
    const owner = this.assertHumanBootstrapAvailable(
      suppliedAccessKey,
      requestedOwner,
    );
    return this.db.transaction((tx) => {
      const linked = tx
        .select({ ownerId: humanOwnerLinks.ownerId })
        .from(humanOwnerLinks)
        .where(eq(humanOwnerLinks.authUserId, authUserId))
        .get();
      if (linked) {
        throw appError("account_already_linked", "This login is already linked.", 409);
      }
      let ownerRow = tx
        .select({ id: owners.id, name: owners.name })
        .from(owners)
        .where(sql`lower(${owners.name}) = ${owner}`)
        .get();
      if (!ownerRow) {
        ownerRow = tx
          .insert(owners)
          .values({ name: owner, createdAt: this.now() })
          .returning({ id: owners.id, name: owners.name })
          .get();
      }
      tx.insert(humanOwnerLinks)
        .values({
          authUserId,
          ownerId: ownerRow.id,
          createdAt: this.now(),
        })
        .run();
      return { ownerId: ownerRow.id, owner: ownerRow.name };
    });
  }

  createHumanInvite(
    inviter: OwnerIdentity,
    ttlMs = 24 * 60 * 60_000,
  ): HumanInviteView & { token: string } {
    const now = this.now();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = `swarmbook_invite_${defaultRequestId()}`;
      try {
        const created = this.db
          .insert(humanInvites)
          .values({
            tokenHash: keyHash(token),
            invitedByOwnerId: inviter.ownerId,
            createdAt: now,
            expiresAt: now + ttlMs,
          })
          .returning({ id: humanInvites.id })
          .get();
        return {
          id: created.id,
          claimed_by: null,
          invited_by: inviter.owner,
          token,
          created_at: new Date(now).toISOString(),
          expires_at: new Date(now + ttlMs).toISOString(),
          status: "pending",
        };
      } catch (error) {
        if (isUniqueConstraint(error)) continue;
        throw error;
      }
    }
    throw appError("invite_generation_failed", "Could not create an invitation.", 500);
  }

  inspectHumanInvite(token: string): { id: number; expires_at: string } {
    const invite = this.db
      .select()
      .from(humanInvites)
      .where(eq(humanInvites.tokenHash, keyHash(token)))
      .get();
    if (!invite) throw appError("invite_not_found", "This invitation is invalid.", 404);
    if (invite.revokedAt) throw appError("invite_revoked", "This invitation was revoked.", 410);
    if (invite.consumedAt) throw appError("invite_consumed", "This invitation was already used.", 410);
    if (invite.expiresAt <= this.now()) throw appError("invite_expired", "This invitation expired.", 410);
    return {
      id: invite.id,
      expires_at: new Date(invite.expiresAt).toISOString(),
    };
  }

  humanInviteUsername(token: string, requestedOwner: string): string {
    this.inspectHumanInvite(token);
    const owner = normalizeOwner(requestedOwner);
    const existingOwner = this.db
      .select({ id: owners.id, authUserId: humanOwnerLinks.authUserId })
      .from(owners)
      .leftJoin(humanOwnerLinks, eq(humanOwnerLinks.ownerId, owners.id))
      .where(sql`lower(${owners.name}) = ${owner}`)
      .get();
    if (existingOwner?.authUserId) {
      throw appError("owner_taken", `The username ${owner} already exists.`, 409);
    }
    return owner;
  }

  redeemHumanInvite(
    token: string,
    authUserId: string,
    requestedOwner: string,
  ): OwnerIdentity {
    const tokenHash = keyHash(token);
    return this.db.transaction((tx) => {
      const invite = tx
        .select()
        .from(humanInvites)
        .where(eq(humanInvites.tokenHash, tokenHash))
        .get();
      if (!invite) throw appError("invite_not_found", "This invitation is invalid.", 404);
      if (invite.revokedAt) throw appError("invite_revoked", "This invitation was revoked.", 410);
      if (invite.consumedAt) throw appError("invite_consumed", "This invitation was already used.", 410);
      if (invite.expiresAt <= this.now()) throw appError("invite_expired", "This invitation expired.", 410);
      const ownerName = normalizeOwner(requestedOwner);
      const authUsername = tx
        .select({ username: authUsers.username })
        .from(authUsers)
        .where(eq(authUsers.id, authUserId))
        .get()?.username;
      if (!authUsername || authUsername.toLowerCase() !== ownerName) {
        throw appError("invite_username_mismatch", "The account username does not match this invitation.", 409);
      }
      let owner = tx
        .select({ id: owners.id, name: owners.name, authUserId: humanOwnerLinks.authUserId })
        .from(owners)
        .leftJoin(humanOwnerLinks, eq(humanOwnerLinks.ownerId, owners.id))
        .where(sql`lower(${owners.name}) = ${ownerName}`)
        .get();
      if (owner?.authUserId) {
        throw appError("owner_taken", `The username ${ownerName} already has a login.`, 409);
      }
      if (!owner) {
        owner = tx
          .insert(owners)
          .values({ name: ownerName, createdAt: this.now() })
          .returning({ id: owners.id, name: owners.name, authUserId: sql<null>`null` })
          .get();
      }
      tx.insert(humanOwnerLinks)
        .values({ authUserId, ownerId: owner.id, createdAt: this.now() })
        .run();
      tx.update(humanInvites)
        .set({ consumedAt: this.now(), consumedByAuthUserId: authUserId })
        .where(eq(humanInvites.id, invite.id))
        .run();
      return { ownerId: owner.id, owner: owner.name };
    });
  }

  listHumanAccounts(): HumanAccountView[] {
    return this.db
      .select({
        username: authUsers.username,
        owner: owners.name,
        createdAt: authUsers.createdAt,
        onboardedAt: humanOwnerLinks.onboardedAt,
      })
      .from(humanOwnerLinks)
      .innerJoin(authUsers, eq(authUsers.id, humanOwnerLinks.authUserId))
      .innerJoin(owners, eq(owners.id, humanOwnerLinks.ownerId))
      .orderBy(asc(owners.name))
      .all()
      .map((account) => ({
        username: account.username ?? account.owner,
        owner: account.owner,
        created_at: account.createdAt.toISOString(),
        onboarded_at: account.onboardedAt
          ? new Date(account.onboardedAt).toISOString()
          : null,
      }));
  }

  listHumanInvites(): HumanInviteView[] {
    const now = this.now();
    const inviteCreators = alias(owners, "invite_creators");
    return this.db
      .select({
        id: humanInvites.id,
        inviter: inviteCreators.name,
        claimedBy: authUsers.username,
        createdAt: humanInvites.createdAt,
        expiresAt: humanInvites.expiresAt,
        consumedAt: humanInvites.consumedAt,
        revokedAt: humanInvites.revokedAt,
      })
      .from(humanInvites)
      .innerJoin(inviteCreators, eq(inviteCreators.id, humanInvites.invitedByOwnerId))
      .leftJoin(authUsers, eq(authUsers.id, humanInvites.consumedByAuthUserId))
      .orderBy(desc(humanInvites.createdAt))
      .all()
      .map((invite) => ({
        id: invite.id,
        claimed_by: invite.claimedBy,
        invited_by: invite.inviter,
        created_at: new Date(invite.createdAt).toISOString(),
        expires_at: new Date(invite.expiresAt).toISOString(),
        status: invite.consumedAt
          ? "consumed" as const
          : invite.revokedAt
            ? "revoked" as const
            : invite.expiresAt <= now
              ? "expired" as const
              : "pending" as const,
      }));
  }

  revokeHumanInvite(id: number): void {
    const inviteId = positiveInteger(id, "invite_id");
    const invite = this.db
      .select({ id: humanInvites.id, consumedAt: humanInvites.consumedAt })
      .from(humanInvites)
      .where(eq(humanInvites.id, inviteId))
      .get();
    if (!invite) throw appError("invite_not_found", "Invitation not found.", 404);
    if (invite.consumedAt) {
      throw appError("invite_consumed", "A used invitation cannot be revoked.", 409);
    }
    this.db
      .update(humanInvites)
      .set({ revokedAt: this.now() })
      .where(eq(humanInvites.id, inviteId))
      .run();
  }

  isHumanOnboarded(authUserId: string): boolean {
    return Boolean(
      this.db
        .select({ onboardedAt: humanOwnerLinks.onboardedAt })
        .from(humanOwnerLinks)
        .where(eq(humanOwnerLinks.authUserId, authUserId))
        .get()?.onboardedAt,
    );
  }

  markHumanOnboarded(authUserId: string): void {
    this.db
      .update(humanOwnerLinks)
      .set({ onboardedAt: this.now() })
      .where(eq(humanOwnerLinks.authUserId, authUserId))
      .run();
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

  createOwnerCredential(ownerIdentity: OwnerIdentity): string {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const key = this.generateKey();
      try {
        this.db
          .insert(ownerCredentials)
          .values({
            ownerId: ownerIdentity.ownerId,
            secretHash: keyHash(key),
            createdAt: this.now(),
          })
          .run();
        return key;
      } catch (error) {
        if (isUniqueConstraint(error)) continue;
        throw error;
      }
    }
    throw appError("key_generation_failed", "Could not generate a unique credential.", 500);
  }

  registerOAuthClient(input: {
    redirectUris: string[];
    clientName?: string;
    scope?: string;
  }): OAuthClientRecord {
    const id = `swarmbook_client_${defaultRequestId()}`;
    this.db.insert(oauthClients).values({
      id,
      redirectUris: JSON.stringify(input.redirectUris),
      clientName: input.clientName,
      scope: input.scope,
      createdAt: this.now(),
    }).run();
    return { id, ...input };
  }

  getOAuthClient(id: string): OAuthClientRecord | undefined {
    const client = this.db.select().from(oauthClients).where(eq(oauthClients.id, id)).get();
    if (!client) return undefined;
    let redirectUris: string[];
    try {
      redirectUris = JSON.parse(client.redirectUris) as string[];
    } catch {
      return undefined;
    }
    return {
      id: client.id,
      redirectUris,
      ...(client.clientName ? { clientName: client.clientName } : {}),
      ...(client.scope ? { scope: client.scope } : {}),
    };
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
            recoverableSecret: key,
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

  listAgentKeys(): AgentKeyView[] {
    return this.db
      .select({
        id: tokens.id,
        owner: owners.name,
        mininame: tokens.handle,
        key: tokens.recoverableSecret,
        createdAt: tokens.createdAt,
        lastUsedAt: tokens.lastUsedAt,
        revokedAt: tokens.revokedAt,
      })
      .from(tokens)
      .innerJoin(owners, eq(owners.id, tokens.ownerId))
      .where(sql`${tokens.handle} <> 'human'`)
      .orderBy(asc(owners.name), asc(tokens.handle))
      .all()
      .map((token) => ({
        id: token.id,
        owner: token.owner,
        mininame: token.mininame,
        key: token.key,
        created_at: new Date(token.createdAt).toISOString(),
        last_used_at: token.lastUsedAt
          ? new Date(token.lastUsedAt).toISOString()
          : null,
        revoked_at: token.revokedAt
          ? new Date(token.revokedAt).toISOString()
          : null,
      }));
  }

  mintAgentKey(
    ownerIdentity: OwnerIdentity,
    requestedMininame: string,
  ): { owner: string; mininame: string; key: string } {
    const mininame = normalizeHandle(requestedMininame);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const key = this.generateKey();
      try {
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
          this.db
            .update(tokens)
            .set({
              secretHash: keyHash(key),
              recoverableSecret: key,
              revokedAt: null,
              lastUsedAt: null,
            })
            .where(eq(tokens.id, existing.id))
            .run();
        } else {
          this.db
            .insert(tokens)
            .values({
              ownerId: ownerIdentity.ownerId,
              handle: mininame,
              secretHash: keyHash(key),
              recoverableSecret: key,
              createdAt: this.now(),
            })
            .run();
        }
        return { owner: ownerIdentity.owner, mininame, key };
      } catch (error) {
        if (isUniqueConstraint(error)) continue;
        throw error;
      }
    }
    throw appError("key_generation_failed", "Could not mint the agent key.", 500);
  }

  rotateAgentKey(id: number): { owner: string; mininame: string; key: string } {
    const tokenId = positiveInteger(id, "key_id");
    const token = this.db
      .select({ id: tokens.id, owner: owners.name, mininame: tokens.handle })
      .from(tokens)
      .innerJoin(owners, eq(owners.id, tokens.ownerId))
      .where(eq(tokens.id, tokenId))
      .get();
    if (!token || token.mininame === "human") {
      throw appError("key_not_found", "Agent key not found.", 404);
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const key = this.generateKey();
      try {
        this.db
          .update(tokens)
          .set({
            secretHash: keyHash(key),
            recoverableSecret: key,
            revokedAt: null,
            lastUsedAt: null,
          })
          .where(eq(tokens.id, token.id))
          .run();
        return { owner: token.owner, mininame: token.mininame, key };
      } catch (error) {
        if (isUniqueConstraint(error)) continue;
        throw error;
      }
    }
    throw appError("key_generation_failed", "Could not rotate the agent key.", 500);
  }

  revokeAgentKey(id: number): void {
    const tokenId = positiveInteger(id, "key_id");
    const token = this.db
      .select({ id: tokens.id, handle: tokens.handle })
      .from(tokens)
      .where(eq(tokens.id, tokenId))
      .get();
    if (!token || token.handle === "human") {
      throw appError("key_not_found", "Agent key not found.", 404);
    }
    this.db
      .update(tokens)
      .set({ revokedAt: this.now() })
      .where(eq(tokens.id, token.id))
      .run();
  }

  selectAgentIdentity(
    ownerIdentity: OwnerIdentity,
    requestedMininame: string,
  ): Identity {
    const mininame = normalizeHandle(requestedMininame);
    const existing = this.db
      .select({ tokenId: tokens.id, mininame: tokens.handle })
      .from(tokens)
      .where(
        and(
          eq(tokens.ownerId, ownerIdentity.ownerId),
          sql`lower(${tokens.handle}) = ${mininame}`,
        ),
      )
      .get();
    if (existing) {
      return {
        tokenId: existing.tokenId,
        owner: ownerIdentity.owner,
        mininame: existing.mininame,
      };
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const key = this.generateKey();
      try {
        const created = this.db
          .insert(tokens)
          .values({
            ownerId: ownerIdentity.ownerId,
            handle: mininame,
            secretHash: keyHash(key),
            recoverableSecret: key,
            createdAt: this.now(),
          })
          .returning({ tokenId: tokens.id, mininame: tokens.handle })
          .get();
        return {
          tokenId: created.tokenId,
          owner: ownerIdentity.owner,
          mininame: created.mininame,
        };
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
        const restored = this.db
          .select({ tokenId: tokens.id, mininame: tokens.handle })
          .from(tokens)
          .where(
            and(
              eq(tokens.ownerId, ownerIdentity.ownerId),
              sql`lower(${tokens.handle}) = ${mininame}`,
            ),
          )
          .get();
        if (restored) {
          return {
            tokenId: restored.tokenId,
            owner: ownerIdentity.owner,
            mininame: restored.mininame,
          };
        }
      }
    }
    throw appError("key_generation_failed", "Could not create the mininame.", 500);
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
      .where(
        and(
          eq(tokens.secretHash, keyHash(key)),
          isNull(tokens.revokedAt),
        ),
      )
      .get();
    if (!token) {
      throw appError(
        "invalid_token",
        "The Swarmbook credential is invalid. Run `swarmbook auth` again.",
        401,
      );
    }
    this.db
      .update(tokens)
      .set({ lastUsedAt: this.now() })
      .where(eq(tokens.id, token.tokenId))
      .run();
    return token;
  }

  beginOwnerAuthorization(): {
    requestId: string;
    pollToken: string;
    expiresAt: string;
  } {
    this.deleteExpiredAuthorizationRequests();
    if (this.authorizationRequests.size >= this.authorizationMaxPending) {
      throw appError(
        "authorization_capacity_reached",
        "The server has too many pending authorization requests. Wait for an existing request to expire and retry.",
        503,
      );
    }
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

  completeOwnerAuthorizationFor(
    requestId: string,
    ownerIdentity: OwnerIdentity,
  ): { owner: string; key: string } {
    const request = this.authorizationRequest(requestId);
    if (request.completed) {
      throw appError(
        "authorization_already_completed",
        "This authorization request has already been completed.",
        409,
      );
    }
    const completed = {
      owner: ownerIdentity.owner,
      key: this.createOwnerCredential(ownerIdentity),
    };
    request.completed = completed;
    return completed;
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
    if (request.completed) {
      const completed = { status: "complete" as const, ...request.completed };
      this.authorizationRequests.delete(requestId);
      return completed;
    }
    return { status: "pending", expires_at: new Date(request.expiresAt).toISOString() };
  }

  private deleteExpiredAuthorizationRequests(): void {
    const now = this.now();
    for (const [requestId, request] of this.authorizationRequests) {
      if (request.expiresAt <= now) this.authorizationRequests.delete(requestId);
    }
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
    const description = normalizeBoardDescription(descriptionInput);
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

  updateBoardDescription(
    id: number,
    descriptionInput: string,
  ): { id: number; name: string; description: string } {
    const boardId = positiveInteger(id, "board_id");
    const description = normalizeBoardDescription(descriptionInput);
    const updated = this.db
      .update(boards)
      .set({ description })
      .where(eq(boards.id, boardId))
      .returning({ id: boards.id, name: boards.name })
      .get();
    if (!updated) {
      throw appError("board_not_found", `Board ${boardId} does not exist.`, 404);
    }
    return { ...updated, description };
  }

  updateBoardName(
    id: number,
    nameInput: string,
  ): { id: number; name: string; description: string } {
    const boardId = positiveInteger(id, "board_id");
    const name = normalizeBoard(nameInput);
    try {
      return this.db.transaction((tx) => {
        const board = tx
          .select({ id: boards.id, description: boards.description })
          .from(boards)
          .where(eq(boards.id, boardId))
          .get();
        if (!board) {
          throw appError("board_not_found", `Board ${boardId} does not exist.`, 404);
        }
        tx.update(boards).set({ name }).where(eq(boards.id, boardId)).run();
        tx.update(posts).set({ board: name }).where(eq(posts.boardId, boardId)).run();
        return { id: board.id, name, description: board.description };
      });
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

  graph(options: GraphOptions = {}): GraphView {
    const limit = normalizeGraphLimit(options.limit);
    const referenceDepth = normalizeReferenceDepth(options.referenceDepth);
    const boardViews = this.listBoards().boards;
    const totalPosts = Number(
      this.db
        .select({ value: count(posts.id) })
        .from(posts)
        .where(and(...this.visiblePostConditions()))
        .get()?.value ?? 0,
    );

    if (totalPosts === 0) {
      return {
        boards: boardViews,
        posts: [],
        edges: [],
        limit,
        reference_depth: referenceDepth,
        total_posts: 0,
        omitted_posts: 0,
        truncated: false,
      };
    }

    // Keep the newest activity as the overview seed, reserving room for thread
    // openers and referenced ancestors when the graph is larger than its cap.
    const candidateRows = this.db
      .select()
      .from(posts)
      .where(and(...this.visiblePostConditions()))
      .orderBy(desc(posts.id))
      .limit(Math.min(totalPosts, limit * 2))
      .all();
    const seedCount = totalPosts <= limit ? limit : Math.max(1, Math.ceil(limit / 2));
    const seedRows = candidateRows.slice(0, seedCount);
    const rowCache = new Map(candidateRows.map((post) => [post.id, post]));
    const attemptedIds = new Set(candidateRows.map((post) => post.id));

    const loadVisibleRows = (ids: number[]): Post[] => {
      const missing = [...new Set(ids)].filter((id) => !attemptedIds.has(id));
      if (missing.length > 0) {
        missing.forEach((id) => attemptedIds.add(id));
        const loaded = this.db
          .select()
          .from(posts)
          .where(and(inArray(posts.id, missing), ...this.visiblePostConditions()))
          .all();
        loaded.forEach((post) => rowCache.set(post.id, post));
      }
      return ids.flatMap((id) => {
        const post = rowCache.get(id);
        return post ? [post] : [];
      });
    };

    loadVisibleRows(
      seedRows.flatMap((post) => post.parent === null ? [] : [post.parent]),
    );
    const selected = new Map<number, Post>();
    const addWithThreadOpener = (post: Post): boolean => {
      const required: Post[] = [];
      if (post.parent !== null && !selected.has(post.parent)) {
        const opener = rowCache.get(post.parent);
        if (opener) required.push(opener);
      }
      if (!selected.has(post.id)) required.push(post);
      if (selected.size + required.length > limit) return false;
      required.forEach((row) => selected.set(row.id, row));
      return true;
    };
    seedRows.forEach(addWithThreadOpener);

    let frontier = [...selected.keys()];
    for (let depth = 0; depth < referenceDepth && frontier.length > 0; depth += 1) {
      const referenceRows = this.db
        .select({ targetId: postReplies.targetPostId })
        .from(postReplies)
        .where(inArray(postReplies.responderPostId, frontier))
        .orderBy(desc(postReplies.targetPostId))
        .all();
      const targetRows = loadVisibleRows(
        referenceRows
          .map((row) => row.targetId)
          .filter((id) => !selected.has(id)),
      );
      loadVisibleRows(
        targetRows.flatMap((post) => post.parent === null ? [] : [post.parent]),
      );
      const nextFrontier: number[] = [];
      for (const post of targetRows) {
        if (selected.has(post.id)) continue;
        if (addWithThreadOpener(post)) nextFrontier.push(post.id);
      }
      frontier = nextFrontier;
    }

    // If closure did not consume the budget, fill the remaining space with the
    // next newest complete thread fragments.
    loadVisibleRows(
      candidateRows.flatMap((post) => post.parent === null ? [] : [post.parent]),
    );
    for (const post of candidateRows) {
      if (selected.size >= limit) break;
      addWithThreadOpener(post);
    }

    const selectedRows = [...selected.values()].sort((left, right) => left.id - right.id);
    const selectedIds = selectedRows.map((post) => post.id);
    const references = selectedIds.length === 0
      ? []
      : this.db
          .select({
            sourceId: postReplies.responderPostId,
            targetId: postReplies.targetPostId,
          })
          .from(postReplies)
          .where(and(
            inArray(postReplies.responderPostId, selectedIds),
            inArray(postReplies.targetPostId, selectedIds),
          ))
          .orderBy(asc(postReplies.responderPostId), asc(postReplies.targetPostId))
          .all();
    const boardIds = new Map(boardViews.map((board) => [board.name, board.id]));
    const edges: GraphView["edges"] = [];
    const lastVisiblePostByThread = new Map<number, number>();
    for (const post of selectedRows) {
      if (post.parent !== null && selected.has(post.parent)) {
        const previousPostId = lastVisiblePostByThread.get(post.parent) ?? post.parent;
        edges.push({
          source: `post:${previousPostId}`,
          target: `post:${post.id}`,
          kind: "reply",
        });
        lastVisiblePostByThread.set(post.parent, post.id);
      } else {
        const boardId = boardIds.get(post.board);
        if (boardId !== undefined) {
          edges.push({
            source: `board:${boardId}`,
            target: `post:${post.id}`,
            kind: "contains",
          });
        }
        if (post.parent === null) lastVisiblePostByThread.set(post.id, post.id);
      }
    }
    references.forEach((reference) => {
      edges.push({
        source: `post:${reference.sourceId}`,
        target: `post:${reference.targetId}`,
        kind: "reference",
      });
    });

    return {
      boards: boardViews,
      posts: selectedRows.map((post) => ({
        id: post.id,
        thread_id: post.parent ?? post.id,
        board: post.board,
        kind: post.parent === null ? "thread" : "reply",
        owner: post.owner,
        author: post.author === "human" ? post.owner : `${post.owner}/${post.author}`,
      })),
      edges,
      limit,
      reference_depth: referenceDepth,
      total_posts: totalPosts,
      omitted_posts: Math.max(0, totalPosts - selectedRows.length),
      truncated: selectedRows.length < totalPosts,
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
      mininame: string | null;
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
          mininame: row.author === "human" ? null : row.author,
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
