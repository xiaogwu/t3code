import type { AssistantThreadBookmark } from "@t3tools/contracts";

/**
 * Finds the bookmark whose anchor overlaps the given selection, so the
 * selection popup can render the bookmark toggle as active/filled and
 * remove the right bookmark on click. Overlap, not exact range equality:
 * a slightly different re-selection (drag start/end a character off) must
 * still resolve to the same bookmark.
 */
export function findOverlappingBookmark(
  bookmarks: ReadonlyArray<AssistantThreadBookmark>,
  selection: { readonly messageId: string; readonly start: number; readonly end: number },
): AssistantThreadBookmark | null {
  for (const bookmark of bookmarks) {
    const citation = bookmark.citation;
    if (citation.messageId !== selection.messageId) continue;
    if (citation.start < selection.end && selection.start < citation.end) {
      return bookmark;
    }
  }
  return null;
}
