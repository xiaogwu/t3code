export const CHAT_LIST_ANCHOR_OFFSET = 16;

export interface ChatListAnchoredEndSpace {
  readonly anchorIndex: number;
  readonly anchorOffset: number;
}

export interface ChatListAnchorOptions {
  readonly anchorOffset?: number;
  /**
   * Which eligible row is allowed to anchor. "first-eligible" reserves end
   * space only for a list's opening eligible row, so a follow-up submission
   * cannot push itself to the top. "latest" matches the anchor wherever it
   * sits, for a surface that deliberately anchors every new turn.
   */
  readonly match?: "first-eligible" | "latest";
}

export function resolveChatListAnchoredEndSpace<Item, AnchorId>(
  items: ReadonlyArray<Item>,
  anchorId: AnchorId | null,
  getAnchorId: (item: Item) => AnchorId | null,
  options: ChatListAnchorOptions = {},
): ChatListAnchoredEndSpace | undefined {
  if (anchorId === null) {
    return undefined;
  }

  const anchorOffset = options.anchorOffset ?? CHAT_LIST_ANCHOR_OFFSET;

  if (options.match === "latest") {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item !== undefined && getAnchorId(item) === anchorId) {
        return { anchorIndex: index, anchorOffset };
      }
    }

    return undefined;
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === undefined) {
      continue;
    }

    const itemAnchorId = getAnchorId(item);
    if (itemAnchorId === null) {
      continue;
    }

    return itemAnchorId === anchorId ? { anchorIndex: index, anchorOffset } : undefined;
  }

  return undefined;
}
