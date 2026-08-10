import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { AppError, appError } from "../core/errors";
import type {
  Identity,
  OwnerIdentity,
  QueryFilters,
  RecentFilters,
  SwarmbookService,
} from "../core/service";
import {
  BoardPage,
  AuthorizationPage,
  AuthorizationCompletePage,
  ErrorPage,
  HomePage,
  LoginPage,
  NewThreadPage,
  SearchPage,
  ThreadPage,
} from "../ui/views";
import {
  encodeApiToon,
  JSON_MEDIA_TYPE,
  prefersJson,
  TOON_MEDIA_TYPE,
} from "../transport/toon";

type Environment = {
  Variables: {
    identity: Identity;
    ownerIdentity: OwnerIdentity;
  };
};

export interface AccessLogEntry {
  event: "http_request";
  at: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  actor: string;
}

export interface AppOptions {
  requestLogger?: ((entry: AccessLogEntry) => void) | false;
}

const identitySchema = z.object({ mininame: z.string() }).strict();
const startThreadSchema = z
  .object({
    board: z.string(),
    title: z.string(),
    body: z.string(),
  })
  .strict();
const replySchema = z.object({ body: z.string() }).strict();
const threadQuerySchema = z.object({
  since: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
const filterSchema = z.object({
  after: z.string().optional(),
  before: z.string().optional(),
  by: z.array(z.string()).optional(),
  owner: z.array(z.string()).optional(),
  board: z.array(z.string()).optional(),
  limit: z.coerce.number().int().positive().optional(),
});
const recentSchema = filterSchema.extend({
  since: z.coerce.number().int().positive().optional(),
});
const searchSchema = filterSchema.extend({
  q: z.string(),
  fts: z.literal("1").optional(),
});

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
    owner: repeatedQueries(request, "owner"),
    board: repeatedQueries(request, "board"),
    limit: request.query("limit"),
    ...(includeSince ? { since: request.query("since") } : {}),
  };
}

function browserOwner(
  context: Context<Environment>,
  service: SwarmbookService,
): OwnerIdentity | undefined {
  const key = getCookie(context, "swarmbook_owner_key");
  if (!key) return undefined;
  try {
    return service.authenticateOwner(key);
  } catch {
    return undefined;
  }
}

function requireBrowserOwner(
  context: Context<Environment>,
  service: SwarmbookService,
): OwnerIdentity {
  const identity = context.get("ownerIdentity") ?? browserOwner(context, service);
  if (!identity) {
    throw appError(
      "browser_authentication_required",
      "Sign in to use the Swarmbook UI.",
      401,
    );
  }
  return identity;
}

function setOwnerCookie(context: Context<Environment>, key: string): void {
  setCookie(context, "swarmbook_owner_key", key, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    secure: new URL(context.req.url).protocol === "https:",
  });
}

function safeNext(value: string | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function formString(body: Record<string, string | File>, name: string): string {
  const value = body[name];
  return typeof value === "string" ? value : "";
}

function apiResponse(
  context: Context<Environment>,
  value: unknown,
  status: ContentfulStatusCode = 200,
): Response {
  context.header("Vary", "Accept");
  if (prefersJson(context.req.header("accept"))) {
    return context.body(JSON.stringify(value), status, {
      "content-type": `${JSON_MEDIA_TYPE}; charset=UTF-8`,
    });
  }
  return context.body(encodeApiToon(value), status, {
    "content-type": `${TOON_MEDIA_TYPE}; charset=UTF-8`,
  });
}

export function createApp(service: SwarmbookService, options: AppOptions = {}) {
  const app = new Hono<Environment>();
  const api = new Hono<Environment>();
  const requestLogger =
    options.requestLogger === undefined
      ? (entry: AccessLogEntry) => console.info(JSON.stringify(entry))
      : options.requestLogger;

  app.use("*", async (context, next) => {
    const startedAt = performance.now();
    try {
      await next();
    } finally {
      if (requestLogger && context.req.path !== "/health") {
        const identity =
          context.get("identity") as Identity | undefined;
        const ownerIdentity =
          (context.get("ownerIdentity") as OwnerIdentity | undefined) ??
          browserOwner(context, service);
        requestLogger({
          event: "http_request",
          at: new Date().toISOString(),
          method: context.req.method,
          path: context.req.path,
          status: context.res.status,
          duration_ms: Math.max(
            0,
            Math.round((performance.now() - startedAt) * 100) / 100,
          ),
          actor: identity
            ? `${identity.owner}/${identity.mininame}`
            : ownerIdentity?.owner ?? "anonymous",
        });
      }
    }
  });

  app.use("*", async (context, next) => {
    const path = context.req.path;
    if (
      path === "/health" ||
      path.startsWith("/api/") ||
      path === "/login" ||
      path.startsWith("/auth/cli/")
    ) {
      await next();
      return;
    }
    const ownerIdentity = browserOwner(context, service);
    if (!ownerIdentity) {
      const nextPath = `${path}${new URL(context.req.url).search}`;
      return context.redirect(`/login?next=${encodeURIComponent(nextPath)}`);
    }
    context.set("ownerIdentity", ownerIdentity);
    await next();
  });

  app.get("/health", (context) => apiResponse(context, { status: "ok" }));

  app.get("/stream", (context) => {
    return streamSSE(context, async (stream) => {
      type PostEvent = ReturnType<SwarmbookService["recent"]>["posts"][number];
      const queue: PostEvent[] = service.recent({ limit: 20 }).posts.slice();
      let wake: () => void = () => {};
      let pending = new Promise<void>((resolve) => {
        wake = resolve;
      });
      const arm = () => {
        pending = new Promise<void>((resolve) => {
          wake = resolve;
        });
      };
      const unsubscribe = service.subscribe((post) => {
        queue.push(post);
        wake();
        arm();
      });
      stream.onAbort(() => {
        unsubscribe();
        wake();
      });
      try {
        while (!stream.aborted) {
          while (queue.length > 0 && !stream.aborted) {
            const post = queue.shift()!;
            await stream.writeSSE({ event: "post", data: JSON.stringify(post) });
          }
          if (stream.aborted) break;
          const settled = await Promise.race([
            pending.then(() => "wake" as const),
            new Promise<"ping">((resolve) => setTimeout(() => resolve("ping"), 25_000)),
          ]);
          if (settled === "ping" && !stream.aborted && queue.length === 0) {
            await stream.writeSSE({ event: "ping", data: "" });
          }
        }
      } finally {
        unsubscribe();
      }
    });
  });

  api.post("/auth/requests", (context) => {
    const request = service.beginOwnerAuthorization();
    return apiResponse(
      context,
      {
        request_id: request.requestId,
        poll_token: request.pollToken,
        verification_url: new URL(`/auth/cli/${request.requestId}`, context.req.url).toString(),
        expires_at: request.expiresAt,
      },
      201,
    );
  });

  api.get("/auth/requests/:id", (context) => {
    const authorization = context.req.header("authorization");
    if (!authorization?.startsWith("Bearer ") || authorization.length <= 7) {
      throw appError(
        "poll_authentication_required",
        "This authorization request requires its poll credential.",
        401,
      );
    }
    return apiResponse(
      context,
      service.pollOwnerAuthorization(
        context.req.param("id"),
        authorization.slice(7),
      ),
    );
  });

  api.use("/owner/*", async (context, next) => {
    const authorization = context.req.header("authorization");
    if (!authorization?.startsWith("Bearer ") || authorization.length <= 7) {
      throw appError("owner_authentication_required", "Run `swarmbook auth` first.", 401);
    }
    context.set("ownerIdentity", service.authenticateOwner(authorization.slice(7)));
    await next();
  });

  api.get("/owner/whoami", (context) =>
    apiResponse(context, { owner: context.get("ownerIdentity").owner }),
  );

  api.post("/owner/identities", jsonValidator(identitySchema), (context) => {
    const { mininame } = context.req.valid("json");
    return apiResponse(
      context,
      service.createAgentIdentity(context.get("ownerIdentity"), mininame),
      201,
    );
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

  api.get("/whoami", (context) => {
    const identity = context.get("identity");
    return apiResponse(context, {
      owner: identity.owner,
      mininame: identity.mininame,
    });
  });

  api.get("/boards", (context) => apiResponse(context, service.listBoards()));

  api.get("/recent", (context) => {
    const filters = validate(recentSchema, filterInput(context.req, true)) as RecentFilters;
    return apiResponse(context, service.recent(filters));
  });

  api.get("/search", (context) => {
    const filters = validate(searchSchema, {
      ...filterInput(context.req, false),
      q: context.req.query("q"),
      fts: context.req.query("fts"),
    });
    const { q, fts, ...queryFilters } = filters;
    return apiResponse(
      context,
      service.search(q, queryFilters as QueryFilters, { rawFts: fts === "1" }),
    );
  });

  api.get("/posts/:id", (context) =>
    apiResponse(context, service.getPost(Number(context.req.param("id")))),
  );

  api.get("/threads/:id", (context) => {
    const query = validate(threadQuerySchema, {
      since: context.req.query("since"),
      limit: context.req.query("limit"),
    });
    return apiResponse(
      context,
      service.getThread(Number(context.req.param("id")), query),
    );
  });

  api.post("/threads", jsonValidator(startThreadSchema), (context) => {
    const input = context.req.valid("json");
    const result = service.startThread(context.get("identity"), {
      board: input.board,
      title: input.title,
      body: input.body,
    });
    return apiResponse(context, result, 201);
  });

  api.post("/threads/:id/replies", jsonValidator(replySchema), (context) => {
    const result = service.reply(
      context.get("identity"),
      Number(context.req.param("id")),
      context.req.valid("json").body,
    );
    return apiResponse(context, result, 201);
  });

  api.notFound((context) =>
    apiResponse(context, { error: "not_found", message: "API route not found." }, 404),
  );
  app.route("/api", api);

  app.get("/login", (context) =>
    context.html(<LoginPage next={safeNext(context.req.query("next"))} />),
  );
  app.post("/login", async (context) => {
    const body = await context.req.parseBody();
    const next = safeNext(formString(body, "next"));
    try {
      const credential = service.issueOwnerCredential(
        formString(body, "access_key"),
        formString(body, "owner"),
      );
      setOwnerCookie(context, credential.key);
      return context.redirect(next);
    } catch (error) {
      if (error instanceof AppError) {
        return context.html(
          <LoginPage next={next} message={error.message} />,
          error.status as ContentfulStatusCode,
        );
      }
      throw error;
    }
  });

  app.get("/auth/cli/:id", (context) =>
    context.html(<AuthorizationPage requestId={context.req.param("id")} />),
  );
  app.post("/auth/cli/:id", async (context) => {
    const body = await context.req.parseBody();
    try {
      const credential = service.completeOwnerAuthorization(
        context.req.param("id"),
        formString(body, "access_key"),
        formString(body, "owner"),
      );
      setOwnerCookie(context, credential.key);
      return context.html(<AuthorizationCompletePage owner={credential.owner} />);
    } catch (error) {
      if (error instanceof AppError) {
        return context.html(
          <AuthorizationPage
            requestId={context.req.param("id")}
            message={error.message}
          />,
          error.status as ContentfulStatusCode,
        );
      }
      throw error;
    }
  });

  app.get("/", (context) => {
    const identity = requireBrowserOwner(context, service);
    return context.html(
      <HomePage
        identity={identity}
        boards={service.listBoards().boards}
        archivedBoards={identity ? service.listArchivedBoards().boards : []}
      />,
    );
  });

  app.post("/logout", (context) => {
    deleteCookie(context, "swarmbook_owner_key", { path: "/" });
    return context.redirect("/login");
  });

  app.post("/admin/boards", async (context) => {
    requireBrowserOwner(context, service);
    const body = await context.req.parseBody();
    service.createBoard(formString(body, "name"), formString(body, "description"));
    return context.redirect("/");
  });

  app.post("/admin/boards/:id/archive", async (context) => {
    requireBrowserOwner(context, service);
    service.archiveBoard(Number(context.req.param("id")));
    return context.redirect("/");
  });

  app.post("/admin/boards/:id/restore", async (context) => {
    requireBrowserOwner(context, service);
    service.restoreBoard(Number(context.req.param("id")));
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
        identity={requireBrowserOwner(context, service)}
        board={board}
        threads={preview.threads}
        page={page}
        perPage={perPage}
        total={preview.total}
      />,
    );
  });

  app.get("/threads/new", (context) => {
    const identity = requireBrowserOwner(context, service);
    return context.html(
      <NewThreadPage
        identity={identity}
        boards={service.listBoards().boards}
        selectedBoard={context.req.query("board")}
      />,
    );
  });

  app.get("/threads/:id", (context) => {
    const id = Number(context.req.param("id"));
    const thread = service.getThread(id, { limit: 1 });
    const anchor = id === thread.thread_id ? "" : `#post-${id}`;
    return context.redirect(
      `/boards/${thread.board}/threads/${thread.thread_id}${anchor}`,
    );
  });

  app.get("/boards/:board/threads/:id", (context) => {
    const id = Number(context.req.param("id"));
    const thread = service.getThread(id, { limit: 500 });
    const board = context.req.param("board").toLowerCase();
    if (thread.board !== board) {
      return context.redirect(`/boards/${thread.board}/threads/${thread.thread_id}`);
    }
    return context.html(
      <ThreadPage identity={requireBrowserOwner(context, service)} thread={thread} />,
    );
  });

  app.post("/threads", async (context) => {
    const ownerIdentity = requireBrowserOwner(context, service);
    const body = await context.req.parseBody();
    const result = service.startThread(service.humanIdentity(ownerIdentity), {
      board: formString(body, "board"),
      title: formString(body, "title"),
      body: formString(body, "body"),
    });
    const thread = service.getThread(result.id, { limit: 1 });
    return context.redirect(`/boards/${thread.board}/threads/${thread.thread_id}`);
  });

  app.post("/threads/:id/replies", async (context) => {
    const ownerIdentity = requireBrowserOwner(context, service);
    const body = await context.req.parseBody();
    const threadId = Number(context.req.param("id"));
    const reply = service.reply(
      service.humanIdentity(ownerIdentity),
      threadId,
      formString(body, "body"),
    );
    const thread = service.getThread(threadId, { limit: 1 });
    return context.redirect(`/boards/${thread.board}/threads/${thread.thread_id}#post-${reply.id}`);
  });

  app.get("/search", (context) => {
    const query = context.req.query("q") ?? "";
    const results = query ? service.search(query, {}).results : [];
    return context.html(
      <SearchPage
        identity={requireBrowserOwner(context, service)}
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
            identity={browserOwner(context, service)}
            code={error.code}
            message={error.message}
          />,
          error.status as ContentfulStatusCode,
        );
      }
      return apiResponse(
        context,
        { error: error.code, message: error.message },
        error.status as ContentfulStatusCode,
      );
    }
    if (error instanceof HTTPException) {
      const code = error.status === 400 ? "invalid_request" : "http_error";
      if (context.req.path.startsWith("/api/")) {
        return apiResponse(
          context,
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
    if (context.req.path.startsWith("/api/") || context.req.path === "/health") {
      return apiResponse(
        context,
        { error: "internal_error", message: "An unexpected server error occurred." },
        500,
      );
    }
    return context.html(
      <ErrorPage
        code="internal_error"
        message="An unexpected server error occurred."
      />,
      500,
    );
  });

  return app;
}
