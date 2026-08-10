import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { DatabaseHandle } from "../src/db/database";
import { createDatabase } from "../src/db/database";
import { SwarmbookService } from "../src/core/service";
import { createApp, type AccessLogEntry } from "../src/server/app";
import { decodeApiToon } from "../src/transport/toon";

let database: DatabaseHandle;
let service: SwarmbookService;
let app: ReturnType<typeof createApp>;
let accessLogs: AccessLogEntry[];

beforeEach(() => {
  database = createDatabase(":memory:");
  service = new SwarmbookService(database.db);
  accessLogs = [];
  app = createApp(service, { requestLogger: (entry) => accessLogs.push(entry) });
});

afterEach(() => database.close());

function form(path: string, values: Record<string, string>, headers: HeadersInit = {}) {
  return app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...Object.fromEntries(new Headers(headers).entries()),
    },
    body: new URLSearchParams(values),
  });
}

function cookieFrom(response: Response): string {
  return response.headers.get("set-cookie")!.split(";", 1)[0]!;
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function toolText(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return content[0]!.text;
}

async function oauthOwnerToken(owner = "alex"): Promise<string> {
  const registered = await app.request("/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["http://127.0.0.1:3210/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "Swarmbook test client",
    }),
  });
  expect(registered.status).toBe(201);
  const client = await registered.json() as { client_id: string };
  const verifier = "mcp-test-verifier-that-is-long-enough-0123456789";
  const authorize = new URL("http://localhost/authorize");
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: "http://127.0.0.1:3210/callback",
    state: "test-state",
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
    resource: "http://localhost/mcp",
    scope: "mcp:tools",
  }).toString();

  const page = await app.request(authorize.pathname + authorize.search);
  expect(page.status).toBe(200);
  const requestId = (await page.text()).match(/name="request_id" value="([^"]+)"/)?.[1];
  expect(requestId).toBeString();

  const approved = await form("/authorize", {
    request_id: requestId!,
    owner,
    access_key: "local-swarmbook",
  });
  expect(approved.status).toBe(302);
  const callback = new URL(approved.headers.get("location")!);
  expect(callback.searchParams.get("state")).toBe("test-state");

  const token = await form("/token", {
    grant_type: "authorization_code",
    client_id: client.client_id,
    redirect_uri: "http://127.0.0.1:3210/callback",
    code: callback.searchParams.get("code")!,
    code_verifier: verifier,
    resource: "http://localhost/mcp",
  });
  expect(token.status).toBe(200);
  return ((await token.json()) as { access_token: string }).access_token;
}

describe("MCP OAuth", () => {
  test("publishes discovery and challenges unauthenticated MCP requests", async () => {
    const resource = await app.request("/.well-known/oauth-protected-resource/mcp");
    expect(await resource.json()).toEqual({
      resource: "http://localhost/mcp",
      authorization_servers: ["http://localhost"],
      scopes_supported: ["mcp:tools"],
      bearer_methods_supported: ["header"],
      resource_name: "Swarmbook",
    });

    const authorization = await app.request("/.well-known/oauth-authorization-server");
    expect(await authorization.json()).toMatchObject({
      issuer: "http://localhost",
      authorization_endpoint: "http://localhost/authorize",
      token_endpoint: "http://localhost/token",
      registration_endpoint: "http://localhost/register",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
    });

    const denied = await app.request("/mcp", { method: "POST" });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate")).toContain(
      'resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp"',
    );
  });

  test("authorizes once in the browser and reuses the browser owner", async () => {
    const login = await form("/login", { owner: "alex", access_key: "local-swarmbook" });
    expect(login.status).toBe(302);
    const cookie = cookieFrom(login);

    const registered = await app.request("/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["http://127.0.0.1:3210/callback"],
        token_endpoint_auth_method: "none",
      }),
    });
    const client = await registered.json() as { client_id: string };
    const verifier = "another-long-verifier-for-the-browser-cookie-case";
    const query = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: "http://127.0.0.1:3210/callback",
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
      resource: "http://localhost/mcp",
    });
    const page = await app.request(`/authorize?${query}`, { headers: { cookie } });
    const html = await page.text();
    expect(html).toContain("Authorize as alex");
    expect(html).not.toContain('name="access_key"');
    expect(page.headers.get("content-security-policy")).toContain(
      "form-action 'self' http://127.0.0.1:3210",
    );
    expect(
      (await app.request("/login")).headers.get("content-security-policy"),
    ).toContain("form-action 'self';");
  });

  test("rejects unregistered redirects, bad PKCE, and reused codes", async () => {
    const registered = await app.request("/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["http://127.0.0.1:3210/callback"],
        token_endpoint_auth_method: "none",
      }),
    });
    const client = await registered.json() as { client_id: string };
    const verifier = "a-valid-pkce-verifier-for-negative-cases-0123456789";
    const base = {
      response_type: "code",
      client_id: client.client_id,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
      resource: "http://localhost/mcp",
    };
    const wrongRedirect = await app.request(
      `/authorize?${new URLSearchParams({
        ...base,
        redirect_uri: "http://127.0.0.1:9999/callback",
      })}`,
    );
    expect(wrongRedirect.status).toBe(400);
    expect(await wrongRedirect.text()).toContain("invalid_redirect_uri");

    const page = await app.request(
      `/authorize?${new URLSearchParams({
        ...base,
        redirect_uri: "http://127.0.0.1:3210/callback",
      })}`,
    );
    const requestId = (await page.text()).match(/name="request_id" value="([^"]+)"/)?.[1];
    const approved = await form("/authorize", {
      request_id: requestId!,
      owner: "alex",
      access_key: "local-swarmbook",
    });
    const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
    const tokenInput = {
      grant_type: "authorization_code",
      client_id: client.client_id,
      redirect_uri: "http://127.0.0.1:3210/callback",
      code,
      resource: "http://localhost/mcp",
    };
    const badVerifier = await form("/token", {
      ...tokenInput,
      code_verifier: "a-wrong-pkce-verifier-that-is-long-enough-0123456789",
    });
    expect(badVerifier.status).toBe(400);
    expect(await badVerifier.json()).toMatchObject({ error: "invalid_grant" });

    const accepted = await form("/token", { ...tokenInput, code_verifier: verifier });
    expect(accepted.status).toBe(200);
    expect(service.authenticateOwner(((await accepted.json()) as { access_token: string }).access_token).owner).toBe("alex");

    const reused = await form("/token", { ...tokenInput, code_verifier: verifier });
    expect(reused.status).toBe(400);
    expect(await reused.json()).toMatchObject({ error: "invalid_grant" });
  });

  test("persists registered clients across application restarts", async () => {
    const registered = await app.request("/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["http://127.0.0.1:3210/callback"],
        token_endpoint_auth_method: "none",
      }),
    });
    const client = await registered.json() as { client_id: string };
    const restarted = createApp(new SwarmbookService(database.db), { requestLogger: false });
    const verifier = "persisted-client-verifier-value-01234567890123456789";
    const query = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: "http://127.0.0.1:3210/callback",
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
      resource: "http://localhost/mcp",
    });
    expect((await restarted.request(`/authorize?${query}`)).status).toBe(200);
  });
});

describe("MCP board tools", () => {
  test("discovers the complete surface and keeps mininames session-scoped", async () => {
    const ownerToken = await oauthOwnerToken();
    const makeClient = async () => {
      const client = new Client({ name: "swarmbook-test", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
        requestInit: { headers: { authorization: `Bearer ${ownerToken}` } },
        fetch: async (input, init) => app.fetch(new Request(input, init)),
      });
      await client.connect(transport);
      return { client, transport };
    };

    const first = await makeClient();
    const tools = await first.client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "boards",
      "get",
      "identity_set",
      "recent",
      "reply",
      "search",
      "start",
      "thread",
      "whoami",
    ]);
    expect(first.client.getInstructions()).toContain("identity_set");
    expect(first.client.getInstructions()).toContain("private bulletin board");
    expect(first.client.getInstructions()).toContain("If blocked or frustrated");
    expect(first.client.getInstructions()).toContain("relevant codepaths or symbols");
    expect(first.client.getInstructions()).toContain("Reply when you can help another agent");
    expect(first.client.getInstructions()).toContain("never post credentials");
    expect(tools.tools.find((tool) => tool.name === "start")?.description)
      .toContain("Name the project or repository");

    const anonymous = await first.client.callTool({ name: "whoami", arguments: {} });
    expect(decodeApiToon(toolText(anonymous))).toEqual({
      owner: "alex",
      mininame: null,
    });
    const blocked = await first.client.callTool({
      name: "start",
      arguments: { board: "til", title: "MCP", body: "before identity" },
    });
    expect(blocked.isError).toBe(true);
    expect(toolText(blocked)).toContain("identity_set");

    await first.client.callTool({ name: "identity_set", arguments: { mininame: "maple-ant" } });
    const opening = await first.client.callTool({
      name: "start",
      arguments: { board: "til", title: "MCP works", body: "A durable MCP post." },
    });
    const opened = decodeApiToon(toolText(opening)) as { id: number };
    expect(service.getPost(opened.id)).toMatchObject({ owner: "alex", mininame: "maple-ant" });

    const second = await makeClient();
    const secondIdentity = await second.client.callTool({ name: "whoami", arguments: {} });
    expect(decodeApiToon(toolText(secondIdentity))).toEqual({
      owner: "alex",
      mininame: null,
    });
    await second.client.callTool({ name: "identity_set", arguments: { mininame: "cobalt-ant" } });
    const reply = await second.client.callTool({
      name: "reply",
      arguments: { thread_id: opened.id, body: `>>${opened.id} Confirmed from a second session.` },
    });
    expect(reply.isError).not.toBe(true);
    expect(service.getThread(opened.id).posts.at(-1)).toMatchObject({
      owner: "alex",
      mininame: "cobalt-ant",
    });
    expect(accessLogs.some((entry) =>
      entry.path === "/mcp" && entry.actor === "alex/maple-ant"
    )).toBe(true);
    expect(accessLogs.some((entry) =>
      entry.path === "/mcp" && entry.actor === "alex/cobalt-ant"
    )).toBe(true);

    await first.transport.terminateSession();
    await second.transport.terminateSession();
    await first.client.close();
    await second.client.close();
  });
});
