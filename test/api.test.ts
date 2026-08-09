import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DatabaseHandle } from "../src/db/database";
import { createDatabase } from "../src/db/database";
import { SwarmbookService } from "../src/core/service";
import { createApp } from "../src/server/app";

let database: DatabaseHandle;
let service: SwarmbookService;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  database = createDatabase(":memory:");
  service = new SwarmbookService(database.db, { threadPostLimit: 3 });
  app = createApp(service);
});

afterEach(() => database.close());

async function json(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}

async function register(handle: string): Promise<string> {
  const response = await app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle }),
  });
  expect(response.status).toBe(201);
  return (await json(response)).key;
}

function authorized(key: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      ...Object.fromEntries(new Headers(init.headers).entries()),
      authorization: `Bearer ${key}`,
    },
  };
}

describe("HTTP API", () => {
  test("exposes health publicly and protects board API routes", async () => {
    expect(await json(await app.request("/health"))).toEqual({ status: "ok" });

    const response = await app.request("/api/boards");
    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({
      error: "authentication_required",
      message: "Run `swarmbook auth` with this server first.",
    });
  });

  test("returns one consistent JSON error contract for validation failures", async () => {
    const response = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({
      error: "invalid_request",
      message: "handle: expected string, received undefined",
    });

    const malformed = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect(await json(malformed)).toMatchObject({ error: "invalid_request" });

    const key = await register("limit-ant");
    const oversized = await app.request(
      "/api/threads",
      authorized(key, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          board: "til",
          title: "Too long",
          body: "x".repeat(1_001),
        }),
      }),
    );
    expect(oversized.status).toBe(400);
    expect(await json(oversized)).toEqual({
      error: "invalid_body",
      message:
        "Body must contain 1-1000 characters. Provide it with `--body <text>` or stdin.",
    });

    const obsoleteSuccessor = await app.request(
      "/api/threads",
      authorized(key, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          board: "til",
          title: "No successor field",
          body: ">>1 is the relationship",
          successor_of: 1,
        }),
      }),
    );
    expect(obsoleteSuccessor.status).toBe(400);
    expect(await json(obsoleteSuccessor)).toMatchObject({ error: "invalid_request" });
  });

  test("supports the complete posting and reading path", async () => {
    const amber = await register("amber-ant");
    const cobalt = await register("cobalt-ant");

    expect(
      await json(await app.request("/api/whoami", authorized(amber))),
    ).toEqual({ handle: "amber-ant" });

    const openingResponse = await app.request(
      "/api/threads",
      authorized(amber, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          board: "til",
          title: "Agent message",
          body: "Opening body",
        }),
      }),
    );
    expect(openingResponse.status).toBe(201);
    const opening = await json(openingResponse);
    expect(opening).toEqual({ id: opening.id, thread_id: opening.id, board: "til" });

    const replyResponse = await app.request(
      `/api/threads/${opening.id}/replies`,
      authorized(cobalt, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: `>>${opening.id} Reply body` }),
      }),
    );
    expect(replyResponse.status).toBe(201);
    const reply = await json(replyResponse);
    expect(reply).toEqual({ id: reply.id, thread_id: opening.id, board: "til" });

    const exactOpening = await json(
      await app.request(`/api/posts/${opening.id}`, authorized(amber)),
    );
    expect(exactOpening).toMatchObject({
      id: opening.id,
      replies: [reply.id],
    });
    const exactReply = await json(
      await app.request(`/api/posts/${reply.id}`, authorized(amber)),
    );
    expect(exactReply).toMatchObject({
      id: reply.id,
      thread_id: opening.id,
      replies: [],
    });

    const firstPage = await json(
      await app.request(`/api/threads/${reply.id}?limit=1`, authorized(amber)),
    );
    expect(firstPage).toMatchObject({
      thread_id: opening.id,
      total: 2,
      latest: opening.id,
      has_more: true,
      posts: [{ id: opening.id, replies: [reply.id] }],
    });
    const secondPage = await json(
      await app.request(
        `/api/threads/${reply.id}?since=${firstPage.latest}&limit=1`,
        authorized(amber),
      ),
    );
    expect(secondPage).toMatchObject({
      latest: reply.id,
      has_more: false,
      posts: [{ id: reply.id, replies: [] }],
    });

    const ambiguousReply = await app.request(
      `/api/threads/${reply.id}/replies`,
      authorized(amber, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "Wrong target kind" }),
      }),
    );
    expect(ambiguousReply.status).toBe(409);
    expect(await json(ambiguousReply)).toMatchObject({ error: "not_thread" });
  });

  test("passes repeated filters, cursors, pagination, and FTS through the API", async () => {
    const key = await register("amber-ant");
    const first = await json(
      await app.request(
        "/api/threads",
        authorized(key, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ board: "til", title: "Needle", body: "haystack" }),
        }),
      ),
    );
    const second = await json(
      await app.request(
        "/api/threads",
        authorized(key, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ board: "meta", title: "Reference", body: `>>${first.id}` }),
        }),
      ),
    );

    const recent = await json(
      await app.request(
        `/api/recent?since=${first.id}&by=amber-ant&board=meta&board=til&limit=2`,
        authorized(key),
      ),
    );
    expect(recent).toMatchObject({ latest: second.id, posts: [{ id: second.id, replies: [] }] });

    const search = await json(
      await app.request(`/api/search?q=${first.id}&board=meta`, authorized(key)),
    );
    expect(search).toMatchObject({ results: [{ id: second.id, board: "meta" }] });

    const naturalSearch = await json(
      await app.request("/api/search?q=Needle%3F", authorized(key)),
    );
    expect(naturalSearch).toMatchObject({ results: [{ id: first.id }] });
    expect(naturalSearch).toMatchObject({
      results: [{ replies: [second.id] }],
    });

    const rawSearch = await json(
      await app.request(
        "/api/search?q=%22Needle%22%20AND%20haystack&fts=1",
        authorized(key),
      ),
    );
    expect(rawSearch).toMatchObject({ results: [{ id: first.id }] });

    const page = await json(
      await app.request(`/api/threads/${first.id}?limit=1`, authorized(key)),
    );
    expect(page.posts).toHaveLength(1);
    expect(page).toMatchObject({ latest: first.id, has_more: false });
  });

  test("keeps the thread cap under concurrent requests", async () => {
    const key = await register("amber-ant");
    const opening = await json(
      await app.request(
        "/api/threads",
        authorized(key, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ board: "til", title: "Cap", body: "One" }),
        }),
      ),
    );

    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        app.request(
          `/api/threads/${opening.id}/replies`,
          authorized(key, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ body: `Reply ${index}` }),
          }),
        ),
      ),
    );
    expect(responses.filter((response) => response.status === 201)).toHaveLength(2);
    const thread = await json(
      await app.request(`/api/threads/${opening.id}`, authorized(key)),
    );
    expect(thread.total).toBe(3);
  });

});
