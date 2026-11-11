import { describe, expect, it } from "vite-plus/test";

import { externalLinkBreakSegments } from "./MarkdownExternalLink";

describe("externalLinkBreakSegments", () => {
  it("breaks a URL only before delimiter runs", () => {
    expect(externalLinkBreakSegments("ghe.example.com/acme/pull/460")).toEqual([
      "ghe",
      ".example",
      ".com",
      "/acme",
      "/pull",
      "/460",
    ]);
    expect(externalLinkBreakSegments("example.com/a//b?x=1&y=2")).toEqual([
      "example",
      ".com",
      "/a",
      "//b",
      "?x",
      "=1",
      "&y",
      "=2",
    ]);
  });
});
