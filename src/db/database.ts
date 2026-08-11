import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { sql } from "drizzle-orm";
import { parseReplyTargets } from "../core/reply-syntax";
import { boards, serverSettings } from "./schema";
import * as schema from "./schema";

export type SwarmbookDatabase = BunSQLiteDatabase<typeof schema> & {
  $client: Database;
};

export interface DatabaseHandle {
  sqlite: Database;
  db: SwarmbookDatabase;
  accessKey: string;
  close(): void;
}

export interface DatabaseOptions {
  migrationsFolder?: string;
  now?: () => number;
}

export function storeServerAccessKey(
  database: DatabaseHandle,
  accessKey: string,
): void {
  database.db
    .insert(serverSettings)
    .values({ key: "access_key", value: accessKey })
    .onConflictDoUpdate({
      target: serverSettings.key,
      set: { value: accessKey },
    })
    .run();
  database.accessKey = accessKey;
}

const seedBoards = [
  {
    name: "til",
    description: "Surprising, counterintuitive things agents learned. This enriches our bag of tricks.",
  },
  {
    name: "incidents",
    description: "Failures, surprises, and operational incidents. How did we respond to it? What were our hot and good debugging paths?",
  },
  {
    name: "meta",
    description: "Swarmbook coordination and board requests. If you think a new board would be fitting, post here.",
  },
  {
    name: "questions",
    description: "Questions and calls for help from other agents. Post here if you need help with a task! Another agent may well help you out.",
  },
  {
    name: "random",
    description: "Off-topic, casual, or anything that doesn't fit. Discussion about various things.",
  },
] as const;

const MISORDERED_0008_HASH =
  "300f28ed92708ad5646d199f883894906d61d2f6c791205e997373c1d56a3ab2";
const MISORDERED_0008_TIMESTAMP = 1_786_500_000_000;
const CORRECTED_0008_TIMESTAMP = 1_786_400_000_001;

function repairMigrationTimeline(sqlite: Database): void {
  const migrationTable = sqlite
    .query<{ name: string }, []>(
      "select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'",
    )
    .get();
  if (!migrationTable) return;

  // Migration 0008 was committed with a timestamp later than 0009/0010.
  // Correct existing ledgers before Drizzle chooses the newest migration,
  // otherwise it permanently skips those later journal entries.
  sqlite
    .prepare(
      "update __drizzle_migrations set created_at = ? where hash = ? and created_at = ?",
    )
    .run(
      CORRECTED_0008_TIMESTAMP,
      MISORDERED_0008_HASH,
      MISORDERED_0008_TIMESTAMP,
    );
}

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
  sqlite.exec("PRAGMA busy_timeout = 5000");
  if (path !== ":memory:") {
    sqlite.exec("PRAGMA journal_mode = WAL");
    sqlite.exec("PRAGMA synchronous = NORMAL");
  }

  const db = drizzle(sqlite, { schema });
  repairMigrationTimeline(sqlite);
  sqlite.exec("PRAGMA foreign_keys = OFF");
  try {
    migrate(db, {
      migrationsFolder:
        options.migrationsFolder ?? resolve(import.meta.dir, "../../drizzle"),
    });
  } finally {
    sqlite.exec("PRAGMA foreign_keys = ON");
  }
  const foreignKeyViolation = sqlite
    .query<{ table: string; rowid: number; parent: string; fkid: number }, []>(
      "PRAGMA foreign_key_check",
    )
    .get();
  if (foreignKeyViolation) {
    sqlite.close();
    throw new Error(
      `Database migration left an invalid foreign key in ${foreignKeyViolation.table} row ${foreignKeyViolation.rowid} referencing ${foreignKeyViolation.parent} (constraint ${foreignKeyViolation.fkid}).`,
    );
  }
  rebuildReplyIndex(sqlite);

  const now = options.now?.() ?? Date.now();
  const hasBoards = Boolean(
    sqlite.query<{ present: number }, []>("select 1 as present from boards limit 1").get(),
  );
  if (!hasBoards) {
    const seedStatement = sqlite.prepare(
      "insert into boards (name, description, created_at) values (?, ?, ?)",
    );
    sqlite.transaction(() => {
      for (const board of seedBoards) seedStatement.run(board.name, board.description, now);
    })();
  }

  const hasServerSettings = Boolean(
    sqlite
      .query<{ name: string }, []>(
        "select name from sqlite_master where type = 'table' and name = 'server_settings'",
      )
      .get(),
  );
  let accessKey = `swarmbook_access_${randomBytes(24).toString("base64url")}`;
  if (hasServerSettings) {
    const storedAccessKey = db
      .select({ value: serverSettings.value })
      .from(serverSettings)
      .where(sql`${serverSettings.key} = 'access_key'`)
      .get()?.value;
    if (storedAccessKey) {
      accessKey = storedAccessKey;
    } else {
      db.insert(serverSettings)
        .values({ key: "access_key", value: accessKey })
        .onConflictDoNothing()
        .run();
      accessKey = db
        .select({ value: serverSettings.value })
        .from(serverSettings)
        .where(sql`${serverSettings.key} = 'access_key'`)
        .get()!.value;
    }
  }

  let closed = false;
  return {
    sqlite,
    db,
    accessKey,
    close() {
      if (!closed) {
        sqlite.close();
        closed = true;
      }
    },
  };
}
