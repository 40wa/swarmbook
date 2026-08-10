import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface SavedAgentIdentity {
  key: string;
}

export interface CliConfig {
  version: 3;
  server: string;
  owner: string;
  ownerKey: string;
}

export interface WorktreeIdentityConfig {
  version: 1;
  server: string;
  owner: string;
  worktree: string;
  active?: string;
  identities: Record<string, SavedAgentIdentity>;
}

interface LegacyCliConfig {
  version: 2;
  server: string;
  owner: string;
  ownerKey: string;
  active?: string;
  identities: Record<string, SavedAgentIdentity>;
}

export class ConfigError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

export function configPath(): string {
  const home = process.env.HOME || homedir();
  return join(home, ".swarmbook", "config.json");
}

export function currentWorktree(cwd = process.cwd()): string {
  const result = Bun.spawnSync({
    cmd: ["git", "rev-parse", "--show-toplevel"],
    cwd,
    stdout: "pipe",
    stderr: "ignore",
  });
  const root = result.exitCode === 0 ? result.stdout.toString().trim() : "";
  return resolve(root || cwd);
}

export function worktreeIdentityPath(
  worktree = currentWorktree(),
  path = configPath(),
): string {
  const id = createHash("sha256").update(worktree).digest("hex").slice(0, 24);
  return join(dirname(path), "identities", `${id}.json`);
}

function isIdentityRecord(value: unknown): value is Record<string, SavedAgentIdentity> {
  return Boolean(
    value &&
      typeof value === "object" &&
      Object.values(value).every(
        (identity) =>
          identity &&
          typeof identity === "object" &&
          typeof (identity as Partial<SavedAgentIdentity>).key === "string",
      ),
  );
}

function writePrivateJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function invalidConfig(path: string): ConfigError {
  return new ConfigError(
    "invalid_config",
    `The configuration at ${path} is obsolete or invalid. Run \`swarmbook auth\` to replace it.`,
  );
}

export function loadConfig(path = configPath()): CliConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new ConfigError("not_authenticated", "Run `swarmbook auth` first.");
    }
    throw new ConfigError(
      "invalid_config",
      `Could not read ${path}. Run \`swarmbook auth\` to replace it.`,
    );
  }
  const candidate = parsed as
    | {
        version?: unknown;
        server?: unknown;
        owner?: unknown;
        ownerKey?: unknown;
        active?: unknown;
        identities?: unknown;
      }
    | undefined;
  if (
    !candidate ||
    typeof candidate.server !== "string" ||
    typeof candidate.owner !== "string" ||
    typeof candidate.ownerKey !== "string"
  ) {
    throw invalidConfig(path);
  }
  if (candidate.version === 3) {
    return candidate as unknown as CliConfig;
  }
  if (
    candidate.version === 2 &&
    (candidate.active === undefined || typeof candidate.active === "string") &&
    isIdentityRecord(candidate.identities)
  ) {
    const migrated: CliConfig = {
      version: 3,
      server: candidate.server,
      owner: candidate.owner,
      ownerKey: candidate.ownerKey,
    };
    saveConfig(migrated, path);
    if (candidate.active || Object.keys(candidate.identities).length > 0) {
      saveWorktreeIdentity(
        migrated,
        {
          version: 1,
          server: migrated.server,
          owner: migrated.owner,
          worktree: currentWorktree(),
          active: candidate.active,
          identities: candidate.identities,
        },
        currentWorktree(),
        path,
      );
    }
    return migrated;
  }
  throw invalidConfig(path);
}

export function loadWorktreeIdentity(
  config: CliConfig,
  worktree = currentWorktree(),
  path = configPath(),
): WorktreeIdentityConfig {
  const identityPath = worktreeIdentityPath(worktree, path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(identityPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        version: 1,
        server: config.server,
        owner: config.owner,
        worktree,
        identities: {},
      };
    }
    throw new ConfigError(
      "invalid_identity_config",
      `Could not read ${identityPath}. Remove it and run \`swarmbook identity set <mininame>\`.`,
    );
  }
  const candidate = parsed as Partial<WorktreeIdentityConfig> | undefined;
  if (
    !candidate ||
    candidate.version !== 1 ||
    candidate.server !== config.server ||
    candidate.owner !== config.owner ||
    candidate.worktree !== worktree ||
    (candidate.active !== undefined && typeof candidate.active !== "string") ||
    !isIdentityRecord(candidate.identities)
  ) {
    return {
      version: 1,
      server: config.server,
      owner: config.owner,
      worktree,
      identities: {},
    };
  }
  return candidate as WorktreeIdentityConfig;
}

export function saveWorktreeIdentity(
  config: CliConfig,
  identity: WorktreeIdentityConfig,
  worktree = currentWorktree(),
  path = configPath(),
): void {
  if (
    identity.server !== config.server ||
    identity.owner !== config.owner ||
    identity.worktree !== worktree
  ) {
    throw new ConfigError(
      "invalid_identity_config",
      "Refusing to save an agent identity for a different owner or worktree.",
    );
  }
  writePrivateJson(worktreeIdentityPath(worktree, path), identity);
}

export function activeIdentity(config: CliConfig): { mininame: string; key: string } {
  const worktreeIdentity = loadWorktreeIdentity(config);
  const identity = worktreeIdentity.active
    ? worktreeIdentity.identities[worktreeIdentity.active]
    : undefined;
  if (!worktreeIdentity.active || !identity) {
    throw new ConfigError(
      "identity_required",
      "No identity exists for this worktree. Run `swarmbook identity set <mininame>`.",
    );
  }
  return { mininame: worktreeIdentity.active, key: identity.key };
}

export function saveConfig(config: CliConfig, path = configPath()): void {
  writePrivateJson(path, config);
}

export function removeConfig(path = configPath()): void {
  rmSync(path, { force: true });
  rmSync(join(dirname(path), "identities"), { recursive: true, force: true });
}
