import {
  CommandId,
  MessageId,
  OrchestrationDispatchCommandError,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as GitWorkflowService from "../../git/GitWorkflowService.ts";
import * as ProjectSetupScriptRunner from "../../project/ProjectSetupScriptRunner.ts";
import * as ServerRuntimeStartup from "../../serverRuntimeStartup.ts";
import * as OrchestrationEngine from "./OrchestrationEngine.ts";
import * as ThreadDeletionReactor from "./ThreadDeletionReactor.ts";
import * as ThreadTurnBootstrap from "./ThreadTurnBootstrap.ts";

const THREAD_ID = ThreadId.make("child-1");
const NOW = "2026-08-01T00:00:00.000Z";

const makeCommand = (
  bootstrap?: Extract<OrchestrationCommand, { type: "thread.turn.start" }>["bootstrap"],
) =>
  ({
    type: "thread.turn.start",
    commandId: CommandId.make("turn-1"),
    threadId: THREAD_ID,
    message: {
      messageId: MessageId.make("message-1"),
      role: "user",
      text: "Implement the task",
      attachments: [],
    },
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt: NOW,
    ...(bootstrap === undefined ? {} : { bootstrap }),
  }) as unknown as Extract<OrchestrationCommand, { type: "thread.turn.start" }>;

const makeDependencies = Effect.fn("makeThreadTurnBootstrapDependencies")(function* (options: {
  readonly commands: Ref.Ref<ReadonlyArray<OrchestrationCommand>>;
  readonly deletedSequences: Ref.Ref<ReadonlyArray<number>>;
  readonly failFinalTurn?: boolean;
  readonly setupActivities: Ref.Ref<ReadonlyArray<string>>;
  readonly refreshedPaths: Ref.Ref<ReadonlyArray<string>>;
}) {
  const dispatch = ((command: OrchestrationCommand) =>
    Ref.updateAndGet(options.commands, (current) => [...current, command]).pipe(
      Effect.flatMap((commands) =>
        options.failFinalTurn && command.type === "thread.turn.start"
          ? Effect.fail(new OrchestrationDispatchCommandError({ message: "provider failed" }))
          : Effect.succeed({ sequence: commands.length }),
      ),
    )) as unknown as OrchestrationEngine.OrchestrationEngineShape["dispatch"];
  const engine = {
    dispatch,
  } as unknown as OrchestrationEngine.OrchestrationEngineShape;
  const deletionReactor: ThreadDeletionReactor.ThreadDeletionReactorShape = {
    start: () => Effect.void,
    drainThrough: (sequence) =>
      Ref.update(options.deletedSequences, (current) => [...current, sequence]),
  };
  const git = {
    remoteExists: () => Effect.succeed(false),
    createWorktree: () =>
      Effect.succeed({ worktree: { path: "/tmp/delegated", refName: "feature/delegated" } }),
  } as unknown as GitWorkflowService.GitWorkflowService["Service"];
  const setupScripts = {
    runForThread: () =>
      Effect.succeed({
        status: "started" as const,
        scriptId: "script-1",
        scriptName: "setup",
        terminalId: "terminal-1",
        cwd: "/tmp/delegated",
      }),
  } as unknown as ProjectSetupScriptRunner.ProjectSetupScriptRunner["Service"];
  const startup = {
    enqueueCommand: <A, E>(effect: Effect.Effect<A, E>) => effect,
  } as ServerRuntimeStartup.ServerRuntimeStartup["Service"];
  return Layer.mergeAll(
    Layer.succeed(OrchestrationEngine.OrchestrationEngineService, engine),
    Layer.succeed(ThreadDeletionReactor.ThreadDeletionReactor, deletionReactor),
    Layer.succeed(GitWorkflowService.GitWorkflowService, git),
    Layer.succeed(ProjectSetupScriptRunner.ProjectSetupScriptRunner, setupScripts),
    Layer.succeed(ServerRuntimeStartup.ServerRuntimeStartup, startup),
  );
});

describe("ThreadTurnBootstrap", () => {
  it.effect("creates, fences, prepares, reports setup, and starts the final turn", () =>
    Effect.gen(function* () {
      const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
      const deletedSequences = yield* Ref.make<ReadonlyArray<number>>([]);
      const setupActivities = yield* Ref.make<ReadonlyArray<string>>([]);
      const refreshedPaths = yield* Ref.make<ReadonlyArray<string>>([]);
      const dependencies = yield* makeDependencies({
        commands,
        deletedSequences,
        setupActivities,
        refreshedPaths,
      });
      const bootstrap = yield* ThreadTurnBootstrap.ThreadTurnBootstrap.pipe(
        Effect.provide(
          ThreadTurnBootstrap.ThreadTurnBootstrapLive.pipe(Layer.provide(dependencies)),
        ),
      );
      const result = yield* bootstrap.start(
        makeCommand({
          createThread: {
            projectId: ProjectId.make("project-1"),
            title: "Delegated task",
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: NOW,
          },
          prepareWorktree: {
            projectCwd: "/tmp/project",
            baseBranch: "main",
            branch: "feature/delegated",
          },
          runSetupScript: true,
        }),
        {
          appendSetupActivity: (input) =>
            Ref.update(setupActivities, (current) => [...current, input.kind]),
          refreshGitStatus: (cwd) => Ref.update(refreshedPaths, (current) => [...current, cwd]),
        },
      );
      expect(result.sequence).toBe(3);
      const recorded = yield* Ref.get(commands);
      expect(recorded.map((command) => command.type)).toEqual([
        "thread.create",
        "thread.meta.update",
        "thread.turn.start",
      ]);
      expect(yield* Ref.get(deletedSequences)).toEqual([1]);
      expect(yield* Ref.get(setupActivities)).toEqual([
        "setup-script.requested",
        "setup-script.started",
      ]);
      expect(yield* Ref.get(refreshedPaths)).toEqual(["/tmp/delegated"]);
    }),
  );

  it.effect("deletes a partially-created thread when the final turn fails", () =>
    Effect.gen(function* () {
      const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
      const deletedSequences = yield* Ref.make<ReadonlyArray<number>>([]);
      const setupActivities = yield* Ref.make<ReadonlyArray<string>>([]);
      const refreshedPaths = yield* Ref.make<ReadonlyArray<string>>([]);
      const dependencies = yield* makeDependencies({
        commands,
        deletedSequences,
        setupActivities,
        refreshedPaths,
        failFinalTurn: true,
      });
      const bootstrap = yield* ThreadTurnBootstrap.ThreadTurnBootstrap.pipe(
        Effect.provide(
          ThreadTurnBootstrap.ThreadTurnBootstrapLive.pipe(Layer.provide(dependencies)),
        ),
      );
      const error = yield* bootstrap
        .start(
          makeCommand({
            createThread: {
              projectId: ProjectId.make("project-1"),
              title: "Delegated task",
              modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
              runtimeMode: "full-access",
              interactionMode: "default",
              branch: null,
              worktreePath: null,
              createdAt: NOW,
            },
          }),
        )
        .pipe(Effect.flip);
      assert.isTrue(error._tag === "OrchestrationDispatchCommandError");
      expect(error.bootstrapThreadDisposition).toBe("deleted");
      expect((yield* Ref.get(commands)).map((command) => command.type)).toEqual([
        "thread.create",
        "thread.turn.start",
        "thread.delete",
      ]);
      expect(yield* Ref.get(deletedSequences)).toEqual([1]);
    }),
  );
});
