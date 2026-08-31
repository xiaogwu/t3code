import { describe, expect, it } from "vite-plus/test";

import { searchPromptHistoryEntries } from "./promptHistorySearch";

const entries = [
  { text: "Newest prompt" },
  { text: "Run the focused tests" },
  { text: "Older\nmultiline prompt" },
];

describe("searchPromptHistoryEntries", () => {
  it("returns all entries newest-first for an empty query", () => {
    expect(searchPromptHistoryEntries(entries, "")).toEqual(entries);
  });

  it("matches case-insensitive substrings without changing history order", () => {
    expect(searchPromptHistoryEntries(entries, "PROMPT").map((entry) => entry.text)).toEqual([
      "Newest prompt",
      "Older\nmultiline prompt",
    ]);
  });

  it("normalizes whitespace in prompts and queries", () => {
    expect(searchPromptHistoryEntries(entries, "older multiline")).toEqual([entries[2]]);
  });

  it("returns no entries when the query does not match", () => {
    expect(searchPromptHistoryEntries(entries, "deploy production")).toEqual([]);
  });
});
