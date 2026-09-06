import type { TurnId } from "@t3tools/contracts";

import type * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

/**
 * The mutable slice of an adapter session context needed to attribute a
 * notification to a turn. Adapter contexts satisfy this structurally.
 */
export interface AcpItemTurnTracker {
  readonly activeTurnId: TurnId | undefined;
  readonly itemTurnIds: Map<string, TurnId>;
}

/**
 * Bound on remembered item→turn bindings. A late notification trails its item by
 * milliseconds, so only recent items matter; older entries are evicted in
 * insertion order to keep a long-lived session from growing without limit.
 */
export const MAX_TRACKED_ITEM_TURNS = 512;

/**
 * Items whose originating turn is worth tracking. Everything else is genuinely
 * "whatever turn is running now" and carries no item identity to key on.
 */
export function acpItemIdForEvent(
  event: AcpSessionRuntime.AcpSessionRuntimeEvent,
): string | undefined {
  switch (event._tag) {
    case "AssistantItemStarted":
    case "AssistantItemCompleted":
      return event.itemId;
    case "ContentDelta":
      return event.itemId;
    case "ToolCallUpdated":
      return event.toolCall.toolCallId;
    default:
      return undefined;
  }
}

function rememberItemTurn(tracker: AcpItemTurnTracker, itemId: string, turnId: TurnId): void {
  if (tracker.itemTurnIds.size >= MAX_TRACKED_ITEM_TURNS) {
    const oldest = tracker.itemTurnIds.keys().next();
    if (!oldest.done) {
      tracker.itemTurnIds.delete(oldest.value);
    }
  }
  tracker.itemTurnIds.set(itemId, turnId);
}

/**
 * Resolves the turn a notification belongs to.
 *
 * An item is bound to the turn that was active the first time it was seen, and
 * every later notification for that item reuses the binding. Reading
 * `activeTurnId` directly is wrong for late notifications: ACP can deliver an
 * item's completion after the next prompt has already moved the active turn on,
 * which restamps the previous turn's final message onto the new turn.
 *
 * A completion releases the binding, since no further notification can follow it.
 */
export function resolveAcpItemTurnId(
  tracker: AcpItemTurnTracker,
  event: AcpSessionRuntime.AcpSessionRuntimeEvent,
): TurnId | undefined {
  const itemId = acpItemIdForEvent(event);
  if (itemId === undefined) {
    return tracker.activeTurnId;
  }
  const remembered = tracker.itemTurnIds.get(itemId);
  if (remembered !== undefined) {
    if (event._tag === "AssistantItemCompleted") {
      tracker.itemTurnIds.delete(itemId);
    }
    return remembered;
  }
  // An unseen item completing without ever having started has no turn of its own
  // to recover, so it falls back to the active turn rather than binding one.
  if (tracker.activeTurnId !== undefined && event._tag !== "AssistantItemCompleted") {
    rememberItemTurn(tracker, itemId, tracker.activeTurnId);
  }
  return tracker.activeTurnId;
}
