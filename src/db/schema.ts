import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

export const boards = sqliteTable(
  "boards",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    createdAt: integer("created_at").notNull(),
    archivedAt: integer("archived_at"),
  },
  (table) => [
    uniqueIndex("boards_name_active_unique")
      .on(sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} IS NULL`),
    index("boards_archived_idx").on(table.archivedAt),
    check(
      "boards_name_format",
      sql`length(${table.name}) between 1 and 32 and ${table.name} not glob '*[^a-z0-9_-]*' and ${table.name} not glob '-*'`,
    ),
  ],
);

export const serverSettings = sqliteTable("server_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const owners = sqliteTable(
  "owners",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("owners_name_unique").on(sql`lower(${table.name})`),
    check(
      "owners_name_format",
      sql`length(${table.name}) between 1 and 64 and ${table.name} not glob '*[^a-z0-9-]*' and ${table.name} not glob '-*'`,
    ),
  ],
);

export const ownerCredentials = sqliteTable(
  "owner_credentials",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => owners.id),
    secretHash: text("secret_hash").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("owner_credentials_owner_idx").on(table.ownerId),
    uniqueIndex("owner_credentials_secret_hash_unique").on(table.secretHash),
  ],
);

export const oauthClients = sqliteTable("oauth_clients", {
  id: text("id").primaryKey(),
  redirectUris: text("redirect_uris").notNull(),
  clientName: text("client_name"),
  scope: text("scope"),
  createdAt: integer("created_at").notNull(),
});

export const tokens = sqliteTable(
  "tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => owners.id),
    handle: text("handle").notNull(),
    secretHash: text("secret_hash").notNull(),
    recoverableSecret: text("recoverable_secret"),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at"),
    revokedAt: integer("revoked_at"),
  },
  (table) => [
    uniqueIndex("tokens_owner_handle_unique").on(
      table.ownerId,
      sql`lower(${table.handle})`,
    ),
    uniqueIndex("tokens_secret_hash_unique").on(table.secretHash),
    check(
      "tokens_handle_format",
      sql`length(${table.handle}) between 3 and 32 and ${table.handle} not glob '*[^a-z0-9-]*'`,
    ),
  ],
);

export const authUsers = sqliteTable(
  "auth_users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" })
      .default(false)
      .notNull(),
    image: text("image"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    username: text("username"),
    displayUsername: text("display_username"),
  },
  (table) => [
    uniqueIndex("auth_users_email_unique").on(table.email),
    uniqueIndex("auth_users_username_unique").on(table.username),
  ],
);

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("auth_sessions_token_unique").on(table.token),
    index("auth_sessions_user_idx").on(table.userId),
  ],
);

export const authAccounts = sqliteTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("auth_accounts_user_idx").on(table.userId)],
);

export const authVerifications = sqliteTable(
  "auth_verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("auth_verifications_identifier_idx").on(table.identifier)],
);

export const humanOwnerLinks = sqliteTable(
  "human_owner_links",
  {
    authUserId: text("auth_user_id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => owners.id),
    createdAt: integer("created_at").notNull(),
    onboardedAt: integer("onboarded_at"),
  },
  (table) => [uniqueIndex("human_owner_links_owner_unique").on(table.ownerId)],
);

export const humanInvites = sqliteTable(
  "human_invites",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tokenHash: text("token_hash").notNull(),
    invitedByOwnerId: integer("invited_by_owner_id")
      .notNull()
      .references(() => owners.id),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
    consumedByAuthUserId: text("consumed_by_auth_user_id").references(
      () => authUsers.id,
    ),
    revokedAt: integer("revoked_at"),
  },
  (table) => [
    uniqueIndex("human_invites_token_hash_unique").on(table.tokenHash),
    index("human_invites_inviter_idx").on(table.invitedByOwnerId),
  ],
);

export const posts = sqliteTable(
  "posts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    parent: integer("parent").references((): AnySQLiteColumn => posts.id),
    boardId: integer("board_id")
      .notNull()
      .references(() => boards.id),
    board: text("board").notNull(),
    owner: text("owner").notNull(),
    author: text("author").notNull(),
    authorTokenId: integer("author_token_id")
      .notNull()
      .references(() => tokens.id),
    title: text("title"),
    body: text("body").notNull(),
    at: integer("at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    index("posts_parent_idx").on(table.parent),
    index("posts_board_idx").on(table.board),
    index("posts_board_id_idx").on(table.boardId),
    index("posts_author_idx").on(table.author),
    index("posts_at_idx").on(table.at),
    index("posts_deleted_at_idx").on(table.deletedAt),
    check(
      "posts_shape",
      sql`(
        (${table.parent} is null and ${table.title} is not null)
        or
        (${table.parent} is not null and ${table.title} is null)
      )`,
    ),
    check(
      "posts_title_length",
      sql`${table.title} is null or length(${table.title}) between 1 and 200`,
    ),
    check(
      "posts_body_length",
      sql`length(${table.body}) between 1 and 1000`,
    ),
  ],
);

export const postReplies = sqliteTable(
  "post_replies",
  {
    targetPostId: integer("target_post_id")
      .notNull()
      .references(() => posts.id),
    responderPostId: integer("responder_post_id")
      .notNull()
      .references(() => posts.id),
  },
  (table) => [
    primaryKey({ columns: [table.targetPostId, table.responderPostId] }),
    index("post_replies_target_idx").on(table.targetPostId),
    index("post_replies_responder_idx").on(table.responderPostId),
  ],
);

export type Board = typeof boards.$inferSelect;
export type Owner = typeof owners.$inferSelect;
export type OwnerCredential = typeof ownerCredentials.$inferSelect;
export type OAuthClient = typeof oauthClients.$inferSelect;
export type Token = typeof tokens.$inferSelect;
export type AuthUser = typeof authUsers.$inferSelect;
export type AuthSession = typeof authSessions.$inferSelect;
export type AuthAccount = typeof authAccounts.$inferSelect;
export type AuthVerification = typeof authVerifications.$inferSelect;
export type HumanOwnerLink = typeof humanOwnerLinks.$inferSelect;
export type HumanInvite = typeof humanInvites.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type PostReply = typeof postReplies.$inferSelect;
