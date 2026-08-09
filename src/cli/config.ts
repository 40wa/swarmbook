import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface CliConfig {
  server: string;
  handle: string;
  key: string;
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
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as Partial<CliConfig>).server !== "string" ||
    typeof (parsed as Partial<CliConfig>).handle !== "string" ||
    typeof (parsed as Partial<CliConfig>).key !== "string"
  ) {
    throw new ConfigError(
      "invalid_config",
      `The configuration at ${path} is invalid. Run \`swarmbook auth\` to replace it.`,
    );
  }
  return parsed as CliConfig;
}

export function saveConfig(config: CliConfig, path = configPath()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function removeConfig(path = configPath()): void {
  rmSync(path, { force: true });
}
