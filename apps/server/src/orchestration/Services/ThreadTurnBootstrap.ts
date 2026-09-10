import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  CommandId,
  type ThreadId,
  type OrchestrationCommand,
  OrchestrationDispatchCommandError,
} from "@t3tools/contracts";
import * as GitWorkflowService from "../../git/GitWorkflowService.ts";
import * as ProjectSetupScriptRunner from "../../project/ProjectSetupScriptRunner.ts";
import * as ServerRuntimeStartup from "../../serverRuntimeStartup.ts";
import * as OrchestrationEngine from "./OrchestrationEngine.ts";
import type { OrchestrationDispatchError } from "../Errors.ts";

type BootstrapDependencyError = OrchestrationDispatchError | OrchestrationDispatchCommandError;
import { ThreadDeletionReactor } from "./ThreadDeletionReactor.ts";

/**
 * Shared bootstrap boundary for a newly-created thread. MCP and WebSocket
 * callers must enter here so worktree creation, setup scripts, queue ordering,
 * and partial-thread cleanup stay identical.
 */
export interface ThreadTurnBootstrapShape {
  readonly start: (
    command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
    options?: ThreadTurnBootstrapOptions,
  ) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError>;
}

export interface ThreadTurnBootstrapOptions {
  readonly dispatch?: OrchestrationEngine.OrchestrationEngineShape["dispatch"];
  readonly commandId?: (tag: string) => Effect.Effect<CommandId, BootstrapDependencyError, never>;
  readonly appendSetupActivity?: (input: {
    readonly threadId: ThreadId;
    readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
    readonly summary: string;
    readonly createdAt: string;
    readonly payload: Record<string, unknown>;
    readonly tone: "info" | "error";
  }) => Effect.Effect<unknown, BootstrapDependencyError, never>;
  readonly refreshGitStatus?: (cwd: string) => Effect.Effect<void, never, never>;
}

export class ThreadTurnBootstrap extends Context.Service<
  ThreadTurnBootstrap,
  ThreadTurnBootstrapShape
>()("t3/orchestration/Services/ThreadTurnBootstrap") {}

function legacySetupFailureDescription(cause: unknown): string {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string"
  ) {
    return cause.message;
  }
  return String(cause);
}

function projectSetupScriptCompatibilityDetail(
  error: ProjectSetupScriptRunner.ProjectSetupScriptRunnerError,
): string {
  switch (error._tag) {
    case "ProjectSetupScriptOperationError":
      return legacySetupFailureDescription(error.cause);
    case "ProjectSetupScriptProjectNotFoundError":
      return "Project was not found for setup script execution.";
  }
}

export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const deletionReactor = yield* ThreadDeletionReactor;
  const git = yield* GitWorkflowService.GitWorkflowService;
  const setupScripts = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
  const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

  const toDispatchError = (cause: unknown, created = false) =>
    Schema.is(OrchestrationDispatchCommandError)(cause)
      ? cause
      : new OrchestrationDispatchCommandError({
          message: cause instanceof Error ? cause.message : "Failed to bootstrap thread",
          cause,
          ...(created ? { bootstrapThreadDisposition: "deleted" as const } : {}),
        });

  const start = (
    command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
    options?: ThreadTurnBootstrapOptions,
  ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> => {
    const dispatch = options?.dispatch ?? engine.dispatch;
    const commandId =
      options?.commandId ??
      ((tag: string) => Effect.succeed(CommandId.make(`${command.commandId}:${tag}`)));
    const appendSetupActivity = options?.appendSetupActivity;
    const refreshGitStatus = options?.refreshGitStatus ?? (() => Effect.void);

    return startup
      .enqueueCommand(
        Effect.gen(function* () {
          const bootstrap = command.bootstrap;
          const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
          let createdThread = false;
          let targetProjectId = bootstrap?.createThread?.projectId;
          let targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
          let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;

          const cleanupCreatedThread = () =>
            createdThread
              ? commandId("bootstrap-thread-delete").pipe(
                  Effect.flatMap((deleteCommandId) =>
                    dispatch({
                      type: "thread.delete",
                      commandId: deleteCommandId,
                      threadId: command.threadId,
                    }),
                  ),
                  Effect.as(true),
                )
              : Effect.succeed(false);

          const recordSetupActivity = (input: {
            readonly kind:
              | "setup-script.requested"
              | "setup-script.started"
              | "setup-script.failed";
            readonly summary: string;
            readonly createdAt: string;
            readonly payload: Record<string, unknown>;
            readonly tone: "info" | "error";
          }) =>
            appendSetupActivity === undefined
              ? Effect.void
              : appendSetupActivity({ threadId: command.threadId, ...input }).pipe(
                  Effect.asVoid,
                  Effect.catch((error) =>
                    Effect.logWarning(
                      "bootstrap turn start launched setup script but failed to record setup activity",
                      {
                        threadId: command.threadId,
                        worktreePath: input.payload.worktreePath,
                        detail: error instanceof Error ? error.message : String(error),
                      },
                    ),
                  ),
                );

          const runSetupProgram = () =>
            Effect.gen(function* () {
              if (!bootstrap?.runSetupScript || !targetWorktreePath) return;
              const worktreePath = targetWorktreePath;
              const requestedAt = yield* nowIso;
              yield* setupScripts
                .runForThread({
                  threadId: command.threadId,
                  ...(targetProjectId ? { projectId: targetProjectId } : {}),
                  ...(targetProjectCwd ? { projectCwd: targetProjectCwd } : {}),
                  worktreePath,
                })
                .pipe(
                  Effect.matchEffect({
                    onFailure: (error) => {
                      const detail = projectSetupScriptCompatibilityDetail(error);
                      return recordSetupActivity({
                        kind: "setup-script.failed",
                        summary: "Setup script failed to start",
                        createdAt: requestedAt,
                        payload: { detail, worktreePath },
                        tone: "error",
                      }).pipe(
                        Effect.andThen(
                          Effect.logWarning("bootstrap turn start failed to launch setup script", {
                            threadId: command.threadId,
                            worktreePath,
                            detail,
                          }),
                        ),
                      );
                    },
                    onSuccess: (result) =>
                      result.status === "started"
                        ? Effect.gen(function* () {
                            const startedAt = yield* nowIso;
                            const payload = {
                              scriptId: result.scriptId,
                              scriptName: result.scriptName,
                              terminalId: result.terminalId,
                              worktreePath,
                            };
                            yield* Effect.all([
                              recordSetupActivity({
                                kind: "setup-script.requested",
                                summary: "Starting setup script",
                                createdAt: requestedAt,
                                payload,
                                tone: "info",
                              }),
                              recordSetupActivity({
                                kind: "setup-script.started",
                                summary: "Setup script started",
                                createdAt: startedAt,
                                payload,
                                tone: "info",
                              }),
                            ]);
                          })
                        : Effect.void,
                  }),
                );
            });

          const bootstrapProgram = Effect.gen(function* () {
            if (bootstrap?.createThread) {
              const createCommandId = yield* commandId("bootstrap-thread-create");
              const created = yield* dispatch({
                type: "thread.create",
                commandId: createCommandId,
                threadId: command.threadId,
                projectId: bootstrap.createThread.projectId,
                title: bootstrap.createThread.title,
                modelSelection: bootstrap.createThread.modelSelection,
                runtimeMode: bootstrap.createThread.runtimeMode,
                interactionMode: bootstrap.createThread.interactionMode,
                branch: bootstrap.createThread.branch,
                worktreePath: bootstrap.createThread.worktreePath,
                ...(bootstrap.createThread.parentThreadId !== undefined
                  ? { parentThreadId: bootstrap.createThread.parentThreadId }
                  : {}),
                ...(bootstrap.createThread.parentTurnId !== undefined
                  ? { parentTurnId: bootstrap.createThread.parentTurnId }
                  : {}),
                ...(bootstrap.createThread.spawnKey != null
                  ? { spawnKey: bootstrap.createThread.spawnKey }
                  : {}),
                createdAt: bootstrap.createThread.createdAt,
              });
              yield* deletionReactor.drainThrough(created.sequence);
              createdThread = true;
            }
            if (bootstrap?.prepareWorktree) {
              let worktreeBaseRef = bootstrap.prepareWorktree.baseBranch;
              if (
                bootstrap.prepareWorktree.startFromOrigin === true &&
                (yield* git.remoteExists({
                  cwd: bootstrap.prepareWorktree.projectCwd,
                  remoteName: "origin",
                }))
              ) {
                yield* git.fetchRemote({
                  cwd: bootstrap.prepareWorktree.projectCwd,
                  remoteName: "origin",
                });
                if (
                  yield* git.remoteBranchExists({
                    cwd: bootstrap.prepareWorktree.projectCwd,
                    refName: bootstrap.prepareWorktree.baseBranch,
                    remoteName: "origin",
                  })
                ) {
                  worktreeBaseRef = yield* git
                    .resolveRemoteTrackingCommit({
                      cwd: bootstrap.prepareWorktree.projectCwd,
                      refName: bootstrap.prepareWorktree.baseBranch,
                      fallbackRemoteName: "origin",
                    })
                    .pipe(Effect.map((result) => result.commitSha));
                }
              }
              const worktree = yield* git.createWorktree({
                cwd: bootstrap.prepareWorktree.projectCwd,
                refName: worktreeBaseRef,
                newRefName: bootstrap.prepareWorktree.branch ?? `t3/agent/${command.threadId}`,
                baseRefName: bootstrap.prepareWorktree.baseBranch,
                path: null,
              });
              targetWorktreePath = worktree.worktree.path;
              yield* commandId("bootstrap-thread-meta-update").pipe(
                Effect.flatMap((metaCommandId) =>
                  dispatch({
                    type: "thread.meta.update",
                    commandId: metaCommandId,
                    threadId: command.threadId,
                    branch: worktree.worktree.refName,
                    worktreePath: targetWorktreePath,
                  }),
                ),
              );
              yield* refreshGitStatus(targetWorktreePath);
            }
            yield* runSetupProgram();
            return yield* dispatch(finalTurnStartCommand);
          });

          return yield* bootstrapProgram.pipe(
            Effect.catchCause((cause) => {
              const error = Cause.squash(cause);
              const dispatchError = toDispatchError(error);
              if (Cause.hasInterruptsOnly(cause)) return Effect.fail(dispatchError);
              return Effect.uninterruptible(cleanupCreatedThread()).pipe(
                Effect.matchCauseEffect({
                  onFailure: (cleanupCause) =>
                    Effect.logWarning("bootstrap thread cleanup failed", {
                      threadId: command.threadId,
                      detail: Cause.pretty(cleanupCause),
                    }).pipe(Effect.flatMap(() => Effect.fail(dispatchError))),
                  onSuccess: (threadDeleted) =>
                    Effect.fail(
                      threadDeleted
                        ? new OrchestrationDispatchCommandError({
                            message: dispatchError.message,
                            ...(dispatchError.cause !== undefined
                              ? { cause: dispatchError.cause }
                              : {}),
                            bootstrapThreadDisposition: "deleted",
                          })
                        : dispatchError,
                    ),
                }),
              );
            }),
          );
        }),
      )
      .pipe(Effect.mapError((error) => toDispatchError(error)));
  };

  return { start } satisfies ThreadTurnBootstrapShape;
});

export const ThreadTurnBootstrapLive = Layer.effect(ThreadTurnBootstrap, make);
