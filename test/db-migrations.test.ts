import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SwarmbookService } from "../src/core/service";
import { createDatabase } from "../src/db/database";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("database migrations", () => {
  test("create the schema, FTS index, and seed boards from an empty file", () => {
    const directory = mkdtempSync(join(tmpdir(), "swarmbook-db-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "swarmbook.sqlite");

    const handle = createDatabase(path);
    expect(existsSync(path)).toBe(true);
    expect(
      handle.sqlite
        .query<{ name: string }, []>("select name from boards order by name")
        .all(),
    ).toEqual([{ name: "incidents" }, { name: "meta" }, { name: "til" }]);
    expect(
      handle.sqlite
        .query<{ name: string }, []>(
          "select name from sqlite_master where type = 'table' and name = 'posts_fts'",
        )
        .get(),
    ).toEqual({ name: "posts_fts" });
    expect(
      handle.sqlite
        .query<{ sql: string }, []>(
          "select sql from sqlite_master where type = 'table' and name = 'posts'",
        )
        .get()?.sql,
    ).toContain("between 1 and 1000");
    handle.close();

    const reopened = new Database(path, { readonly: true });
    expect(reopened.query("select count(*) as count from boards").get()).toEqual({
      count: 3,
    });
    reopened.close();
  });

  test("is idempotent when the same database is opened twice", () => {
    const directory = mkdtempSync(join(tmpdir(), "swarmbook-db-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "swarmbook.sqlite");

    createDatabase(path).close();
    const reopened = createDatabase(path);
    expect(reopened.sqlite.query("select count(*) as count from boards").get()).toEqual({
      count: 3,
    });
    reopened.close();
  });

  test("preserves posts and FTS while removing the successor column", () => {
    const directory = mkdtempSync(join(tmpdir(), "swarmbook-upgrade-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "swarmbook.sqlite");
    const oldMigrations = join(directory, "old-migrations");
    mkdirSync(join(oldMigrations, "meta"), { recursive: true });
    cpSync(resolve(import.meta.dir, "../drizzle/0000_spotty_the_renegades.sql"), join(oldMigrations, "0000_spotty_the_renegades.sql"));
    cpSync(resolve(import.meta.dir, "../drizzle/0001_add_fts.sql"), join(oldMigrations, "0001_add_fts.sql"));
    const journal = JSON.parse(
      readFileSync(resolve(import.meta.dir, "../drizzle/meta/_journal.json"), "utf8"),
    );
    journal.entries = journal.entries.slice(0, 2);
    writeFileSync(
      join(oldMigrations, "meta/_journal.json"),
      `${JSON.stringify(journal, null, 2)}\n`,
    );

    const old = createDatabase(path, { migrationsFolder: oldMigrations });
    const oldService = new SwarmbookService(old.db, { threadPostLimit: 2 });
    const registration = oldService.register("upgrade-ant");
    const identity = oldService.authenticate(registration.key);
    const opening = oldService.startThread(identity, {
      board: "til",
      title: "Before migration",
      body: "Existing searchable body",
    });
    const existingReply = oldService.reply(
      identity,
      opening.id,
      "Existing self-referencing reply",
    );
    old.sqlite
      .query("update posts set body = ? where id = ?")
      .run(
        `>>${opening.id} >>${existingReply.id} Existing self-referencing reply`,
        existingReply.id,
      );
    const formerSuccessor = old.sqlite
      .query<never, [string, string, number, string, string, number, number]>(
        `insert into posts
          (parent, board, author, author_token_id, title, body, at, successor_of)
         values (null, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "til",
        identity.handle,
        identity.tokenId,
        "Existing successor",
        `>>${opening.id} Existing successor body`,
        Date.now(),
        opening.id,
      );
    const formerSuccessorId = Number(formerSuccessor.lastInsertRowid);
    old.sqlite
      .query("update posts set body = ? where id = ?")
      .run(
        `Existing searchable body with future reference >>${formerSuccessorId}`,
        opening.id,
      );
    old.close();

    const upgraded = createDatabase(path);
    const upgradedService = new SwarmbookService(upgraded.db);
    expect(
      upgradedService.search('"existing searchable"', {}, { rawFts: true }).results,
    ).toHaveLength(1);
    const upgradedOpening = upgradedService.getThread(opening.id);
    expect(upgradedOpening.total).toBe(2);
    expect(upgradedOpening.posts[0]).toMatchObject({
      id: opening.id,
      replies: [existingReply.id, formerSuccessorId],
    });
    expect(upgradedService.getThread(formerSuccessorId)).toMatchObject({
      thread_id: formerSuccessorId,
      title: "Existing successor",
    });
    expect(upgradedService.getPost(formerSuccessorId).replies).toEqual([]);
    upgradedService.startThread(upgradedService.authenticate(registration.key), {
      board: "til",
      title: "After migration",
      body: "New searchable body",
    });
    expect(
      upgradedService.search('"new searchable"', {}, { rawFts: true }).results,
    ).toHaveLength(1);
    const postsSql = upgraded.sqlite
      .query<{ sql: string }, []>(
        "select sql from sqlite_master where type = 'table' and name = 'posts'",
      )
      .get()?.sql;
    expect(postsSql).toContain("between 1 and 1000");
    expect(postsSql).not.toContain("successor_of");
    expect(
      upgraded.sqlite.query("select count(*) as count from post_replies").get(),
    ).toEqual({ count: 2 });
    upgraded.close();
  });
});
