import type { TurnId } from "@t3tools/contracts";

import {
  clearThreadTimelinePosition,
  readThreadTimelinePosition,
  saveThreadTimelinePosition,
} from "../../threadTimelinePositionStore";

// Match the titlebar fade inset so draft promotion preserves the first row's position.
export const CHAT_TIMELINE_ANCHOR_OFFSET = 24;

// "anchoring-reveal" is a command-palette search hit being pinned near the top.
// Distinct from "anchoring-new-turn" so the streaming turn-metrics adjustments,
// which assume an incoming response below the anchor, stay out of it.
export type TimelineScrollMode =
  | "following-end"
  | "anchoring-new-turn"
  | "anchoring-reveal"
  | "free-scrolling";

export interface TimelineSendScrollBehavior {
  readonly mode: TimelineScrollMode;
  readonly liveFollowEnabled: boolean;
  readonly anchorNewTurn: boolean;
  /**
   * Whether tool activity in the new turn drops the anchor and returns to
   * following the end. A thread's opening send keeps upstream's behavior, where
   * releasing avoids leaving the reserved end space blank behind a tool call. A
   * follow-up send holds its anchor instead: anchoring one exists so the reply
   * can be read from its start, and a coding agent's first tool call usually
   * lands a second or two after the send.
   */
  readonly releaseOnToolActivity: boolean;
}

export function resolveTimelineSendScrollBehavior({
  replyToMessageId,
  hasBlockReply,
  threadHasStarted,
}: {
  readonly replyToMessageId: string | null;
  readonly hasBlockReply: boolean;
  readonly threadHasStarted: boolean;
}): TimelineSendScrollBehavior {
  if (replyToMessageId !== null || hasBlockReply) {
    return {
      mode: "free-scrolling",
      liveFollowEnabled: false,
      anchorNewTurn: false,
      releaseOnToolActivity: false,
    };
  }

  return {
    mode: "anchoring-new-turn",
    liveFollowEnabled: true,
    anchorNewTurn: true,
    releaseOnToolActivity: !threadHasStarted,
  };
}

export interface TimelineListMeasurementState {
  readonly data: readonly unknown[];
  readonly scroll: number;
  readonly scrollLength: number;
  readonly positionAtIndex: (index: number) => number | undefined;
  readonly sizeAtIndex: (index: number) => number | undefined;
}

export interface AnchoredTurnMetrics {
  readonly anchorTop: number;
  readonly lastBottom: number;
  readonly turnHeight: number;
  readonly usableViewportHeight: number;
  readonly visibleUsableBottom: number;
  readonly overflowsUsableViewport: boolean;
  readonly targetScrollToRevealEnd: number;
  readonly scrollDeltaToRevealEnd: number;
}

export function getRowBottom(state: TimelineListMeasurementState, index: number): number | null {
  const top = state.positionAtIndex(index);
  const height = state.sizeAtIndex(index);
  if (
    typeof top !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(top) ||
    !Number.isFinite(height)
  ) {
    return null;
  }

  return top + Math.max(1, height);
}

/**
 * Whether the timeline's real rows extend past the viewport left above the
 * composer. The list's own content length includes the composer inset
 * spacer, so this measures from the last row instead. Unknown row geometry
 * or an unmeasured viewport counts as fitting.
 */
export function timelineContentOverflowsViewport(
  state: TimelineListMeasurementState | undefined,
  input: { readonly composerInset: number; readonly anchorOffset: number },
): boolean {
  if (!state || !state.data || state.data.length === 0) {
    return false;
  }
  const scrollLength = state.scrollLength;
  if (typeof scrollLength !== "number" || !Number.isFinite(scrollLength) || scrollLength <= 0) {
    return false;
  }
  const lastBottom = getRowBottom(state, state.data.length - 1);
  if (lastBottom === null) {
    return false;
  }
  const visibleScrollLength = Math.max(0, scrollLength - input.composerInset - input.anchorOffset);
  return lastBottom > visibleScrollLength;
}

export function getAnchoredTurnMetrics({
  state,
  anchorIndex,
  composerOverlayHeight,
  anchorOffset,
}: {
  readonly state: TimelineListMeasurementState;
  readonly anchorIndex: number;
  readonly composerOverlayHeight: number;
  readonly anchorOffset: number;
}): AnchoredTurnMetrics | null {
  if (state.data.length === 0) {
    return null;
  }

  const boundedAnchorIndex = Math.max(0, Math.min(anchorIndex, state.data.length - 1));
  const anchorTop = state.positionAtIndex(boundedAnchorIndex);
  const lastBottom = getRowBottom(state, state.data.length - 1);
  if (typeof anchorTop !== "number" || !Number.isFinite(anchorTop) || lastBottom === null) {
    return null;
  }

  const usableViewportHeight = Math.max(
    0,
    state.scrollLength - composerOverlayHeight - anchorOffset,
  );
  const turnHeight = Math.max(0, lastBottom - anchorTop);
  const visibleUsableBottom = state.scroll + usableViewportHeight;
  const targetScrollToRevealEnd = Math.max(0, lastBottom - usableViewportHeight);
  const scrollDeltaToRevealEnd = Math.max(0, targetScrollToRevealEnd - state.scroll);

  return {
    anchorTop,
    lastBottom,
    turnHeight,
    usableViewportHeight,
    visibleUsableBottom,
    overflowsUsableViewport: turnHeight > usableViewportHeight,
    targetScrollToRevealEnd,
    scrollDeltaToRevealEnd,
  };
}

export interface RememberedTimelinePosition {
  readonly rowId: string;
  readonly offsetWithinRow: number;
  readonly scrollOffset: number;
  readonly atEnd: boolean;
  /** Timestamp of the anchored row, mirrored to storage so a cold start keeps it. */
  readonly rowCreatedAt?: string | null;
  readonly disclosures?: {
    readonly turns: ReadonlySet<TurnId>;
    readonly workGroups: ReadonlySet<string>;
    readonly spawnEntries: ReadonlySet<string>;
    readonly reasoningMessages: ReadonlySet<string>;
    readonly workGroupState: {
      scrollPositions: Map<string, { readonly entryId: string; readonly offset: number }>;
      expandedEntries: Set<string>;
    };
  };
}

// Scoped thread keys keep separate environments independent. Bound the session cache.
const rememberedTimelinePositions = new Map<string, RememberedTimelinePosition>();

/**
 * The cache only lives as long as the tab, so on a cold start it falls through
 * to the persisted position. A seeded position carries no `disclosures`:
 * `workGroupState` holds live `Map`/`Set` objects that do not serialize, so a
 * reloaded thread restores its scroll offset with its groups collapsed.
 */
export function readTimelinePosition(threadKey: string) {
  const remembered = rememberedTimelinePositions.get(threadKey);
  if (remembered !== undefined) return remembered;
  const persisted = readThreadTimelinePosition(threadKey);
  if (persisted === undefined) return undefined;
  return {
    rowId: persisted.rowId,
    offsetWithinRow: persisted.offsetWithinRow,
    scrollOffset: persisted.scrollOffset ?? 0,
    atEnd: persisted.atEnd ?? false,
    rowCreatedAt: persisted.rowCreatedAt ?? null,
  } satisfies RememberedTimelinePosition;
}

export function rememberTimelinePosition(threadKey: string, position: RememberedTimelinePosition) {
  rememberedTimelinePositions.delete(threadKey);
  rememberedTimelinePositions.set(threadKey, position);
  if (rememberedTimelinePositions.size > 100) {
    const oldest = rememberedTimelinePositions.keys().next().value;
    if (oldest !== undefined) rememberedTimelinePositions.delete(oldest);
  }
  // Mirror the durable subset so a reload resumes where reading stopped. The
  // live edge is stored as absence, not as `atEnd: true`, so a cold start at
  // the bottom cannot restore a stale mid-thread anchor.
  if (position.atEnd) {
    clearThreadTimelinePosition(threadKey);
    return;
  }
  saveThreadTimelinePosition(threadKey, {
    rowId: position.rowId,
    offsetWithinRow: position.offsetWithinRow,
    scrollOffset: position.scrollOffset,
    atEnd: position.atEnd,
    ...(position.rowCreatedAt !== undefined ? { rowCreatedAt: position.rowCreatedAt } : {}),
  });
}
