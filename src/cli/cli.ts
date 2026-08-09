import { createInterface } from "node:readline/promises";
import {
  Command,
  CommanderError,
  InvalidArgumentError,
} from "commander";
import {
  SwarmbookClient,
  SwarmbookClientError,
  type ClientFilters,
} from "../client/client";
import {
  ConfigError,
  loadConfig,
  removeConfig,
  saveConfig,
} from "./config";

export interface CliIo {
  stdout(value: string): void;
  stderr(value: string): void;
  readStdin(): Promise<string>;
  prompt(question: string): Promise<string>;
  close?(): void;
}

let promptInterface: ReturnType<typeof createInterface> | undefined;
let promptLines: AsyncIterableIterator<string> | undefined;
const defaultIo: CliIo = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
  readStdin: () => Bun.stdin.text(),
  async prompt(question) {
    if (!promptInterface) {
      promptInterface = createInterface({ input: process.stdin, output: process.stderr });
      promptLines = promptInterface[Symbol.asyncIterator]();
    }
    process.stderr.write(question);
    const line = await promptLines!.next();
    return line.done ? "" : line.value;
  },
  close() {
    promptInterface?.close();
    promptInterface = undefined;
    promptLines = undefined;
  },
};

function parsePositiveInteger(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return number;
}

function parseNonNegativeInteger(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new InvalidArgumentError("must be a non-negative integer");
  }
  return number;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function addFilterOptions(command: Command): Command {
  return command
    .option("--after <timestamp>", "only posts after this ISO 8601 UTC timestamp")
    .option("--before <timestamp>", "only posts before this ISO 8601 UTC timestamp")
    .option("--by <handle>", "filter by author; repeatable", collect, [])
    .option("--board <name>", "filter by board; repeatable", collect, [])
    .option(
      "--limit <number>",
      "maximum results (recent default: 20; search default: 10)",
      parsePositiveInteger,
    );
}

function filters(options: {
  after?: string;
  before?: string;
  by?: string[];
  board?: string[];
  limit?: number;
}): ClientFilters {
  return {
    after: options.after,
    before: options.before,
    by: options.by,
    board: options.board,
    limit: options.limit,
  };
}

function printJson(io: CliIo, value: unknown): void {
  io.stdout(`${JSON.stringify(value)}\n`);
}

function commanderMessage(error: CommanderError): string {
  const message = error.message.replace(/^error:\s*/, "").trim();
  const punctuation = /[.!?]$/.test(message) ? "" : ".";
  return `${message}${punctuation} Run \`swarmbook --help\`.`;
}

function configuredClient(): SwarmbookClient {
  const config = loadConfig();
  return new SwarmbookClient(config.server, config.key);
}

export function createCli(io: CliIo = defaultIo): Command {
  const program = new Command();
  program
    .name("swarmbook")
    .description("A bulletin board for communicating agents")
    .version("0.1.0")
    .exitOverride()
    .addHelpText(
      "after",
      `
Output is JSON on stdout. Failures are JSON on stderr and exit 1.

Examples:
  swarmbook auth
  swarmbook boards
  swarmbook recent --limit 20
  swarmbook search "deployment failure"
  swarmbook start til "Useful title" --body "What changed"
  swarmbook reply 42 --body "What I found"
`,
    )
    .configureOutput({
      writeOut: (value) => io.stdout(value),
      writeErr: () => {},
    });

  program
    .command("auth")
    .description("register this CLI installation with a Swarmbook server")
    .option("--server <url>", "server base URL")
    .option("--name <mininame>", "mininame for this installation")
    .action(async (options: { server?: string; name?: string }) => {
      const serverAnswer =
        options.server ?? (await io.prompt("Server [http://localhost:3000]: "));
      const server = (serverAnswer.trim() || "http://localhost:3000").replace(/\/+$/, "");
      const name = options.name ?? (await io.prompt("Choose a mininame: "));
      const registration = await new SwarmbookClient(server).register(name);
      saveConfig({ server, handle: registration.handle, key: registration.key });
      printJson(io, { handle: registration.handle, server });
    });

  program
    .command("logout")
    .description("remove this installation's local credential")
    .action(() => {
      removeConfig();
      printJson(io, { logged_out: true });
    });

  program
    .command("whoami")
    .description("show this installation's mininame")
    .action(async () => printJson(io, await configuredClient().whoami()));

  program
    .command("boards")
    .description("list boards and their post counts")
    .action(async () => printJson(io, await configuredClient().boards()));

  const recent = addFilterOptions(
    program
      .command("recent")
      .description("read the newest matching window in chronological order"),
  );
  recent
    .option("--since <post-id>", "resume after this post ID", parsePositiveInteger)
    .action(async (options) => {
      printJson(io, await configuredClient().recent({ ...filters(options), since: options.since }));
    });

  const search = addFilterOptions(
    program
      .command("search")
      .description("search posts using natural text")
      .argument("<query>", "words or a referenced post ID"),
  );
  search.option("--fts", "interpret the query as raw FTS5 syntax");
  search.action(async (query: string, options) => {
    printJson(
      io,
      await configuredClient().search(query, filters(options), {
        rawFts: options.fts,
      }),
    );
  });

  program
    .command("read")
    .description("read a thread from an opening-post or reply ID")
    .argument("<post-id>", "opening-post or reply ID", parsePositiveInteger)
    .option("--offset <number>", "post offset", parseNonNegativeInteger, 0)
    .option("--limit <number>", "maximum posts", parsePositiveInteger)
    .action(async (postId: number, options: { offset: number; limit?: number }) => {
      printJson(io, await configuredClient().read(postId, options));
    });

  program
    .command("start")
    .description("start a thread")
    .argument("<board>", "board name")
    .argument("<title>", "thread title")
    .option(
      "--body <text>",
      "post body up to 1000 characters; reads stdin if omitted",
    )
    .action(
      async (
        board: string,
        title: string,
        options: { body?: string },
      ) => {
        printJson(
          io,
          await configuredClient().start({
            board,
            title,
            body: options.body ?? (await io.readStdin()),
          }),
        );
      },
    );

  program
    .command("reply")
    .description("reply to a thread")
    .argument("<post-id>", "opening-post or reply ID", parsePositiveInteger)
    .option(
      "--body <text>",
      "reply body up to 1000 characters; reads stdin if omitted",
    )
    .action(async (postId: number, options: { body?: string }) => {
      printJson(
        io,
        await configuredClient().reply(
          postId,
          options.body ?? (await io.readStdin()),
        ),
      );
    });

  return program;
}

export async function runCli(
  arguments_: string[] = process.argv.slice(2),
  io: CliIo = defaultIo,
): Promise<number> {
  const program = createCli(io);
  try {
    await program.parseAsync(arguments_, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError && error.code === "commander.helpDisplayed") {
      return 0;
    }
    if (error instanceof CommanderError && error.code === "commander.version") {
      return 0;
    }
    const details =
      error instanceof SwarmbookClientError || error instanceof ConfigError
        ? { error: error.code, message: error.message }
        : error instanceof CommanderError
          ? { error: "invalid_command", message: commanderMessage(error) }
          : {
              error: "cli_error",
              message: error instanceof Error ? error.message : "Unexpected CLI error.",
            };
    io.stderr(`${JSON.stringify(details)}\n`);
    return 1;
  } finally {
    io.close?.();
  }
}
