import type { AssistantThreadBookmark, MessageId } from "@t3tools/contracts";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";

/**
 * One line on the rail. Prompts carry the turn structure; bookmarks sit between
 * the two prompts that bracket them, ordered by where they fall in the turn, so
 * a bookmark reads as its own stop rather than a dot interpolated onto a prompt.
 */
export type TimelineMinimapItem =
  | {
      readonly kind: "prompt";
      readonly id: string;
      readonly rowIndex: number;
      readonly userText: string | null;
      readonly assistantText: string | null;
    }
  | {
      readonly kind: "bookmark";
      readonly id: string;
      readonly rowIndex: number;
      readonly bookmark: AssistantThreadBookmark;
      /** The prompt this bookmark's turn belongs to, shown under the quote. */
      readonly userText: string | null;
    };

/** Keep full source text untouched until a minimap preview is opened. */
export function deriveTimelineMinimapItems(
  rows: ReadonlyArray<MessagesTimelineRow>,
  bookmarksByMessageId: ReadonlyMap<MessageId, ReadonlyArray<AssistantThreadBookmark>>,
): TimelineMinimapItem[] {
  const items: TimelineMinimapItem[] = [];
  // Tracks the prompt whose turn we are inside, so a bookmark on an assistant
  // message can name the prompt that produced it.
  let currentUserText: string | null = null;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row?.kind !== "message") {
      continue;
    }

    if (row.message.role === "user") {
      currentUserText = row.message.text;
      items.push({
        kind: "prompt",
        id: row.id,
        rowIndex: index,
        userText: currentUserText,
        assistantText: resolveFinalAssistantTextForTurn(rows, index),
      });
      continue;
    }

    if (row.message.role !== "assistant" || bookmarksByMessageId.size === 0) {
      continue;
    }
    const messageBookmarks = bookmarksByMessageId.get(row.message.id);
    if (!messageBookmarks || messageBookmarks.length === 0) {
      continue;
    }
    // Row order already sequences messages within the turn; sorting by anchor
    // offset sequences several bookmarks inside one message.
    const ordered = [...messageBookmarks].sort((a, b) => a.citation.start - b.citation.start);
    for (const bookmark of ordered) {
      items.push({
        kind: "bookmark",
        id: `bookmark:${bookmark.id}`,
        rowIndex: index,
        bookmark,
        userText: currentUserText,
      });
    }
  }
  return items;
}

function resolveFinalAssistantTextForTurn(
  rows: ReadonlyArray<MessagesTimelineRow>,
  userRowIndex: number,
) {
  let finalAssistantText: string | null = null;
  for (let index = userRowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row?.kind !== "message") {
      continue;
    }
    if (row.message.role === "user") {
      break;
    }
    if (row.message.role === "assistant") {
      finalAssistantText = row.message.text ?? null;
    }
  }
  return finalAssistantText;
}

function compactMinimapPreview(text: string | null | undefined) {
  const compact = text?.replace(/\s+/g, " ").trim() ?? "";
  return compact.length > 0 ? compact : null;
}

export function resolveTimelineMinimapPreview(
  item: TimelineMinimapItem | null,
): TimelineMinimapItem | null {
  if (item === null) {
    return null;
  }
  return item.kind === "bookmark"
    ? { ...item, userText: compactMinimapPreview(item.userText) }
    : {
        ...item,
        userText: compactMinimapPreview(item.userText),
        assistantText: compactMinimapPreview(item.assistantText),
      };
}
