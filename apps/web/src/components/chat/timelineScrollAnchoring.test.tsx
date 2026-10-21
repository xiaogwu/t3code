import { MessageId, RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  readThreadTimelinePosition,
  saveThreadTimelinePosition,
} from "../../threadTimelinePositionStore";
import {
  observeTimelineRun,
  getAnchoredTurnMetrics,
  readTimelinePosition,
  rememberTimelinePosition,
  resolveRevealHistoryRequest,
  resolveTimelineSendScrollBehavior,
  shouldReleaseCollapsedTimelineAnchor,
} from "./timelineScrollAnchoring";

function buildState({
  positions,
  sizes,
  scroll = 0,
  scrollLength = 700,
}: {
  readonly positions: readonly number[];
  readonly sizes: readonly number[];
  readonly scroll?: number;
  readonly scrollLength?: number;
}) {
  return {
    data: positions.map((_, index) => index),
    scroll,
    scrollLength,
    positionAtIndex: (index: number) => positions[index],
    sizeAtIndex: (index: number) => sizes[index],
  };
}

describe("timeline scroll anchoring", () => {
  it("anchors a thread's opening send and lets tool activity release it", () => {
    expect(
      resolveTimelineSendScrollBehavior({
        threadHasStarted: false,
        citesThisThread: false,
      }),
    ).toEqual({
      mode: "anchoring-new-turn",
      liveFollowEnabled: true,
      anchorNewTurn: true,
      releaseOnToolActivity: true,
    });
  });

  it("holds a follow-up send's anchor through its tool activity", () => {
    expect(
      resolveTimelineSendScrollBehavior({
        threadHasStarted: true,
        citesThisThread: false,
      }),
    ).toEqual({
      mode: "anchoring-new-turn",
      liveFollowEnabled: true,
      anchorNewTurn: true,
      releaseOnToolActivity: false,
    });
  });

  it("keeps a reply send in place without anchoring or live follow", () => {
    expect(
      resolveTimelineSendScrollBehavior({
        threadHasStarted: true,
        citesThisThread: true,
      }),
    ).toEqual({
      mode: "free-scrolling",
      liveFollowEnabled: false,
      anchorNewTurn: false,
      releaseOnToolActivity: false,
    });
  });

  it("targets the real row end instead of any temporary reserved tail", () => {
    const state = buildState({
      positions: [0, 1720, 1880],
      sizes: [1600, 80, 120],
      scroll: 1900,
      scrollLength: 760,
    });

    const metrics = getAnchoredTurnMetrics({
      state,
      anchorIndex: 1,
      composerOverlayHeight: 180,
      anchorOffset: 16,
    });

    expect(metrics?.lastBottom).toBe(2000);
    expect(metrics?.targetScrollToRevealEnd).toBe(1436);
    expect(metrics?.scrollDeltaToRevealEnd).toBe(0);
  });
});

describe("shouldReleaseCollapsedTimelineAnchor", () => {
  // A send-time anchor that has landed, in a settled turn, whose response has
  // outgrown the reserved end space.
  const landed = {
    endSpaceCollapsed: true,
    turnInProgress: false,
    mode: "anchoring-new-turn",
    pendingAnchorId: null,
    positionedAnchorId: "message-1",
    settledAnchorId: "message-1",
  } as const;

  it("releases a landed send-time anchor once its end space is gone", () => {
    expect(shouldReleaseCollapsedTimelineAnchor(landed)).toBe(true);
  });

  it("keeps the anchor while its end space still reserves blank space", () => {
    expect(shouldReleaseCollapsedTimelineAnchor({ ...landed, endSpaceCollapsed: false })).toBe(
      false,
    );
  });

  it("keeps the anchor while the turn is still in progress", () => {
    expect(shouldReleaseCollapsedTimelineAnchor({ ...landed, turnInProgress: true })).toBe(false);
  });

  it("waits for positioning to land", () => {
    expect(
      shouldReleaseCollapsedTimelineAnchor({
        ...landed,
        pendingAnchorId: "message-1",
        positionedAnchorId: null,
        settledAnchorId: null,
      }),
    ).toBe(false);
    expect(shouldReleaseCollapsedTimelineAnchor({ ...landed, settledAnchorId: null })).toBe(false);
  });

  it("leaves reveals and other scroll modes alone", () => {
    for (const mode of ["anchoring-reveal", "free-scrolling", "following-end"] as const) {
      expect(shouldReleaseCollapsedTimelineAnchor({ ...landed, mode })).toBe(false);
    }
  });
});

describe("observeTimelineRun", () => {
  const existing = {
    threadKey: "environment:thread",
    hydrated: true,
    runId: RunId.make("existing-run"),
    queued: false,
    messageId: MessageId.make("existing-message"),
  };
  const next = {
    ...existing,
    runId: RunId.make("new-run"),
    messageId: MessageId.make("new-message"),
  };

  it("does not mistake delayed hydration for a newly started turn", () => {
    const loading = { ...existing, hydrated: false, runId: null, messageId: null };
    const opened = observeTimelineRun(null, loading);
    const stillLoading = observeTimelineRun(opened.observation, loading);
    const hydrated = observeTimelineRun(stillLoading.observation, existing);
    expect(hydrated.anchorMessageId).toBeNull();
    expect(observeTimelineRun(hydrated.observation, next).anchorMessageId).toBe(next.messageId);
  });

  it("keeps the end position while a stale cached run is replaced during synchronization", () => {
    const cached = observeTimelineRun(null, { ...existing, hydrated: false });
    const synchronizing = observeTimelineRun(cached.observation, { ...next, hydrated: false });
    expect(synchronizing.anchorMessageId).toBeNull();
    const live = observeTimelineRun(synchronizing.observation, next);
    expect(live.anchorMessageId).toBeNull();
    expect(
      observeTimelineRun(live.observation, {
        ...next,
        runId: RunId.make("later-run"),
        messageId: MessageId.make("later-message"),
      }).anchorMessageId,
    ).toBe("later-message");
  });

  it("waits for a new run's user message and frames it only once", () => {
    const opened = observeTimelineRun(null, existing);
    const waiting = observeTimelineRun(opened.observation, { ...next, messageId: null });
    expect(waiting.anchorMessageId).toBeNull();
    const ready = observeTimelineRun(waiting.observation, next);
    expect(ready.anchorMessageId).toBe(next.messageId);
    expect(observeTimelineRun(ready.observation, next).anchorMessageId).toBeNull();
  });

  it("does not reset the baseline during a temporary loss of projection data", () => {
    const opened = observeTimelineRun(null, existing);
    const reconnecting = observeTimelineRun(opened.observation, {
      ...existing,
      hydrated: false,
      runId: null,
    });
    expect(observeTimelineRun(reconnecting.observation, existing).anchorMessageId).toBeNull();
  });

  it("waits for a queued run to start before framing it", () => {
    const opened = observeTimelineRun(null, { ...existing, queued: true });
    expect(opened.anchorMessageId).toBeNull();
    expect(observeTimelineRun(opened.observation, existing).anchorMessageId).toBe(
      existing.messageId,
    );
  });
});

describe("remembered timeline positions", () => {
  it("mirrors the durable subset of a reading position, minus its live disclosures", () => {
    const threadKey = "scroll-test-mirror:thread-1";
    rememberTimelinePosition(
      threadKey,
      {
        rowId: "message-7",
        offsetWithinRow: 48,
        scrollOffset: 1480,
        atEnd: false,
        rowCreatedAt: "2026-09-17T00:00:00.000Z",
        disclosures: {
          runs: new Set([RunId.make("run-1")]),
          workGroups: new Set(["group-1"]),
          attempts: new Set(),
          workGroupState: { scrollPositions: new Map(), expandedEntries: new Set() },
        },
      },
      false,
    );
    // `workGroupState` holds live Map/Set objects, so disclosures are deliberately
    // not persisted: a reloaded thread restores its offset with groups collapsed.
    expect(readThreadTimelinePosition(threadKey)).toEqual({
      rowId: "message-7",
      offsetWithinRow: 48,
      scrollOffset: 1480,
      atEnd: false,
      rowCreatedAt: "2026-09-17T00:00:00.000Z",
    });
  });

  it("seeds a cold start from the persisted position", () => {
    // Nothing was remembered this session, which is what a reload looks like:
    // the cache lives only as long as the tab, the stored position does not.
    const threadKey = "scroll-test-cold:thread-1";
    saveThreadTimelinePosition(threadKey, {
      rowId: "message-3",
      offsetWithinRow: 12,
      scrollOffset: 640,
      atEnd: false,
      rowCreatedAt: "2026-09-17T01:00:00.000Z",
    });
    expect(readTimelinePosition(threadKey)).toEqual({
      rowId: "message-3",
      offsetWithinRow: 12,
      scrollOffset: 640,
      atEnd: false,
      rowCreatedAt: "2026-09-17T01:00:00.000Z",
    });
  });

  it("stores the live edge as absence, so a cold start there restores no stale anchor", () => {
    const threadKey = "scroll-test-edge:thread-1";
    rememberTimelinePosition(
      threadKey,
      {
        rowId: "message-2",
        offsetWithinRow: 20,
        scrollOffset: 400,
        atEnd: false,
      },
      false,
    );
    expect(readThreadTimelinePosition(threadKey)).toBeDefined();
    rememberTimelinePosition(
      threadKey,
      {
        rowId: "message-9",
        offsetWithinRow: 0,
        scrollOffset: 2400,
        atEnd: true,
      },
      false,
    );
    expect(readThreadTimelinePosition(threadKey)).toBeUndefined();
  });
});

describe("resolveRevealHistoryRequest", () => {
  const base = {
    messageId: "message-old",
    revealPending: true,
    messageLoaded: false,
    firstEntryId: "entry-40",
    history: { hasMoreHistory: true, loading: false, error: null },
    lastRequestKey: null,
  };

  it("pages toward a revealed message that is not loaded yet, once per window", () => {
    expect(resolveRevealHistoryRequest(base)).toBe("message-old:entry-40");
    expect(resolveRevealHistoryRequest({ ...base, lastRequestKey: "message-old:entry-40" })).toBe(
      null,
    );
    // A page landed without the message: the window moved, so ask again.
    expect(
      resolveRevealHistoryRequest({
        ...base,
        firstEntryId: "entry-20",
        lastRequestKey: "message-old:entry-40",
      }),
    ).toBe("message-old:entry-20");
  });

  it("stops once the message is loaded, history is exhausted, or paging is busy or failed", () => {
    expect(resolveRevealHistoryRequest({ ...base, messageLoaded: true })).toBe(null);
    expect(resolveRevealHistoryRequest({ ...base, revealPending: false })).toBe(null);
    expect(
      resolveRevealHistoryRequest({ ...base, history: { ...base.history, hasMoreHistory: false } }),
    ).toBe(null);
    expect(
      resolveRevealHistoryRequest({ ...base, history: { ...base.history, loading: true } }),
    ).toBe(null);
    expect(
      resolveRevealHistoryRequest({ ...base, history: { ...base.history, error: "offline" } }),
    ).toBe(null);
    expect(resolveRevealHistoryRequest({ ...base, history: undefined })).toBe(null);
  });
});
