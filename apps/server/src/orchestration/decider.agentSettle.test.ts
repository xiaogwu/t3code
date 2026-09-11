import {
  CheckpointRef,
  CommandId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
  type OrchestrationSession,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const ARMED_AT = "2025-12-31T23:59:00.000Z";
const THREAD_ID = ThreadId.make("thread-1");
const TURN_ID = TurnId.make("turn-1");

function makeSession(
  status: OrchestrationSession["status"],
  activeTurnId: OrchestrationSession["activeTurnId"] = null,
): OrchestrationSession {
  return {
    threadId: THREAD_ID,
    status,
    providerName: "Codex",
    runtimeMode: "full-access",
    activeTurnId,
    lastError: null,
    updatedAt: NOW,
  };
}

function makeCheckpoint(turnId: OrchestrationThread["checkpoints"][number]["turnId"]) {
  return {
    turnId,
    checkpointTurnCount: 1,
    checkpointRef: CheckpointRef.make("refs/t3/checkpoints/turn-1"),
    status: "ready" as const,
    files: [],
    assistantMessageId: null,
    completedAt: NOW,
  };
}

function makeReadModel(thread: Partial<OrchestrationThread> = {}): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: THREAD_ID,
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        pullRequests: [],
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
        ...thread,
      },
    ],
    updatedAt: NOW,
  };
}

/** A thread with a settle armed on TURN_ID, mid-turn. */
function armedReadModel(thread: Partial<OrchestrationThread> = {}): OrchestrationReadModel {
  return makeReadModel({
    agentSettleTurnId: TURN_ID,
    agentSettleRequestedAt: ARMED_AT,
    agentSettleReason: "Shipped the fix",
    session: makeSession("running", TURN_ID),
    ...thread,
  });
}

function diffCompleteCommand(turnId = TURN_ID) {
  return {
    type: "thread.turn.diff.complete" as const,
    commandId: CommandId.make(`cmd-diff-${turnId}`),
    threadId: THREAD_ID,
    turnId,
    completedAt: NOW,
    checkpointRef: CheckpointRef.make("refs/t3/checkpoints/turn-1"),
    status: "ready" as const,
    files: [],
    checkpointTurnCount: 1,
    createdAt: NOW,
  };
}

function sessionSetCommand(status: OrchestrationSession["status"]) {
  return {
    type: "thread.session.set" as const,
    commandId: CommandId.make(`cmd-session-${status}`),
    threadId: THREAD_ID,
    session: makeSession(status),
    createdAt: NOW,
  };
}

const userInputRequest: OrchestrationThread["activities"][number] = {
  id: EventId.make("activity-input"),
  kind: "user-input.requested",
  summary: "Which approach?",
  tone: "info",
  turnId: TURN_ID,
  createdAt: NOW,
  payload: { requestId: "request-1", responseMode: "message" },
};

it.layer(NodeServices.layer)("agent settle decider", (it) => {
  it.effect("arms without settling while the turn is still running", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.agent-settle.request",
          commandId: CommandId.make("cmd-arm"),
          threadId: THREAD_ID,
          turnId: TURN_ID,
          reason: "Shipped the fix",
        },
        readModel: makeReadModel({ session: makeSession("running", TURN_ID) }),
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events.map((event) => event.type)).toEqual(["thread.agent-settle-requested"]);
      const armed = events[0];
      if (armed?.type === "thread.agent-settle-requested") {
        expect(armed.payload.turnId).toBe(TURN_ID);
        expect(armed.payload.reason).toBe("Shipped the fix");
        expect(armed.payload.requestedAt).toBe(armed.payload.updatedAt);
      }
    }),
  );

  it.effect("settles immediately when no turn is running", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.agent-settle.request",
          commandId: CommandId.make("cmd-arm-idle"),
          threadId: THREAD_ID,
          turnId: null,
          reason: null,
        },
        readModel: makeReadModel({ session: makeSession("stopped") }),
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events.map((event) => event.type)).toEqual(["thread.settled"]);
    }),
  );

  it.effect("says why instead of settling a thread that is waiting on the user", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.agent-settle.request",
          commandId: CommandId.make("cmd-arm-blocked"),
          threadId: THREAD_ID,
          turnId: null,
          reason: null,
        },
        readModel: makeReadModel({
          session: makeSession("stopped"),
          activities: [userInputRequest],
        }),
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events.map((event) => event.type)).toEqual(["thread.activity-appended"]);
      const appended = events[0];
      if (appended?.type === "thread.activity-appended") {
        expect(appended.payload.activity.kind).toBe("thread.agent-settle-skipped");
        expect(appended.payload.activity.summary).toContain("waiting on you");
      }
    }),
  );

  it.effect("settles when the armed turn's diff lands and the session is idle", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: diffCompleteCommand(),
        readModel: armedReadModel({ session: makeSession("stopped") }),
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events.map((event) => event.type)).toEqual([
        "thread.turn-diff-completed",
        "thread.settled",
      ]);
    }),
  );

  it.effect("keeps the arm when the diff lands while the session still reads running", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: diffCompleteCommand(),
        readModel: armedReadModel(),
      });
      const events = Array.isArray(result) ? result : [result];
      // No cancellation: the status write that follows is what honours the arm.
      expect(events.map((event) => event.type)).toEqual(["thread.turn-diff-completed"]);
    }),
  );

  it.effect("ignores a diff for a turn the arm is not bound to", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: diffCompleteCommand(TurnId.make("turn-2")),
        readModel: armedReadModel({ session: makeSession("stopped") }),
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events.map((event) => event.type)).toEqual(["thread.turn-diff-completed"]);
    }),
  );

  it.effect("settles on the session status write once the armed turn has a checkpoint", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: sessionSetCommand("stopped"),
        readModel: armedReadModel({ checkpoints: [makeCheckpoint(TURN_ID)] }),
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events.map((event) => event.type)).toEqual(["thread.session-set", "thread.settled"]);
    }),
  );

  it.effect("waits for the checkpoint before honouring the arm", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: sessionSetCommand("stopped"),
        readModel: armedReadModel(),
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events.map((event) => event.type)).toEqual(["thread.session-set"]);
    }),
  );

  it.effect("refuses to settle a turn that errored, and says so", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: sessionSetCommand("error"),
        readModel: armedReadModel({ checkpoints: [makeCheckpoint(TURN_ID)] }),
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events.map((event) => event.type)).toEqual([
        "thread.session-set",
        "thread.activity-appended",
      ]);
      const appended = events[1];
      if (appended?.type === "thread.activity-appended") {
        expect(appended.payload.activity.kind).toBe("thread.agent-settle-skipped");
        expect(appended.payload.activity.summary).toContain("error");
      }
    }),
  );

  it.effect("cancels the arm and says why when the thread is waiting on the user", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: diffCompleteCommand(),
        readModel: armedReadModel({
          session: makeSession("stopped"),
          activities: [userInputRequest],
        }),
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events.map((event) => event.type)).toEqual([
        "thread.turn-diff-completed",
        "thread.agent-settle-cancelled",
        "thread.activity-appended",
      ]);
    }),
  );

  it.effect("cancelling an unarmed thread does not churn ordering", () =>
    Effect.gen(function* () {
      const armed = yield* decideOrchestrationCommand({
        command: {
          type: "thread.agent-settle.cancel",
          commandId: CommandId.make("cmd-cancel-armed"),
          threadId: THREAD_ID,
        },
        readModel: armedReadModel(),
      });
      const armedEvents = Array.isArray(armed) ? armed : [armed];
      expect(armedEvents[0]?.type).toBe("thread.agent-settle-cancelled");
      if (armedEvents[0]?.type === "thread.agent-settle-cancelled") {
        expect(armedEvents[0].payload.updatedAt).not.toBe(NOW);
      }

      const unarmed = yield* decideOrchestrationCommand({
        command: {
          type: "thread.agent-settle.cancel",
          commandId: CommandId.make("cmd-cancel-unarmed"),
          threadId: THREAD_ID,
        },
        readModel: makeReadModel(),
      });
      const unarmedEvents = Array.isArray(unarmed) ? unarmed : [unarmed];
      expect(unarmedEvents[0]?.type).toBe("thread.agent-settle-cancelled");
      if (unarmedEvents[0]?.type === "thread.agent-settle-cancelled") {
        expect(unarmedEvents[0].payload.updatedAt).toBe(NOW);
      }
    }),
  );
});
