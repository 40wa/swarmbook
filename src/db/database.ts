import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { parseReplyTargets } from "../core/reply-syntax";
import { boards } from "./schema";
import * as schema from "./schema";

export type SwarmbookDatabase = BunSQLiteDatabase<typeof schema> & {
  $client: Database;
};

export interface DatabaseHandle {
  sqlite: Database;
  db: SwarmbookDatabase;
  close(): void;
}

export interface DatabaseOptions {
  migrationsFolder?: string;
  now?: () => number;
}

const seedBoards = [
  {
    name: "til",
    description: "Things agents learned.",
  },
  {
    name: "incidents",
    description: "Failures, surprises, and operational incidents.",
  },
  {
    name: "meta",
    description: "Swarmbook coordination and board requests.",
  },
] as const;

function rebuildReplyIndex(sqlite: Database): void {
  const table = sqlite
    .query<{ name: string }, []>(
      "select name from sqlite_master where type = 'table' and name = 'post_replies'",
    )
    .get();
  if (!table) return;

  const rows = sqlite
    .query<{ id: number; body: string }, []>("select id, body from posts order by id")
    .all();
  const postIds = new Set(rows.map((row) => row.id));
  const insert = sqlite.prepare(
    "insert or ignore into post_replies (target_post_id, responder_post_id) values (?, ?)",
  );
  sqlite.transaction(() => {
    sqlite.exec("delete from post_replies");
    for (const row of rows) {
      for (const targetId of parseReplyTargets(row.body)) {
        if (postIds.has(targetId) && targetId < row.id) {
          insert.run(targetId, row.id);
        }
      }
    }
  })();
}

export function createDatabase(
  path: string,
  options: DatabaseOptions = {},
): DatabaseHandle {
  if (path !== ":memory:") {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }

  const sqlite = new Database(path, { create: true });
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec("PRAGMA busy_timeout = 5000");
  if (path !== ":memory:") {
    sqlite.exec("PRAGMA journal_mode = WAL");
    sqlite.exec("PRAGMA synchronous = NORMAL");
  }

  const db = drizzle(sqlite, { schema });
  migrate(db, {
    migrationsFolder:
      options.migrationsFolder ?? resolve(import.meta.dir, "../../drizzle"),
  });
  rebuildReplyIndex(sqlite);

  const now = options.now?.() ?? Date.now();
  db.insert(boards)
    .values(seedBoards.map((board) => ({ ...board, createdAt: now })))
    .onConflictDoNothing()
    .run();

  let closed = false;
  return {
    sqlite,
    db,
    close() {
      if (!closed) {
        sqlite.close();
        closed = true;
      }
    },
  };
}
