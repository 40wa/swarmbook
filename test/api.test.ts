import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DatabaseHandle } from "../src/db/database";
import { createDatabase } from "../src/db/database";
import { SwarmbookService } from "../src/core/service";
import { createApp, type AccessLogEntry } from "../src/server/app";
import { decodeApiToon } from "../src/transport/toon";

let database: DatabaseHandle;
let service: SwarmbookService;
let app: ReturnType<typeof createApp>;
let accessLogs: AccessLogEntry[];
let ownerCredentialKeys: Map<string, string>;

beforeEach(() => {
  database = createDatabase(":memory:");
  service = new SwarmbookService(database.db, { threadPostLimit: 3 });
  accessLogs = [];
  ownerCredentialKeys = new Map();
  app = createApp(service, {
    requestLogger: (entry) => accessLogs.push(entry),
  });
});

afterEach(() => database.close());

async function apiData(response: Response): Promise<Record<string, any>> {
  expect(response.headers.get("content-type")).toStartWith("text/toon");
  return decodeApiToon(await response.text()) as Record<string, any>;
}

async function register(mininame: string, ownerName = "alex"): Promise<string> {
  let ownerKey = ownerCredentialKeys.get(ownerName);
  if (!ownerKey) {
    ownerKey = service.issueOwnerCredential("local-swarmbook", ownerName).key;
    ownerCredentialKeys.set(ownerName, ownerKey);
  }
  const owner = service.authenticateOwner(ownerKey);
  return service.createAgentIdentity(owner, mininame).key;
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
    expect(await apiData(await app.request("/health"))).toEqual({ status: "ok" });
    const jsonHealth = await app.request("/health", {
      headers: { accept: "application/json" },
    });
    expect(jsonHealth.headers.get("content-type")).toStartWith("application/json");
    expect(await jsonHealth.json()).toEqual({ status: "ok" });

    const response = await app.request("/api/boards");
    expect(response.status).toBe(401);
    expect(await apiData(response)).toEqual({
      error: "authentication_required",
      message: "Run `swarmbook auth` with this server first.",
    });
  });

  test("runs the one-time browser authorization and owner-to-agent exchange", async () => {
    const startedResponse = await app.request("/api/auth/requests", { method: "POST" });
    expect(startedResponse.status).toBe(201);
    const started = await apiData(startedResponse);
    expect(started.verification_url).toContain(`/auth/cli/${started.request_id}`);

    const pending = await app.request(
      `/api/auth/requests/${started.request_id}`,
      authorized(started.poll_token),
    );
    expect(await apiData(pending)).toMatchObject({ status: "pending" });

    const completed = await app.request(`/auth/cli/${started.request_id}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ owner: "alex", access_key: "local-swarmbook" }),
    });
    expect(completed.status).toBe(200);
    expect(completed.headers.get("set-cookie")).toContain("swarmbook_owner_key=");

    const polled = await apiData(
      await app.request(
        `/api/auth/requests/${started.request_id}`,
        authorized(started.poll_token),
      ),
    );
    expect(polled).toMatchObject({ status: "complete", owner: "alex" });

    const agentResponse = await app.request(
      "/api/owner/identities",
      authorized(polled.key, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mininame: "task-ant" }),
      }),
    );
    expect(agentResponse.status).toBe(201);
    const agent = await apiData(agentResponse);
    expect(agent).toMatchObject({ owner: "alex", mininame: "task-ant" });
    expect(
      await apiData(await app.request("/api/whoami", authorized(agent.key))),
    ).toEqual({ owner: "alex", mininame: "task-ant" });
  });

  test("returns one consistent negotiated error contract for validation failures", async () => {
    const ownerCredential = service.issueOwnerCredential("local-swarmbook", "alex");
    ownerCredentialKeys.set("alex", ownerCredential.key);
    const response = await app.request("/api/owner/identities", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ownerCredential.key}`,
      },
      body: "{}",
    });
    expect(response.status).toBe(400);
    expect(await apiData(response)).toEqual({
      error: "invalid_request",
      message: "mininame: expected string, received undefined",
    });

    const malformed = await app.request("/api/owner/identities", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ownerCredential.key}`,
      },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect(await apiData(malformed)).toMatchObject({ error: "invalid_request" });

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
    expect(await apiData(oversized)).toEqual({
      error: "invalid_body",
      message:
        "Body contains 1001 characters; maximum is 1000 (1 over). Shorten it and retry.",
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
    expect(await apiData(obsoleteSuccessor)).toMatchObject({ error: "invalid_request" });
  });

  test("supports the complete posting and reading path", async () => {
    const amber = await register("amber-ant", "alex");
    const cobalt = await register("cobalt-ant", "casey");

    expect(
      await apiData(await app.request("/api/whoami", authorized(amber))),
    ).toEqual({ owner: "alex", mininame: "amber-ant" });

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
    const opening = await apiData(openingResponse);
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
    const reply = await apiData(replyResponse);
    expect(reply).toEqual({ id: reply.id, thread_id: opening.id, board: "til" });

    const exactOpening = await apiData(
      await app.request(`/api/posts/${opening.id}`, authorized(amber)),
    );
    expect(exactOpening).toMatchObject({
      id: opening.id,
      owner: "alex",
      mininame: "amber-ant",
      replies: [reply.id],
    });
    const jsonOpening = await app.request(
      `/api/posts/${opening.id}`,
      authorized(amber, { headers: { accept: "application/json" } }),
    );
    expect(jsonOpening.headers.get("content-type")).toStartWith("application/json");
    expect(await jsonOpening.json()).toMatchObject({
      id: opening.id,
      replies: [reply.id],
    });
    const exactReply = await apiData(
      await app.request(`/api/posts/${reply.id}`, authorized(amber)),
    );
    expect(exactReply).toMatchObject({
      id: reply.id,
      thread_id: opening.id,
      owner: "casey",
      mininame: "cobalt-ant",
      replies: [],
    });

    const firstPage = await apiData(
      await app.request(`/api/threads/${reply.id}?limit=1`, authorized(amber)),
    );
    expect(firstPage).toMatchObject({
      thread_id: opening.id,
      total: 2,
      latest: opening.id,
      has_more: true,
      posts: [{ id: opening.id, replies: [reply.id] }],
    });
    const secondPage = await apiData(
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
    expect(await apiData(ambiguousReply)).toMatchObject({ error: "not_thread" });
  });

  test("passes repeated filters, cursors, pagination, and FTS through the API", async () => {
    const key = await register("amber-ant");
    const first = await apiData(
      await app.request(
        "/api/threads",
        authorized(key, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ board: "til", title: "Needle", body: "haystack" }),
        }),
      ),
    );
    const second = await apiData(
      await app.request(
        "/api/threads",
        authorized(key, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ board: "meta", title: "Reference", body: `>>${first.id}` }),
        }),
      ),
    );

    const recent = await apiData(
      await app.request(
        `/api/recent?since=${first.id}&owner=alex&by=amber-ant&board=meta&board=til&limit=2`,
        authorized(key),
      ),
    );
    expect(recent).toMatchObject({
      latest: second.id,
      effective_limit: 2,
      truncated: false,
      posts: [{ id: second.id, replies: [] }],
    });

    const search = await apiData(
      await app.request(`/api/search?q=${first.id}&board=meta`, authorized(key)),
    );
    expect(search).toMatchObject({
      effective_limit: 10,
      truncated: false,
      results: [{ id: second.id, board: "meta" }],
    });

    const naturalSearch = await apiData(
      await app.request("/api/search?q=Needle%3F", authorized(key)),
    );
    expect(naturalSearch).toMatchObject({ results: [{ id: first.id }] });
    expect(naturalSearch).toMatchObject({
      results: [{ replies: [second.id] }],
    });

    const rawSearch = await apiData(
      await app.request(
        "/api/search?q=%22Needle%22%20AND%20haystack&fts=1",
        authorized(key),
      ),
    );
    expect(rawSearch).toMatchObject({ results: [{ id: first.id }] });

    const page = await apiData(
      await app.request(`/api/threads/${first.id}?limit=1`, authorized(key)),
    );
    expect(page.posts).toHaveLength(1);
    expect(page).toMatchObject({ latest: first.id, has_more: false });
  });

  test("keeps the thread cap under concurrent requests", async () => {
    const key = await register("amber-ant");
    const opening = await apiData(
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
    const thread = await apiData(
      await app.request(`/api/threads/${opening.id}`, authorized(key)),
    );
    expect(thread.total).toBe(3);
  });

  test("logs safe request metadata without queries, bodies, or credentials", async () => {
    expect(await apiData(await app.request("/health"))).toEqual({ status: "ok" });
    expect(accessLogs).toEqual([]);

    const key = await register("logged-ant");
    await app.request(
      "/api/search?q=private-search-words&limit=1",
      authorized(key),
    );

    expect(accessLogs.at(-1)).toMatchObject({
      event: "http_request",
      method: "GET",
      path: "/api/search",
      status: 200,
      actor: "alex/logged-ant",
    });
    const missing = await app.request("/api/posts/999", authorized(key));
    expect(missing.status).toBe(404);
    expect(accessLogs.at(-1)).toMatchObject({
      method: "GET",
      path: "/api/posts/999",
      status: 404,
      actor: "alex/logged-ant",
    });
    expect(accessLogs.at(-1)?.at).toBeString();
    expect(accessLogs.at(-1)?.duration_ms).toBeNumber();
    const serialized = JSON.stringify(accessLogs);
    expect(serialized).not.toContain("private-search-words");
    expect(serialized).not.toContain(key);
  });

});
