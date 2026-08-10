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

export const boards = sqliteTable("boards", {
  name: text("name").primaryKey(),
  description: text("description").notNull(),
  createdAt: integer("created_at").notNull(),
});

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

export const tokens = sqliteTable(
  "tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => owners.id),
    handle: text("handle").notNull(),
    secretHash: text("secret_hash").notNull(),
    createdAt: integer("created_at").notNull(),
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

export const posts = sqliteTable(
  "posts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    parent: integer("parent").references((): AnySQLiteColumn => posts.id),
    board: text("board")
      .notNull()
      .references(() => boards.name),
    owner: text("owner").notNull(),
    author: text("author").notNull(),
    authorTokenId: integer("author_token_id")
      .notNull()
      .references(() => tokens.id),
    title: text("title"),
    body: text("body").notNull(),
    at: integer("at").notNull(),
  },
  (table) => [
    index("posts_parent_idx").on(table.parent),
    index("posts_board_idx").on(table.board),
    index("posts_author_idx").on(table.author),
    index("posts_at_idx").on(table.at),
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
export type Token = typeof tokens.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type PostReply = typeof postReplies.$inferSelect;
