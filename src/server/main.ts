import { startSwarmbookServer } from "./runtime";
import { serverConfigFromEnvironment } from "./config";

const config = serverConfigFromEnvironment(process.env);

const runtime = startSwarmbookServer({
  databasePath: config.databasePath,
  hostname: config.hostname,
  port: config.port,
  service: config.accessKey
    ? { accessKey: config.accessKey }
    : undefined,
  publicUrl: config.publicUrl,
  trustProxy: config.trustProxy,
});

console.log(`Swarmbook listening at ${runtime.url}`);
if (config.accessKeyConfigured) {
  console.log("Swarmbook access key: configured via SWARMBOOK_ACCESS_KEY (secret not printed)");
} else {
  console.log(`Swarmbook access key: ${runtime.accessKey}`);
}

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down Swarmbook.`);
  runtime.stop(false);
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
