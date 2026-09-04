import { describe, expect, it } from "vite-plus/test";
import type { AssistantThreadBookmark } from "@t3tools/contracts";

import { findOverlappingBookmark } from "./threadBookmarks.logic";

function bookmark(
  id: string,
  input: { messageId: string; start: number; end: number },
): AssistantThreadBookmark {
  return {
    id,
    citation: {
      version: 1,
      environmentId: "env-1",
      threadId: "thread-1",
      messageId: input.messageId,
      text: "quoted text",
      start: input.start,
      end: input.end,
      prefix: "",
      suffix: "",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
  } as AssistantThreadBookmark;
}

describe("findOverlappingBookmark", () => {
  const bookmarks = [
    bookmark("a", { messageId: "message-1", start: 10, end: 20 }),
    bookmark("b", { messageId: "message-2", start: 0, end: 5 }),
  ];

  it("finds a bookmark whose range exactly matches", () => {
    const found = findOverlappingBookmark(bookmarks, {
      messageId: "message-1",
      start: 10,
      end: 20,
    });
    expect(found?.id).toBe("a");
  });

  it("finds a bookmark whose range partially overlaps", () => {
    const found = findOverlappingBookmark(bookmarks, {
      messageId: "message-1",
      start: 15,
      end: 25,
    });
    expect(found?.id).toBe("a");
  });

  it("finds a bookmark that fully contains the selection", () => {
    const found = findOverlappingBookmark(bookmarks, {
      messageId: "message-1",
      start: 12,
      end: 18,
    });
    expect(found?.id).toBe("a");
  });

  it("does not match a different message even with the same offsets", () => {
    const found = findOverlappingBookmark(bookmarks, {
      messageId: "message-3",
      start: 10,
      end: 20,
    });
    expect(found).toBeNull();
  });

  it("does not match an adjacent, non-overlapping range", () => {
    const found = findOverlappingBookmark(bookmarks, {
      messageId: "message-1",
      start: 20,
      end: 30,
    });
    expect(found).toBeNull();
  });

  it("returns null when there is no overlap", () => {
    const found = findOverlappingBookmark(bookmarks, {
      messageId: "message-1",
      start: 100,
      end: 110,
    });
    expect(found).toBeNull();
  });
});
