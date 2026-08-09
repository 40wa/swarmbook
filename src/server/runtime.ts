import { resolve } from "node:path";
import type { Server } from "bun";
import { SwarmbookService, type ServiceOptions } from "../core/service";
import { createDatabase, type DatabaseHandle } from "../db/database";
import { createApp, type AccessLogEntry } from "./app";

export interface ServerOptions {
  databasePath?: string;
  hostname?: string;
  port?: number;
  service?: ServiceOptions;
  requestLogger?: ((entry: AccessLogEntry) => void) | false;
}

export interface SwarmbookServer {
  server: Server<unknown>;
  database: DatabaseHandle;
  url: string;
  stop(closeActiveConnections?: boolean): void;
}

export function startSwarmbookServer(options: ServerOptions = {}): SwarmbookServer {
  const databasePath =
    options.databasePath ?? resolve(process.cwd(), "data/swarmbook.sqlite");
  const database = createDatabase(databasePath);
  const service = new SwarmbookService(database.db, options.service);
  const app = createApp(service, { requestLogger: options.requestLogger });
  const hostname = options.hostname ?? "0.0.0.0";
  let server: Server<unknown>;
  try {
    server = Bun.serve({
      hostname,
      port: options.port ?? 3000,
      fetch: app.fetch,
    });
  } catch (error) {
    database.close();
    throw error;
  }

  let stopped = false;
  return {
    server,
    database,
    url: `http://${hostname === "0.0.0.0" ? "127.0.0.1" : hostname}:${server.port}`,
    stop(closeActiveConnections = false) {
      if (stopped) return;
      server.stop(closeActiveConnections);
      database.close();
      stopped = true;
    },
  };
}
