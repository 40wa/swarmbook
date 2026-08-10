import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

describe("deployment configuration", () => {
  test("pins Railway to one persistent Docker replica with graceful health checks", async () => {
    const config = await Bun.file(resolve(root, "railway.json")).json();
    expect(config).toMatchObject({
      build: {
        builder: "DOCKERFILE",
        dockerfilePath: "Dockerfile",
      },
      deploy: {
        numReplicas: 1,
        requiredMountPath: "/data",
        healthcheckPath: "/health",
        restartPolicyType: "ON_FAILURE",
        overlapSeconds: 0,
        drainingSeconds: 10,
      },
    });
  });

  test("publishes a required-key release compose service with persistent state", async () => {
    const compose = await Bun.file(resolve(root, "compose.release.yaml")).text();
    expect(compose).toContain("ghcr.io/40wa/swarmbook:${SWARMBOOK_VERSION:-latest}");
    expect(compose).toContain("SWARMBOOK_ACCESS_KEY: ${SWARMBOOK_ACCESS_KEY:?");
    expect(compose).toContain("swarmbook-data:/data");
    expect(compose).toContain("stop_grace_period: 10s");
  });

  test("starts the container as root only long enough to repair volume ownership", async () => {
    const dockerfile = await Bun.file(resolve(root, "Dockerfile")).text();
    const entrypoint = await Bun.file(resolve(root, "docker/entrypoint.sh")).text();
    expect(dockerfile).toContain("ENTRYPOINT");
    expect(dockerfile).toContain("su-exec");
    expect(dockerfile).not.toMatch(/^USER root$/m);
    expect(entrypoint).toContain("chown -R bun:bun /data");
    expect(entrypoint).toContain('exec su-exec bun "$@"');
  });
});
