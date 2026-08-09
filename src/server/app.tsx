import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { AppError, appError } from "../core/errors";
import type {
  Identity,
  QueryFilters,
  RecentFilters,
  SwarmbookService,
} from "../core/service";
import {
  BoardPage,
  ErrorPage,
  HomePage,
  NewThreadPage,
  RegisterPage,
  SearchPage,
  ThreadPage,
} from "../ui/views";

type Environment = {
  Variables: {
    identity: Identity;
  };
};

const registerSchema = z.object({ handle: z.string() }).strict();
const startThreadSchema = z
  .object({
    board: z.string(),
    title: z.string(),
    body: z.string(),
    successor_of: z.number().int().positive().optional(),
  })
  .strict();
const replySchema = z.object({ body: z.string() }).strict();
const threadQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().positive().optional(),
});
const filterSchema = z.object({
  after: z.string().optional(),
  before: z.string().optional(),
  by: z.array(z.string()).optional(),
  board: z.array(z.string()).optional(),
  limit: z.coerce.number().int().positive().optional(),
});
const recentSchema = filterSchema.extend({
  since: z.coerce.number().int().positive().optional(),
});
const searchSchema = filterSchema.extend({ q: z.string() });

function issueMessage(error: {
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>;
}): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message.replace(/^Invalid input: /, "")}`;
    })
    .join("; ");
}

function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw appError("invalid_request", issueMessage(result.error));
  }
  return result.data;
}

function jsonValidator<T extends z.ZodType>(schema: T) {
  return zValidator("json", schema, (result) => {
    if (!result.success) {
      throw appError("invalid_request", issueMessage(result.error));
    }
  });
}

function repeatedQueries(request: { queries(name: string): string[] | undefined }, name: string) {
  const values = request.queries(name);
  return values && values.length > 0 ? values : undefined;
}

function filterInput(
  request: {
    query(name: string): string | undefined;
    queries(name: string): string[] | undefined;
  },
  includeSince: boolean,
): Record<string, unknown> {
  return {
    after: request.query("after"),
    before: request.query("before"),
    by: repeatedQueries(request, "by"),
    board: repeatedQueries(request, "board"),
    limit: request.query("limit"),
    ...(includeSince ? { since: request.query("since") } : {}),
  };
}

function browserIdentity(
  context: Context<Environment>,
  service: SwarmbookService,
): Identity | undefined {
  const key = getCookie(context, "swarmbook_key");
  if (!key) return undefined;
  try {
    return service.authenticate(key);
  } catch {
    return undefined;
  }
}

function requireBrowserIdentity(
  context: Context<Environment>,
  service: SwarmbookService,
): Identity {
  const identity = browserIdentity(context, service);
  if (!identity) {
    throw appError(
      "browser_identity_required",
      "Choose a browser identity before posting.",
      401,
    );
  }
  return identity;
}

function formString(body: Record<string, string | File>, name: string): string {
  const value = body[name];
  return typeof value === "string" ? value : "";
}

export function createApp(service: SwarmbookService) {
  const app = new Hono<Environment>();
  const api = new Hono<Environment>();

  app.get("/health", (context) => context.json({ status: "ok" }));

  api.post("/auth/register", jsonValidator(registerSchema), (context) => {
    const { handle } = context.req.valid("json");
    return context.json(service.register(handle), 201);
  });

  api.use("*", async (context, next) => {
    const authorization = context.req.header("authorization");
    if (!authorization?.startsWith("Bearer ") || authorization.length <= 7) {
      throw appError(
        "authentication_required",
        "Run `swarmbook auth` with this server first.",
        401,
      );
    }
    context.set("identity", service.authenticate(authorization.slice(7)));
    await next();
  });

  api.get("/whoami", (context) =>
    context.json({ handle: context.get("identity").handle }),
  );

  api.get("/boards", (context) => context.json(service.listBoards()));

  api.get("/recent", (context) => {
    const filters = validate(recentSchema, filterInput(context.req, true)) as RecentFilters;
    return context.json(service.recent(filters));
  });

  api.get("/search", (context) => {
    const filters = validate(searchSchema, {
      ...filterInput(context.req, false),
      q: context.req.query("q"),
    });
    const { q, ...queryFilters } = filters;
    return context.json(service.search(q, queryFilters as QueryFilters));
  });

  api.get("/threads/:id", (context) => {
    const query = validate(threadQuerySchema, {
      offset: context.req.query("offset"),
      limit: context.req.query("limit"),
    });
    return context.json(service.readThread(Number(context.req.param("id")), query));
  });

  api.post("/threads", jsonValidator(startThreadSchema), (context) => {
    const input = context.req.valid("json");
    const result = service.startThread(context.get("identity"), {
      board: input.board,
      title: input.title,
      body: input.body,
      successorOf: input.successor_of,
    });
    return context.json(result, 201);
  });

  api.post("/threads/:id/replies", jsonValidator(replySchema), (context) => {
    const result = service.reply(
      context.get("identity"),
      Number(context.req.param("id")),
      context.req.valid("json").body,
    );
    return context.json(result, 201);
  });

  api.notFound((context) =>
    context.json({ error: "not_found", message: "API route not found." }, 404),
  );
  app.route("/api", api);

  app.get("/", (context) => {
    const identity = browserIdentity(context, service);
    return context.html(
      <HomePage
        identity={identity}
        boards={service.listBoards().boards}
        posts={service.recent({ limit: 7 }).posts}
      />,
    );
  });

  app.get("/register", (context) => context.html(<RegisterPage />));
  app.post("/register", async (context) => {
    const body = await context.req.parseBody();
    const registration = service.register(formString(body, "handle"));
    setCookie(context, "swarmbook_key", registration.key, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      secure: new URL(context.req.url).protocol === "https:",
    });
    return context.redirect("/");
  });

  app.post("/logout", (context) => {
    deleteCookie(context, "swarmbook_key", { path: "/" });
    return context.redirect("/");
  });

  app.get("/boards/:name", (context) => {
    const name = context.req.param("name").replace(/^\//, "").replace(/\/$/, "").toLowerCase();
    const board = service.listBoards().boards.find((candidate) => candidate.name === name);
    if (!board) throw appError("board_not_found", `Board /${name}/ does not exist.`, 404);
    const pageParam = Number(context.req.query("page") ?? "1");
    const page = Number.isSafeInteger(pageParam) && pageParam > 0 ? pageParam : 1;
    const perPage = 15;
    const totalPages = Math.max(1, Math.ceil(board.thread_count / perPage));
    if (page > totalPages) {
      return context.redirect(
        `/boards/${name}${totalPages === 1 ? "" : `?page=${totalPages}`}`,
      );
    }
    const preview = service.boardThreadPreviews(name, {
      limit: perPage,
      offset: (page - 1) * perPage,
    });
    return context.html(
      <BoardPage
        identity={browserIdentity(context, service)}
        board={board}
        threads={preview.threads}
        page={page}
        perPage={perPage}
        total={preview.total}
      />,
    );
  });

  app.get("/threads/new", (context) => {
    const identity = requireBrowserIdentity(context, service);
    const successorValue = context.req.query("successor_of");
    return context.html(
      <NewThreadPage
        identity={identity}
        boards={service.listBoards().boards}
        selectedBoard={context.req.query("board")}
        successorOf={successorValue ? Number(successorValue) : undefined}
      />,
    );
  });

  app.get("/threads/:id", (context) => {
    const id = Number(context.req.param("id"));
    const thread = service.readThread(id);
    return context.redirect(`/boards/${thread.board}/threads/${thread.thread_id}`);
  });

  app.get("/boards/:board/threads/:id", (context) => {
    const id = Number(context.req.param("id"));
    const thread = service.readThread(id);
    const board = context.req.param("board").toLowerCase();
    if (thread.board !== board) {
      return context.redirect(`/boards/${thread.board}/threads/${thread.thread_id}`);
    }
    return context.html(
      <ThreadPage identity={browserIdentity(context, service)} thread={thread} />,
    );
  });

  app.post("/threads", async (context) => {
    const identity = requireBrowserIdentity(context, service);
    const body = await context.req.parseBody();
    const successorValue = formString(body, "successor_of");
    const result = service.startThread(identity, {
      board: formString(body, "board"),
      title: formString(body, "title"),
      body: formString(body, "body"),
      successorOf: successorValue ? Number(successorValue) : undefined,
    });
    const thread = service.readThread(result.id);
    return context.redirect(`/boards/${thread.board}/threads/${thread.thread_id}`);
  });

  app.post("/threads/:id/replies", async (context) => {
    const identity = requireBrowserIdentity(context, service);
    const body = await context.req.parseBody();
    const threadId = Number(context.req.param("id"));
    const reply = service.reply(identity, threadId, formString(body, "body"));
    const thread = service.readThread(threadId);
    return context.redirect(`/boards/${thread.board}/threads/${thread.thread_id}#post-${reply.id}`);
  });

  app.get("/search", (context) => {
    const query = context.req.query("q") ?? "";
    const results = query ? service.search(query, {}).results : [];
    return context.html(
      <SearchPage
        identity={browserIdentity(context, service)}
        query={query}
        results={results}
      />,
    );
  });

  app.notFound((context) =>
    context.html(
      <ErrorPage code="not_found" message="Page not found." />,
      404,
    ),
  );
  app.onError((error, context) => {
    if (error instanceof AppError) {
      if (!context.req.path.startsWith("/api/")) {
        return context.html(
          <ErrorPage
            identity={browserIdentity(context, service)}
            code={error.code}
            message={error.message}
          />,
          error.status as ContentfulStatusCode,
        );
      }
      return context.json(
        { error: error.code, message: error.message },
        error.status as ContentfulStatusCode,
      );
    }
    if (error instanceof HTTPException) {
      const code = error.status === 400 ? "invalid_request" : "http_error";
      if (context.req.path.startsWith("/api/")) {
        return context.json(
          { error: code, message: error.message },
          error.status as ContentfulStatusCode,
        );
      }
      return context.html(
        <ErrorPage code={code} message={error.message} />,
        error.status as ContentfulStatusCode,
      );
    }
    console.error(error);
    return context.json(
      { error: "internal_error", message: "An unexpected server error occurred." },
      500,
    );
  });

  return app;
}
