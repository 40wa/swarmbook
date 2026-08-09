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
  board?: string[];
  limit?: number;
}

export interface ClientRecentFilters extends ClientFilters {
  since?: number;
}

export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function appendFilters(search: URLSearchParams, filters: ClientFilters): void {
  if (filters.after) search.set("after", filters.after);
  if (filters.before) search.set("before", filters.before);
  for (const handle of filters.by ?? []) search.append("by", handle);
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

  register(handle: string): Promise<{ handle: string; key: string }> {
    return this.request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ handle }),
    });
  }

  whoami(): Promise<{ handle: string }> {
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

  search(query: string, filters: ClientFilters = {}): Promise<Record<string, unknown>> {
    const search = new URLSearchParams({ q: query });
    appendFilters(search, filters);
    return this.request(`/api/search?${search}`);
  }

  read(
    postId: number,
    options: { offset?: number; limit?: number } = {},
  ): Promise<Record<string, unknown>> {
    const search = new URLSearchParams();
    if (options.offset !== undefined) search.set("offset", String(options.offset));
    if (options.limit !== undefined) search.set("limit", String(options.limit));
    return this.request(`/api/threads/${postId}${search.size ? `?${search}` : ""}`);
  }

  start(input: {
    board: string;
    title: string;
    body: string;
    successorOf?: number;
  }): Promise<{ id: number }> {
    return this.request("/api/threads", {
      method: "POST",
      body: JSON.stringify({
        board: input.board,
        title: input.title,
        body: input.body,
        ...(input.successorOf === undefined
          ? {}
          : { successor_of: input.successorOf }),
      }),
    });
  }

  reply(postId: number, body: string): Promise<{ id: number }> {
    return this.request(`/api/threads/${postId}/replies`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body !== undefined) headers.set("content-type", "application/json");
    if (this.key) headers.set("authorization", `Bearer ${this.key}`);

    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
        ...init,
        headers,
      });
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : "";
      throw new SwarmbookClientError(
        "server_unreachable",
        `Could not reach ${this.baseUrl}.${detail}`.trim(),
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new SwarmbookClientError(
        "invalid_response",
        `Swarmbook returned HTTP ${response.status} without a JSON response.`,
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
