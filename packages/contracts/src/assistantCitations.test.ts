import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  AssistantCitation,
  AssistantThreadBookmark,
} from "./assistantCitations.ts";

const decodeCitation = Schema.decodeUnknownSync(AssistantCitation);
const decodeBookmark = Schema.decodeUnknownSync(AssistantThreadBookmark);

const BASE_CITATION = {
  version: 1 as const,
  environmentId: "env-1",
  threadId: "thread-1",
  messageId: "message-1",
  text: "quoted text",
  start: 0,
  end: 11,
  prefix: "",
  suffix: "",
};

describe("AssistantCitation", () => {
  it("decodes a valid citation", () => {
    expect(decodeCitation(BASE_CITATION)).toMatchObject({ text: "quoted text" });
  });

  it("rejects end <= start", () => {
    expect(() => decodeCitation({ ...BASE_CITATION, start: 5, end: 5 })).toThrow();
    expect(() => decodeCitation({ ...BASE_CITATION, start: 5, end: 3 })).toThrow();
  });

  it("rejects text over the max length", () => {
    const tooLong = "a".repeat(ASSISTANT_CITATION_MAX_TEXT_LENGTH + 1);
    expect(() =>
      decodeCitation({ ...BASE_CITATION, text: tooLong, start: 0, end: tooLong.length }),
    ).toThrow();
  });

  it("rejects blank text", () => {
    expect(() => decodeCitation({ ...BASE_CITATION, text: "   " })).toThrow();
  });
});

describe("AssistantThreadBookmark", () => {
  it("decodes a bookmark that reuses the citation anchor verbatim", () => {
    const bookmark = decodeBookmark({
      id: "bookmark-1",
      citation: BASE_CITATION,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(bookmark.citation.text).toBe("quoted text");
  });

  it("rejects a bookmark whose citation has end <= start", () => {
    expect(() =>
      decodeBookmark({
        id: "bookmark-1",
        citation: { ...BASE_CITATION, start: 5, end: 5 },
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow();
  });
});
