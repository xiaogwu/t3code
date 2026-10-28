import { useStableCallback } from "../../hooks/useStableCallback";
import { type MessageId, type RunId } from "@t3tools/contracts";
import { CHAT_LIST_ANCHOR_OFFSET } from "@t3tools/shared/chatList";
import { Debouncer } from "@tanstack/react-pacer";
import {
  type SetStateAction,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { type LegendListRef } from "@legendapp/list/react";
import {
  CHAT_TIMELINE_ANCHOR_OFFSET,
  timelineContentOverflowsViewport,
  readTimelinePosition,
  observeTimelineRun,
  resolveRevealHistoryRequest,
  shouldReleaseCollapsedTimelineAnchor,
  type TimelineRunObservation,
  type TimelineScrollMode,
  type TimelineSendScrollBehavior,
} from "./timelineScrollAnchoring";
import { subscribeToThreadScrollRequests } from "./threadScrollRequest";
import { useThreadMessageRevealStore } from "../../threadMessageRevealStore";
import { createPageScrollController, type PageScrollKey } from "./pageScrollController";
import {
  FOLLOWING,
  initialTimelineFollow,
  navigationReleasesFollow,
  transitionTimelineFollow,
  type TimelineFollow,
  type TimelineFollowEvent,
  type TimelineNavigation,
  type TimelineViewport,
} from "./timelineViewport";
import { resolveTimelineIsAtEnd, type MessagesTimelineRow } from "./MessagesTimeline.logic";
import { measuredEndOffset, settleListScroll } from "./useTimelinePositionRestore";
import {
  releaseChatTimelineAnchor,
  shouldReleaseTimelineAnchorForToolActivity,
} from "../ChatView.logic";
import type { Dispatch, RefObject } from "react";
import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import type { deriveThreadActivityRun } from "@t3tools/client-runtime/state/thread-execution";
import type { EnvironmentThreadStatus } from "@t3tools/client-runtime/state/threads";
import type { TimelineEntry } from "../../session-logic";
import type { ChatMessage } from "../../types";

const TIMELINE_SCROLL_CANCEL_SENTINEL = Object.freeze({});

interface TimelineAnchor {
  readonly threadKey: string | null;
  readonly messageId: MessageId | null;
}

/** One visit to a thread; a switch starts a new one from the remembered position. */
interface TimelineFollowVisit {
  readonly threadKey: string | null;
  readonly followEnd: boolean;
}

/**
 * Scroll bookkeeping that belongs to one visit. Handlers fetch it for the
 * current visit, so a thread switch leaves the old one behind instead of
 * resetting it.
 */
function createVisitScrollState(
  visit: TimelineFollowVisit,
  showScrollToBottom: (visit: TimelineFollowVisit) => void,
) {
  return {
    visit,
    // Debounce *showing* the scroll-to-bottom pill so it doesn't flash during
    // thread switches. LegendList fires scroll events with isAtEnd=false while
    // initialScrollAtEnd is settling; hiding is always immediate.
    showScrollDebouncer: new Debouncer(() => showScrollToBottom(visit), { wait: 150 }),
    positionedAnchor: null as MessageId | null,
    settledAnchor: null as MessageId | null,
    releaseAnchorScrollHold: null as (() => void) | null,
    pendingAnchorScrollRestore: null as {
      readonly messageId: MessageId;
      readonly offset: number;
    } | null,
    anchorScrollRestoreFrame: null as number | null,
    // Fork: what armed the anchor named by anchorFor. "send" is a send-time
    // anchor, "reveal" a command-palette hit still positioning, "revealed" one
    // that has landed and is free-scrolled. Anchors armed elsewhere (a run that
    // started while following) leave these unset and keep upstream behavior.
    anchorFor: null as MessageId | null,
    anchorKind: null as "send" | "reveal" | "revealed" | null,
    // Whether the send-time anchor yields to tool activity in its turn. A
    // thread's opening anchor releases, a follow-up's holds.
    releasesOnToolActivity: true,
    // True once the armed anchor's end space has shrunk to zero: the response
    // outgrew the reserved blank space, so the anchored view is identical to
    // ordinary end-following and the anchor can be released.
    endSpaceCollapsed: false,
    // The last earlier-history page requested for a reveal, as messageId:firstEntryId.
    revealHistoryRequest: null as string | null,
  };
}
type VisitScrollState = ReturnType<typeof createVisitScrollState>;

function stopAnchorPositioning(scroll: VisitScrollState) {
  scroll.positionedAnchor = null;
  scroll.settledAnchor = null;
  scroll.releaseAnchorScrollHold?.();
  scroll.releaseAnchorScrollHold = null;
}

/** Whether the list still shows the anchored message; a thread switch replaces its data. */
function listShowsMessage(list: LegendListRef | null, messageId: MessageId): boolean {
  const rows = list?.getState().data as ReadonlyArray<MessagesTimelineRow> | undefined;
  return rows?.some((row) => row.kind === "message" && row.message.id === messageId) === true;
}

/**
 * The follow mode, read by scroll listeners at event time and by render
 * through useSyncExternalStore. State recorded for an earlier visit is
 * discarded, so a thread switch needs no reset step.
 */
function createTimelineFollowStore() {
  let snapshot: { readonly visit: TimelineFollowVisit | null; readonly follow: TimelineFollow } = {
    visit: null,
    follow: FOLLOWING,
  };
  const listeners = new Set<() => void>();
  // Page keys read the overlay at keypress time; it changes no rendered state.
  let composerOverlay: HTMLElement | null = null;
  const read = (visit: TimelineFollowVisit) =>
    snapshot.visit === visit ? snapshot.follow : initialTimelineFollow(visit.followEnd);
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => snapshot,
    read,
    /** Ref callback for the composer overlay. */
    attachComposerOverlay: (element: HTMLElement | null) => {
      composerOverlay = element;
    },
    readComposerOverlayHeight: () => composerOverlay?.getBoundingClientRect().height ?? 0,
    dispatch: (visit: TimelineFollowVisit, event: TimelineFollowEvent) => {
      const before = read(visit);
      const after = transitionTimelineFollow(before, event);
      if (snapshot.visit !== visit || after !== snapshot.follow) {
        snapshot = { visit, follow: after };
        for (const listener of listeners) listener();
      }
      return { before, after };
    },
  };
}

function sameRunObservation(
  next: TimelineRunObservation,
  previous: TimelineRunObservation | null,
): boolean {
  return (
    previous !== null &&
    next.threadKey === previous.threadKey &&
    next.hydrated === previous.hydrated &&
    next.runId === previous.runId
  );
}

interface TimelineFollowInput {
  readonly legendListRef: RefObject<LegendListRef | null>;
  readonly composerTimelineInset: number;
  readonly routeThreadKey: string;
  readonly activeThreadKey: string | null;
  readonly isServerThread: boolean;
  readonly serverProjection: ThreadStructure | null;
  readonly threadStatus: EnvironmentThreadStatus;
  readonly activeActivityRun: ReturnType<typeof deriveThreadActivityRun>;
  readonly activeRunningTurnId: RunId | null;
  readonly timelineEntries: ReadonlyArray<TimelineEntry>;
  readonly timelineAnchorMessageId: MessageId | null;
  readonly setTimelineAnchor: Dispatch<SetStateAction<TimelineAnchor>>;
  readonly timelineMessages: ReadonlyArray<ChatMessage>;
  readonly threadHistoryControls: TimelineHistoryControls | undefined;
  /** The anchored message's run has settled, so its end space can go. */
  readonly anchorRunSettled: boolean;
  /**
   * Wider than isWorking: a run that has stopped streaming but not yet settled
   * is still growing, so the collapsed-anchor release waits for it.
   */
  readonly activeTurnInProgress: boolean;
}

interface TimelineHistoryControls {
  readonly hasMoreHistory: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onLoadEarlier: (throughEntryId?: string) => void;
}

const DEFAULT_SEND_SCROLL_BEHAVIOR: TimelineSendScrollBehavior = {
  mode: "anchoring-new-turn",
  liveFollowEnabled: true,
  anchorNewTurn: true,
  releaseOnToolActivity: true,
};

/**
 * Keeps the timeline following the live end, anchoring a newly sent turn near
 * the top, and letting the user scroll away. Follow lives in a store the
 * viewport's navigation signal writes, so a scroll gesture does not re-render
 * ChatView unless the follow mode flips.
 */
export function useTimelineFollow(input: TimelineFollowInput) {
  const {
    legendListRef,
    composerTimelineInset,
    routeThreadKey,
    activeThreadKey,
    isServerThread,
    serverProjection,
    threadStatus,
    activeActivityRun,
    activeRunningTurnId,
    timelineEntries,
    timelineAnchorMessageId,
    setTimelineAnchor,
    timelineMessages,
    threadHistoryControls,
    anchorRunSettled,
    activeTurnInProgress,
  } = input;
  const [visitState, setVisit] = useState<TimelineFollowVisit>({
    threadKey: activeThreadKey,
    followEnd: true,
  });
  let visit = visitState;
  if (visit.threadKey !== activeThreadKey) {
    visit = {
      threadKey: activeThreadKey,
      followEnd: readTimelinePosition(routeThreadKey)?.atEnd !== false,
    };
    setVisit(visit);
  }
  // Keyed by visit, so a pill decision from the previous thread (a pending
  // debounce) never shows here.
  const [pill, setPill] = useState<{ readonly visit: TimelineFollowVisit; readonly show: boolean }>(
    { visit, show: false },
  );
  const showScrollToBottom = pill.visit === visit ? pill.show : !visit.followEnd;
  // Called on every streamed chunk while following; an unchanged pill must
  // bail out instead of re-rendering ChatView.
  const setShowScrollToBottom = (show: boolean) =>
    setPill((current) =>
      current.visit === visit && current.show === show ? current : { visit, show },
    );
  const [followStore] = useState(createTimelineFollowStore);
  const followSnapshot = useSyncExternalStore(followStore.subscribe, followStore.snapshot);
  const follow =
    followSnapshot.visit === visit ? followSnapshot.follow : initialTimelineFollow(visit.followEnd);
  const timelineLiveFollowEnabled = follow.mode === "following";
  const readFollow = () => followStore.read(visit);
  // Async settles outlive their render; this reads the visit shown now.
  const readCurrentFollow = useStableCallback(readFollow);
  const isTimelineAtLogicalEnd = () => {
    const current = readFollow();
    return (
      resolveTimelineIsAtEnd(legendListRef.current?.getState()) ??
      (current.mode === "following" || current.atEnd)
    );
  };
  const visitScrollRef = useRef<VisitScrollState | null>(null);
  /** Only from handlers: the bookkeeping of the visit they run in. */
  const visitScroll = () => {
    if (visitScrollRef.current?.visit !== visit) {
      visitScrollRef.current = createVisitScrollState(visit, (shownVisit) => {
        // A debounce that outlived its visit must not overwrite the current one's pill.
        if (visitScrollRef.current?.visit === shownVisit)
          setPill({ visit: shownVisit, show: true });
      });
    }
    return visitScrollRef.current;
  };
  // The anchor whose list position LegendList reported ready; until then a
  // newly started run must not re-anchor.
  const [laidOutAnchor, setLaidOutAnchor] = useState<MessageId | null>(null);
  const anchorPending =
    timelineAnchorMessageId !== null && laidOutAnchor !== timelineAnchorMessageId;
  // Fork: async checks (timers, list promises) read the anchor shown now.
  const isAnchorPending = useStableCallback(
    (messageId: MessageId) =>
      timelineAnchorMessageId === messageId && laidOutAnchor !== timelineAnchorMessageId,
  );
  const viewportRef = useRef<TimelineViewport | null>(null);
  const releaseFollowForNavigation = () => {
    const { before } = followStore.dispatch(visit, { type: "navigated" });
    if (before.mode === "following") viewportRef.current?.followReleased();
    const scroll = visitScroll();
    stopAnchorPositioning(scroll);
    // A user who scrolls away owns the view; a collapsed send anchor stays put.
    if (scroll.anchorKind === "send") scroll.anchorKind = null;
    scroll.pendingAnchorScrollRestore = null;
    if (scroll.anchorScrollRestoreFrame !== null) {
      cancelAnimationFrame(scroll.anchorScrollRestoreFrame);
      scroll.anchorScrollRestoreFrame = null;
    }
    if (before.mode === "following") {
      // LegendList may run queued scrolls after user navigation. A new imperative
      // scroll cancels that queue; a missing item cancels without moving the view.
      void legendListRef.current?.scrollToItem({
        item: TIMELINE_SCROLL_CANCEL_SENTINEL,
        animated: false,
      });
      // An already-started animated scroll (behavior: smooth) keeps running in
      // the browser regardless of the queue; a same-position instant write is
      // the only way to halt it where it is.
      const scrollNode = legendListRef.current?.getScrollableNode() as
        | { scrollTop?: number }
        | null
        | undefined;
      const currentScrollTop = scrollNode?.scrollTop;
      if (scrollNode && typeof currentScrollTop === "number") {
        scrollNode.scrollTop = currentScrollTop;
      }
    }
  };

  // A run that starts while the live end is followed anchors its user message
  // near the top, unless the previous anchor has not been laid out yet.
  const [observedRun, setObservedRun] = useState<TimelineRunObservation | null>(null);
  const dispatchedUserItem =
    observedRun?.hydrated &&
    observedRun.threadKey === activeThreadKey &&
    activeActivityRun !== null &&
    observedRun.runId !== activeActivityRun.runId
      ? serverProjection?.visibleTurnItems.find(
          (row) => row.item.type === "user_message" && row.item.runId === activeActivityRun.runId,
        )
      : undefined;
  const runObservation = observeTimelineRun(observedRun, {
    threadKey: activeThreadKey,
    hydrated: !isServerThread || (serverProjection !== null && threadStatus === "live"),
    runId: activeActivityRun?.runId ?? null,
    queued: activeActivityRun?.status === "queued",
    messageId:
      dispatchedUserItem?.item.type === "user_message" ? dispatchedUserItem.item.messageId : null,
  });
  if (!sameRunObservation(runObservation.observation, observedRun)) {
    setObservedRun(runObservation.observation);
    const startedRunAnchor = runObservation.anchorMessageId;
    if (startedRunAnchor !== null && !anchorPending && timelineLiveFollowEnabled) {
      setShowScrollToBottom(false);
      setTimelineAnchor({ threadKey: activeThreadKey, messageId: startedRunAnchor });
    }
  }
  const timelineRealContentOverflowsViewport = () =>
    timelineContentOverflowsViewport(legendListRef.current?.getState(), {
      composerInset: composerTimelineInset,
      anchorOffset: CHAT_TIMELINE_ANCHOR_OFFSET,
    });
  const pageScrollControllerRef = useRef<ReturnType<typeof createPageScrollController> | null>(
    null,
  );
  const handlePageScrollStart = useStableCallback((key: PageScrollKey) => {
    if ((key === "PageUp" && timelineRealContentOverflowsViewport()) || !isTimelineAtLogicalEnd()) {
      // Through the viewport, so a running position restore stops too.
      viewportRef.current?.navigate({ releasesFollow: true });
    }
  });
  const onComposerPageScrollKeyDown = (key: PageScrollKey) => {
    pageScrollControllerRef.current?.handleKeyDown(key);
  };
  const onComposerPageScrollKeyDownStable = useStableCallback(onComposerPageScrollKeyDown);
  const onComposerPageScrollKeyUp = (key: string) => {
    pageScrollControllerRef.current?.handleKeyUp(key);
  };
  const onComposerPageScrollKeyUpStable = useStableCallback(onComposerPageScrollKeyUp);
  const onComposerPageScrollRelease = () => {
    pageScrollControllerRef.current?.releaseActiveKey();
  };
  const onComposerPageScrollReleaseStable = useStableCallback(onComposerPageScrollRelease);
  const scrollToEnd = (animated: boolean = false) => {
    // Stops a running position restore; follow itself is re-armed below.
    viewportRef.current?.navigate({ releasesFollow: false });
    followStore.dispatch(visit, { type: "followEnd" });
    const endScroll = visitScroll();
    endScroll.showScrollDebouncer.cancel();
    endScroll.anchorFor = null;
    endScroll.anchorKind = null;
    endScroll.endSpaceCollapsed = false;
    setShowScrollToBottom(false);
    setTimelineAnchor(releaseChatTimelineAnchor);
    // The anchored end space must be gone before the scroll measures, or the
    // list lands short of the real end.
    requestAnimationFrame(() => {
      const list = legendListRef.current;
      if (!list) return;
      void Promise.resolve(
        list.scrollToEnd?.({
          animated: animated && !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        }),
      ).then(() =>
        settleListScroll(
          list,
          measuredEndOffset,
          () => readCurrentFollow().mode !== "following" || legendListRef.current !== list,
        ),
      );
    });
  };
  const scrollToEndStable = useStableCallback(scrollToEnd);
  // Fork: shared by the thread.scrollToTop/End shortcuts and command palette items.
  // A stable callback rather than an effect event: keyboard handlers call it too.
  const scrollTimelineTo = useStableCallback((target: "top" | "end") => {
    if (target === "end") {
      scrollToEnd(true);
      return;
    }
    // Through the viewport, so a running position restore stops too.
    if (viewportRef.current) viewportRef.current.navigate({ releasesFollow: true });
    else releaseFollowForNavigation();
    void legendListRef.current?.scrollToIndex({ index: 0, animated: true });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to an external window event bus
  useEffect(() => subscribeToThreadScrollRequests(scrollTimelineTo), [scrollTimelineTo]);
  // The list does not follow footer layout, so the resting composer cannot scroll it. Growth
  // above the composer (a new notice) would cover the last rows instead.
  const followedInsetRef = useRef(composerTimelineInset);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the list after its bottom inset grows
  useLayoutEffect(() => {
    const grew = composerTimelineInset > followedInsetRef.current;
    followedInsetRef.current = composerTimelineInset;
    if (grew && readCurrentFollow().mode === "following") scrollToEndStable();
  }, [composerTimelineInset, readCurrentFollow, scrollToEndStable]);

  const handleNavigation = (navigation: TimelineNavigation) => {
    const awayFromEnd = () => resolveTimelineIsAtEnd(legendListRef.current?.getState()) === false;
    const releases = navigationReleasesFollow(navigation, {
      contentScrollsUp: timelineRealContentOverflowsViewport,
      awayFromEnd,
    });
    if (releases) releaseFollowForNavigation();
  };
  const handleNavigationStable = useStableCallback(handleNavigation);
  /**
   * Attached by the timeline's list ref callback, so follow hears the
   * viewport's navigation exactly as long as the scroll node exists.
   */
  const attachTimelineViewport = (viewport: TimelineViewport) => {
    viewportRef.current = viewport;
    const unsubscribe = viewport.subscribe(handleNavigationStable);
    const controller = createPageScrollController({
      getContainer: () => viewport.scrollNode,
      getScrollPaddingBottomPx: followStore.readComposerOverlayHeight,
      onScrollStart: handlePageScrollStart,
    });
    pageScrollControllerRef.current = controller;
    return () => {
      unsubscribe();
      controller.dispose();
      if (pageScrollControllerRef.current === controller) pageScrollControllerRef.current = null;
      if (viewportRef.current === viewport) viewportRef.current = null;
      const scroll = visitScrollRef.current;
      scroll?.releaseAnchorScrollHold?.();
      if (scroll) scroll.releaseAnchorScrollHold = null;
    };
  };

  // Fork: the follow mode the collapsed-anchor release reasons about.
  const anchorScrollMode = (scroll: VisitScrollState): TimelineScrollMode => {
    if (timelineAnchorMessageId !== null && scroll.anchorFor === timelineAnchorMessageId) {
      if (scroll.anchorKind === "reveal") return "anchoring-reveal";
      if (scroll.anchorKind === "revealed") return "free-scrolling";
    }
    if (readFollow().mode !== "following") return "free-scrolling";
    return timelineAnchorMessageId !== null ? "anchoring-new-turn" : "following-end";
  };
  // Fork: a stale armed anchor keeps the list from maintaining the live end, so
  // a layout resize (sidebar or right panel toggle) strands the viewport short
  // of it. Once the end space has collapsed, releasing the anchor is visually a
  // no-op and hands ordinary end-follow back. Backs up the anchorRunSettled
  // release, which only fires for an anchor it can match to a run. Returns true
  // when it released.
  const maybeReleaseCollapsedTimelineAnchor = useStableCallback(() => {
    const scroll = visitScroll();
    if (
      timelineAnchorMessageId === null ||
      !shouldReleaseCollapsedTimelineAnchor({
        endSpaceCollapsed: scroll.endSpaceCollapsed,
        turnInProgress: activeTurnInProgress,
        mode: anchorScrollMode(scroll),
        pendingAnchorId: isAnchorPending(timelineAnchorMessageId) ? timelineAnchorMessageId : null,
        positionedAnchorId: scroll.positionedAnchor,
        settledAnchorId: scroll.settledAnchor,
      })
    ) {
      return false;
    }
    stopAnchorPositioning(scroll);
    scroll.endSpaceCollapsed = false;
    scroll.anchorFor = null;
    scroll.anchorKind = null;
    setTimelineAnchor(releaseChatTimelineAnchor);
    return true;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- re-checks the collapsed-anchor release once the turn settles
  useEffect(() => {
    if (!activeTurnInProgress) maybeReleaseCollapsedTimelineAnchor();
  }, [activeTurnInProgress, maybeReleaseCollapsedTimelineAnchor]);
  // Fork: released from an effect, not during render. A palette reveal anchors
  // a message whose run settled long ago and owns that anchor until the user
  // scrolls back to the end or switches threads.
  const releaseSettledAnchor = useStableCallback(() => {
    const scroll = visitScroll();
    if (
      timelineAnchorMessageId !== null &&
      scroll.anchorFor === timelineAnchorMessageId &&
      (scroll.anchorKind === "reveal" || scroll.anchorKind === "revealed")
    ) {
      return;
    }
    setTimelineAnchor({ threadKey: activeThreadKey, messageId: null });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drops the anchored end space once its run settles
  useEffect(() => {
    if (anchorRunSettled) releaseSettledAnchor();
  }, [anchorRunSettled, activeThreadKey, releaseSettledAnchor]);

  // Fork: palette reveal highlight state, declared before the anchor callbacks that set it.
  const [highlightedMessageId, setHighlightedMessageId] = useState<MessageId | null>(null);
  // Held outside the reveal effect: clearReveal() inside it flips revealRequest
  // to null next render, and an effect-owned cleanup would cancel these timers.
  const revealStaleAnchorTimeoutRef = useRef<number | null>(null);
  const revealHighlightTimeoutRef = useRef<number | null>(null);

  const onTimelineAnchorReady = (
    messageId: MessageId,
    anchorIndex: number,
    endSpaceSize: number,
  ) => {
    const scroll = visitScroll();
    scroll.endSpaceCollapsed = endSpaceSize === 0;
    if (maybeReleaseCollapsedTimelineAnchor()) {
      return;
    }
    setLaidOutAnchor(messageId);
    if (scroll.positionedAnchor === messageId) {
      return;
    }
    stopAnchorPositioning(scroll);
    scroll.positionedAnchor = messageId;
    if (scroll.anchorFor === messageId && scroll.anchorKind === "reveal") {
      // Pulse once the row is about to scroll in, which may be after earlier
      // history loaded, not when the reveal was requested. Two cycles (650ms
      // each) plus slack, so a later re-render cannot re-trigger it.
      setHighlightedMessageId(messageId);
      if (revealHighlightTimeoutRef.current !== null) {
        window.clearTimeout(revealHighlightTimeoutRef.current);
      }
      revealHighlightTimeoutRef.current = window.setTimeout(() => {
        revealHighlightTimeoutRef.current = null;
        setHighlightedMessageId((current) => (current === messageId ? null : current));
      }, 1500);
    }
    // The positioning scroll moves up when the anchor sits above the view.
    const releaseHold = viewportRef.current?.holdProgrammaticScroll() ?? (() => {});
    scroll.releaseAnchorScrollHold = releaseHold;
    const isPositioning = () =>
      scroll.positionedAnchor === messageId && listShowsMessage(legendListRef.current, messageId);
    // Releasing is idempotent, so an attempt that is no longer current (the
    // thread switched, the user navigated) always lets go of its own hold.
    const abandon = () => {
      releaseHold();
      if (scroll.positionedAnchor === messageId) stopAnchorPositioning(scroll);
    };
    const positionAnchor = (remainingAttempts: number) => {
      requestAnimationFrame(() => {
        if (!isPositioning()) {
          abandon();
          return;
        }
        const list = legendListRef.current;
        if (!list) {
          if (remainingAttempts > 0) {
            positionAnchor(remainingAttempts - 1);
          } else {
            abandon();
          }
          return;
        }
        // LegendList waits for queued layout and the animation before resolving.
        void list
          .scrollToIndex({
            index: anchorIndex,
            animated: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
            viewPosition: 0,
            viewOffset: CHAT_LIST_ANCHOR_OFFSET,
          })
          .then(() => {
            if (legendListRef.current === list && isPositioning()) {
              scroll.settledAnchor = messageId;
              releaseHold();
              scroll.releaseAnchorScrollHold = null;
              // A reveal has no streaming turn to keep tracking, so hand the
              // list back to ordinary free scrolling once it has landed.
              if (scroll.anchorFor === messageId && scroll.anchorKind === "reveal") {
                scroll.anchorKind = "revealed";
              }
              // The space may have collapsed while positioning was in flight.
              maybeReleaseCollapsedTimelineAnchor();
            } else {
              abandon();
            }
          });
      });
    };
    requestAnimationFrame(() => positionAnchor(12));
  };
  const onTimelineAnchorReadyStable = useStableCallback(onTimelineAnchorReady);
  const onTimelineAnchorSizeChanged = (messageId: MessageId) => {
    const scroll = visitScroll();
    if (scroll.settledAnchor !== messageId || readFollow().mode === "following") {
      return;
    }
    const scrollOffset = legendListRef.current?.getState().scroll;
    if (scrollOffset === undefined) {
      return;
    }
    if (scroll.pendingAnchorScrollRestore === null) {
      scroll.pendingAnchorScrollRestore = { messageId, offset: scrollOffset };
    }
    if (scroll.anchorScrollRestoreFrame !== null) {
      return;
    }
    scroll.anchorScrollRestoreFrame = requestAnimationFrame(() => {
      scroll.anchorScrollRestoreFrame = null;
      const pending = scroll.pendingAnchorScrollRestore;
      scroll.pendingAnchorScrollRestore = null;
      if (pending && scroll.settledAnchor === pending.messageId) {
        const list = legendListRef.current;
        const currentScrollOffset = list?.getState().scroll;
        if (
          typeof currentScrollOffset === "number" &&
          Math.abs(currentScrollOffset - pending.offset) <= 2
        ) {
          void list?.scrollToOffset({ offset: pending.offset, animated: false });
        }
      }
    });
  };
  const onTimelineAnchorSizeChangedStable = useStableCallback(onTimelineAnchorSizeChanged);

  // The list ignores footer layout, so a new queued turn or status line there would land
  // under the composer. Follow it when the reader was following the end.
  const onTimelineFooterGrow = () => {
    if (readFollow().mode === "following") scrollToEndStable();
  };
  const onTimelineFooterGrowStable = useStableCallback(onTimelineFooterGrow);

  const onIsAtEndChange = (isAtEnd: boolean) => {
    const scroll = visitScroll();
    // Fork: a reveal starts from the live edge, so the list can still report
    // isAtEnd while the anchor scroll is in flight. Honoring that would re-arm
    // follow and drop the reveal's anchor.
    if (isAtEnd && scroll.anchorKind === "reveal" && scroll.anchorFor === timelineAnchorMessageId) {
      return;
    }
    if (!isAtEnd && readFollow().mode === "following") {
      scroll.showScrollDebouncer.cancel();
      setShowScrollToBottom(false);
      return;
    }
    const { before, after } = followStore.dispatch(visit, {
      type: isAtEnd ? "reachedEnd" : "leftEnd",
    });
    if (after === before) return;
    if (after.mode === "following") {
      setTimelineAnchor(releaseChatTimelineAnchor);
      scroll.showScrollDebouncer.cancel();
      setShowScrollToBottom(false);
    } else {
      scroll.showScrollDebouncer.maybeExecute();
    }
  };
  const onIsAtEndChangeStable = useStableCallback(onIsAtEndChange);

  // timelineEntries leave out reasoning rows (their text is not in the
  // structure), and reasoning counts as tool activity, like any work row.
  const runningTurnHasReasoning =
    activeRunningTurnId !== null &&
    serverProjection?.visibleTurnItems.some(
      (row) => row.item.type === "reasoning" && row.item.runId === activeRunningTurnId,
    ) === true;
  // Z: the release scrolls, and that scroll must follow the commit that drops
  // the anchored end space; the trigger is streamed thread data. A
  // totalSize listener cannot replace it: the anchored end space can already
  // be 0, so dropping it changes no size and no list event fires.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the timeline to the end after the commit that drops anchored end space
  useLayoutEffect(() => {
    if (timelineAnchorMessageId === null || !timelineLiveFollowEnabled) return;
    // Fork: a follow-up send holds its anchor through tool activity.
    const scroll = visitScrollRef.current;
    if (
      scroll?.visit === visit &&
      scroll.anchorFor === timelineAnchorMessageId &&
      !scroll.releasesOnToolActivity
    ) {
      return;
    }
    if (
      runningTurnHasReasoning ||
      shouldReleaseTimelineAnchorForToolActivity({
        anchorMessageId: timelineAnchorMessageId,
        liveFollowEnabled: timelineLiveFollowEnabled,
        runningTurnId: activeRunningTurnId,
        timelineEntries,
      })
    ) {
      scrollToEndStable();
    }
  }, [
    activeRunningTurnId,
    runningTurnHasReasoning,
    scrollToEndStable,
    timelineAnchorMessageId,
    timelineEntries,
    timelineLiveFollowEnabled,
    visit,
  ]);

  // Fork: command-palette content-match reveal. The request arrives through an
  // external store; applying it arms per-visit refs render cannot touch.
  const revealRequest = useThreadMessageRevealStore((state) => state.request);
  const applyReveal = useStableCallback(
    (request: { readonly messageId: MessageId; readonly requestId: number }) => {
      const messageId = request.messageId;
      // The reveal leaves the live end, like user navigation.
      if (viewportRef.current) viewportRef.current.navigate({ releasesFollow: true });
      else releaseFollowForNavigation();
      const scroll = visitScroll();
      // Cleared so revealing the same message twice re-runs the positioning.
      stopAnchorPositioning(scroll);
      scroll.anchorFor = messageId;
      scroll.anchorKind = "reveal";
      // A collapsed flag left over from the previous turn would release this
      // reveal anchor the moment it reports ready.
      scroll.endSpaceCollapsed = false;
      scroll.revealHistoryRequest = null;
      scroll.showScrollDebouncer.cancel();
      setShowScrollToBottom(false);
      setLaidOutAnchor(null);
      setTimelineAnchor({ threadKey: activeThreadKey, messageId });
      useThreadMessageRevealStore.getState().clearReveal(request.requestId);

      if (revealStaleAnchorTimeoutRef.current !== null) {
        window.clearTimeout(revealStaleAnchorTimeoutRef.current);
      }
      if (revealHighlightTimeoutRef.current !== null) {
        window.clearTimeout(revealHighlightTimeoutRef.current);
      }
      // Stale-anchor guard: a message deleted or compacted away never lays
      // out, so drop the reveal if it never lands. History paging toward the
      // message counts as progress and re-arms.
      const armStaleAnchorGuard = (historyRequestAtArm: string | null) => {
        revealStaleAnchorTimeoutRef.current = window.setTimeout(() => {
          revealStaleAnchorTimeoutRef.current = null;
          if (scroll.anchorFor !== messageId || scroll.anchorKind !== "reveal") return;
          if (!isAnchorPending(messageId)) return;
          if (scroll.revealHistoryRequest !== historyRequestAtArm) {
            armStaleAnchorGuard(scroll.revealHistoryRequest);
            return;
          }
          scroll.anchorFor = null;
          scroll.anchorKind = null;
          setTimelineAnchor(releaseChatTimelineAnchor);
          scroll.showScrollDebouncer.maybeExecute();
        }, 5000);
      };
      armStaleAnchorGuard(null);
    },
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies a reveal requested through an external store
  useEffect(() => {
    // A request for a thread that never became active waits in the store until
    // that thread mounts or a later reveal replaces it.
    if (revealRequest === null || revealRequest.threadKey !== activeThreadKey) return;
    applyReveal(revealRequest);
  }, [revealRequest, activeThreadKey, applyReveal]);
  // A revealed message can sit above the loaded history window. Page earlier
  // history through it; the anchor positions the row once it is loaded. One
  // request per loaded window, so a page that misses the message cannot loop.
  const requestRevealHistory = useStableCallback(() => {
    const messageId = timelineAnchorMessageId;
    const scroll = visitScroll();
    const requestKey = resolveRevealHistoryRequest({
      messageId,
      revealPending:
        messageId !== null &&
        scroll.anchorFor === messageId &&
        scroll.anchorKind === "reveal" &&
        isAnchorPending(messageId),
      messageLoaded: timelineMessages.some((message) => message.id === messageId),
      firstEntryId: timelineEntries[0]?.id,
      history: threadHistoryControls,
      lastRequestKey: scroll.revealHistoryRequest,
    });
    if (requestKey === null || messageId === null) return;
    scroll.revealHistoryRequest = requestKey;
    threadHistoryControls?.onLoadEarlier(messageId);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pages history toward a revealed message
  useEffect(() => {
    requestRevealHistory();
  }, [
    requestRevealHistory,
    threadHistoryControls,
    timelineAnchorMessageId,
    timelineEntries,
    timelineMessages,
  ]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the reveal timers on unmount
  useEffect(
    () => () => {
      if (revealStaleAnchorTimeoutRef.current !== null) {
        window.clearTimeout(revealStaleAnchorTimeoutRef.current);
      }
      if (revealHighlightTimeoutRef.current !== null) {
        window.clearTimeout(revealHighlightTimeoutRef.current);
      }
    },
    [],
  );

  /**
   * Applies a send's scroll behavior before its run exists: either arms the
   * anchor for the message the user just sent, or (fork: a reply citing this
   * thread) keeps the cited source in place until Scroll to end is used.
   */
  const anchorNewTurn = (
    threadKey: string,
    messageId: MessageId,
    behavior: TimelineSendScrollBehavior = DEFAULT_SEND_SCROLL_BEHAVIOR,
  ) => {
    const scroll = visitScroll();
    if (!behavior.anchorNewTurn) {
      // Released like user navigation, so neither the list's end maintenance
      // nor a starting run pulls the view to the new turn.
      if (viewportRef.current) viewportRef.current.navigate({ releasesFollow: true });
      else releaseFollowForNavigation();
      scroll.anchorFor = null;
      scroll.anchorKind = null;
      scroll.endSpaceCollapsed = false;
      return;
    }
    followStore.dispatch(visit, { type: "followEnd" });
    scroll.showScrollDebouncer.cancel();
    scroll.anchorFor = messageId;
    scroll.anchorKind = "send";
    scroll.releasesOnToolActivity = behavior.releaseOnToolActivity;
    scroll.endSpaceCollapsed = false;
    setShowScrollToBottom(false);
    setTimelineAnchor({ threadKey, messageId });
  };

  return {
    showScrollToBottom,
    timelineLiveFollowEnabled,
    onComposerPageScrollKeyDownStable,
    onComposerPageScrollKeyUpStable,
    onComposerPageScrollReleaseStable,
    scrollToEnd,
    onTimelineAnchorReadyStable,
    onTimelineAnchorSizeChangedStable,
    onTimelineFooterGrowStable,
    onIsAtEndChangeStable,
    anchorNewTurn,
    attachTimelineViewport,
    attachComposerOverlay: followStore.attachComposerOverlay,
    scrollTimelineTo,
    highlightedMessageId,
  };
}
