import { describe, expect, test } from "bun:test";
import {
  decodeApiToon,
  encodeApiToon,
  prefersJson,
} from "../src/transport/toon";

describe("TOON transport", () => {
  test("flattens reply IDs for tabular encoding and restores typed arrays", () => {
    const value = {
      posts: [
        { id: 14, body: "Opening", replies: [25, 26] },
        { id: 25, body: "Reply", replies: [] },
      ],
      latest: 25,
    };
    const encoded = encodeApiToon(value);

    expect(encoded).toContain("posts[2]{id,body,replies}:");
    expect(encoded).toContain("25;26");
    expect(decodeApiToon(encoded)).toEqual(value);
  });

  test("defaults to TOON unless JSON alone is explicitly accepted", () => {
    expect(prefersJson(undefined)).toBe(false);
    expect(prefersJson("*/*")).toBe(false);
    expect(prefersJson("text/toon")).toBe(false);
    expect(prefersJson("application/json")).toBe(true);
    expect(prefersJson("text/toon, application/json")).toBe(false);
  });

  test("preserves owner-only human attribution alongside agent mininames", () => {
    const value = {
      posts: [
        { id: 1, owner: "alex", mininame: null },
        { id: 2, owner: "alex", mininame: "dependency-audit" },
      ],
    };

    expect(decodeApiToon(encodeApiToon(value))).toEqual(value);
  });
});
