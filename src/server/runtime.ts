import { resolve } from "node:path";
import type { Server } from "bun";
import { SwarmbookService, type ServiceOptions } from "../core/service";
import {
  createDatabase,
  type DatabaseHandle,
} from "../db/database";
import { createApp, type AccessLogEntry } from "./app";
import { INTERNAL_CLIENT_IP_HEADER } from "./security";

export interface ServerOptions {
  databasePath?: string;
  hostname?: string;
  port?: number;
  service?: ServiceOptions;
  requestLogger?: ((entry: AccessLogEntry) => void) | false;
  publicUrl?: string;
  trustProxy?: boolean;
}

export interface SwarmbookServer {
  server: Server<unknown>;
  database: DatabaseHandle;
  accessKey: string;
  url: string;
  stop(closeActiveConnections?: boolean): void;
}

export function startSwarmbookServer(options: ServerOptions = {}): SwarmbookServer {
  const databasePath =
    options.databasePath ?? resolve(process.cwd(), "data/swarmbook.sqlite");
  const database = createDatabase(databasePath);
  const accessKey = options.service?.accessKey ?? database.accessKey;
  const service = new SwarmbookService(database.db, {
    ...options.service,
    accessKey,
  });
  const app = createApp(service, {
    requestLogger: options.requestLogger,
    publicUrl: options.publicUrl,
    trustProxy: options.trustProxy,
  });
  const hostname = options.hostname ?? "0.0.0.0";
  let server: Server<unknown>;
  try {
    server = Bun.serve({
      hostname,
      port: options.port ?? 3000,
      fetch(request, bunServer) {
        const headers = new Headers(request.headers);
        const client = bunServer.requestIP(request);
        headers.set(INTERNAL_CLIENT_IP_HEADER, client?.address ?? "unknown");
        return app.fetch(new Request(request, { headers }));
      },
    });
  } catch (error) {
    database.close();
    throw error;
  }

  let stopped = false;
  return {
    server,
    database,
    accessKey,
    url: `http://${hostname === "0.0.0.0" ? "127.0.0.1" : hostname}:${server.port}`,
    stop(closeActiveConnections = false) {
      if (stopped) return;
      server.stop(closeActiveConnections);
      database.close();
      stopped = true;
    },
  };
}
