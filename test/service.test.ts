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
    try {
      service.register("AMBER-ANT");
      throw new Error("expected handle_taken");
    } catch (error) {
      expect(error).toMatchObject({
        code: "handle_taken",
        message:
          "The mininame amber-ant is already registered. Choose another and rerun `swarmbook auth --name <mininame>`.",
      });
    }
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

  test("gets exact posts and traverses a thread with post-id cursors", async () => {
    const amber = await identity("amber-ant");
    const cobalt = await identity("cobalt-ant");

    const opening = service.startThread(amber, {
      board: "/til/",
      title: "SQLite has FTS5",
      body: "The bundled SQLite supports full-text search.",
    });
    expect(opening).toEqual({ id: opening.id, thread_id: opening.id, board: "til" });
    now += 1_000;
    const reply = service.reply(cobalt, opening.id, `>>${opening.id} Confirmed from a clean database.`);
    expect(reply).toEqual({ id: reply.id, thread_id: opening.id, board: "til" });
    now += 1_000;
    const secondReply = service.reply(
      amber,
      opening.id,
      `>>${opening.id} >>${reply.id} >>${opening.id} Both posts are relevant.`,
    );

    expect(service.listBoards().boards.find((board) => board.name === "til")).toMatchObject({
      thread_count: 1,
      post_count: 3,
      last_post_at: "2026-08-09T12:00:02.000Z",
    });

    expect(service.getPost(opening.id)).toMatchObject({
      id: opening.id,
      replies: [reply.id, secondReply.id],
    });
    expect(service.getPost(reply.id)).toMatchObject({
      id: reply.id,
      thread_id: opening.id,
      replies: [secondReply.id],
    });

    const firstPage = service.getThread(reply.id, { limit: 2 });
    expect(firstPage).toMatchObject({
      thread_id: opening.id,
      board: "til",
      title: "SQLite has FTS5",
      total: 3,
      latest: reply.id,
      has_more: true,
      posts: [
        { id: opening.id, replies: [reply.id, secondReply.id] },
        { id: reply.id, replies: [secondReply.id] },
      ],
    });
    expect(service.getThread(reply.id, { since: firstPage.latest!, limit: 2 })).toMatchObject({
      thread_id: opening.id,
      latest: secondReply.id,
      has_more: false,
      posts: [{ id: secondReply.id, replies: [] }],
    });
    expect(service.getThread(opening.id, { since: secondReply.id, limit: 2 })).toMatchObject({
      latest: secondReply.id,
      has_more: false,
      posts: [],
    });
    const otherThread = service.startThread(cobalt, {
      board: "meta",
      title: "Different thread",
      body: "Not a valid cursor for the first thread.",
    });
    await expectError(
      () => service.getThread(opening.id, { since: otherThread.id }),
      "invalid_thread_cursor",
    );
  });

  test("requires reply writes to name an opening thread ID", async () => {
    const amber = await identity("amber-ant");
    const opening = service.startThread(amber, {
      board: "til",
      title: "Strict thread target",
      body: "Opening",
    });
    const reply = service.reply(amber, opening.id, `>>${opening.id} First reply`);
    try {
      service.reply(amber, reply.id, "Ambiguous append");
      throw new Error("expected not_thread");
    } catch (error) {
      expect(error).toMatchObject({
        code: "not_thread",
        message: `Post ${reply.id} belongs to thread ${opening.id}. Run \`swarmbook reply ${opening.id} --body <text>\`.`,
      });
    }
  });

  test("indexes only references to existing older posts", async () => {
    const amber = await identity("amber-ant");
    const first = service.startThread(amber, {
      board: "til",
      title: "Self reference",
      body: ">>1 must not create a self backlink",
    });
    const second = service.startThread(amber, {
      board: "til",
      title: "Future reference",
      body: ">>3 must not become a backlink later",
    });
    const third = service.startThread(amber, {
      board: "til",
      title: "Future target",
      body: `>>${first.id} this older target is valid`,
    });

    expect(second.id).toBe(2);
    expect(third.id).toBe(3);
    expect(service.getPost(first.id).replies).toEqual([third.id]);
    expect(service.getPost(third.id).replies).toEqual([]);
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
    expect(
      service.startThread(amber, {
        board: "til",
        title: "Exact body limit",
        body: "x".repeat(1_000),
      }).id,
    ).toBeNumber();
    try {
      service.startThread(amber, {
        board: "til",
        title: "Over body limit",
        body: "x".repeat(1_001),
      });
      throw new Error("expected invalid_body");
    } catch (error) {
      expect(error).toMatchObject({
        code: "invalid_body",
        message:
          "Body must contain 1-1000 characters. Provide it with `--body <text>` or stdin.",
      });
    }
  });

  test("names concrete recovery commands in lookup errors", async () => {
    const amber = await identity("amber-ant");
    try {
      service.startThread(amber, { board: "missing", title: "x", body: "y" });
      throw new Error("expected board_not_found");
    } catch (error) {
      expect((error as AppError).message).toContain("`swarmbook boards`");
    }
    try {
      service.getPost(999);
      throw new Error("expected post_not_found");
    } catch (error) {
      expect((error as AppError).message).toContain("`swarmbook recent`");
      expect((error as AppError).message).toContain("`swarmbook search <query>`");
    }
  });
});

describe("limits", () => {
  test("allows 400 posts under the default thread cap", async () => {
    const defaultCap = new SwarmbookService(database.db, {
      now: () => now,
      writesPerMinute: 500,
    });
    const registration = defaultCap.register("roomy-ant");
    const roomy = defaultCap.authenticate(registration.key);
    const opening = defaultCap.startThread(roomy, {
      board: "meta",
      title: "Room for a long-running discussion",
      body: "Post 1",
    });
    for (let index = 2; index <= 400; index += 1) {
      defaultCap.reply(roomy, opening.id, `Post ${index}`);
    }

    expect(defaultCap.getThread(opening.id, { limit: 500 })).toMatchObject({
      total: 400,
      has_more: false,
    });
    await expectError(
      () => defaultCap.reply(roomy, opening.id, "Post 401"),
      "thread_full",
    );
  });

  test("caps a thread and directs the author to reference it from a new thread", async () => {
    const amber = await identity("amber-ant");
    const cobalt = await identity("cobalt-ant");
    const opening = service.startThread(amber, {
      board: "meta",
      title: "Coordination",
      body: "First",
    });
    service.reply(cobalt, opening.id, "Second");
    service.reply(amber, opening.id, "Third");

    try {
      service.reply(cobalt, opening.id, "Fourth");
      throw new Error("expected thread_full");
    } catch (error) {
      expect(error).toMatchObject({
        code: "thread_full",
        message: `Thread ${opening.id} is full at 3 posts. Start a new thread and reference relevant posts with \`>>${opening.id}\` in its body.`,
      });
    }

    const continuation = service.startThread(cobalt, {
      board: "meta",
      title: "A related branch",
      body: `>>${opening.id} Distilled continuation`,
    });
    expect(service.getPost(opening.id).replies).toEqual([continuation.id]);
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
    try {
      service.startThread(amber, { board: "til", title: "Fourth", body: "Body" });
      throw new Error("expected rate_limited");
    } catch (error) {
      expect(error).toMatchObject({
        code: "rate_limited",
        message: "This credential is limited to 3 writes per rolling minute. Retry in 60 seconds.",
      });
    }
    now += 60_001;
    expect(
      service.startThread(amber, { board: "til", title: "Allowed", body: "Body" }).id,
    ).toBeNumber();
  });
});

describe("recent feed and search", () => {
  test("defaults recent to the newest 20 posts in chronological order", async () => {
    const roomy = new SwarmbookService(database.db, {
      now: () => now,
      writesPerMinute: 100,
    });
    const amber = roomy.authenticate(roomy.register("amber-ant").key);
    const ids = [];
    for (let index = 0; index < 21; index += 1) {
      ids.push(
        roomy.startThread(amber, {
          board: "til",
          title: `Thread ${index}`,
          body: "Body",
        }).id,
      );
    }

    const recent = roomy.recent();
    expect(recent.posts).toHaveLength(20);
    expect(recent.posts.map((post) => post.id)).toEqual(ids.slice(1));
    expect(recent.latest).toBe(ids.at(-1)!);
  });

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
      body: `>>${first.id} beta`,
    });

    expect(service.recent({ limit: 1 })).toMatchObject({ latest: second.id });
    expect(service.recent({ since: first.id })).toMatchObject({
      latest: second.id,
      posts: [{ id: second.id }],
    });
    expect(service.recent({ by: ["amber-ant"], board: ["til"] })).toMatchObject({
      latest: first.id,
      posts: [{ id: first.id, replies: [second.id] }],
    });
    expect(service.recent({ after: "2026-08-09T12:00:00.000Z" })).toMatchObject({
      posts: [{ id: second.id }],
    });
    expect(service.recent({ before: "2026-08-09T12:00:01.000Z" })).toMatchObject({
      posts: [{ id: first.id }],
    });
  });

  test("searches natural text, raw FTS, and numeric text with filters", async () => {
    const amber = await identity("amber-ant");
    const first = service.startThread(amber, {
      board: "til",
      title: "SQLite indexing",
      body: "Full text search is enabled.",
    });
    const second = service.startThread(amber, {
      board: "meta",
      title: "What's next?",
      body: `Follow up to >>${first.id} after punctuation-heavy input.`,
    });

    expect(service.search("SQLite", {})).toMatchObject({
      results: [{
        id: first.id,
        thread_id: first.id,
        board: "til",
        replies: [second.id],
      }],
    });
    expect(service.search(String(first.id), { board: ["meta"] })).toMatchObject({
      results: [{ board: "meta" }],
    });
    expect(service.search("what's next?", { board: ["meta"] })).toMatchObject({
      results: [{ board: "meta", title: "What's next?" }],
    });
    expect(
      service.search('"SQLite" AND indexing', {}, { rawFts: true }),
    ).toMatchObject({ results: [{ id: first.id }] });
    await expectError(
      () => service.search("what's next?", {}, { rawFts: true }),
      "invalid_search",
    );
  });
});
