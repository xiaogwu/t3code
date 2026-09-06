import { TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  MAX_TRACKED_ITEM_TURNS,
  type AcpItemTurnTracker,
  acpItemIdForEvent,
  resolveAcpItemTurnId,
} from "./AcpItemTurnTracking.ts";
import type * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

const turnA = TurnId.make("turn-a");
const turnB = TurnId.make("turn-b");

function makeTracker(activeTurnId: TurnId | undefined): {
  tracker: AcpItemTurnTracker;
  setActiveTurnId: (turnId: TurnId | undefined) => void;
} {
  const state = { activeTurnId, itemTurnIds: new Map<string, TurnId>() };
  return {
    tracker: state,
    setActiveTurnId: (turnId) => {
      state.activeTurnId = turnId;
    },
  };
}

const itemStarted = (itemId: string): AcpSessionRuntime.AcpSessionRuntimeEvent => ({
  _tag: "AssistantItemStarted",
  itemId,
});

const itemCompleted = (itemId: string): AcpSessionRuntime.AcpSessionRuntimeEvent => ({
  _tag: "AssistantItemCompleted",
  itemId,
});

const contentDelta = (itemId: string | undefined): AcpSessionRuntime.AcpSessionRuntimeEvent => ({
  _tag: "ContentDelta",
  ...(itemId === undefined ? {} : { itemId }),
  text: "hello",
  rawPayload: {},
});

const toolCallUpdated = (toolCallId: string): AcpSessionRuntime.AcpSessionRuntimeEvent => ({
  _tag: "ToolCallUpdated",
  toolCall: {
    toolCallId,
    kind: "execute",
    status: "pending",
    data: { toolCallId, kind: "execute" },
  },
  rawPayload: {},
});

describe("resolveAcpItemTurnId", () => {
  it("keeps a late completion on the turn its item started in", () => {
    const { tracker, setActiveTurnId } = makeTracker(turnA);

    expect(resolveAcpItemTurnId(tracker, itemStarted("item-1"))).toBe(turnA);
    expect(resolveAcpItemTurnId(tracker, contentDelta("item-1"))).toBe(turnA);

    // The next prompt arrives before the provider finishes flushing item-1.
    setActiveTurnId(turnB);

    expect(resolveAcpItemTurnId(tracker, itemCompleted("item-1"))).toBe(turnA);
  });

  it("attributes a new item to the turn that is now active", () => {
    const { tracker, setActiveTurnId } = makeTracker(turnA);

    resolveAcpItemTurnId(tracker, itemStarted("item-1"));
    setActiveTurnId(turnB);

    expect(resolveAcpItemTurnId(tracker, itemStarted("item-2"))).toBe(turnB);
    expect(resolveAcpItemTurnId(tracker, contentDelta("item-2"))).toBe(turnB);
    expect(resolveAcpItemTurnId(tracker, itemCompleted("item-2"))).toBe(turnB);
  });

  it("tracks tool calls by their tool call id", () => {
    const { tracker, setActiveTurnId } = makeTracker(turnA);

    expect(resolveAcpItemTurnId(tracker, toolCallUpdated("tool-1"))).toBe(turnA);
    setActiveTurnId(turnB);
    expect(resolveAcpItemTurnId(tracker, toolCallUpdated("tool-1"))).toBe(turnA);
  });

  it("releases the binding once an item completes", () => {
    const { tracker } = makeTracker(turnA);

    resolveAcpItemTurnId(tracker, itemStarted("item-1"));
    resolveAcpItemTurnId(tracker, itemCompleted("item-1"));

    expect(tracker.itemTurnIds.size).toBe(0);
  });

  it("falls back to the active turn for events without an item identity", () => {
    const { tracker } = makeTracker(turnA);

    expect(resolveAcpItemTurnId(tracker, contentDelta(undefined))).toBe(turnA);
    expect(
      resolveAcpItemTurnId(tracker, { _tag: "ThoughtDelta", text: "hm", rawPayload: {} }),
    ).toBe(turnA);
    expect(tracker.itemTurnIds.size).toBe(0);
  });

  it("does not bind a completion for an item it never saw start", () => {
    const { tracker } = makeTracker(turnB);

    expect(resolveAcpItemTurnId(tracker, itemCompleted("unknown"))).toBe(turnB);
    expect(tracker.itemTurnIds.size).toBe(0);
  });

  it("evicts the oldest bindings rather than growing without bound", () => {
    const { tracker } = makeTracker(turnA);

    for (let index = 0; index <= MAX_TRACKED_ITEM_TURNS; index += 1) {
      resolveAcpItemTurnId(tracker, itemStarted(`item-${index}`));
    }

    expect(tracker.itemTurnIds.size).toBe(MAX_TRACKED_ITEM_TURNS);
    expect(tracker.itemTurnIds.has("item-0")).toBe(false);
    expect(tracker.itemTurnIds.has(`item-${MAX_TRACKED_ITEM_TURNS}`)).toBe(true);
  });
});

describe("acpItemIdForEvent", () => {
  it("returns an id only for events that carry item identity", () => {
    expect(acpItemIdForEvent(itemStarted("item-1"))).toBe("item-1");
    expect(acpItemIdForEvent(itemCompleted("item-1"))).toBe("item-1");
    expect(acpItemIdForEvent(contentDelta("item-1"))).toBe("item-1");
    expect(acpItemIdForEvent(toolCallUpdated("tool-1"))).toBe("tool-1");
    expect(acpItemIdForEvent({ _tag: "ModeChanged", modeId: "default" })).toBeUndefined();
  });
});
