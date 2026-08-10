import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SwarmbookService } from "../src/core/service";
import type { DatabaseHandle } from "../src/db/database";
import { createDatabase } from "../src/db/database";
import { createApp } from "../src/server/app";
import { decodeApiToon } from "../src/transport/toon";

let database: DatabaseHandle;
let service: SwarmbookService;
let now: number;

beforeEach(() => {
  now = Date.parse("2026-08-10T12:00:00.000Z");
  database = createDatabase(":memory:");
  service = new SwarmbookService(database.db, {
    accessKey: "deployment-access-key",
    now: () => now,
  });
});

afterEach(() => database.close());

function productionApp(rateLimit = 120) {
  return createApp(service, {
    requestLogger: false,
    publicUrl: "https://swarmbook-production.up.railway.app",
    trustProxy: true,
    publicAuthRateLimit: {
      requests: rateLimit,
      windowMs: 60_000,
      now: () => now,
    },
  });
}

function proxyHeaders(ip = "203.0.113.10"): Record<string, string> {
  return {
    origin: "https://swarmbook-production.up.railway.app",
    "x-forwarded-for": ip,
    "x-forwarded-host": "swarmbook-production.up.railway.app",
    "x-forwarded-proto": "https",
  };
}

async function toon(response: Response): Promise<Record<string, any>> {
  return decodeApiToon(await response.text()) as Record<string, any>;
}

describe("internet-facing server boundary", () => {
  test("constructs public authorization URLs and secure owner cookies", async () => {
    const app = productionApp();
    const startedResponse = await app.request("/api/auth/requests", {
      method: "POST",
      headers: proxyHeaders(),
    });
    const started = await toon(startedResponse);
    expect(started.verification_url).toBe(
      `https://swarmbook-production.up.railway.app/auth/cli/${started.request_id}`,
    );

    const completed = await app.request(`/auth/cli/${started.request_id}`, {
      method: "POST",
      headers: {
        ...proxyHeaders(),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        owner: "alex",
        access_key: "deployment-access-key",
      }),
    });
    expect(completed.status).toBe(200);
    expect(completed.headers.get("set-cookie")).toContain("HttpOnly");
    expect(completed.headers.get("set-cookie")).toContain("Secure");
    expect(completed.headers.get("cache-control")).toBe("no-store");
    expect(completed.headers.get("x-content-type-options")).toBe("nosniff");
    expect(completed.headers.get("x-frame-options")).toBe("DENY");
    expect(completed.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
    expect(completed.headers.get("strict-transport-security")).toContain("max-age=");
  });

  test("rejects cross-origin browser mutations before checking the access key", async () => {
    const app = productionApp();
    const started = await toon(
      await app.request("/api/auth/requests", {
        method: "POST",
        headers: proxyHeaders(),
      }),
    );
    const response = await app.request(`/auth/cli/${started.request_id}`, {
      method: "POST",
      headers: {
        ...proxyHeaders(),
        origin: "https://attacker.example",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        owner: "alex",
        access_key: "deployment-access-key",
      }),
    });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("cross_origin_request");
  });

  test("accepts a matching Origin even when the proxy classifies it as same-site", async () => {
    const app = productionApp();
    const started = await toon(
      await app.request("/api/auth/requests", {
        method: "POST",
        headers: proxyHeaders(),
      }),
    );
    const response = await app.request(`/auth/cli/${started.request_id}`, {
      method: "POST",
      headers: {
        ...proxyHeaders(),
        "sec-fetch-site": "same-site",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        owner: "alex",
        access_key: "deployment-access-key",
      }),
    });
    expect(response.status).toBe(200);
  });

  test("falls back to Fetch Metadata when Chrome sends a null Origin", async () => {
    const app = productionApp();
    const accepted = await app.request("/login", {
      method: "POST",
      headers: {
        ...proxyHeaders(),
        origin: "null",
        "sec-fetch-site": "same-origin",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        owner: "alex",
        access_key: "deployment-access-key",
      }),
    });
    expect(accepted.status).toBe(302);

    const rejected = await app.request("/login", {
      method: "POST",
      headers: {
        ...proxyHeaders("203.0.113.11"),
        origin: "null",
        "sec-fetch-site": "cross-site",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        owner: "mallory",
        access_key: "deployment-access-key",
      }),
    });
    expect(rejected.status).toBe(403);
    expect(await rejected.text()).toContain("cross_origin_request");
  });

  test("shares a 120-per-minute IP bucket across public authentication POSTs", async () => {
    const app = productionApp(2);
    expect(
      await app.request("/api/auth/requests", {
        method: "POST",
        headers: proxyHeaders(),
      }),
    ).toHaveProperty("status", 201);
    expect(
      await app.request("/login", {
        method: "POST",
        headers: {
          ...proxyHeaders(),
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ owner: "alex", access_key: "wrong" }),
      }),
    ).toHaveProperty("status", 401);

    const limited = await app.request("/api/auth/requests", {
      method: "POST",
      headers: proxyHeaders(),
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(await toon(limited)).toEqual({
      error: "rate_limited",
      message: "Public authentication is limited to 2 requests per minute per IP. Retry later.",
    });

    const otherIp = await app.request("/api/auth/requests", {
      method: "POST",
      headers: proxyHeaders("203.0.113.11"),
    });
    expect(otherIp.status).toBe(201);

    now += 60_000;
    const reset = await app.request("/api/auth/requests", {
      method: "POST",
      headers: proxyHeaders(),
    });
    expect(reset.status).toBe(201);
  });

  test("rejects oversized fixed-length and streamed request bodies", async () => {
    const app = productionApp();
    const oversized = "x".repeat(17 * 1024);
    const formResponse = await app.request("/login", {
      method: "POST",
      headers: {
        ...proxyHeaders(),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: oversized,
    });
    expect(formResponse.status).toBe(413);
    expect(await formResponse.text()).toContain("payload_too_large");

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(oversized));
        controller.close();
      },
    });
    const apiResponse = await app.request("/api/auth/requests", {
      method: "POST",
      headers: proxyHeaders("203.0.113.12"),
      body: stream,
      // Bun supports the Fetch streaming request extension.
      duplex: "half",
    } as RequestInit);
    expect(apiResponse.status).toBe(413);
    expect(await toon(apiResponse)).toMatchObject({ error: "payload_too_large" });
  });
});
