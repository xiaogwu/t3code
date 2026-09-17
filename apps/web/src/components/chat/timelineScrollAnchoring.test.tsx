import { describe, expect, it } from "vite-plus/test";
import type { TurnId } from "@t3tools/contracts";
import {
  readThreadTimelinePosition,
  saveThreadTimelinePosition,
} from "../../threadTimelinePositionStore";
import {
  getAnchoredTurnMetrics,
  getRowBottom,
  readTimelinePosition,
  rememberTimelinePosition,
  resolveTimelineSendScrollBehavior,
  timelineContentOverflowsViewport,
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

describe("timelineContentOverflowsViewport", () => {
  const inset = { composerInset: 100, anchorOffset: 24 };

  it("reports overflow from the last row, not the inset spacer", () => {
    const fits = buildState({ positions: [0, 200], sizes: [200, 300], scrollLength: 700 });
    expect(timelineContentOverflowsViewport(fits, inset)).toBe(false);

    const overflows = buildState({ positions: [0, 200], sizes: [200, 400], scrollLength: 700 });
    expect(timelineContentOverflowsViewport(overflows, inset)).toBe(true);
  });

  it("treats an empty or unmeasured list as fitting", () => {
    expect(timelineContentOverflowsViewport(undefined, inset)).toBe(false);
    expect(
      timelineContentOverflowsViewport(
        buildState({ positions: [0, 200], sizes: [200, 400], scrollLength: 0 }),
        inset,
      ),
    ).toBe(false);
    expect(timelineContentOverflowsViewport(buildState({ positions: [], sizes: [] }), inset)).toBe(
      false,
    );
    expect(
      timelineContentOverflowsViewport(
        buildState({ positions: [0, 200], sizes: [200, Number.NaN] }),
        inset,
      ),
    ).toBe(false);
  });
});

describe("timeline scroll anchoring", () => {
  it("anchors a thread's opening send and lets tool activity release it", () => {
    expect(
      resolveTimelineSendScrollBehavior({
        replyToMessageId: null,
        hasBlockReply: false,
        threadHasStarted: false,
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
        replyToMessageId: null,
        hasBlockReply: false,
        threadHasStarted: true,
      }),
    ).toEqual({
      mode: "anchoring-new-turn",
      liveFollowEnabled: true,
      anchorNewTurn: true,
      releaseOnToolActivity: false,
    });
  });

  it("preserves the viewport for whole-message replies while output streams", () => {
    expect(
      resolveTimelineSendScrollBehavior({
        replyToMessageId: "assistant:message-1",
        hasBlockReply: false,
        threadHasStarted: true,
      }),
    ).toEqual({
      mode: "free-scrolling",
      liveFollowEnabled: false,
      anchorNewTurn: false,
      releaseOnToolActivity: false,
    });
  });

  it("preserves the viewport for block replies while output streams", () => {
    expect(
      resolveTimelineSendScrollBehavior({
        replyToMessageId: "assistant:message-1",
        hasBlockReply: true,
        threadHasStarted: true,
      }),
    ).toEqual({
      mode: "free-scrolling",
      liveFollowEnabled: false,
      anchorNewTurn: false,
      releaseOnToolActivity: false,
    });
  });

  it("measures row bottoms from LegendList row position and size", () => {
    const state = buildState({
      positions: [0, 120],
      sizes: [80, 40],
    });

    expect(getRowBottom(state, 1)).toBe(160);
  });

  it("treats the active turn as fitting when it fits above the composer", () => {
    const state = buildState({
      positions: [0, 300, 460],
      sizes: [240, 80, 140],
      scrollLength: 760,
    });

    const metrics = getAnchoredTurnMetrics({
      state,
      anchorIndex: 1,
      composerOverlayHeight: 180,
      anchorOffset: 16,
    });

    expect(metrics?.turnHeight).toBe(300);
    expect(metrics?.usableViewportHeight).toBe(564);
    expect(metrics?.overflowsUsableViewport).toBe(false);
    expect(metrics?.targetScrollToRevealEnd).toBe(36);
    expect(metrics?.scrollDeltaToRevealEnd).toBe(36);
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

  it("reports overflow only for the current anchored turn", () => {
    const state = buildState({
      positions: [0, 900, 1180],
      sizes: [800, 220, 300],
      scroll: 900,
      scrollLength: 760,
    });

    const metrics = getAnchoredTurnMetrics({
      state,
      anchorIndex: 1,
      composerOverlayHeight: 180,
      anchorOffset: 16,
    });

    expect(metrics?.turnHeight).toBe(580);
    expect(metrics?.usableViewportHeight).toBe(564);
    expect(metrics?.overflowsUsableViewport).toBe(true);
  });

  it("returns the minimal positive scroll delta needed to reveal the turn end", () => {
    const state = buildState({
      positions: [0, 900, 1180],
      sizes: [800, 220, 360],
      scroll: 900,
      scrollLength: 760,
    });

    const metrics = getAnchoredTurnMetrics({
      state,
      anchorIndex: 1,
      composerOverlayHeight: 180,
      anchorOffset: 16,
    });

    expect(metrics?.lastBottom).toBe(1540);
    expect(metrics?.visibleUsableBottom).toBe(1464);
    expect(metrics?.scrollDeltaToRevealEnd).toBe(76);
  });

  it("subtracts composer height from usable viewport height", () => {
    const state = buildState({
      positions: [0, 300],
      sizes: [120, 470],
      scrollLength: 700,
    });

    const withoutComposer = getAnchoredTurnMetrics({
      state,
      anchorIndex: 1,
      composerOverlayHeight: 0,
      anchorOffset: 16,
    });
    const withComposer = getAnchoredTurnMetrics({
      state,
      anchorIndex: 1,
      composerOverlayHeight: 220,
      anchorOffset: 16,
    });

    expect(withoutComposer?.overflowsUsableViewport).toBe(false);
    expect(withComposer?.overflowsUsableViewport).toBe(true);
  });
});

describe("remembered timeline positions", () => {
  it("keeps reading positions and end-follow independent across threads and environments", () => {
    const reading = { rowId: "message-4", offsetWithinRow: 32, scrollOffset: 932, atEnd: false };
    const following = { rowId: "message-9", offsetWithinRow: 10, scrollOffset: 2010, atEnd: true };
    rememberTimelinePosition("scroll-test-a:thread-1", reading);
    rememberTimelinePosition("scroll-test-a:thread-2", following);
    rememberTimelinePosition("scroll-test-b:thread-1", following);
    expect(readTimelinePosition("scroll-test-a:thread-1")).toEqual(reading);
    expect(readTimelinePosition("scroll-test-a:thread-2")).toEqual(following);
    expect(readTimelinePosition("scroll-test-b:thread-1")).toEqual(following);
    expect(readTimelinePosition("scroll-test-a:unvisited")).toBeUndefined();
    rememberTimelinePosition("scroll-test-a:thread-1", following);
    expect(readTimelinePosition("scroll-test-a:thread-1")).toEqual(following);
  });

  it("mirrors the durable subset of a reading position, minus its live disclosures", () => {
    const threadKey = "scroll-test-mirror:thread-1";
    rememberTimelinePosition(threadKey, {
      rowId: "message-7",
      offsetWithinRow: 48,
      scrollOffset: 1480,
      atEnd: false,
      rowCreatedAt: "2026-09-17T00:00:00.000Z",
      disclosures: {
        turns: new Set(["turn-1" as TurnId]),
        workGroups: new Set(["group-1"]),
        spawnEntries: new Set(["spawn-1"]),
        reasoningMessages: new Set(["message-7"]),
        workGroupState: { scrollPositions: new Map(), expandedEntries: new Set() },
      },
    });
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
    rememberTimelinePosition(threadKey, {
      rowId: "message-2",
      offsetWithinRow: 20,
      scrollOffset: 400,
      atEnd: false,
    });
    expect(readThreadTimelinePosition(threadKey)).toBeDefined();
    rememberTimelinePosition(threadKey, {
      rowId: "message-9",
      offsetWithinRow: 0,
      scrollOffset: 2400,
      atEnd: true,
    });
    expect(readThreadTimelinePosition(threadKey)).toBeUndefined();
  });
});
