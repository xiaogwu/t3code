import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CheckpointRef,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { TextGeneration, type TextGenerationShape } from "../../textGeneration/TextGeneration.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { TitlePolicyReactor } from "../Services/TitlePolicyReactor.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { TitlePolicyReactorLive } from "./TitlePolicyReactor.ts";

const threadId = ThreadId.make("thread-1");
const projectId = ProjectId.make("project-1");
const createdAt = "2026-01-01T00:00:00.000Z";

describe("TitlePolicyReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<
    OrchestrationEngineService | ProjectionSnapshotQuery | TitlePolicyReactor,
    unknown
  > | null = null;
  let scope: Scope.Closeable | null = null;

  afterEach(async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    scope = null;
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  });

  const defaultEvaluation = {
    gist: "Review sidebar cleanup",
    identifiers: ["PR#4821:"],
    shouldRename: true,
    suggestedTitle: "Review sidebar cleanup",
    reason: "A pull request established a durable identifier",
    confidence: 0.9,
  };

  async function createHarness() {
    let evaluationResult = defaultEvaluation;
    const evaluateTitlePolicy = vi.fn(() => Effect.succeed(evaluationResult));
    const setEvaluationResult = (result: typeof defaultEvaluation) => {
      evaluationResult = result;
    };
    const textGenerationLayer = Layer.succeed(TextGeneration, {
      evaluateTitlePolicy,
    } as unknown as TextGenerationShape);
    const orchestrationLayer = Layer.mergeAll(
      OrchestrationEngineLive.pipe(Layer.provide(OrchestrationProjectionSnapshotQueryLive)),
      OrchestrationProjectionSnapshotQueryLive,
    ).pipe(
      Layer.provide(ThreadBackgroundLiveness.layer),
      Layer.provide(ThreadPlanProgress.layer),
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(RepositoryIdentityResolver.layer),
      Layer.provide(SqlitePersistenceMemory),
    );
    const projectionSnapshotLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
      Layer.provide(ThreadBackgroundLiveness.layer),
      Layer.provide(ThreadPlanProgress.layer),
      Layer.provide(RepositoryIdentityResolver.layer),
      Layer.provide(SqlitePersistenceMemory),
    );
    const layer = TitlePolicyReactorLive.pipe(
      Layer.provideMerge(orchestrationLayer),
      Layer.provideMerge(projectionSnapshotLayer),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(textGenerationLayer),
      Layer.provideMerge(
        ServerConfig.layerTest(process.cwd(), { prefix: "t3-title-policy-reactor-test-" }),
      ),
      Layer.provideMerge(NodeServices.layer),
    );

    runtime = ManagedRuntime.make(layer);
    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const projection = await runtime.runPromise(Effect.service(ProjectionSnapshotQuery));
    const reactor = await runtime.runPromise(Effect.service(TitlePolicyReactor));
    scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start().pipe(Scope.provide(scope)));

    await Effect.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.make("cmd-project-create"),
        projectId,
        title: "Test Project",
        workspaceRoot: "/tmp/title-policy-reactor-test",
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        createdAt,
      }),
    );
    await Effect.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make("cmd-thread-create"),
        threadId,
        projectId,
        title: "Thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: "/tmp/title-policy-reactor-test",
        createdAt,
      }),
    );

    let turnSequence = 0;
    const runCompletedTurn = async (
      messageText = "Please review https://github.com/acme/app/pull/4821",
    ) => {
      turnSequence += 1;
      const turnIndex = turnSequence;
      await Effect.runPromise(
        engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make(`cmd-turn-start-${turnIndex}`),
          threadId,
          message: {
            messageId: MessageId.make(`message-user-${turnIndex}`),
            role: "user",
            text: messageText,
            attachments: [],
          },
          runtimeMode: "approval-required",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          createdAt,
        }),
      );
      await Effect.runPromise(
        engine.dispatch({
          type: "thread.turn.diff.complete",
          commandId: CommandId.make(`cmd-turn-diff-${turnIndex}`),
          threadId,
          turnId: TurnId.make(`turn-${turnIndex}`),
          completedAt: createdAt,
          checkpointRef: CheckpointRef.make(`refs/t3/checkpoints/thread-1/turn/${turnIndex}`),
          status: "ready",
          files: [],
          assistantMessageId: MessageId.make(`message-assistant-${turnIndex}`),
          checkpointTurnCount: turnIndex,
          createdAt,
        }),
      );
      await Effect.runPromise(reactor.drain);
    };
    const getThread = async () => {
      const result = await Effect.runPromise(projection.getThreadDetailById(threadId));
      return Option.getOrThrow(result);
    };

    return { engine, evaluateTitlePolicy, getThread, runCompletedTurn, setEvaluationResult };
  }

  it("renames immediately when a PR reference first appears", async () => {
    const harness = await createHarness();
    await harness.runCompletedTurn();

    const thread = await harness.getThread();
    expect(thread.title).toBe("PR#4821: Review sidebar cleanup");
    expect(thread.titleProvenance).toBe("automatic");
    expect(harness.evaluateTitlePolicy).toHaveBeenCalledOnce();
  });

  it("uses the deterministic Oliver title template for an initial /oliver command", async () => {
    const harness = await createHarness();
    await harness.runCompletedTurn("/oliver help me organize this work");

    const thread = await harness.getThread();
    expect(thread.title).toMatch(/^Oliver \d{2}\/\d{2}\/\d{4}$/);
    expect(thread.titleProvenance).toBe("automatic");
    expect(harness.evaluateTitlePolicy).not.toHaveBeenCalled();
  });

  it("does not rename a manually locked title when a new PR reference appears", async () => {
    const harness = await createHarness();
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-title-update"),
        threadId,
        title: "My custom title",
      }),
    );
    await harness.runCompletedTurn();

    const thread = await harness.getThread();
    expect(thread.title).toBe("My custom title");
    expect(harness.evaluateTitlePolicy).not.toHaveBeenCalled();
  });

  it("does not invoke the title model before the refresh threshold is reached", async () => {
    const harness = await createHarness();
    for (let turn = 1; turn < 5; turn += 1) {
      await harness.runCompletedTurn("Keep reviewing the sidebar layout");
    }
    const thread = await harness.getThread();
    expect(thread.title).toBe("Thread");
    expect(thread.titleTurnsSincePolicyEval).toBe(4);
    expect(harness.evaluateTitlePolicy).not.toHaveBeenCalled();
  });

  it("evaluates and accepts a valid rename at the refresh threshold", async () => {
    const harness = await createHarness();
    for (let turn = 1; turn < 6; turn += 1) {
      await harness.runCompletedTurn("Keep reviewing the sidebar layout");
    }
    const thread = await harness.getThread();
    expect(thread.title).toBe("Review sidebar cleanup");
    expect(thread.titleTurnsSincePolicyEval).toBe(0);
    expect(harness.evaluateTitlePolicy).toHaveBeenCalledOnce();
  });

  it("passes the matched rule guidance to the title evaluator", async () => {
    const harness = await createHarness();
    await harness.runCompletedTurn();

    expect(harness.evaluateTitlePolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        guidance: expect.arrayContaining([
          "Describe the feature or concern being reviewed, not the review process.",
        ]),
      }),
    );
  });

  it("increments evaluation bookkeeping when a suggestion is rejected", async () => {
    const harness = await createHarness();
    harness.setEvaluationResult({
      gist: "Sidebar cleanup review",
      identifiers: ["PR#4821:"],
      shouldRename: true,
      suggestedTitle: "Sidebar cleanup review",
      reason: "The suggestion is too uncertain",
      confidence: 0.4,
    });
    await harness.runCompletedTurn();
    const thread = await harness.getThread();
    expect(thread.title).toBe("Thread");
    expect(thread.titleProtectedPrefix).toBe("PR#4821:");
    expect(thread.titleTurnsSincePolicyEval).toBe(1);
    expect(harness.evaluateTitlePolicy).toHaveBeenCalledOnce();
  });
});
