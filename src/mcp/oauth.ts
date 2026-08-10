import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { OwnerIdentity, SwarmbookService } from "../core/service";
import { appError } from "../core/errors";

const MCP_SCOPE = "mcp:tools";
const AUTHORIZATION_TTL_MS = 10 * 60_000;

interface PendingAuthorization {
  id: string;
  clientId: string;
  clientName?: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  expiresAt: number;
}

interface AuthorizationCode extends Omit<PendingAuthorization, "id" | "clientName" | "state"> {
  owner: OwnerIdentity;
  expiresAt: number;
}

export interface AuthorizationPrompt {
  requestId: string;
  clientName?: string;
  redirectOrigin: string;
}

function randomId(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

function exactString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) {
    throw appError("invalid_oauth_request", `${name} is required.`);
  }
  return value;
}

function safeRedirectUri(value: string): string {
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    throw appError("invalid_client_metadata", "Every redirect URI must be an absolute URL.");
  }
  const loopback = uri.hostname === "127.0.0.1" || uri.hostname === "[::1]" || uri.hostname === "localhost";
  if (uri.protocol !== "https:" && !(uri.protocol === "http:" && loopback)) {
    throw appError(
      "invalid_client_metadata",
      "Redirect URIs must use HTTPS, except HTTP loopback callbacks on localhost.",
    );
  }
  if (uri.username || uri.password || uri.hash) {
    throw appError("invalid_client_metadata", "Redirect URIs cannot contain credentials or fragments.");
  }
  return uri.toString();
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function oauthError(error: string, description: string, status = 400): Response {
  return Response.json(
    { error, error_description: description },
    { status, headers: { "cache-control": "no-store", pragma: "no-cache" } },
  );
}

export class SwarmbookOAuth {
  private readonly pending = new Map<string, PendingAuthorization>();
  private readonly codes = new Map<string, AuthorizationCode>();

  constructor(
    private readonly service: SwarmbookService,
    private readonly now: () => number = Date.now,
  ) {}

  protectedResourceMetadata(origin: string) {
    return {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: [MCP_SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: "Swarmbook",
    };
  }

  authorizationServerMetadata(origin: string) {
    return {
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      registration_endpoint: `${origin}/register`,
      scopes_supported: [MCP_SCOPE],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
    };
  }

  registerClient(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw appError("invalid_client_metadata", "Client registration requires a JSON object.");
    }
    const record = input as Record<string, unknown>;
    if (!Array.isArray(record.redirect_uris) || record.redirect_uris.length === 0) {
      throw appError("invalid_client_metadata", "redirect_uris must contain at least one callback URL.");
    }
    const redirectUris = record.redirect_uris.map((uri) =>
      safeRedirectUri(exactString(uri, "redirect_uri"))
    );
    if (record.token_endpoint_auth_method !== undefined && record.token_endpoint_auth_method !== "none") {
      throw appError("invalid_client_metadata", "Swarmbook supports public OAuth clients with token_endpoint_auth_method=none.");
    }
    if (
      record.grant_types !== undefined &&
      (!Array.isArray(record.grant_types) ||
        !record.grant_types.includes("authorization_code") ||
        record.grant_types.some(
          (grant) => grant !== "authorization_code" && grant !== "refresh_token",
        ))
    ) {
      throw appError(
        "invalid_client_metadata",
        "OAuth clients must support authorization_code; refresh_token may also be advertised.",
      );
    }
    if (
      record.response_types !== undefined &&
      (!Array.isArray(record.response_types) || record.response_types.some((response) => response !== "code"))
    ) {
      throw appError("invalid_client_metadata", "Swarmbook supports only the code response type.");
    }
    const clientName = typeof record.client_name === "string"
      ? record.client_name.trim().slice(0, 200) || undefined
      : undefined;
    const scope = typeof record.scope === "string" ? record.scope : undefined;
    if (scope && scope.split(/\s+/).some((item) => item !== MCP_SCOPE)) {
      throw appError("invalid_client_metadata", `Swarmbook supports only the ${MCP_SCOPE} scope.`);
    }
    const client = this.service.registerOAuthClient({ redirectUris, clientName, scope });
    return {
      client_id: client.id,
      client_id_issued_at: Math.floor(this.now() / 1_000),
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      ...(client.clientName ? { client_name: client.clientName } : {}),
      scope: client.scope ?? MCP_SCOPE,
    };
  }

  beginAuthorization(url: URL, origin: string): AuthorizationPrompt {
    this.cleanExpired();
    if (url.searchParams.get("response_type") !== "code") {
      throw appError("unsupported_response_type", "Swarmbook supports response_type=code.");
    }
    const clientId = exactString(url.searchParams.get("client_id"), "client_id");
    const client = this.service.getOAuthClient(clientId);
    if (!client) throw appError("invalid_client", "The OAuth client is not registered.", 401);
    const redirectUri = safeRedirectUri(exactString(url.searchParams.get("redirect_uri"), "redirect_uri"));
    if (!client.redirectUris.includes(redirectUri)) {
      throw appError("invalid_redirect_uri", "The callback URL is not registered for this client.");
    }
    if (url.searchParams.get("code_challenge_method") !== "S256") {
      throw appError("invalid_request", "PKCE code_challenge_method must be S256.");
    }
    const codeChallenge = exactString(url.searchParams.get("code_challenge"), "code_challenge");
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
      throw appError("invalid_request", "The PKCE code challenge is malformed.");
    }
    const resource = url.searchParams.get("resource") ?? `${origin}/mcp`;
    if (resource !== `${origin}/mcp`) {
      throw appError("invalid_target", "The OAuth resource must be this Swarmbook server's /mcp endpoint.");
    }
    const scope = url.searchParams.get("scope") ?? MCP_SCOPE;
    if (scope.split(/\s+/).some((item) => item !== MCP_SCOPE)) {
      throw appError("invalid_scope", `Swarmbook supports only the ${MCP_SCOPE} scope.`);
    }
    const id = randomId(18);
    this.pending.set(id, {
      id,
      clientId,
      clientName: client.clientName,
      redirectUri,
      state: url.searchParams.get("state") ?? undefined,
      codeChallenge,
      resource,
      scope,
      expiresAt: this.now() + AUTHORIZATION_TTL_MS,
    });
    return {
      requestId: id,
      clientName: client.clientName,
      redirectOrigin: new URL(redirectUri).origin,
    };
  }

  authorizationPrompt(requestId: string): AuthorizationPrompt | undefined {
    this.cleanExpired();
    const request = this.pending.get(requestId);
    if (!request) return undefined;
    return {
      requestId,
      clientName: request.clientName,
      redirectOrigin: new URL(request.redirectUri).origin,
    };
  }

  approveAuthorization(requestId: string, owner: OwnerIdentity): string {
    this.cleanExpired();
    const request = this.pending.get(requestId);
    if (!request) throw appError("authorization_expired", "This authorization request expired. Return to the MCP client and retry.", 410);
    this.pending.delete(requestId);
    const code = randomId();
    this.codes.set(code, {
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      resource: request.resource,
      scope: request.scope,
      owner,
      expiresAt: this.now() + AUTHORIZATION_TTL_MS,
    });
    const callback = new URL(request.redirectUri);
    callback.searchParams.set("code", code);
    if (request.state) callback.searchParams.set("state", request.state);
    return callback.toString();
  }

  exchangeToken(input: URLSearchParams, origin: string): Response {
    this.cleanExpired();
    if (input.get("grant_type") !== "authorization_code") {
      return oauthError("unsupported_grant_type", "Swarmbook supports only authorization_code.");
    }
    const codeValue = input.get("code") ?? "";
    const code = this.codes.get(codeValue);
    if (!code) return oauthError("invalid_grant", "The authorization code is invalid or expired.");
    const clientId = input.get("client_id") ?? "";
    const redirectUri = input.get("redirect_uri") ?? "";
    const verifier = input.get("code_verifier") ?? "";
    const resource = input.get("resource") ?? `${origin}/mcp`;
    const actualChallenge = createHash("sha256").update(verifier).digest("base64url");
    if (
      clientId !== code.clientId ||
      redirectUri !== code.redirectUri ||
      resource !== code.resource ||
      !safeEqual(actualChallenge, code.codeChallenge)
    ) {
      return oauthError("invalid_grant", "The authorization code, client, callback, resource, or PKCE verifier did not match.");
    }
    this.codes.delete(codeValue);
    return Response.json({
      access_token: this.service.createOwnerCredential(code.owner),
      token_type: "Bearer",
      scope: code.scope,
    }, { headers: { "cache-control": "no-store", pragma: "no-cache" } });
  }

  private cleanExpired(): void {
    const now = this.now();
    for (const [id, request] of this.pending) {
      if (request.expiresAt <= now) this.pending.delete(id);
    }
    for (const [code, request] of this.codes) {
      if (request.expiresAt <= now) this.codes.delete(code);
    }
  }
}

export function oauthJsonError(error: unknown): Response {
  const value = error as { code?: string; message?: string; status?: number };
  return oauthError(value.code ?? "server_error", value.message ?? "OAuth request failed.", value.status ?? 400);
}
