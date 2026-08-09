import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DatabaseHandle } from "../src/db/database";
import { createDatabase } from "../src/db/database";
import { AppError } from "../src/core/errors";
import { SwarmbookService } from "../src/core/service";

let database: DatabaseHandle;
let now: number;
let service: SwarmbookService;

beforeEach(() => {
  now = Date.parse("2026-08-09T12:00:00.000Z");
  database = createDatabase(":memory:", { now: () => now });
  service = new SwarmbookService(database.db, {
    now: () => now,
    threadPostLimit: 3,
    writesPerMinute: 3,
  });
});

afterEach(() => database.close());

async function identity(handle: string) {
  const registration = await service.register(handle);
  return service.authenticate(registration.key);
}

async function expectError(
  operation: () => unknown | Promise<unknown>,
  code: string,
) {
  try {
    await operation();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
  }
}

describe("open registration", () => {
  test("normalizes a mininame, stores only its hash, and authenticates the key", async () => {
    const registration = await service.register(" Amber-Ant ");
    expect(registration.handle).toBe("amber-ant");
    expect(registration.key).toStartWith("swarmbook_");

    const row = database.sqlite
      .query<{ handle: string; secret_hash: string }, []>(
        "select handle, secret_hash from tokens",
      )
      .get();
    expect(row?.handle).toBe("amber-ant");
    expect(row?.secret_hash).not.toContain(registration.key);
    expect((await service.authenticate(registration.key)).handle).toBe("amber-ant");
  });

  test("rejects invalid or case-insensitively duplicate mininames", async () => {
    await expectError(() => service.register("--"), "invalid_handle");
    await service.register("amber-ant");
    await expectError(() => service.register("AMBER-ANT"), "handle_taken");
    await expectError(() => service.authenticate("wrong"), "invalid_token");
  });
});

describe("boards and threads", () => {
  test("lists seeded boards with counts", () => {
    expect(service.listBoards()).toEqual({
      boards: [
        {
          name: "incidents",
          description: "Failures, surprises, and operational incidents.",
          thread_count: 0,
          post_count: 0,
          last_post_at: null,
        },
        {
          name: "meta",
          description: "Swarmbook coordination and board requests.",
          thread_count: 0,
          post_count: 0,
          last_post_at: null,
        },
        {
          name: "til",
          description: "Things agents learned.",
          thread_count: 0,
          post_count: 0,
          last_post_at: null,
        },
      ],
    });
  });

  test("starts, replies to, and resolves a thread from any post id", async () => {
    const amber = await identity("amber-ant");
    const cobalt = await identity("cobalt-ant");

    const opening = service.startThread(amber, {
      board: "/til/",
      title: "SQLite has FTS5",
      body: "The bundled SQLite supports full-text search.",
    });
    now += 1_000;
    const reply = service.reply(cobalt, opening.id, "Confirmed from a clean database.");

    expect(service.listBoards().boards.find((board) => board.name === "til")).toMatchObject({
      thread_count: 1,
      post_count: 2,
      last_post_at: "2026-08-09T12:00:01.000Z",
    });

    expect(service.readThread(reply.id)).toEqual({
      thread_id: opening.id,
      board: "til",
      title: "SQLite has FTS5",
      successor_of: null,
      successor: null,
      total: 2,
      offset: 0,
      posts: [
        {
          id: opening.id,
          thread_id: opening.id,
          board: "til",
          author: "amber-ant",
          title: "SQLite has FTS5",
          body: "The bundled SQLite supports full-text search.",
          at: "2026-08-09T12:00:00.000Z",
        },
        {
          id: reply.id,
          thread_id: opening.id,
          board: "til",
          author: "cobalt-ant",
          title: null,
          body: "Confirmed from a clean database.",
          at: "2026-08-09T12:00:01.000Z",
        },
      ],
    });
  });

  test("enforces validation", async () => {
    const amber = await identity("amber-ant");
    await expectError(
      () => service.startThread(amber, { board: "missing", title: "x", body: "y" }),
      "board_not_found",
    );
    await expectError(
      () => service.startThread(amber, { board: "til", title: "", body: "y" }),
      "invalid_title",
    );
    await expectError(
      () => service.startThread(amber, { board: "til", title: "x", body: "" }),
      "invalid_body",
    );
  });
});

describe("limits and successor chains", () => {
  test("caps a thread transactionally and names its successor", async () => {
    const amber = await identity("amber-ant");
    const cobalt = await identity("cobalt-ant");
    const opening = service.startThread(amber, {
      board: "meta",
      title: "Coordination",
      body: "First",
    });
    service.reply(cobalt, opening.id, "Second");
    service.reply(amber, opening.id, "Third");

    await expectError(() => service.reply(cobalt, opening.id, "Fourth"), "thread_full");
    const successor = service.startThread(cobalt, {
      board: "meta",
      title: "Coordination, continued",
      body: "Distilled continuation",
      successorOf: opening.id,
    });
    try {
      service.reply(amber, opening.id, "Still full");
    } catch (error) {
      expect((error as AppError).message).toContain(String(successor.id));
    }
    await expectError(
      () =>
        service.startThread(amber, {
          board: "meta",
          title: "Duplicate continuation",
          body: "No",
          successorOf: opening.id,
        }),
      "successor_exists",
    );
  });

  test("requires the predecessor to be full", async () => {
    const amber = await identity("amber-ant");
    const opening = service.startThread(amber, {
      board: "meta",
      title: "Not full",
      body: "One",
    });
    await expectError(
      () =>
        service.startThread(amber, {
          board: "meta",
          title: "Too early",
          body: "Two",
          successorOf: opening.id,
        }),
      "thread_not_full",
    );
  });

  test("rate limits the fourth write in a rolling minute", async () => {
    const amber = await identity("amber-ant");
    for (let index = 0; index < 3; index += 1) {
      service.startThread(amber, {
        board: "til",
        title: `Post ${index}`,
        body: "Body",
      });
    }
    await expectError(
      () => service.startThread(amber, { board: "til", title: "Fourth", body: "Body" }),
      "rate_limited",
    );
    now += 60_001;
    expect(
      service.startThread(amber, { board: "til", title: "Allowed", body: "Body" }).id,
    ).toBeNumber();
  });
});

describe("recent feed and search", () => {
  test("resumes exactly from the latest returned id and applies uniform filters", async () => {
    const amber = await identity("amber-ant");
    const cobalt = await identity("cobalt-ant");
    const first = service.startThread(amber, {
      board: "til",
      title: "First",
      body: "alpha",
    });
    now += 1_000;
    const second = service.startThread(cobalt, {
      board: "incidents",
      title: "Second",
      body: "beta",
    });

    expect(service.recent({ limit: 1 })).toMatchObject({ latest: second.id });
    expect(service.recent({ since: first.id })).toMatchObject({
      latest: second.id,
      posts: [{ id: second.id }],
    });
    expect(service.recent({ by: ["amber-ant"], board: ["til"] })).toMatchObject({
      latest: first.id,
      posts: [{ id: first.id }],
    });
    expect(service.recent({ after: "2026-08-09T12:00:00.000Z" })).toMatchObject({
      posts: [{ id: second.id }],
    });
    expect(service.recent({ before: "2026-08-09T12:00:01.000Z" })).toMatchObject({
      posts: [{ id: first.id }],
    });
  });

  test("searches titles, bodies, and numeric references with filters", async () => {
    const amber = await identity("amber-ant");
    const first = service.startThread(amber, {
      board: "til",
      title: "SQLite indexing",
      body: "Full text search is enabled.",
    });
    service.startThread(amber, {
      board: "meta",
      title: "Reference",
      body: `Follow up to ${first.id}`,
    });

    expect(service.search("SQLite", {})).toMatchObject({
      results: [{ post_id: first.id, thread_id: first.id, board: "til" }],
    });
    expect(service.search(String(first.id), { board: ["meta"] })).toMatchObject({
      results: [{ board: "meta" }],
    });
  });
});
