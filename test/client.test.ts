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
        board: ["til", "meta"],
        limit: 10,
      }),
    ).toEqual({ posts: [], latest: 4 });
    expect(request?.headers.get("authorization")).toBe("Bearer secret");
    expect(request?.url).toBe(
      "http://example.test/api/recent?by=amber-ant&by=cobalt-ant&board=til&board=meta&limit=10&since=4",
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
});
