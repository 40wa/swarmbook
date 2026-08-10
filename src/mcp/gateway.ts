import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Identity, OwnerIdentity, SwarmbookService } from "../core/service";
import { AppError } from "../core/errors";
import { createSwarmbookMcpServer, type McpIdentityState } from "./tools";

interface Session {
  transport: WebStandardStreamableHTTPServerTransport;
  owner: OwnerIdentity;
  identity: McpIdentityState;
}

function jsonRpcError(status: number, message: string): Response {
  return Response.json({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  }, { status });
}

function bearer(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") && authorization.length > 7
    ? authorization.slice(7)
    : undefined;
}

export class SwarmbookMcpGateway {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly service: SwarmbookService) {}

  actorFor(request: Request): Identity | OwnerIdentity | undefined {
    const key = bearer(request);
    if (!key) return undefined;

    try {
      const owner = this.service.authenticateOwner(key);
      const sessionId = request.headers.get("mcp-session-id");
      const session = sessionId ? this.sessions.get(sessionId) : undefined;
      if (session?.owner.ownerId === owner.ownerId && session.identity.current) {
        return session.identity.current;
      }
      return owner;
    } catch {
      return undefined;
    }
  }

  async handle(request: Request, origin: string): Promise<Response> {
    let owner: OwnerIdentity;
    try {
      const key = bearer(request);
      if (!key) return this.unauthorized(origin);
      owner = this.service.authenticateOwner(key);
    } catch (error) {
      if (error instanceof AppError) return this.unauthorized(origin, "invalid_token");
      throw error;
    }

    const sessionId = request.headers.get("mcp-session-id");
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session) return jsonRpcError(404, "MCP session not found. Initialize a new session.");
      if (session.owner.ownerId !== owner.ownerId) {
        return this.unauthorized(origin, "invalid_token");
      }
      return session.transport.handleRequest(request, {
        authInfo: { token: bearer(request)!, clientId: `owner:${owner.ownerId}`, scopes: ["mcp:tools"] },
      });
    }

    if (request.method !== "POST") {
      return jsonRpcError(400, "A valid mcp-session-id header is required.");
    }
    let body: unknown;
    try {
      body = await request.clone().json();
    } catch {
      return jsonRpcError(400, "The MCP request body must be valid JSON.");
    }
    if (!isInitializeRequest(body)) {
      return jsonRpcError(400, "Initialize MCP before sending other requests.");
    }

    let transport!: WebStandardStreamableHTTPServerTransport;
    const identity: McpIdentityState = {};
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        this.sessions.set(id, { transport, owner, identity });
      },
      onsessionclosed: (id) => {
        this.sessions.delete(id);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) this.sessions.delete(transport.sessionId);
    };
    const server = createSwarmbookMcpServer(this.service, owner, identity);
    await server.connect(transport);
    return transport.handleRequest(request, {
      parsedBody: body,
      authInfo: { token: bearer(request)!, clientId: `owner:${owner.ownerId}`, scopes: ["mcp:tools"] },
    });
  }

  private unauthorized(origin: string, error?: string): Response {
    const metadata = `${origin}/.well-known/oauth-protected-resource/mcp`;
    const fields = ["Bearer", `resource_metadata="${metadata}"`, 'scope="mcp:tools"'];
    if (error) fields.push(`error="${error}"`);
    return Response.json(
      { error: "authentication_required", message: "Authorize this MCP client with Swarmbook." },
      { status: 401, headers: { "www-authenticate": fields.join(", ") } },
    );
  }
}
