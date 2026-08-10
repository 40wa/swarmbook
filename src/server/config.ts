export interface ServerEnvironment {
  [name: string]: string | undefined;
}

export interface ServerEnvironmentConfig {
  databasePath?: string;
  hostname: string;
  port: number;
  accessKey?: string;
  accessKeyConfigured: boolean;
  publicUrl?: string;
  trustProxy: boolean;
}

function portFromEnvironment(value: string | undefined): number {
  if (value === undefined) return 3000;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return port;
}

function booleanFromEnvironment(
  name: string,
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (value === undefined) return fallback;
  if (value === "1" || value.toLowerCase() === "true") return true;
  if (value === "0" || value.toLowerCase() === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function publicUrlFromEnvironment(environment: ServerEnvironment): string | undefined {
  const supplied = environment.SWARMBOOK_PUBLIC_URL;
  const derived = environment.RAILWAY_PUBLIC_DOMAIN
    ? `https://${environment.RAILWAY_PUBLIC_DOMAIN}`
    : undefined;
  const value = supplied ?? derived;
  if (!value) return undefined;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SWARMBOOK_PUBLIC_URL must be a valid absolute URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("SWARMBOOK_PUBLIC_URL must use http or https.");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("SWARMBOOK_PUBLIC_URL must contain only an http(s) origin.");
  }
  return url.origin;
}

export function serverConfigFromEnvironment(
  environment: ServerEnvironment,
): ServerEnvironmentConfig {
  const accessKey = environment.SWARMBOOK_ACCESS_KEY;
  if (accessKey !== undefined && !accessKey) {
    throw new Error("SWARMBOOK_ACCESS_KEY cannot be empty.");
  }
  if (environment.RAILWAY_ENVIRONMENT_ID !== undefined && accessKey === undefined) {
    throw new Error("SWARMBOOK_ACCESS_KEY is required for Railway deployments.");
  }

  return {
    databasePath: environment.SWARMBOOK_DB_PATH,
    hostname: environment.HOST ?? "0.0.0.0",
    port: portFromEnvironment(environment.PORT),
    accessKey,
    accessKeyConfigured: accessKey !== undefined,
    publicUrl: publicUrlFromEnvironment(environment),
    trustProxy: booleanFromEnvironment(
      "SWARMBOOK_TRUST_PROXY",
      environment.SWARMBOOK_TRUST_PROXY,
      environment.RAILWAY_ENVIRONMENT_ID !== undefined,
    ),
  };
}
