import type { MessageId, RunId } from "@t3tools/contracts";

export interface TimelineRunObservation {
  readonly threadKey: string | null;
  readonly hydrated: boolean;
  readonly runId: RunId | null;
}

export function observeTimelineRun(
  previous: TimelineRunObservation | null,
  input: TimelineRunObservation & {
    readonly queued: boolean;
    readonly messageId: MessageId | null;
  },
): { observation: TimelineRunObservation; anchorMessageId: MessageId | null } {
  const observation = {
    threadKey: input.threadKey,
    hydrated: input.hydrated,
    runId: input.queued ? null : input.runId,
  };
  if (previous?.threadKey !== input.threadKey || !previous.hydrated) {
    return { observation, anchorMessageId: null };
  }
  if (
    !input.hydrated ||
    input.runId === null ||
    input.queued ||
    previous.runId === input.runId ||
    input.messageId === null
  ) {
    return { observation: previous, anchorMessageId: null };
  }
  return { observation, anchorMessageId: input.messageId };
}
import type { RunAttemptId } from "@t3tools/contracts";

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
  threadHasStarted,
}: {
  readonly threadHasStarted: boolean;
}): TimelineSendScrollBehavior {
  return {
    mode: "anchoring-new-turn",
    liveFollowEnabled: true,
    anchorNewTurn: true,
    releaseOnToolActivity: !threadHasStarted,
  };
}

/**
 * Whether a send-time anchor whose anchored end space has collapsed to zero can
 * be dropped. Re-checked at every quiescent point (anchor ready, positioning
 * landed, turn settled):
 * - a still-running turn keeps its anchor: a size-0 report often arrives
 *   mid-stream, the moment the response outgrows the space, and releasing then
 *   would start pinning the stream to the end;
 * - only a send-time anchor is released: a palette reveal owns its anchor, and
 *   once the user scrolls away live follow is already off and returning to the
 *   end releases the anchor anyway;
 * - an in-flight positioning must land before the anchor state is torn down.
 */
export function shouldReleaseCollapsedTimelineAnchor(input: {
  readonly endSpaceCollapsed: boolean;
  readonly turnInProgress: boolean;
  readonly mode: TimelineScrollMode;
  readonly pendingAnchorId: string | null;
  readonly positionedAnchorId: string | null;
  readonly settledAnchorId: string | null;
}): boolean {
  if (!input.endSpaceCollapsed || input.turnInProgress || input.mode !== "anchoring-new-turn") {
    return false;
  }
  const positioningInFlight =
    input.pendingAnchorId !== null ||
    (input.positionedAnchorId !== null && input.settledAnchorId !== input.positionedAnchorId);
  return !positioningInFlight;
}

/**
 * The earlier-history request that would load a palette-revealed message, as a
 * `messageId:firstEntryId` key, or null when none is needed or possible. Keying
 * on the loaded window's first entry allows one request per window, so a page
 * that misses the message cannot loop.
 */
export function resolveRevealHistoryRequest(input: {
  readonly messageId: string | null;
  readonly revealPending: boolean;
  readonly messageLoaded: boolean;
  readonly firstEntryId: string | undefined;
  readonly history:
    | { readonly hasMoreHistory: boolean; readonly loading: boolean; readonly error: string | null }
    | undefined;
  readonly lastRequestKey: string | null;
}): string | null {
  if (input.messageId === null || !input.revealPending || input.messageLoaded) return null;
  if (!input.history?.hasMoreHistory || input.history.loading || input.history.error !== null) {
    return null;
  }
  const requestKey = `${input.messageId}:${input.firstEntryId ?? ""}`;
  return requestKey === input.lastRequestKey ? null : requestKey;
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
 * The list's own content length includes the composer inset spacer, so this
 * measures from the last row instead. Unknown row positions or an unmeasured
 * viewport counts as fitting.
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
  const lastIndex = state.data.length - 1;
  // Overflow can use an unmeasured tail's lower bound; anchored-turn metrics need its height.
  const lastTop = state.positionAtIndex(lastIndex);
  const lastBottom =
    getRowBottom(state, lastIndex) ??
    (typeof lastTop === "number" && Number.isFinite(lastTop) ? lastTop + 1 : null);
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
    readonly runs: ReadonlySet<RunId>;
    readonly workGroups: ReadonlySet<string>;
    readonly attempts: ReadonlySet<RunAttemptId>;
    readonly workGroupState: {
      scrollPositions: Map<string, { readonly entryId: string; readonly offset: number }>;
      expandedEntries: Set<string>;
    };
  };
}

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

export function rememberTimelinePosition(
  threadKey: string,
  position: RememberedTimelinePosition,
  liveFollowEnabled: boolean,
) {
  rememberedTimelinePositions.delete(threadKey);
  rememberedTimelinePositions.set(threadKey, {
    ...position,
    atEnd: liveFollowEnabled || position.atEnd,
  });
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
