export const INTERNAL_CLIENT_IP_HEADER = "x-swarmbook-client-ip";

export interface PublicAuthRateLimitOptions {
  requests: number;
  windowMs: number;
  now?: () => number;
}

export interface RequestOriginOptions {
  publicUrl?: string;
  trustProxy?: boolean;
}

function firstHeaderValue(value: string | null): string | undefined {
  const first = value?.split(",", 1)[0]?.trim();
  return first || undefined;
}

export function externalOrigin(
  request: Request,
  options: RequestOriginOptions,
): string {
  if (options.publicUrl) return new URL(options.publicUrl).origin;
  if (options.trustProxy) {
    const protocol = firstHeaderValue(request.headers.get("x-forwarded-proto"));
    const host = firstHeaderValue(request.headers.get("x-forwarded-host"));
    if ((protocol === "http" || protocol === "https") && host) {
      try {
        return new URL(`${protocol}://${host}`).origin;
      } catch {
        // Fall through to the request URL when proxy headers are malformed.
      }
    }
  }
  return new URL(request.url).origin;
}

export function requestClientIp(
  request: Request,
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const forwarded = firstHeaderValue(request.headers.get("x-forwarded-for"));
    if (forwarded) return forwarded;
  }
  return request.headers.get(INTERNAL_CLIENT_IP_HEADER) ?? "unknown";
}

export function isPublicAuthPost(method: string, path: string): boolean {
  if (method.toUpperCase() !== "POST") return false;
  return path === "/login" ||
    path === "/api/auth/requests" ||
    /^\/auth\/cli\/[^/]+$/.test(path);
}

export function isBrowserMutation(method: string, path: string): boolean {
  const normalized = method.toUpperCase();
  return !path.startsWith("/api/") &&
    normalized !== "GET" &&
    normalized !== "HEAD" &&
    normalized !== "OPTIONS";
}

export class PublicAuthRateLimiter {
  private readonly now: () => number;
  private readonly buckets = new Map<string, { startedAt: number; count: number }>();

  constructor(private readonly options: PublicAuthRateLimitOptions) {
    if (!Number.isSafeInteger(options.requests) || options.requests < 1) {
      throw new Error("Public authentication rate-limit requests must be positive.");
    }
    if (!Number.isSafeInteger(options.windowMs) || options.windowMs < 1) {
      throw new Error("Public authentication rate-limit windowMs must be positive.");
    }
    this.now = options.now ?? Date.now;
  }

  consume(ip: string): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const now = this.now();
    const existing = this.buckets.get(ip);
    if (!existing || now - existing.startedAt >= this.options.windowMs) {
      this.buckets.set(ip, { startedAt: now, count: 1 });
      this.deleteExpired(now);
      return { allowed: true };
    }
    if (existing.count >= this.options.requests) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((existing.startedAt + this.options.windowMs - now) / 1_000),
        ),
      };
    }
    existing.count += 1;
    return { allowed: true };
  }

  private deleteExpired(now: number): void {
    if (this.buckets.size < 256) return;
    for (const [ip, bucket] of this.buckets) {
      if (now - bucket.startedAt >= this.options.windowMs) this.buckets.delete(ip);
    }
  }
}
