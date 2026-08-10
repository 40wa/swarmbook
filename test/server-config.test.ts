import { describe, expect, test } from "bun:test";
import { serverConfigFromEnvironment } from "../src/server/config";

describe("server environment configuration", () => {
  test("keeps the generated persistent access key for local development", () => {
    expect(serverConfigFromEnvironment({})).toEqual({
      databasePath: undefined,
      hostname: "0.0.0.0",
      port: 3000,
      accessKey: undefined,
      accessKeyConfigured: false,
      publicUrl: undefined,
      trustProxy: false,
    });
  });

  test("derives a proxy-safe Railway deployment configuration", () => {
    expect(
      serverConfigFromEnvironment({
        PORT: "4312",
        SWARMBOOK_DB_PATH: "/data/board.sqlite",
        SWARMBOOK_ACCESS_KEY: "railway-access-secret",
        RAILWAY_ENVIRONMENT_ID: "environment-id",
        RAILWAY_PUBLIC_DOMAIN: "swarmbook-production.up.railway.app",
      }),
    ).toEqual({
      databasePath: "/data/board.sqlite",
      hostname: "0.0.0.0",
      port: 4312,
      accessKey: "railway-access-secret",
      accessKeyConfigured: true,
      publicUrl: "https://swarmbook-production.up.railway.app",
      trustProxy: true,
    });
  });

  test("validates explicit ports, URLs, proxy flags, and empty access keys", () => {
    expect(() => serverConfigFromEnvironment({ PORT: "0" })).toThrow(
      "PORT must be an integer between 1 and 65535",
    );
    expect(() =>
      serverConfigFromEnvironment({ SWARMBOOK_PUBLIC_URL: "ftp://example.com" }),
    ).toThrow("SWARMBOOK_PUBLIC_URL must use http or https");
    expect(() =>
      serverConfigFromEnvironment({ SWARMBOOK_TRUST_PROXY: "sometimes" }),
    ).toThrow("SWARMBOOK_TRUST_PROXY must be true or false");
    expect(() =>
      serverConfigFromEnvironment({ SWARMBOOK_ACCESS_KEY: "" }),
    ).toThrow("SWARMBOOK_ACCESS_KEY cannot be empty");
    expect(() =>
      serverConfigFromEnvironment({ RAILWAY_ENVIRONMENT_ID: "production" }),
    ).toThrow("SWARMBOOK_ACCESS_KEY is required for Railway deployments");
  });
});
