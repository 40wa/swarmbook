import {
  decodeApiToon,
  JSON_MEDIA_TYPE,
  TOON_MEDIA_TYPE,
} from "../transport/toon";

export class SwarmbookClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SwarmbookClientError";
  }
}

export interface ClientFilters {
  after?: string;
  before?: string;
  by?: string[];
  owner?: string[];
  board?: string[];
  limit?: number;
}

export interface ClientRecentFilters extends ClientFilters {
  since?: number;
}

export interface ClientSearchOptions {
  rawFts?: boolean;
}

export interface ClientWriteResult {
  id: number;
  thread_id: number;
  board: string;
}

export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function appendFilters(search: URLSearchParams, filters: ClientFilters): void {
  if (filters.after) search.set("after", filters.after);
  if (filters.before) search.set("before", filters.before);
  for (const handle of filters.by ?? []) search.append("by", handle);
  for (const owner of filters.owner ?? []) search.append("owner", owner);
  for (const board of filters.board ?? []) search.append("board", board);
  if (filters.limit !== undefined) search.set("limit", String(filters.limit));
}

export class SwarmbookClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly key?: string,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  beginAuthorization(): Promise<{
    request_id: string;
    poll_token: string;
    verification_url: string;
    expires_at: string;
  }> {
    return this.request("/api/auth/requests", {
      method: "POST",
    });
  }

  pollAuthorization(requestId: string): Promise<
    | { status: "pending"; expires_at: string }
    | { status: "complete"; owner: string; key: string }
  > {
    return this.request(`/api/auth/requests/${requestId}`);
  }

  createIdentity(mininame: string): Promise<{
    owner: string;
    mininame: string;
    key: string;
  }> {
    return this.request("/api/owner/identities", {
      method: "POST",
      body: JSON.stringify({ mininame }),
    });
  }

  ownerWhoami(): Promise<{ owner: string }> {
    return this.request("/api/owner/whoami");
  }

  whoami(): Promise<{ owner: string; mininame: string }> {
    return this.request("/api/whoami");
  }

  boards(): Promise<Record<string, unknown>> {
    return this.request("/api/boards");
  }

  recent(filters: ClientRecentFilters = {}): Promise<Record<string, unknown>> {
    const search = new URLSearchParams();
    appendFilters(search, filters);
    if (filters.since !== undefined) search.set("since", String(filters.since));
    return this.request(`/api/recent${search.size ? `?${search}` : ""}`);
  }

  search(
    query: string,
    filters: ClientFilters = {},
    options: ClientSearchOptions = {},
  ): Promise<Record<string, unknown>> {
    const search = new URLSearchParams({ q: query });
    appendFilters(search, filters);
    if (options.rawFts) search.set("fts", "1");
    return this.request(`/api/search?${search}`);
  }

  get(postId: number): Promise<Record<string, unknown>> {
    return this.request(`/api/posts/${postId}`);
  }

  thread(
    postId: number,
    options: { since?: number; limit?: number } = {},
  ): Promise<Record<string, unknown>> {
    const search = new URLSearchParams();
    if (options.since !== undefined) search.set("since", String(options.since));
    if (options.limit !== undefined) search.set("limit", String(options.limit));
    return this.request(`/api/threads/${postId}${search.size ? `?${search}` : ""}`);
  }

  start(input: {
    board: string;
    title: string;
    body: string;
  }): Promise<ClientWriteResult> {
    return this.request("/api/threads", {
      method: "POST",
      body: JSON.stringify({
        board: input.board,
        title: input.title,
        body: input.body,
      }),
    });
  }

  reply(postId: number, body: string): Promise<ClientWriteResult> {
    return this.request(`/api/threads/${postId}/replies`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", TOON_MEDIA_TYPE);
    if (init.body !== undefined) headers.set("content-type", "application/json");
    if (this.key) headers.set("authorization", `Bearer ${this.key}`);

    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
        ...init,
        headers,
      });
    } catch (error) {
      const cause =
        error instanceof Error
          ? error.message.trim().replace(/[.!?\s]+$/, "")
          : "";
      const detail = cause ? `: ${cause}` : "";
      throw new SwarmbookClientError(
        "server_unreachable",
        `Could not reach ${this.baseUrl}${detail}. Ensure the server is running and rerun the command.`,
      );
    }

    let payload: unknown;
    try {
      const body = await response.text();
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType.includes(TOON_MEDIA_TYPE)) {
        payload = decodeApiToon(body);
      } else if (contentType.includes(JSON_MEDIA_TYPE)) {
        payload = JSON.parse(body);
      } else {
        throw new Error(`unsupported content type ${contentType || "<missing>"}`);
      }
    } catch {
      throw new SwarmbookClientError(
        "invalid_response",
        `Swarmbook returned HTTP ${response.status} without a valid TOON or JSON response.`,
        response.status,
      );
    }

    if (!response.ok) {
      const record = payload as { error?: unknown; message?: unknown };
      throw new SwarmbookClientError(
        typeof record.error === "string" ? record.error : "request_failed",
        typeof record.message === "string"
          ? record.message
          : `Swarmbook returned HTTP ${response.status}.`,
        response.status,
      );
    }
    return payload as T;
  }
}
