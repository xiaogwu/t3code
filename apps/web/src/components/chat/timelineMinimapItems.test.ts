import { EnvironmentId, MessageId, ThreadBookmarkId, ThreadId } from "@t3tools/contracts";
import type { AssistantThreadBookmark } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveTimelineMinimapItems } from "./MessagesTimeline.tsx";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic.ts";

function messageRow(id: string, role: "user" | "assistant", text: string): MessagesTimelineRow {
  return {
    kind: "message",
    id: `row:${id}`,
    createdAt: "2026-04-01T00:00:00.000Z",
    message: {
      id: MessageId.make(id),
      role,
      text,
      createdAt: "2026-04-01T00:00:00.000Z",
    },
    durationStart: "2026-04-01T00:00:00.000Z",
    showAssistantMeta: true,
    showAssistantCopyButton: false,
    assistantCopyStreaming: false,
  } as MessagesTimelineRow;
}

function bookmark(id: string, messageId: string, start: number): AssistantThreadBookmark {
  return {
    id: ThreadBookmarkId.make(id),
    citation: {
      version: 1,
      environmentId: EnvironmentId.make("env-1"),
      threadId: ThreadId.make("thread-1"),
      messageId: MessageId.make(messageId),
      text: `quote-${id}`,
      start,
      end: start + 5,
      prefix: "before ",
      suffix: " after",
    },
    createdAt: "2026-04-01T00:00:00.000Z",
  };
}

function indexBookmarks(bookmarks: ReadonlyArray<AssistantThreadBookmark>) {
  const map = new Map<MessageId, Array<AssistantThreadBookmark>>();
  for (const entry of bookmarks) {
    const forMessage = map.get(entry.citation.messageId) ?? [];
    forMessage.push(entry);
    map.set(entry.citation.messageId, forMessage);
  }
  return map;
}

const rows: ReadonlyArray<MessagesTimelineRow> = [
  messageRow("user-1", "user", "first prompt"),
  messageRow("assistant-1", "assistant", "first answer"),
  messageRow("assistant-2", "assistant", "second answer"),
  messageRow("user-2", "user", "second prompt"),
  messageRow("assistant-3", "assistant", "third answer"),
];

describe("deriveTimelineMinimapItems", () => {
  it("emits only prompts when there are no bookmarks", () => {
    const items = deriveTimelineMinimapItems(rows, new Map());

    expect(items.map((item) => item.kind)).toEqual(["prompt", "prompt"]);
    expect(items.map((item) => item.rowIndex)).toEqual([0, 3]);
  });

  it("anchors a bookmark between the prompts that bracket it", () => {
    const items = deriveTimelineMinimapItems(
      rows,
      indexBookmarks([bookmark("b1", "assistant-1", 10)]),
    );

    expect(items.map((item) => item.kind)).toEqual(["prompt", "bookmark", "prompt"]);
    // Sits after its own turn's prompt and before the next one.
    expect(items[1]?.rowIndex).toBe(1);
  });

  it("orders several bookmarks in one message by anchor offset", () => {
    const items = deriveTimelineMinimapItems(
      rows,
      // Deliberately supplied out of order.
      indexBookmarks([bookmark("late", "assistant-1", 80), bookmark("early", "assistant-1", 10)]),
    );

    const bookmarkIds = items.flatMap((item) =>
      item.kind === "bookmark" ? [item.bookmark.id] : [],
    );
    expect(bookmarkIds).toEqual(["early", "late"]);
  });

  it("orders bookmarks across messages by position in the turn", () => {
    const items = deriveTimelineMinimapItems(
      rows,
      indexBookmarks([
        bookmark("second-msg", "assistant-2", 5),
        bookmark("first-msg", "assistant-1", 90),
      ]),
    );

    const bookmarkIds = items.flatMap((item) =>
      item.kind === "bookmark" ? [item.bookmark.id] : [],
    );
    expect(bookmarkIds).toEqual(["first-msg", "second-msg"]);
  });

  it("labels a bookmark with the prompt whose turn it belongs to", () => {
    const items = deriveTimelineMinimapItems(
      rows,
      indexBookmarks([bookmark("b1", "assistant-3", 10)]),
    );

    const entry = items.find((item) => item.kind === "bookmark");
    expect(entry?.userText).toBe("second prompt");
  });
});
