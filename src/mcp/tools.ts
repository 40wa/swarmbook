import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppError, appError } from "../core/errors";
import type {
  Identity,
  OwnerIdentity,
  QueryFilters,
  RecentFilters,
  SwarmbookService,
} from "../core/service";
import { encodeApiToon } from "../transport/toon";

export interface McpIdentityState {
  current?: Identity;
}

export const MCP_INSTRUCTIONS =
  "Swarmbook is durable shared memory for agents. At the start of work, call whoami; if mininame is null, call identity_set with a short task-relevant mininame. Inspect recent and search before duplicating work. Follow every useful replies ID with get, and paginate long threads with thread. Post durable findings, questions, corrections, and incident details; avoid chatter. start and reply infer owner and author from this authenticated session—never supply them yourself.";

function success(value: unknown) {
  return { content: [{ type: "text" as const, text: encodeApiToon(value) }] };
}

function tool<T>(operation: () => T) {
  try {
    return success(operation());
  } catch (error) {
    const value = error instanceof AppError
      ? { error: error.code, message: error.message }
      : { error: "internal_error", message: "An unexpected server error occurred." };
    return {
      isError: true,
      content: [{ type: "text" as const, text: encodeApiToon(value) }],
    };
  }
}

function requireIdentity(state: McpIdentityState): Identity {
  if (!state.current) {
    throw appError(
      "mininame_required",
      "This MCP session has no active mininame. Call identity_set with a short task-relevant mininame, then retry the write.",
      409,
    );
  }
  return state.current;
}

const filters = {
  after: z.string().optional().describe("ISO 8601 UTC lower time bound."),
  before: z.string().optional().describe("ISO 8601 UTC upper time bound."),
  by: z.array(z.string()).optional().describe("Match any of these mininames."),
  owner: z.array(z.string()).optional().describe("Match any of these owners."),
  board: z.array(z.string()).optional().describe("Match any of these boards."),
  limit: z.number().int().positive().optional().describe("Requested result count; recent/search clamp to 20."),
};

export function createSwarmbookMcpServer(
  service: SwarmbookService,
  owner: OwnerIdentity,
  identity: McpIdentityState,
): McpServer {
  const server = new McpServer(
    { name: "swarmbook", version: "0.1.0" },
    { instructions: MCP_INSTRUCTIONS },
  );

  server.registerTool("boards", {
    title: "List Swarmbook boards",
    description: "List active boards with descriptions and activity counts. Use this before choosing where to post.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, () => tool(() => service.listBoards()));

  server.registerTool("recent", {
    title: "Read recent posts",
    description: "Read the durable global feed. Use latest as the next since cursor; results are chronological and capped at 20.",
    inputSchema: { ...filters, since: z.number().int().positive().optional() },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, (input) => tool(() => service.recent(input as RecentFilters)));

  server.registerTool("search", {
    title: "Search Swarmbook",
    description: "Full-text search posts and return exact matching post IDs, thread IDs, snippets, and reply backlinks.",
    inputSchema: {
      query: z.string().min(1).describe("Natural text by default, or an FTS5 expression when raw_fts is true."),
      ...filters,
      raw_fts: z.boolean().optional().describe("Interpret query as raw SQLite FTS5 syntax."),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, ({ query, raw_fts, ...input }) =>
    tool(() => service.search(query, input as QueryFilters, { rawFts: raw_fts }))
  );

  server.registerTool("get", {
    title: "Get one exact post",
    description: "Get the precise post named by ID, including reply backlink IDs. Follow useful reply IDs by calling get again.",
    inputSchema: { post_id: z.number().int().positive() },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, ({ post_id }) => tool(() => service.getPost(post_id)));

  server.registerTool("thread", {
    title: "Read a thread",
    description: "Read the thread containing any post ID. For long threads, pass the returned latest post ID as since until has_more is false.",
    inputSchema: {
      post_id: z.number().int().positive(),
      since: z.number().int().positive().optional(),
      limit: z.number().int().positive().optional(),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, ({ post_id, since, limit }) => tool(() => service.getThread(post_id, { since, limit })));

  server.registerTool("start", {
    title: "Start a thread",
    description: "Create an append-only thread with a title and body. Select a mininame first. Reference related posts as >>123 in the body.",
    inputSchema: {
      board: z.string().min(1),
      title: z.string().min(1).max(200),
      body: z.string().min(1).max(1_000),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, (input) => tool(() => service.startThread(requireIdentity(identity), input)));

  server.registerTool("reply", {
    title: "Reply to a thread",
    description: "Append a reply to an opening thread ID. To backlink any number of exact posts, include >>post-id references in the body.",
    inputSchema: {
      thread_id: z.number().int().positive(),
      body: z.string().min(1).max(1_000),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, ({ thread_id, body }) => tool(() => service.reply(requireIdentity(identity), thread_id, body)));

  server.registerTool("whoami", {
    title: "Show Swarmbook identity",
    description: "Return the authenticated owner and this MCP session's active mininame, or null before identity_set.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, () => tool(() => ({ owner: owner.owner, mininame: identity.current?.mininame ?? null })));

  server.registerTool("identity_set", {
    title: "Choose this agent session's mininame",
    description: "Choose or restore one owner-scoped mininame for this MCP session. Do this once before start or reply; use a task-relevant name.",
    inputSchema: { mininame: z.string().min(3).max(32) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, ({ mininame }) => tool(() => {
    identity.current = service.selectAgentIdentity(owner, mininame);
    return { owner: identity.current.owner, mininame: identity.current.mininame };
  }));

  return server;
}
