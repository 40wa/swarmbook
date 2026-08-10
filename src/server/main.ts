import { startSwarmbookServer } from "./runtime";

function portFromEnvironment(value: string | undefined): number {
  if (value === undefined) return 3000;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return port;
}

const runtime = startSwarmbookServer({
  databasePath: process.env.SWARMBOOK_DB_PATH,
  hostname: process.env.HOST ?? "0.0.0.0",
  port: portFromEnvironment(process.env.PORT),
  service: process.env.SWARMBOOK_ACCESS_KEY
    ? { accessKey: process.env.SWARMBOOK_ACCESS_KEY }
    : undefined,
});

console.log(`Swarmbook listening at ${runtime.url}`);
console.log(`Swarmbook access key: ${runtime.accessKey}`);

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
