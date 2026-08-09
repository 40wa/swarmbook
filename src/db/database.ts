import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
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
