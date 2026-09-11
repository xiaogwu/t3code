import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { createEmptyReadModel, projectEvent } from "./projector.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const THREAD_ID = ThreadId.make("thread-1");
const TURN_ID = TurnId.make("turn-1");

function makeEvent(input: {
  readonly sequence: number;
  readonly type: OrchestrationEvent["type"];
  readonly payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.make(`event-${input.sequence}`),
    type: input.type,
    aggregateKind: "thread",
    aggregateId: THREAD_ID,
    occurredAt: NOW,
    commandId: CommandId.make(`command-${input.sequence}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent;
}

const createdEvent = makeEvent({
  sequence: 1,
  type: "thread.created",
  payload: {
    threadId: THREAD_ID,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: { provider: "codex", model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
});

const armedEvent = makeEvent({
  sequence: 2,
  type: "thread.agent-settle-requested",
  payload: {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    requestedAt: NOW,
    reason: "Shipped the fix",
    updatedAt: NOW,
  },
});

/** An armed thread, the starting point every clearing path is measured from. */
const armedThread = Effect.gen(function* () {
  const created = yield* projectEvent(createEmptyReadModel(NOW), createdEvent);
  return yield* projectEvent(created, armedEvent);
});

it.effect("projects the agent settle arm", () =>
  Effect.gen(function* () {
    const armed = yield* armedThread;
    expect(armed.threads[0]?.agentSettleTurnId).toBe(TURN_ID);
    expect(armed.threads[0]?.agentSettleRequestedAt).toBe(NOW);
    expect(armed.threads[0]?.agentSettleReason).toBe("Shipped the fix");
  }),
);

it.effect("clears the arm on cancel, settle, and a new turn", () =>
  Effect.gen(function* () {
    const armed = yield* armedThread;
    const clearedBy = [
      makeEvent({
        sequence: 3,
        type: "thread.agent-settle-cancelled",
        payload: { threadId: THREAD_ID, updatedAt: NOW },
      }),
      makeEvent({
        sequence: 3,
        type: "thread.settled",
        payload: { threadId: THREAD_ID, settledAt: NOW, updatedAt: NOW },
      }),
      makeEvent({
        sequence: 3,
        type: "thread.unsettled",
        payload: { threadId: THREAD_ID, reason: "user", updatedAt: NOW },
      }),
      // A new turn is new work: the previous turn's arm must not settle it.
      makeEvent({
        sequence: 3,
        type: "thread.turn-start-requested",
        payload: {
          threadId: THREAD_ID,
          messageId: MessageId.make("message-1"),
          createdAt: NOW,
        },
      }),
    ];
    for (const event of clearedBy) {
      const next = yield* projectEvent(armed, event);
      expect(next.threads[0]?.agentSettleTurnId, event.type).toBeNull();
      expect(next.threads[0]?.agentSettleRequestedAt, event.type).toBeNull();
      expect(next.threads[0]?.agentSettleReason, event.type).toBeNull();
    }
  }),
);

it.effect("drops the arm when the turn errors and keeps it otherwise", () =>
  Effect.gen(function* () {
    const armed = yield* armedThread;
    const sessionSet = (status: "error" | "stopped") =>
      makeEvent({
        sequence: 3,
        type: "thread.session-set",
        payload: {
          threadId: THREAD_ID,
          session: {
            threadId: THREAD_ID,
            status,
            providerName: "Codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: NOW,
          },
        },
      });

    const errored = yield* projectEvent(armed, sessionSet("error"));
    expect(errored.threads[0]?.agentSettleRequestedAt).toBeNull();

    // A clean stop leaves the arm in place: the decider settles from it.
    const stopped = yield* projectEvent(armed, sessionSet("stopped"));
    expect(stopped.threads[0]?.agentSettleTurnId).toBe(TURN_ID);
  }),
);
