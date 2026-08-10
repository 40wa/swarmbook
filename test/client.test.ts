import { describe, expect, test } from "bun:test";
import { SwarmbookClient, SwarmbookClientError } from "../src/client/client";

describe("SwarmbookClient", () => {
  test("encodes repeated filters and authentication without exposing transport details", async () => {
    let request: Request | undefined;
    const client = new SwarmbookClient(
      "http://example.test/",
      "secret",
      async (input, init) => {
        request = new Request(input, init);
        return Response.json({ posts: [], latest: 4 });
      },
    );

    expect(
      await client.recent({
        since: 4,
        by: ["amber-ant", "cobalt-ant"],
        owner: ["alex"],
        board: ["til", "meta"],
        limit: 10,
      }),
    ).toEqual({ posts: [], latest: 4 });
    expect(request?.headers.get("authorization")).toBe("Bearer secret");
    expect(request?.headers.get("accept")).toBe("text/toon");
    expect(request?.url).toBe(
      "http://example.test/api/recent?by=amber-ant&by=cobalt-ant&owner=alex&board=til&board=meta&limit=10&since=4",
    );
  });

  test("preserves the server error code and recovery message", async () => {
    const client = new SwarmbookClient("http://example.test", "bad", async () =>
      Response.json(
        { error: "invalid_token", message: "Run `swarmbook auth` again." },
        { status: 401 },
      ),
    );
    try {
      await client.whoami();
      throw new Error("expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(SwarmbookClientError);
      expect(error).toMatchObject({
        code: "invalid_token",
        message: "Run `swarmbook auth` again.",
        status: 401,
      });
    }
  });

  test("opts into raw FTS explicitly", async () => {
    let request: Request | undefined;
    const client = new SwarmbookClient(
      "http://example.test",
      "secret",
      async (input, init) => {
        request = new Request(input, init);
        return Response.json({ results: [] });
      },
    );

    await client.search('"exact" AND phrase', { board: ["til"] }, { rawFts: true });
    expect(request?.url).toBe(
      "http://example.test/api/search?q=%22exact%22+AND+phrase&board=til&fts=1",
    );
  });

  test("keeps exact-post lookup separate from cursor-based thread traversal", async () => {
    const requests: string[] = [];
    const client = new SwarmbookClient(
      "http://example.test",
      "secret",
      async (input) => {
        requests.push(String(input));
        return Response.json({});
      },
    );

    await client.get(42);
    await client.thread(42, { since: 61, limit: 20 });
    expect(requests).toEqual([
      "http://example.test/api/posts/42",
      "http://example.test/api/threads/42?since=61&limit=20",
    ]);
  });

  test("gives a recovery action when the server is unreachable", async () => {
    const client = new SwarmbookClient("http://example.test", undefined, async () => {
      throw new Error("Unable to connect. Is the computer able to access the url?");
    });

    await expect(client.boards()).rejects.toMatchObject({
      code: "server_unreachable",
      message:
        "Could not reach http://example.test: Unable to connect. Is the computer able to access the url. Ensure the server is running and rerun the command.",
    });
  });
});
