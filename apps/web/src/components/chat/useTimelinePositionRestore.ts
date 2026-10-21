import { useLayoutEffect, useRef } from "react";
import type { LegendListRef } from "@legendapp/list/react";
import type { AssistantCitationRequest } from "./AssistantCitationSource";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import type { RememberedTimelinePosition } from "./timelineScrollAnchoring";

/**
 * Scrolls a newly shown thread back to where the user left it, or to its end,
 * and reports the thread positioned once the saved row settles.
 */
export function useTimelinePositionRestore({
  listRef,
  listIdentityKey,
  restoringThreadPosition,
  rememberedPosition,
  rows,
  restoreTarget,
  citationRequest,
  cancelPositionRestoreRef,
  onManualNavigation,
  onPositioned,
}: {
  readonly listRef: React.RefObject<LegendListRef | null>;
  readonly listIdentityKey: string;
  readonly restoringThreadPosition: boolean;
  readonly rememberedPosition: RememberedTimelinePosition | undefined;
  readonly rows: MessagesTimelineRow[];
  /**
   * The row and offset to land on, resolved by row id, then by the saved row's
   * timestamp, so a position outlives the row it was taken from. Memoize it:
   * the restore effect depends on its identity.
   */
  readonly restoreTarget:
    | { readonly index: number; readonly rowId: string; readonly offsetWithinRow: number }
    | undefined;
  readonly citationRequest: AssistantCitationRequest | null;
  readonly cancelPositionRestoreRef: React.RefObject<(() => void) | null> | undefined;
  readonly onManualNavigation: () => void;
  readonly onPositioned: (identity: string) => void;
}) {
  // Preserve initialScrollAtEnd's measured target until the list is reused
  // for another thread; scrollToEnd would replace it with an estimated offset.
  const listOpenedOnRef = useRef<{
    readonly list: LegendListRef;
    identity: string | null;
  } | null>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    const opened = listOpenedOnRef.current;
    if (!list) return;
    if (opened?.list !== list) {
      listOpenedOnRef.current = { list, identity: listIdentityKey };
    } else if (opened.identity !== listIdentityKey) {
      opened.identity = null;
    }
  });
  useLayoutEffect(() => {
    if (!restoringThreadPosition || rows.length === 0) return;
    const list = listRef.current;
    if (!list) return;
    if (citationRequest !== null) {
      // The citation scroll owns positioning once the list has mounted.
      onPositioned(listIdentityKey);
      return;
    }
    let cancelled = false;
    let settleFrame: number | null = null;
    const viewport: HTMLElement | null = list.getScrollableNode();
    const cancelRestoration = () => {
      if (cancelled) return;
      cancelled = true;
      if (settleFrame !== null) cancelAnimationFrame(settleFrame);
      if (viewport) void list.scrollToOffset({ offset: viewport.scrollTop, animated: false });
      onPositioned(listIdentityKey);
    };
    const cancelForNavigation = () => {
      cancelRestoration();
      onManualNavigation();
    };
    const onScrollKey = (event: globalThis.KeyboardEvent) => {
      if (
        ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key) &&
        !(
          event.target instanceof Element &&
          event.target.closest("input, textarea, [contenteditable=true]")
        )
      )
        cancelForNavigation();
    };
    viewport?.addEventListener("wheel", cancelForNavigation, { passive: true });
    viewport?.addEventListener("touchmove", cancelForNavigation, { passive: true });
    viewport?.addEventListener("pointerdown", cancelForNavigation, { passive: true });
    viewport?.ownerDocument.addEventListener("keydown", onScrollKey);
    const position = rememberedPosition;
    // The raw scroll offset is the last resort, for a position whose row is
    // gone and that carries no usable timestamp.
    const target = restoreTarget;
    if (position?.atEnd === false) onManualNavigation();
    if (cancelPositionRestoreRef) cancelPositionRestoreRef.current = cancelRestoration;
    const scrolling =
      position?.atEnd === false
        ? target
          ? list.scrollToIndex({
              index: target.index,
              animated: false,
              viewPosition: 0,
              viewOffset: -target.offsetWithinRow,
            })
          : list.scrollToOffset({ offset: position.scrollOffset, animated: false })
        : listOpenedOnRef.current?.identity === listIdentityKey
          ? undefined
          : list.scrollToEnd({ animated: false });
    void Promise.resolve(scrolling).then(() => {
      if (cancelled) return;
      if (position?.atEnd !== false || !target) {
        onPositioned(listIdentityKey);
        return;
      }
      // Index scrolling starts from estimates. Keep the saved row mounted
      // until its measured position and the DOM agree for two layout frames.
      let stableFrames = 0;
      const reconcile = () => {
        if (cancelled) return;
        const state = list.getState();
        const rowIndex = state.indexByKey(target.rowId);
        const row = rowIndex === undefined ? undefined : state.elementAtIndex(rowIndex);
        const element = list.getScrollableNode();
        if (!row || !element) return;
        const offset = Math.max(
          0,
          Math.min(
            element.scrollTop +
              row.getBoundingClientRect().top -
              element.getBoundingClientRect().top +
              target.offsetWithinRow,
            element.scrollHeight - element.clientHeight,
          ),
        );
        if (Math.abs(element.scrollTop - offset) > 1) {
          stableFrames = 0;
          void list.scrollToOffset({ offset, animated: false }).then(() => {
            if (!cancelled) settleFrame = requestAnimationFrame(reconcile);
          });
          return;
        }
        stableFrames += 1;
        if (stableFrames >= 2) {
          onPositioned(listIdentityKey);
        } else {
          settleFrame = requestAnimationFrame(reconcile);
        }
      };
      settleFrame = requestAnimationFrame(reconcile);
    });
    return () => {
      cancelled = true;
      if (cancelPositionRestoreRef?.current === cancelRestoration) {
        cancelPositionRestoreRef.current = null;
      }
      if (settleFrame !== null) cancelAnimationFrame(settleFrame);
      viewport?.removeEventListener("wheel", cancelForNavigation);
      viewport?.removeEventListener("touchmove", cancelForNavigation);
      viewport?.removeEventListener("pointerdown", cancelForNavigation);
      viewport?.ownerDocument.removeEventListener("keydown", onScrollKey);
    };
  }, [
    citationRequest,
    cancelPositionRestoreRef,
    listIdentityKey,
    listRef,
    onManualNavigation,
    onPositioned,
    rememberedPosition,
    restoreTarget,
    restoringThreadPosition,
    rows,
  ]);
}
