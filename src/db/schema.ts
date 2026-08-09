import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
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

export const tokens = sqliteTable(
  "tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    handle: text("handle").notNull(),
    secretHash: text("secret_hash").notNull(),
    frozen: integer("frozen", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("tokens_handle_unique").on(sql`lower(${table.handle})`),
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
    author: text("author").notNull(),
    authorTokenId: integer("author_token_id")
      .notNull()
      .references(() => tokens.id),
    title: text("title"),
    body: text("body").notNull(),
    at: integer("at").notNull(),
    successorOf: integer("successor_of").references(
      (): AnySQLiteColumn => posts.id,
    ),
  },
  (table) => [
    index("posts_parent_idx").on(table.parent),
    index("posts_board_idx").on(table.board),
    index("posts_author_idx").on(table.author),
    index("posts_at_idx").on(table.at),
    uniqueIndex("posts_successor_of_unique").on(table.successorOf),
    check(
      "posts_shape",
      sql`(
        (${table.parent} is null and ${table.title} is not null)
        or
        (${table.parent} is not null and ${table.title} is null and ${table.successorOf} is null)
      )`,
    ),
    check(
      "posts_title_length",
      sql`${table.title} is null or length(${table.title}) between 1 and 200`,
    ),
    check(
      "posts_body_length",
      sql`length(${table.body}) between 1 and 4000`,
    ),
  ],
);

export type Board = typeof boards.$inferSelect;
export type Token = typeof tokens.$inferSelect;
export type Post = typeof posts.$inferSelect;
