import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  MessageId,
  type AssistantCitation,
  type AssistantThreadBookmark,
  type ScopedThreadRef,
  type ThreadBookmarkId,
} from "@t3tools/contracts";
import { BookmarkIcon, QuoteIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  captureAssistantTextSelection,
  type AssistantCitationSourceAnchor,
} from "~/lib/assistantTextSelection";
import { findOverlappingBookmark } from "~/lib/threadBookmarks.logic";
import {
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "~/lib/selectionActions";
import { Button } from "../ui/button";
import { cn } from "~/lib/utils";

export function AssistantSelectionToolbar({
  viewport,
  threadRef,
  bookmarks,
  onCite,
  onToggleBookmark,
}: {
  viewport: HTMLElement | null;
  threadRef: ScopedThreadRef;
  /** Every bookmark on the thread, used only for overlap detection. */
  bookmarks?: ReadonlyArray<AssistantThreadBookmark>;
  onCite: (citation: AssistantCitation, sourceAnchor: AssistantCitationSourceAnchor) => boolean;
  onToggleBookmark?: (
    citation: AssistantCitation,
    existingBookmarkId: ThreadBookmarkId | null,
  ) => void;
}) {
  const [selection, setSelection] = useState<{
    citation: AssistantCitation;
    position: SelectionActionPoint;
    sourceAnchor: AssistantCitationSourceAnchor;
  } | null>(null);
  // The action container, not a single button: Tab-focus and the
  // pointerdown/focus guards below need one element that contains every
  // button in the popup.
  const containerRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<ReturnType<typeof observeSelectionActions> | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !selection) return;
    const rect = container.getBoundingClientRect();
    container.style.left = `${Math.max(8, Math.min(selection.position.x, window.innerWidth - rect.width - 8))}px`;
    container.style.top = `${Math.max(8, Math.min(selection.position.y, window.innerHeight - rect.height - 8))}px`;
  }, [selection]);

  useEffect(() => {
    if (!viewport) return;
    const clear = () => setSelection(null);
    const update = (pointer: SelectionActionPoint | null) => {
      const nativeSelection = window.getSelection();
      const captured = captureAssistantTextSelection(viewport, nativeSelection);
      const messageId = captured?.source.dataset.assistantCitationSource;
      if (!captured || !messageId) {
        clear();
        return;
      }
      const rect = captured.range.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      if (rect.bottom < viewportRect.top || rect.top > viewportRect.bottom || rect.width === 0) {
        clear();
        return;
      }
      const rects = captured.range.getClientRects();
      setSelection({
        sourceAnchor: { source: captured.source, range: captured.range, viewport },
        citation: {
          version: 1,
          ...threadRef,
          messageId: MessageId.make(messageId),
          ...captured.selector,
        },
        position: resolveSelectionActionPosition({
          bounds: viewportRect,
          selectionRect: rects.item(rects.length - 1) ?? rect,
          pointer,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      });
    };
    const actions = observeSelectionActions({
      element: viewport,
      getActionElement: () => containerRef.current,
      onSelection: update,
      onDismiss: clear,
    });
    actionsRef.current = actions;
    const focusActions = (event: KeyboardEvent) => {
      const container = containerRef.current;
      if (
        event.key !== "Tab" ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing ||
        event.defaultPrevented ||
        !container ||
        container.contains(event.target as Node)
      ) {
        return;
      }
      const focusTarget = container.querySelector<HTMLButtonElement>("button:not(:disabled)");
      if (!focusTarget) return;
      event.preventDefault();
      event.stopPropagation();
      focusTarget.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", focusActions, true);
    document.addEventListener("selectionchange", actions.selectionChanged);
    return () => {
      document.removeEventListener("keydown", focusActions, true);
      document.removeEventListener("selectionchange", actions.selectionChanged);
      actions.dispose();
      actionsRef.current = null;
    };
  }, [threadRef, viewport]);

  if (!selection) return null;
  const tooLong = selection.citation.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
  const existingBookmark = bookmarks
    ? findOverlappingBookmark(bookmarks, selection.citation)
    : null;
  const dismiss = () => {
    actionsRef.current?.cancel();
    setSelection(null);
  };
  const cite = () => {
    if (tooLong || !onCite(selection.citation, selection.sourceAnchor)) return false;
    window.getSelection()?.removeAllRanges();
    dismiss();
    return true;
  };
  const toggleBookmark = () => {
    if (tooLong || !onToggleBookmark) return;
    onToggleBookmark(selection.citation, existingBookmark?.id ?? null);
    window.getSelection()?.removeAllRanges();
    dismiss();
  };
  return createPortal(
    <div
      ref={containerRef}
      className="fixed z-50 flex max-w-[calc(100vw-1rem)] items-center gap-1 rounded-full border border-border/60 bg-popover/95 p-1 shadow-sm"
      style={{ left: selection.position.x, top: selection.position.y }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          dismiss();
        }
      }}
    >
      <Button
        type="button"
        size="xs"
        variant="glass"
        disabled={tooLong}
        aria-label={tooLong ? "Selection is too long to cite" : "Cite selection in composer"}
        className="rounded-full px-2.5"
        onPointerDown={(event) => event.preventDefault()}
        onClick={cite}
      >
        <QuoteIcon aria-hidden="true" className="size-3.5" />
        {tooLong ? "Shorten selection" : "Cite"}
      </Button>
      {onToggleBookmark ? (
        <Button
          type="button"
          size="xs"
          variant="glass"
          disabled={tooLong}
          aria-pressed={existingBookmark !== null}
          aria-label={
            tooLong
              ? "Selection is too long to bookmark"
              : existingBookmark
                ? "Remove bookmark"
                : "Bookmark selection"
          }
          className="rounded-full px-2.5"
          onPointerDown={(event) => event.preventDefault()}
          onClick={toggleBookmark}
        >
          <BookmarkIcon
            aria-hidden="true"
            className={cn("size-3.5", existingBookmark !== null && "fill-current")}
          />
          {existingBookmark ? "Unmark" : "Mark"}
        </Button>
      ) : null}
    </div>,
    document.body,
  );
}
