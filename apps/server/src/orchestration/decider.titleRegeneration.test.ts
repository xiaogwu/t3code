import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const UPDATED_AT = "2026-01-01T00:00:00.000Z";

const baseThread: OrchestrationThread = {
  id: ThreadId.make("thread-1"),
  projectId: ProjectId.make("project-1"),
  title: "Manual title",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: UPDATED_AT,
  updatedAt: UPDATED_AT,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  snoozedUntil: null,
  snoozedAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
};

const readModel: OrchestrationReadModel = {
  snapshotSequence: 0,
  projects: [],
  threads: [baseThread],
  updatedAt: UPDATED_AT,
};

// Seeds a read model with `thread-1` overridden by the given partial fields,
// e.g. a specific titleTurnsSincePolicyEval to assert the decider's increment.
function readModelWithThread(overrides: Partial<OrchestrationThread>): OrchestrationReadModel {
  return {
    ...readModel,
    threads: [{ ...baseThread, ...overrides }],
  };
}

it.layer(NodeServices.layer)("title regeneration decider", (it) => {
  it.effect("preserves updatedAt for a stale completion", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.title.regeneration.complete",
          commandId: CommandId.make("cmd-regeneration-complete"),
          threadId: ThreadId.make("thread-1"),
          requestId: CommandId.make("cmd-old-regeneration-request"),
          title: "Generated title",
        },
        readModel,
      });
      const event = Array.isArray(result) ? result[0] : result;

      expect(event.type).toBe("thread.meta-updated");
      if (event.type === "thread.meta-updated") {
        expect(event.payload).toEqual({
          threadId: ThreadId.make("thread-1"),
          updatedAt: UPDATED_AT,
        });
      }
    }),
  );

  it.effect("stamps titleProvenance as manual when a client renames the thread", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.meta.update",
          commandId: CommandId.make("cmd-manual-rename"),
          threadId: ThreadId.make("thread-1"),
          title: "New Title",
        },
        readModel,
      });
      const event = Array.isArray(result) ? result[0] : result;

      expect(event.type).toBe("thread.meta-updated");
      if (event.type === "thread.meta-updated") {
        expect(event.payload.title).toBe("New Title");
        expect(event.payload.titleProvenance).toBe("manual");
      }
    }),
  );

  it.effect(
    "handles thread.title.policy.evaluated: rename resets the turn counter and stamps automatic",
    () =>
      Effect.gen(function* () {
        const result = yield* decideOrchestrationCommand({
          command: {
            type: "thread.title.policy.evaluated",
            commandId: CommandId.make("cmd-policy-rename"),
            threadId: ThreadId.make("thread-1"),
            turnId: TurnId.make("turn-1"),
            protectedPrefix: "PR #4821",
            rename: { title: "PR #4821 Fix sidebar regression" },
          },
          readModel,
        });
        const event = Array.isArray(result) ? result[0] : result;

        expect(event.type).toBe("thread.meta-updated");
        if (event.type === "thread.meta-updated") {
          expect(event.payload.title).toBe("PR #4821 Fix sidebar regression");
          expect(event.payload.titleProvenance).toBe("automatic");
          expect(event.payload.titleProtectedPrefix).toBe("PR #4821");
          expect(event.payload.titleTurnsSincePolicyEval).toBe(0);
        }
      }),
  );

  it.effect(
    "handles thread.title.policy.evaluated: no rename increments the turn counter without touching title",
    () =>
      Effect.gen(function* () {
        const result = yield* decideOrchestrationCommand({
          command: {
            type: "thread.title.policy.evaluated",
            commandId: CommandId.make("cmd-policy-no-rename"),
            threadId: ThreadId.make("thread-1"),
            turnId: TurnId.make("turn-1"),
            protectedPrefix: null,
          },
          readModel: readModelWithThread({ titleTurnsSincePolicyEval: 1 }),
        });
        const event = Array.isArray(result) ? result[0] : result;

        expect(event.type).toBe("thread.meta-updated");
        if (event.type === "thread.meta-updated") {
          expect(event.payload.title).toBeUndefined();
          expect(event.payload.titleProtectedPrefix).toBeNull();
          expect(event.payload.titleTurnsSincePolicyEval).toBe(2);
        }
      }),
  );
});
