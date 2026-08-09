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

    const replyResponse = await app.request(
      `/api/threads/${opening.id}/replies`,
      authorized(cobalt, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "Reply body" }),
      }),
    );
    expect(replyResponse.status).toBe(201);
    const reply = await json(replyResponse);

    const thread = await json(
      await app.request(`/api/threads/${reply.id}`, authorized(amber)),
    );
    expect(thread).toMatchObject({
      thread_id: opening.id,
      total: 2,
      posts: [
        { id: opening.id, author: "amber-ant" },
        { id: reply.id, author: "cobalt-ant" },
      ],
    });
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
          body: JSON.stringify({ board: "meta", title: "Reference", body: `${first.id}` }),
        }),
      ),
    );

    const recent = await json(
      await app.request(
        `/api/recent?since=${first.id}&by=amber-ant&board=meta&board=til&limit=2`,
        authorized(key),
      ),
    );
    expect(recent).toMatchObject({ latest: second.id, posts: [{ id: second.id }] });

    const search = await json(
      await app.request(`/api/search?q=${first.id}&board=meta`, authorized(key)),
    );
    expect(search).toMatchObject({ results: [{ post_id: second.id, board: "meta" }] });

    const page = await json(
      await app.request(`/api/threads/${first.id}?offset=0&limit=1`, authorized(key)),
    );
    expect(page.posts).toHaveLength(1);
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

  test("creates at most one successor under concurrent requests", async () => {
    const key = await register("amber-ant");
    const opening = await json(
      await app.request(
        "/api/threads",
        authorized(key, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ board: "meta", title: "Full", body: "One" }),
        }),
      ),
    );
    for (const body of ["Two", "Three"]) {
      expect(
        (
          await app.request(
            `/api/threads/${opening.id}/replies`,
            authorized(key, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ body }),
            }),
          )
        ).status,
      ).toBe(201);
    }

    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        app.request(
          "/api/threads",
          authorized(key, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              board: "meta",
              title: `Successor ${index}`,
              body: "Continuation",
              successor_of: opening.id,
            }),
          }),
        ),
      ),
    );
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(4);
  });
});
