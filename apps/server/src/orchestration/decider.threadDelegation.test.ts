import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const NOW = "2026-08-01T00:00:00.000Z";
const PROJECT_ID = ProjectId.make("delegation-project");
const PARENT_ID = ThreadId.make("delegation-parent");
const MODEL = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" };

const baseEvent = (sequence: number, aggregateKind: "project" | "thread", aggregateId: string) => ({
  sequence,
  eventId: EventId.make(`delegation-event-${sequence}`),
  aggregateKind,
  aggregateId: aggregateId as ProjectId & ThreadId,
  occurredAt: NOW,
  commandId: CommandId.make(`delegation-command-${sequence}`),
  causationEventId: null,
  correlationId: CommandId.make(`delegation-command-${sequence}`),
  metadata: {},
});

const projectCreated = (): OrchestrationEvent => ({
  ...baseEvent(1, "project", PROJECT_ID),
  type: "project.created",
  payload: {
    projectId: PROJECT_ID,
    title: "Delegation project",
    workspaceRoot: "/tmp/delegation-project",
    defaultModelSelection: null,
    scripts: [],
    createdAt: NOW,
    updatedAt: NOW,
  },
});

const threadCreated = (
  sequence: number,
  threadId: ThreadId,
  parentThreadId?: ThreadId,
  spawnKey?: string,
): OrchestrationEvent => ({
  ...baseEvent(sequence, "thread", threadId),
  type: "thread.created",
  payload: {
    threadId,
    projectId: PROJECT_ID,
    title: threadId === PARENT_ID ? "Parent" : "Child",
    modelSelection: MODEL,
    runtimeMode: "full-access",
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    ...(parentThreadId === undefined ? {} : { parentThreadId }),
    ...(spawnKey === undefined ? {} : { spawnKey }),
    createdAt: NOW,
    updatedAt: NOW,
  },
});

const childCreateCommand = (
  threadId: ThreadId,
  spawnKey: string,
  parentThreadId = PARENT_ID,
): OrchestrationCommand => ({
  type: "thread.create",
  commandId: CommandId.make(`create-${threadId}`),
  threadId,
  projectId: PROJECT_ID,
  title: "Child",
  modelSelection: MODEL,
  runtimeMode: "full-access",
  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
  branch: null,
  worktreePath: null,
  parentThreadId,
  parentTurnId: null,
  spawnKey,
  createdAt: NOW,
});

const firstEvent = (event: unknown): OrchestrationEvent =>
  (Array.isArray(event) ? event[0] : event) as OrchestrationEvent;

it.layer(NodeServices.layer)("thread delegation decider", (it) => {
  it.effect(
    "persists provenance and rejects duplicate keys, recursion, and fan-out beyond four",
    () =>
      Effect.gen(function* () {
        let readModel = createEmptyReadModel(NOW);
        readModel = yield* projectEvent(readModel, projectCreated());
        readModel = yield* projectEvent(readModel, threadCreated(2, PARENT_ID));

        const firstChildId = ThreadId.make("delegation-child-1");
        const firstChildEvent = firstEvent(
          yield* decideOrchestrationCommand({
            command: childCreateCommand(firstChildId, "task-1"),
            readModel,
          }),
        ) as Extract<OrchestrationEvent, { type: "thread.created" }>;
        expect(firstChildEvent.payload).toMatchObject({
          parentThreadId: PARENT_ID,
          parentTurnId: null,
          spawnKey: "task-1",
        });
        readModel = yield* projectEvent(readModel, {
          ...firstChildEvent,
          sequence: 3,
        } as OrchestrationEvent);
        expect(readModel.threads.find((thread) => thread.id === firstChildId)).toMatchObject({
          parentThreadId: PARENT_ID,
          spawnKey: "task-1",
        });

        const duplicate = yield* Effect.flip(
          decideOrchestrationCommand({
            command: childCreateCommand(ThreadId.make("delegation-child-duplicate"), "task-1"),
            readModel,
          }),
        );
        expect(duplicate).toMatchObject({
          _tag: "OrchestrationCommandInvariantError",
          detail: expect.stringContaining("already in use"),
        });

        const recursive = yield* Effect.flip(
          decideOrchestrationCommand({
            command: childCreateCommand(
              ThreadId.make("delegation-grandchild"),
              "grandchild",
              firstChildId,
            ),
            readModel,
          }),
        );
        expect(recursive).toMatchObject({
          _tag: "OrchestrationCommandInvariantError",
          detail: expect.stringContaining("cannot create another delegated thread"),
        });

        for (let index = 2; index <= 4; index += 1) {
          const childId = ThreadId.make(`delegation-child-${index}`);
          const event = firstEvent(
            yield* decideOrchestrationCommand({
              command: childCreateCommand(childId, `task-${index}`),
              readModel,
            }),
          );
          readModel = yield* projectEvent(readModel, {
            ...event,
            sequence: 3 + index,
          } as OrchestrationEvent);
        }
        const fanout = yield* Effect.flip(
          decideOrchestrationCommand({
            command: childCreateCommand(ThreadId.make("delegation-child-5"), "task-5"),
            readModel,
          }),
        );
        expect(fanout).toMatchObject({
          _tag: "OrchestrationCommandInvariantError",
          detail: expect.stringContaining("at most four"),
        });
      }),
  );
});
