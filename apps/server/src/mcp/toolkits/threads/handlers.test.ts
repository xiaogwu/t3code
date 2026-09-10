import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ModelSelection,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationShellSnapshot,
  type OrchestrationThread,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/unstable/ai";
import * as NodeServices from "@effect/platform-node/NodeServices";

import * as ServerConfig from "../../../config.ts";
import * as WorkspacePaths from "../../../workspace/WorkspacePaths.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../../orchestration/Services/OrchestrationEngine.ts";
import * as ThreadTurnBootstrap from "../../../orchestration/Services/ThreadTurnBootstrap.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ThreadsToolkit, type StartThreadInput } from "./tools.ts";
import { ThreadsToolkitHandlersLive } from "./handlers.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const PROJECT_ID = ProjectId.make("project-1");
const PARENT_ID = ThreadId.make("parent-1");
const MODEL: ModelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" };
const NOW = "2026-08-01T00:00:00.000Z";

function makeShell(
  id: ThreadId,
  overrides: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell {
  return {
    id,
    projectId: PROJECT_ID,
    title: id === PARENT_ID ? "Parent" : "Child",
    modelSelection: MODEL,
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
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

const parentDetail = (): OrchestrationThread =>
  ({
    ...makeShell(PARENT_ID),
    messages: [],
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    bookmarks: [],
  }) as unknown as OrchestrationThread;

const invocation = (): McpInvocationContext.McpInvocationScope => ({
  environmentId: ENVIRONMENT_ID,
  threadId: PARENT_ID,
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(["threads"]),
  issuedAt: 1,
});

const testLayer = Layer.mergeAll(
  WorkspacePaths.layer,
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-thread-handlers-" }),
).pipe(Layer.provideMerge(NodeServices.layer));

const makeHarness = Effect.fn("makeThreadsToolkitHarness")(function* (options?: {
  readonly initialChildren?: ReadonlyArray<OrchestrationThreadShell>;
  readonly stream?: Stream.Stream<OrchestrationEvent>;
}) {
  const threads = yield* Ref.make<ReadonlyArray<OrchestrationThreadShell>>([
    makeShell(PARENT_ID),
    ...(options?.initialChildren ?? []),
  ]);
  const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
  const dispatch: OrchestrationEngineShape["dispatch"] = (command) =>
    Ref.update(commands, (current) => [...current, command]).pipe(Effect.as({ sequence: 1 }));
  const bootstrap = {
    start: (command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>) =>
      Effect.gen(function* () {
        const create = command.bootstrap?.createThread;
        if (create) {
          yield* Ref.update(threads, (current) => [
            ...current,
            makeShell(command.threadId, {
              projectId: create.projectId,
              title: create.title,
              modelSelection: create.modelSelection,
              runtimeMode: create.runtimeMode,
              interactionMode: create.interactionMode,
              branch: create.branch,
              worktreePath: create.worktreePath,
              parentThreadId: create.parentThreadId,
              parentTurnId: create.parentTurnId,
              spawnKey: create.spawnKey,
            }),
          ]);
        }
        return { sequence: 2 };
      }),
  } satisfies ThreadTurnBootstrap.ThreadTurnBootstrapShape;
  const project = {
    id: PROJECT_ID,
    title: "Project",
    workspaceRoot: process.cwd(),
    defaultModelSelection: null,
    scripts: [],
    repositoryIdentity: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const dependencies = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      getThreadDetailById: (threadId) =>
        Effect.succeed(threadId === PARENT_ID ? Option.some(parentDetail()) : Option.none()),
      getThreadShellById: (threadId) =>
        Ref.get(threads).pipe(
          Effect.map((all) => Option.fromUndefinedOr(all.find((thread) => thread.id === threadId))),
        ),
      getShellSnapshot: () =>
        Ref.get(threads).pipe(
          Effect.map(
            (all) =>
              ({
                projects: [project],
                threads: all,
                snapshotSequence: 1,
                updatedAt: NOW,
              }) as OrchestrationShellSnapshot,
          ),
        ),
      getProjectShellById: (projectId) =>
        Effect.succeed(projectId === PROJECT_ID ? Option.some(project) : Option.none()),
    }),
    Layer.mock(OrchestrationEngineService)({
      readEvents: () => Stream.empty,
      dispatch,
      streamDomainEvents: options?.stream ?? Stream.empty,
      latestSequence: Effect.succeed(1),
    }),
    Layer.succeed(ThreadTurnBootstrap.ThreadTurnBootstrap, bootstrap),
  );
  const allDependencies = Layer.mergeAll(dependencies, testLayer);
  const toolkit = yield* ThreadsToolkit.pipe(
    Effect.provide(ThreadsToolkitHandlersLive.pipe(Layer.provide(allDependencies))),
  );
  const call = <Name extends keyof typeof ThreadsToolkit.tools>(
    name: Name,
    params: Parameters<typeof toolkit.handle<Name>>[1],
  ) =>
    toolkit.handle(name, params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map(
        (chunks) => chunks.at(-1)!.result as Tool.Success<(typeof ThreadsToolkit.tools)[Name]>,
      ),
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation()),
      Effect.provide(allDependencies),
    );
  return { call, commands, threads };
});

describe("thread toolkit handlers", () => {
  it.effect("starts once and returns the existing child for an idempotent retry", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const input: StartThreadInput = { taskKey: "task-1", prompt: "Implement it" };
      const first = yield* harness.call("start_thread", input);
      const second = yield* harness.call("start_thread", input);
      expect(first.threadId).toBe(second.threadId);
      expect(second.alreadyStarted).toBe(true);
      expect(
        (yield* Ref.get(harness.threads)).filter((thread) => thread.parentThreadId === PARENT_ID),
      ).toHaveLength(1);
      expect(
        (yield* Ref.get(harness.commands)).filter(
          (command) => command.type === "thread.activity.append",
        ),
      ).toHaveLength(1);
    }),
  );

  it.effect("wraps listed child threads in an MCP-compatible object", () =>
    Effect.gen(function* () {
      const childId = ThreadId.make("listed-child");
      const harness = yield* makeHarness({
        initialChildren: [makeShell(childId, { parentThreadId: PARENT_ID })],
      });

      const result = yield* harness.call("list_child_threads", { includeTerminal: true });

      expect(result).toMatchObject({
        threads: [{ threadId: childId }],
      });
    }),
  );

  it.effect("rejects the fifth child and enforces child ownership", () =>
    Effect.gen(function* () {
      const children = Array.from({ length: 4 }, (_, index) =>
        makeShell(ThreadId.make(`child-${index}`), {
          parentThreadId: PARENT_ID,
          spawnKey: `existing-${index}`,
        }),
      );
      const harness = yield* makeHarness({ initialChildren: children });
      const fanoutError = yield* harness
        .call("start_thread", { taskKey: "fifth", prompt: "Too many" })
        .pipe(Effect.flip);
      expect(fanoutError).toMatchObject({ _tag: "ThreadDelegationFailedError" });

      const recursive = yield* makeHarness({
        initialChildren: [
          makeShell(ThreadId.make("delegated-parent"), {
            parentThreadId: ThreadId.make("other-parent"),
          }),
        ],
      });
      // The scope is the human parent in this harness; ownership remains
      // explicit in the projection and is what the decider also enforces.
      const result = yield* recursive
        .call("get_thread_status", { threadId: ThreadId.make("delegated-parent") })
        .pipe(Effect.flip);
      expect(result).toMatchObject({ _tag: "ThreadNotOwnedError" });
    }),
  );

  it.effect("bounds event-driven waits without polling", () =>
    Effect.gen(function* () {
      const childId = ThreadId.make("running-child");
      const harness = yield* makeHarness({
        initialChildren: [
          makeShell(childId, {
            parentThreadId: PARENT_ID,
            latestTurn: { state: "running" } as OrchestrationThreadShell["latestTurn"],
          }),
        ],
        stream: Stream.succeed({
          aggregateId: ThreadId.make("other-thread"),
        } as OrchestrationEvent),
      });
      const error = yield* harness
        .call("wait_for_thread", { threadId: childId, timeoutMs: 5 })
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "ThreadWaitTimedOutError", threadId: childId });
    }),
  );
});
