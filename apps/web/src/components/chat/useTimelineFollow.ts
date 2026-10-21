import { useStableCallback } from "../../hooks/useStableCallback";
import {
  eventPathContainsSelector,
  TYPE_TO_FOCUS_EDITABLE_SELECTOR,
  TYPE_TO_FOCUS_FLOATING_LAYER_SELECTOR,
} from "./composerFocusRedirect";
import { type MessageId, type ThreadId, type RunId } from "@t3tools/contracts";
import { CHAT_LIST_ANCHOR_OFFSET } from "@t3tools/shared/chatList";
import { Debouncer } from "@tanstack/react-pacer";
import {
  type SetStateAction,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
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
import { type ChatComposerHandle } from "./ChatComposer";
import { createPageScrollController, type PageScrollKey } from "./pageScrollController";
import { createUpwardScrollDetector, isTimelineScrollTarget } from "./timelineScrollTarget";
import { resolveTimelineIsAtEnd } from "./MessagesTimeline.logic";
import { shouldReleaseTimelineAnchorForToolActivity } from "../ChatView.logic";
import { releaseChatTimelineAnchor } from "../ChatView.logic";
import type { Dispatch, RefObject } from "react";
import type { EnvironmentThread } from "@t3tools/client-runtime/state/shell";
import type { deriveThreadActivityRun } from "@t3tools/client-runtime/state/thread-execution";
import type { EnvironmentThreadStatus } from "@t3tools/client-runtime/state/threads";
import type { TimelineEntry } from "../../session-logic";
import type { ChatMessage } from "../../types";

const TIMELINE_SCROLL_CANCEL_SENTINEL = Object.freeze({});

interface TimelineAnchor {
  readonly threadKey: string | null;
  readonly messageId: MessageId | null;
}

interface TimelineFollowInput {
  readonly legendListRef: RefObject<LegendListRef | null>;
  readonly composerRef: RefObject<ChatComposerHandle | null>;
  readonly composerOverlayElement: HTMLDivElement | null;
  readonly composerTimelineInset: number;
  readonly routeThreadKey: string;
  readonly activeThreadKey: string | null;
  readonly activeThreadId: ThreadId | undefined;
  readonly isServerThread: boolean;
  readonly serverProjection: EnvironmentThread["projection"] | null;
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

/**
 * Keeps the timeline following the live end, anchoring a newly sent turn near
 * the top, and letting the user scroll away. The scroll handlers read refs, so
 * a scroll gesture does not re-render ChatView unless the follow mode flips.
 */
export function useTimelineFollow(input: TimelineFollowInput) {
  const {
    legendListRef,
    composerRef,
    composerOverlayElement,
    composerTimelineInset,
    routeThreadKey,
    activeThreadKey,
    activeThreadId,
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
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const isAtEndRef = useRef(true);
  const isTimelineAtLogicalEnd = () =>
    resolveTimelineIsAtEnd(legendListRef.current?.getState()) ?? isAtEndRef.current;
  const isTimelineAtLogicalEndStable = useStableCallback(isTimelineAtLogicalEnd);
  // Debounce *showing* the scroll-to-bottom pill so it doesn't flash during
  // thread switches. LegendList fires scroll events with isAtEnd=false while
  // initialScrollAtEnd is settling; hiding is always immediate.
  const showScrollDebouncer = useRef(
    new Debouncer(() => setShowScrollToBottom(true), { wait: 150 }),
  );
  const timelineScrollIntentRef = useRef<"toward-end" | "away-from-end" | null>(null);
  const timelineScrollModeRef = useRef<TimelineScrollMode>("following-end");
  // State mirror of the follow mode refs. LegendList's maintainScrollAtEnd
  // re-pins on its own (independent of the refs), so the timeline needs a
  // render-visible flag to switch it off once the user scrolls away.
  const [timelineLiveFollowEnabled, setTimelineLiveFollowEnabled] = useState(true);
  const pendingTimelineAnchorRef = useRef<MessageId | null>(null);
  const positionedTimelineAnchorRef = useRef<MessageId | null>(null);
  const settledTimelineAnchorRef = useRef<MessageId | null>(null);
  const activeTimelineAnchorIndexRef = useRef<number | null>(null);
  // True once the armed anchor's end space has shrunk to zero: the response
  // outgrew the reserved blank space, so the anchored view is identical to
  // ordinary end-following and the anchor can be released.
  const timelineAnchorEndSpaceCollapsedRef = useRef(false);
  const observedTimelineActivityRef = useRef<TimelineRunObservation | null>(null);
  const anchorUserScrollGenerationRef = useRef(0);
  const cancelPositionRestoreRef = useRef<(() => void) | null>(null);
  const liveFollowUserScrollGenerationRef = useRef<number | null>(0);
  const pendingAnchorScrollRestoreRef = useRef<{
    readonly messageId: MessageId;
    readonly offset: number;
    readonly userScrollGeneration: number;
  } | null>(null);
  const anchorScrollRestoreFrameRef = useRef<number | null>(null);
  // Whether the armed anchor yields to tool activity in its turn. Set per send
  // from resolveTimelineSendScrollBehavior; a thread's opening anchor releases,
  // a follow-up's holds. Anchors armed outside the send path keep releasing.
  const timelineAnchorReleasesOnToolActivityRef = useRef(true);
  // Hold ids outside the reveal effect below: clearReveal() inside that effect
  // flips the requestId dep, which would otherwise run this effect's own
  // cleanup on the very next render and cancel both timers before they fire.
  const revealStaleAnchorTimeoutRef = useRef<number | null>(null);
  const revealHighlightTimeoutRef = useRef<number | null>(null);
  // The last earlier-history page requested for a reveal, as messageId:firstEntryId.
  const revealHistoryRequestRef = useRef<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<MessageId | null>(null);
  const revealRequest = useThreadMessageRevealStore((state) => state.request);
  const activeTurnInProgressRef = useRef(activeTurnInProgress);
  useEffect(() => {
    activeTurnInProgressRef.current = activeTurnInProgress;
  }, [activeTurnInProgress]);
  // Released from an effect, not during render: a palette reveal anchors a
  // message whose run settled long ago and owns that anchor until the user
  // scrolls back to the end or switches threads, and the scroll mode that says
  // so lives in a ref.
  useEffect(() => {
    if (!anchorRunSettled) return;
    if (timelineScrollModeRef.current === "anchoring-reveal") return;
    setTimelineAnchor({ threadKey: activeThreadKey, messageId: null });
  }, [anchorRunSettled, activeThreadKey, setTimelineAnchor]);
  const cancelTimelineLiveFollowForUserNavigation = () => {
    cancelPositionRestoreRef.current?.();
    anchorUserScrollGenerationRef.current += 1;
    const wasProgrammaticScrollMode = timelineScrollModeRef.current !== "free-scrolling";
    timelineScrollModeRef.current = "free-scrolling";
    liveFollowUserScrollGenerationRef.current = null;
    setTimelineLiveFollowEnabled(false);
    pendingTimelineAnchorRef.current = null;
    positionedTimelineAnchorRef.current = null;
    settledTimelineAnchorRef.current = null;
    activeTimelineAnchorIndexRef.current = null;
    timelineAnchorEndSpaceCollapsedRef.current = false;
    pendingAnchorScrollRestoreRef.current = null;
    if (anchorScrollRestoreFrameRef.current !== null) {
      cancelAnimationFrame(anchorScrollRestoreFrameRef.current);
      anchorScrollRestoreFrameRef.current = null;
    }
    if (wasProgrammaticScrollMode) {
      // While following or anchoring, our scrollToEnd/scrollToOffset calls can
      // sit in LegendList's pending-imperative-scroll queue (it defers them
      // while layout settles) and fire seconds later with stale targets,
      // yanking the view away after the user scrolled. Starting a new
      // imperative scroll cancels everything queued; targeting an item that
      // is not in the data makes the new request itself resolve without ever
      // scrolling, so this is a pure cancel.
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
  const cancelTimelineLiveFollowForUserNavigationStable = useStableCallback(
    cancelTimelineLiveFollowForUserNavigation,
  );
  const cancelTimelineLiveFollowForUserNavigationRef = useRef(
    cancelTimelineLiveFollowForUserNavigationStable,
  );
  useEffect(() => {
    cancelTimelineLiveFollowForUserNavigationRef.current =
      cancelTimelineLiveFollowForUserNavigationStable;
  }, [cancelTimelineLiveFollowForUserNavigationStable]);
  useEffect(() => {
    const previous = observedTimelineActivityRef.current;
    const dispatchedUserItem =
      previous?.hydrated &&
      previous.threadKey === activeThreadKey &&
      activeActivityRun !== null &&
      previous.runId !== activeActivityRun.runId
        ? serverProjection?.visibleTurnItems.find(
            (row) => row.item.type === "user_message" && row.item.runId === activeActivityRun.runId,
          )
        : undefined;
    const { observation, anchorMessageId: messageId } = observeTimelineRun(previous, {
      threadKey: activeThreadKey,
      hydrated: !isServerThread || (serverProjection !== null && threadStatus === "live"),
      runId: activeActivityRun?.runId ?? null,
      queued: activeActivityRun?.status === "queued",
      messageId:
        dispatchedUserItem?.item.type === "user_message" ? dispatchedUserItem.item.messageId : null,
    });
    observedTimelineActivityRef.current = observation;
    if (messageId === null) return;
    if (
      pendingTimelineAnchorRef.current !== null ||
      timelineScrollModeRef.current === "free-scrolling"
    ) {
      return;
    }

    isAtEndRef.current = true;
    timelineScrollModeRef.current = "anchoring-new-turn";
    liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
    pendingTimelineAnchorRef.current = messageId;
    activeTimelineAnchorIndexRef.current = null;
    timelineAnchorEndSpaceCollapsedRef.current = false;
    timelineAnchorReleasesOnToolActivityRef.current = true;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    setTimelineAnchor({ threadKey: activeThreadKey, messageId });
  }, [
    activeActivityRun,
    activeThreadKey,
    isServerThread,
    serverProjection,
    setTimelineAnchor,
    threadStatus,
  ]);
  const timelineRealContentOverflowsViewport = (list?: LegendListRef | null) =>
    timelineContentOverflowsViewport((list ?? legendListRef.current)?.getState(), {
      composerInset: composerTimelineInset,
      anchorOffset: CHAT_TIMELINE_ANCHOR_OFFSET,
    });
  const timelineRealContentOverflowsViewportStable = useStableCallback(
    timelineRealContentOverflowsViewport,
  );
  const pageScrollControllerRef = useRef<ReturnType<typeof createPageScrollController> | null>(
    null,
  );
  const handlePageScrollStart = useEffectEvent((key: PageScrollKey) => {
    timelineScrollIntentRef.current = key === "PageUp" ? "away-from-end" : "toward-end";
    composerRef.current?.collapseForTimelineScrollKey(key);
    if (
      (key === "PageUp" && timelineRealContentOverflowsViewportStable()) ||
      !isTimelineAtLogicalEndStable()
    ) {
      cancelTimelineLiveFollowForUserNavigationStable();
    }
  });
  useEffect(() => {
    const controller = createPageScrollController({
      getContainer: () => legendListRef.current?.getScrollableNode() ?? null,
      getScrollPaddingBottomPx: () => composerOverlayElement?.getBoundingClientRect().height ?? 0,
      onScrollStart: handlePageScrollStart,
    });
    pageScrollControllerRef.current = controller;

    return () => {
      controller.dispose();
      if (pageScrollControllerRef.current === controller) {
        pageScrollControllerRef.current = null;
      }
    };
  }, [composerOverlayElement, legendListRef]);
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
    cancelPositionRestoreRef.current?.();
    isAtEndRef.current = true;
    timelineScrollModeRef.current = "following-end";
    liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
    setTimelineLiveFollowEnabled(true);
    pendingTimelineAnchorRef.current = null;
    activeTimelineAnchorIndexRef.current = null;
    timelineAnchorEndSpaceCollapsedRef.current = false;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    setTimelineAnchor(releaseChatTimelineAnchor);
    // The anchored end space must be gone before the scroll measures, or the
    // list lands short of the real end (#6519).
    requestAnimationFrame(() => {
      void legendListRef.current?.scrollToEnd?.({
        animated: animated && !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      });
    });
  };
  const scrollToEndStable = useStableCallback(scrollToEnd);
  // Shared by the thread.scrollToTop/End shortcuts and command palette items.
  // A stable callback rather than an effect event: keyboard handlers call it too.
  const scrollTimelineTo = useStableCallback((target: "top" | "end") => {
    if (target === "end") {
      timelineScrollIntentRef.current = "toward-end";
      composerRef.current?.restoreAfterTimelineReachedEnd();
      scrollToEnd(true);
      return;
    }
    timelineScrollIntentRef.current = "away-from-end";
    composerRef.current?.collapseForTimelineScrollKey("Home");
    cancelTimelineLiveFollowForUserNavigation();
    void legendListRef.current?.scrollToIndex({ index: 0, animated: true });
  });
  useEffect(() => subscribeToThreadScrollRequests(scrollTimelineTo), [scrollTimelineTo]);
  useEffect(() => {
    const composer = composerRef;
    let removeListeners: (() => void) | null = null;
    let frame: number | null = null;
    const attach = (remainingAttempts: number) => {
      frame = requestAnimationFrame(() => {
        frame = null;
        const scrollNode = legendListRef.current?.getScrollableNode();
        if (!scrollNode) {
          // The list may not have mounted on the first frame after a thread
          // switch — without a retry the opt-out listeners never attach and
          // live-follow becomes impossible to escape for the whole thread.
          if (remainingAttempts > 0) {
            attach(remainingAttempts - 1);
          }
          return;
        }
        const handleManualNavigation = () => {
          cancelTimelineLiveFollowForUserNavigationRef.current();
        };
        // The gestures below must only break follow when they can actually
        // move the viewport away from the live edge (#5566): a spurious break
        // while pinned at the end produces no scroll event, never re-arms,
        // and streaming silently stops following. Underflowing content can't
        // scroll at all, so nothing there should break follow.
        const contentScrollsUp = () => timelineRealContentOverflowsViewportStable();
        // The follow re-arm band, not the strict flag: streaming growth makes
        // isAtEnd flicker false for a frame before the follow scroll catches
        // up, and a gesture landing in that window while still pinned would
        // otherwise break follow with no scroll event left to re-arm it.
        const viewportIsAwayFromEnd = () =>
          resolveTimelineIsAtEnd(legendListRef.current?.getState()) === false;
        const handleWheel = (event: WheelEvent) => {
          if (event.ctrlKey || !isTimelineScrollTarget(event.target, scrollNode, event.deltaY))
            return;
          if (event.deltaY > 0) {
            timelineScrollIntentRef.current = "toward-end";
            if (isAtEndRef.current) {
              composer.current?.restoreAfterTimelineReachedEnd();
            }
          } else if (event.deltaY < 0) {
            timelineScrollIntentRef.current = "away-from-end";
          }
          if (event.deltaY < 0 && contentScrollsUp()) {
            handleManualNavigation();
          }
        };
        // Touch direction isn't observable here (touchmove fires on any
        // finger motion, scrolling or not), so break only once the drag has
        // actually carried the viewport out of the end band — an upward flick
        // gets there within its first few events and later touchmoves break.
        const handleTouchMove = () => {
          if (viewportIsAwayFromEnd()) {
            handleManualNavigation();
          }
        };
        // Scrollbar drags produce no wheel/touch events; they are the only
        // pointerdowns whose target is the scroll node itself rather than a
        // message row.
        const handlePointerDown = (event: PointerEvent) => {
          if (event.target === scrollNode) {
            if (contentScrollsUp()) {
              handleManualNavigation();
            }
            return;
          }
          if (viewportIsAwayFromEnd()) {
            handleManualNavigation();
          }
        };
        // Keyboard scrolling (PageUp/Home/ArrowUp) bypasses wheel and
        // pointer events entirely; without this the timeline yanks back to
        // the end on the next stream chunk. Clicking message text can leave
        // DOM focus on body, so these keys must also be heard at document.
        const handleKeyDown = (event: KeyboardEvent) => {
          if (
            !(event.target instanceof Node) ||
            (!scrollNode.contains(event.target) &&
              event.target !== document.body &&
              event.target !== document.documentElement) ||
            event.defaultPrevented ||
            event.isComposing ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            eventPathContainsSelector(event, TYPE_TO_FOCUS_EDITABLE_SELECTOR) ||
            document.querySelector(TYPE_TO_FOCUS_FLOATING_LAYER_SELECTOR)
          ) {
            return;
          }
          if (!["PageUp", "Home", "ArrowUp", "PageDown", "End", "ArrowDown"].includes(event.key))
            return;
          const scrollDirection = ["PageUp", "Home", "ArrowUp"].includes(event.key) ? -1 : 1;
          if (
            scrollNode.contains(event.target) &&
            !isTimelineScrollTarget(event.target, scrollNode, scrollDirection)
          )
            return;
          switch (event.key) {
            case "PageUp":
            case "Home":
            case "ArrowUp":
              timelineScrollIntentRef.current = "away-from-end";
              if (contentScrollsUp()) {
                handleManualNavigation();
                composer.current?.collapseForTimelineScrollKey(event.key);
              }
              break;
            case "PageDown":
            case "End":
            case "ArrowDown":
              timelineScrollIntentRef.current = "toward-end";
              if (viewportIsAwayFromEnd()) {
                handleManualNavigation();
              }
              composer.current?.collapseForTimelineScrollKey(event.key);
              if (isTimelineAtLogicalEndStable()) {
                composer.current?.restoreAfterTimelineReachedEnd();
              }
              break;
            default:
              break;
          }
        };
        // Input inside an embedded frame reaches none of the listeners above,
        // but its scroll still chains out to the timeline (#17056).
        const scrolledUp = createUpwardScrollDetector({
          top: scrollNode.scrollTop,
          height: scrollNode.scrollHeight,
        });
        const handleScroll = () => {
          if (
            scrolledUp({
              top: scrollNode.scrollTop,
              height: scrollNode.scrollHeight,
              programmatic:
                positionedTimelineAnchorRef.current !== null &&
                positionedTimelineAnchorRef.current !== settledTimelineAnchorRef.current,
            }) &&
            timelineScrollModeRef.current !== "free-scrolling" &&
            // LegendList updates its scroll state on the next animation frame.
            resolveTimelineIsAtEnd({
              contentLength: scrollNode.scrollHeight,
              scroll: scrollNode.scrollTop,
              scrollLength: scrollNode.clientHeight,
            }) === false
          ) {
            handleManualNavigation();
          }
        };
        scrollNode.addEventListener("scroll", handleScroll, { passive: true });
        scrollNode.addEventListener("wheel", handleWheel, {
          passive: true,
        });
        scrollNode.addEventListener("touchmove", handleTouchMove, {
          passive: true,
        });
        scrollNode.addEventListener("pointerdown", handlePointerDown, {
          passive: true,
        });
        document.addEventListener("keydown", handleKeyDown);
        removeListeners = () => {
          scrollNode.removeEventListener("scroll", handleScroll);
          scrollNode.removeEventListener("wheel", handleWheel);
          scrollNode.removeEventListener("touchmove", handleTouchMove);
          scrollNode.removeEventListener("pointerdown", handlePointerDown);
          document.removeEventListener("keydown", handleKeyDown);
        };
      });
    };
    attach(12);

    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      removeListeners?.();
    };
  }, [
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A thread switch remounts the list's scroll node, so the listeners reattach.
    activeThreadId,
    composerRef,
    isTimelineAtLogicalEndStable,
    legendListRef,
    timelineRealContentOverflowsViewportStable,
  ]);

  // A stale armed anchor keeps LegendList's maintainScrollAtEnd disabled, so a
  // layout resize (sidebar or right panel toggle) strands the viewport short of
  // the live edge. Once the end space has collapsed, releasing the anchor is
  // visually a no-op and hands ordinary end-follow back to LegendList. Backs up
  // the anchorRunSettled release, which only fires for an anchor it can match
  // to a run. Returns true when it released.
  const maybeReleaseCollapsedTimelineAnchor = useStableCallback(() => {
    if (
      !shouldReleaseCollapsedTimelineAnchor({
        endSpaceCollapsed: timelineAnchorEndSpaceCollapsedRef.current,
        turnInProgress: activeTurnInProgressRef.current,
        mode: timelineScrollModeRef.current,
        pendingAnchorId: pendingTimelineAnchorRef.current,
        positionedAnchorId: positionedTimelineAnchorRef.current,
        settledAnchorId: settledTimelineAnchorRef.current,
      })
    ) {
      return false;
    }
    timelineScrollModeRef.current = "following-end";
    positionedTimelineAnchorRef.current = null;
    settledTimelineAnchorRef.current = null;
    activeTimelineAnchorIndexRef.current = null;
    timelineAnchorEndSpaceCollapsedRef.current = false;
    setTimelineAnchor(releaseChatTimelineAnchor);
    return true;
  });
  useEffect(() => {
    if (!activeTurnInProgress) {
      maybeReleaseCollapsedTimelineAnchor();
    }
  }, [activeTurnInProgress, maybeReleaseCollapsedTimelineAnchor]);

  const onTimelineAnchorReady = (
    messageId: MessageId,
    anchorIndex: number,
    endSpaceSize: number,
  ) => {
    timelineAnchorEndSpaceCollapsedRef.current = endSpaceSize === 0;
    if (maybeReleaseCollapsedTimelineAnchor()) {
      return;
    }
    if (pendingTimelineAnchorRef.current === messageId) {
      pendingTimelineAnchorRef.current = null;
    }
    activeTimelineAnchorIndexRef.current = anchorIndex;
    if (positionedTimelineAnchorRef.current === messageId) {
      return;
    }
    positionedTimelineAnchorRef.current = messageId;
    settledTimelineAnchorRef.current = null;
    if (timelineScrollModeRef.current === "anchoring-reveal") {
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
    const positionAnchor = (remainingAttempts: number) => {
      requestAnimationFrame(() => {
        if (positionedTimelineAnchorRef.current !== messageId) {
          return;
        }
        const list = legendListRef.current;
        if (!list) {
          if (remainingAttempts > 0) {
            positionAnchor(remainingAttempts - 1);
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
            if (
              legendListRef.current !== list ||
              positionedTimelineAnchorRef.current !== messageId
            ) {
              return;
            }
            settledTimelineAnchorRef.current = messageId;
            // A reveal has no streaming turn to keep tracking, so hand the list
            // back to ordinary free scrolling once it has landed.
            if (timelineScrollModeRef.current === "anchoring-reveal") {
              timelineScrollModeRef.current = "free-scrolling";
            }
            // The space may have collapsed while positioning was in flight.
            maybeReleaseCollapsedTimelineAnchor();
          });
      });
    };
    requestAnimationFrame(() => positionAnchor(12));
  };
  const onTimelineAnchorReadyStable = useStableCallback(onTimelineAnchorReady);
  const onTimelineAnchorSizeChanged = (messageId: MessageId) => {
    if (settledTimelineAnchorRef.current !== messageId) {
      return;
    }
    if (liveFollowUserScrollGenerationRef.current === anchorUserScrollGenerationRef.current) {
      return;
    }
    const scrollOffset = legendListRef.current?.getState().scroll;
    if (scrollOffset === undefined) {
      return;
    }
    if (pendingAnchorScrollRestoreRef.current === null) {
      pendingAnchorScrollRestoreRef.current = {
        messageId,
        offset: scrollOffset,
        userScrollGeneration: anchorUserScrollGenerationRef.current,
      };
    }
    if (anchorScrollRestoreFrameRef.current !== null) {
      return;
    }
    anchorScrollRestoreFrameRef.current = requestAnimationFrame(() => {
      anchorScrollRestoreFrameRef.current = null;
      const pending = pendingAnchorScrollRestoreRef.current;
      pendingAnchorScrollRestoreRef.current = null;
      if (
        pending &&
        settledTimelineAnchorRef.current === pending.messageId &&
        pending.userScrollGeneration === anchorUserScrollGenerationRef.current
      ) {
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

  const onToolOutputCollapsedAtEnd = () => {
    composerRef.current?.restoreAfterTimelineReachedEnd();
  };
  const onToolOutputCollapsedAtEndStable = useStableCallback(onToolOutputCollapsedAtEnd);

  const onIsAtEndChange = (isAtEnd: boolean) => {
    // A reveal starts from the live edge, so LegendList can still report
    // isAtEnd while the anchor scroll is in flight. Honoring that would flip
    // the mode back to following-end and cancel the reveal.
    if (timelineScrollModeRef.current === "anchoring-reveal") {
      return;
    }
    if (
      !isAtEnd &&
      liveFollowUserScrollGenerationRef.current === anchorUserScrollGenerationRef.current
    ) {
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
      return;
    }
    if (isAtEndRef.current === isAtEnd) return;
    isAtEndRef.current = isAtEnd;
    if (isAtEnd) {
      if (timelineScrollIntentRef.current === "toward-end") {
        composerRef.current?.restoreAfterTimelineReachedEnd();
      }
      timelineScrollModeRef.current = "following-end";
      liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
      setTimelineLiveFollowEnabled(true);
      setTimelineAnchor(releaseChatTimelineAnchor);
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
    } else {
      timelineScrollModeRef.current = "free-scrolling";
      liveFollowUserScrollGenerationRef.current = null;
      showScrollDebouncer.current.maybeExecute();
    }
  };
  const onIsAtEndChangeStable = useStableCallback(onIsAtEndChange);

  useLayoutEffect(() => {
    if (timelineScrollModeRef.current !== "anchoring-new-turn") return;
    if (!timelineAnchorReleasesOnToolActivityRef.current) return;
    if (
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
    scrollToEndStable,
    timelineAnchorMessageId,
    timelineEntries,
    timelineLiveFollowEnabled,
  ]);

  // A thread switch restores that thread's remembered follow state; the refs
  // the scroll handlers read catch up after commit.
  const [timelineThreadReset, setTimelineThreadReset] = useState({
    threadKey: activeThreadKey,
    followEnd: true,
  });
  if (timelineThreadReset.threadKey !== activeThreadKey) {
    const followEnd = readTimelinePosition(routeThreadKey)?.atEnd !== false;
    setTimelineThreadReset({ threadKey: activeThreadKey, followEnd });
    setTimelineLiveFollowEnabled(followEnd);
    // A restored mid-thread position must not re-pin to the bottom, even if the
    // thread streamed new messages while away. The scroll-to-bottom pill is the
    // way back to the edge, and it must show immediately on a restore.
    setShowScrollToBottom(!followEnd);
  }
  useEffect(() => {
    const { followEnd } = timelineThreadReset;
    isAtEndRef.current = followEnd;
    timelineScrollIntentRef.current = null;
    timelineScrollModeRef.current = followEnd ? "following-end" : "free-scrolling";
    liveFollowUserScrollGenerationRef.current = followEnd
      ? anchorUserScrollGenerationRef.current
      : null;
    pendingTimelineAnchorRef.current = null;
    positionedTimelineAnchorRef.current = null;
    settledTimelineAnchorRef.current = null;
    activeTimelineAnchorIndexRef.current = null;
    timelineAnchorEndSpaceCollapsedRef.current = false;
    showScrollDebouncer.current.cancel();
  }, [timelineThreadReset]);

  // Command-palette content-match reveal. Must be declared after the
  // thread-change reset effect above: effects run in declaration order, and
  // an earlier declaration would have this anchor wiped by that reset when a
  // reveal and a thread switch land in the same commit.
  useEffect(() => {
    if (revealRequest === null || revealRequest.threadKey !== activeThreadKey) {
      // A request for a thread that never became active (navigation failed,
      // or the user bailed) is left in the store. Benign: it just sits until
      // either this effect's threadKey check matches later, or a later
      // requestReveal replaces it. See the reviewed risk in the design doc.
      return;
    }
    // Mirrors the send-flow anchor below, minus the optimistic message. The
    // mode is its own value so onTimelineAnchorReady still positions the row
    // while the streaming turn-metrics passes stay out.
    anchorUserScrollGenerationRef.current += 1;
    timelineScrollModeRef.current = "anchoring-reveal";
    liveFollowUserScrollGenerationRef.current = null;
    isAtEndRef.current = false;
    pendingTimelineAnchorRef.current = revealRequest.messageId;
    // Cleared so revealing the same message twice re-runs the positioning;
    // onTimelineAnchorReady returns early when it is already the positioned id.
    positionedTimelineAnchorRef.current = null;
    settledTimelineAnchorRef.current = null;
    activeTimelineAnchorIndexRef.current = null;
    // A collapsed flag left over from the previous turn would release this
    // reveal anchor the moment it reports ready.
    timelineAnchorEndSpaceCollapsedRef.current = false;
    showScrollDebouncer.current.cancel();
    // oxlint-disable-next-line react/set-state-in-effect -- The reveal arrives through an external store and arms scroll-mode refs render cannot touch.
    setShowScrollToBottom(false);
    setTimelineAnchor({ threadKey: activeThreadKey, messageId: revealRequest.messageId });
    revealHistoryRequestRef.current = null;
    useThreadMessageRevealStore.getState().clearReveal(revealRequest.requestId);

    // clearReveal above flips revealRequest to null next render, which
    // changes this effect's requestId dep and would run a same-shaped
    // cleanup immediately. Timers live in refs instead, so they survive that.
    if (revealStaleAnchorTimeoutRef.current !== null) {
      window.clearTimeout(revealStaleAnchorTimeoutRef.current);
    }
    if (revealHighlightTimeoutRef.current !== null) {
      window.clearTimeout(revealHighlightTimeoutRef.current);
    }

    // Stale-anchor guard: if the message was deleted/compacted away,
    // resolveChatListAnchoredEndSpace never finds it, onAnchorReady never
    // fires, and pendingTimelineAnchorRef would stay set forever, permanently
    // suppressing live-follow. Drop back to following-end if it never lands.
    // History paging toward the message (below) counts as progress and re-arms.
    const armStaleAnchorGuard = (historyRequestAtArm: string | null) => {
      revealStaleAnchorTimeoutRef.current = window.setTimeout(() => {
        revealStaleAnchorTimeoutRef.current = null;
        if (pendingTimelineAnchorRef.current !== revealRequest.messageId) return;
        if (revealHistoryRequestRef.current !== historyRequestAtArm) {
          armStaleAnchorGuard(revealHistoryRequestRef.current);
          return;
        }
        pendingTimelineAnchorRef.current = null;
        timelineScrollModeRef.current = "following-end";
      }, 5000);
    };
    armStaleAnchorGuard(null);
  }, [revealRequest, activeThreadKey, setTimelineAnchor]);
  // A revealed message can sit above the loaded history window. Page earlier
  // history through it; the anchor positions the row once it is loaded. One
  // request per loaded window, so a page that misses the message cannot loop.
  useEffect(() => {
    const messageId = timelineAnchorMessageId;
    const requestKey = resolveRevealHistoryRequest({
      messageId,
      revealPending:
        timelineScrollModeRef.current === "anchoring-reveal" &&
        pendingTimelineAnchorRef.current === messageId,
      messageLoaded: timelineMessages.some((message) => message.id === messageId),
      firstEntryId: timelineEntries[0]?.id,
      history: threadHistoryControls,
      lastRequestKey: revealHistoryRequestRef.current,
    });
    if (requestKey === null || messageId === null) return;
    revealHistoryRequestRef.current = requestKey;
    threadHistoryControls?.onLoadEarlier(messageId);
  }, [threadHistoryControls, timelineAnchorMessageId, timelineEntries, timelineMessages]);
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
   * anchor for the message the user just sent, or (a reply citing this
   * thread) keeps the cited source in place.
   */
  const anchorNewTurn = (
    threadKey: string,
    messageId: MessageId,
    behavior: TimelineSendScrollBehavior = {
      mode: "anchoring-new-turn",
      liveFollowEnabled: true,
      anchorNewTurn: true,
      releaseOnToolActivity: true,
    },
  ) => {
    if (!behavior.anchorNewTurn) {
      // Reply sends keep the cited source in place. Opt out of both LegendList's end
      // maintenance and T3's streaming adjustments until Scroll to end is used.
      anchorUserScrollGenerationRef.current += 1;
      timelineScrollModeRef.current = behavior.mode;
      liveFollowUserScrollGenerationRef.current = null;
      setTimelineLiveFollowEnabled(behavior.liveFollowEnabled);
      pendingTimelineAnchorRef.current = null;
      positionedTimelineAnchorRef.current = null;
      settledTimelineAnchorRef.current = null;
      activeTimelineAnchorIndexRef.current = null;
      timelineAnchorEndSpaceCollapsedRef.current = false;
      return;
    }
    isAtEndRef.current = true;
    timelineScrollModeRef.current = behavior.mode;
    liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
    setTimelineLiveFollowEnabled(behavior.liveFollowEnabled);
    pendingTimelineAnchorRef.current = messageId;
    activeTimelineAnchorIndexRef.current = null;
    timelineAnchorEndSpaceCollapsedRef.current = false;
    timelineAnchorReleasesOnToolActivityRef.current = behavior.releaseOnToolActivity;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    setTimelineAnchor({ threadKey, messageId });
  };

  return {
    showScrollToBottom,
    timelineLiveFollowEnabled,
    cancelPositionRestoreRef,
    isTimelineAtLogicalEndStable,
    cancelTimelineLiveFollowForUserNavigationStable,
    onComposerPageScrollKeyDownStable,
    onComposerPageScrollKeyUpStable,
    onComposerPageScrollReleaseStable,
    scrollToEnd,
    onTimelineAnchorReadyStable,
    onTimelineAnchorSizeChangedStable,
    onToolOutputCollapsedAtEndStable,
    onIsAtEndChangeStable,
    anchorNewTurn,
    scrollTimelineTo,
    highlightedMessageId,
  };
}
