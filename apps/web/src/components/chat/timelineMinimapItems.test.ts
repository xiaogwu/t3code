import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, MessageId, ThreadBookmarkId, ThreadId } from "@t3tools/contracts";
import type { AssistantThreadBookmark } from "@t3tools/contracts";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import { deriveTimelineMinimapItems, resolveTimelineMinimapPreview } from "./timelineMinimapItems";
import type { ChatMessage } from "../../types";

const NO_BOOKMARKS: ReadonlyMap<MessageId, ReadonlyArray<AssistantThreadBookmark>> = new Map();

function rows(
  entries: ReadonlyArray<readonly ["user" | "assistant", string]>,
): MessagesTimelineRow[] {
  const messages: ChatMessage[] = entries.map(([role, text], index) => ({
    id: MessageId.make(`message-${index}`),
    role,
    text,
    streaming: false,
    turnId: null,
    createdAt: new Date(index * 1000).toISOString(),
    updatedAt: new Date(index * 1000).toISOString(),
  }));
  return messages.map((message) => ({
    kind: "message",
    id: message.id,
    createdAt: message.createdAt,
    message,
    durationStart: message.createdAt,
    showAssistantMeta: false,
    showAssistantCopyButton: false,
    assistantCopyStreaming: false,
  }));
}

describe("timeline minimap previews", () => {
  it("previews the last assistant response before the next prompt and retains jump targets", () => {
    const source = rows([
      ["user", "  Inspect\n this  "],
      ["assistant", "Working"],
      ["assistant", " Done\t now "],
      ["user", "Next"],
      ["assistant", "Second answer"],
    ]);
    const items = deriveTimelineMinimapItems(source, NO_BOOKMARKS);
    expect(items).toHaveLength(2);
    expect(resolveTimelineMinimapPreview(items[0]!)).toEqual({
      ...items[0],
      userText: "Inspect this",
      assistantText: "Done now",
    });
    expect(source[items[0]!.rowIndex]!.id).toBe(items[0]!.id);
    const secondPreview = resolveTimelineMinimapPreview(items[1]!);
    expect(secondPreview?.kind === "prompt" ? secondPreview.assistantText : null).toBe(
      "Second answer",
    );
    expect(items[0]?.kind === "prompt" ? items[0].assistantText : null).toBe(" Done\t now ");
  });

  it("handles an unanswered prompt, empty responses, and a closed preview", () => {
    const items = deriveTimelineMinimapItems(
      rows([
        ["user", "First"],
        ["assistant", " \n\t"],
        ["user", "Next"],
      ]),
      NO_BOOKMARKS,
    );
    expect(
      items.map((item) => {
        const preview = resolveTimelineMinimapPreview(item);
        return preview?.kind === "prompt" ? preview.assistantText : null;
      }),
    ).toEqual([null, null]);
    expect(resolveTimelineMinimapPreview(null)).toBeNull();
  });

  it("shows fresh streaming text without changing the jump target", () => {
    const first = deriveTimelineMinimapItems(
      rows([
        ["user", "Explain"],
        ["assistant", "First"],
      ]),
      NO_BOOKMARKS,
    )[0]!;
    const next = { ...first, assistantText: "First\n second" };
    expect(resolveTimelineMinimapPreview(next)).toEqual({
      ...first,
      assistantText: "First second",
    });
    const firstPreview = resolveTimelineMinimapPreview(first);
    expect(firstPreview?.kind === "prompt" ? firstPreview.assistantText : null).toBe("First");
  });
});

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

const bookmarkRows: ReadonlyArray<MessagesTimelineRow> = [
  messageRow("user-1", "user", "first prompt"),
  messageRow("assistant-1", "assistant", "first answer"),
  messageRow("assistant-2", "assistant", "second answer"),
  messageRow("user-2", "user", "second prompt"),
  messageRow("assistant-3", "assistant", "third answer"),
];

describe("deriveTimelineMinimapItems", () => {
  it("emits only prompts when there are no bookmarks", () => {
    const items = deriveTimelineMinimapItems(bookmarkRows, new Map());

    expect(items.map((item) => item.kind)).toEqual(["prompt", "prompt"]);
    expect(items.map((item) => item.rowIndex)).toEqual([0, 3]);
  });

  it("anchors a bookmark between the prompts that bracket it", () => {
    const items = deriveTimelineMinimapItems(
      bookmarkRows,
      indexBookmarks([bookmark("b1", "assistant-1", 10)]),
    );

    expect(items.map((item) => item.kind)).toEqual(["prompt", "bookmark", "prompt"]);
    // Sits after its own turn's prompt and before the next one.
    expect(items[1]?.rowIndex).toBe(1);
  });

  it("orders several bookmarks in one message by anchor offset", () => {
    const items = deriveTimelineMinimapItems(
      bookmarkRows,
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
      bookmarkRows,
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
      bookmarkRows,
      indexBookmarks([bookmark("b1", "assistant-3", 10)]),
    );

    const entry = items.find((item) => item.kind === "bookmark");
    expect(entry?.userText).toBe("second prompt");
  });
});
