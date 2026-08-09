import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
});
