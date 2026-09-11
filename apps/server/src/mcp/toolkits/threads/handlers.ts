import * as NodeCrypto from "node:crypto";

import {
  AGENT_SETTLE_REASON_MAX_LENGTH,
  CommandId,
  EventId,
  MessageId,
  ThreadId,
  type ChatAttachment,
  type ClientOrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as OrchestrationEngine from "../../../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadTurnBootstrap from "../../../orchestration/Services/ThreadTurnBootstrap.ts";
import {
  cleanupFailedUploadedAttachments,
  normalizeDispatchCommand,
} from "../../../orchestration/Normalizer.ts";
import { ServerConfig } from "../../../config.ts";
import { WorkspacePaths } from "../../../workspace/WorkspacePaths.ts";
import {
  type ListChildThreadsInput,
  type SendThreadMessageInput,
  type SettleThreadInput,
  type SettleThreadResult,
  type StartThreadInput,
  ThreadDelegationFailedError,
  ThreadNotFoundError,
  ThreadNotOwnedError,
  ThreadProjectNotFoundError,
  ThreadReference,
  ThreadToolError,
  ThreadWaitTimedOutError,
  ThreadsToolkit,
  type WaitForThreadInput,
} from "./tools.ts";

const DELEGATION_ACTIVITY_KIND = "delegated-thread";
const TERMINAL_STATUSES = new Set(["completed", "failed", "settled", "deleted"]);
const MAX_WAIT_TIMEOUT_MS = 300_000;

type ThreadShell = OrchestrationThreadShell;

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const childIdFor = (parentThreadId: string, taskKey: string): ThreadId =>
  ThreadId.make(
    `agent-child-${NodeCrypto.createHash("sha256").update(`${parentThreadId}:${taskKey}`).digest("hex")}`,
  );

const commandIdFor = (name: string, childId: ThreadId): CommandId =>
  CommandId.make(`mcp:threads:${name}:${childId}`);

const messageIdFor = (childId: ThreadId, suffix: string): MessageId =>
  MessageId.make(`mcp:${childId}:${suffix}`);

function statusOf(thread: ThreadShell | undefined): ThreadReference["status"] {
  if (thread === undefined) return "deleted";
  if (thread.session?.status === "error" || thread.latestTurn?.state === "error") return "failed";
  if (thread.settledOverride === "settled") return "settled";
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return "waiting";
  if (thread.session?.status === "starting" || thread.session?.status === "running")
    return "running";
  if (thread.latestTurn?.state === "running") return "running";
  if (thread.latestTurn?.state === "completed") return "completed";
  return "queued";
}

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const bootstrap = yield* Effect.serviceOption(ThreadTurnBootstrap.ThreadTurnBootstrap);

  const requireCapability = () => McpInvocationContext.requireMcpCapability("threads");

  const requireParentDetail = Effect.fn("ThreadsToolkit.requireParentDetail")(function* (
    scope: McpInvocationContext.McpInvocationScope,
  ) {
    const parent = yield* snapshots
      .getThreadDetailById(scope.threadId)
      .pipe(Effect.mapError(() => new ThreadNotFoundError({ threadId: scope.threadId })));
    if (Option.isNone(parent)) return yield* new ThreadNotFoundError({ threadId: scope.threadId });
    return parent.value;
  });

  const requireChild = Effect.fn("ThreadsToolkit.requireChild")(function* (childId: ThreadId) {
    const scope = yield* requireCapability();
    const parent = yield* requireParentDetail(scope);
    const child = yield* snapshots
      .getThreadShellById(childId)
      .pipe(Effect.mapError(() => new ThreadNotFoundError({ threadId: childId })));
    const value = Option.getOrUndefined(child);
    if (value?.parentThreadId !== scope.threadId) {
      return yield* new ThreadNotOwnedError({ threadId: childId });
    }
    return value;
  });

  const referenceOf = Effect.fn("ThreadsToolkit.referenceOf")(function* (
    scope: McpInvocationContext.McpInvocationScope,
    thread: ThreadShell | undefined,
    alreadyStarted: boolean,
  ) {
    if (thread === undefined) {
      return yield* new ThreadNotFoundError({ threadId: "deleted" as ThreadId });
    }
    const resultPreview =
      thread.latestTurn?.state === "completed" || thread.settledOverride === "settled"
        ? yield* snapshots.getThreadDetailById(thread.id).pipe(
            Effect.map((detail) =>
              Option.isSome(detail)
                ? detail.value.messages
                    .findLast(
                      (message) => message.role === "assistant" && message.text.trim().length > 0,
                    )
                    ?.text.trim()
                    .slice(0, 500)
                : undefined,
            ),
            Effect.orElseSucceed(() => undefined),
          )
        : undefined;
    return {
      environmentId: scope.environmentId,
      projectId: thread.projectId,
      threadId: thread.id,
      title: thread.title,
      status: statusOf(thread),
      branch: thread.branch,
      worktreePath: thread.worktreePath,
      ...(resultPreview === undefined ? {} : { resultPreview }),
      alreadyStarted,
    };
  });

  const appendDelegationActivity = Effect.fn("ThreadsToolkit.appendDelegationActivity")(function* (
    parentThreadId: ThreadId,
    payload: Record<string, unknown>,
  ) {
    const timestamp = yield* nowIso;
    yield* engine
      .dispatch({
        type: "thread.activity.append",
        commandId: CommandId.make(
          `mcp:threads:activity:${String(payload.childThreadId)}:${String(payload.status)}`,
        ),
        threadId: parentThreadId,
        activity: {
          id: EventId.make(
            `mcp:delegation:${String(payload.childThreadId)}:${String(payload.status)}`,
          ),
          tone: payload.status === "failed" ? "error" : "info",
          kind: DELEGATION_ACTIVITY_KIND,
          summary: `Delegated thread ${String(payload.status)}`,
          payload,
          turnId: null,
          createdAt: timestamp,
        },
        createdAt: timestamp,
      })
      .pipe(Effect.ignore);
  });

  const dispatchTurn = Effect.fn("ThreadsToolkit.dispatchTurn")(function* (
    childId: ThreadId,
    text: string,
    attachments: ReadonlyArray<ChatAttachment>,
    suffix: string,
  ) {
    const timestamp = yield* nowIso;
    const child = yield* snapshots.getThreadShellById(childId).pipe(
      Effect.mapError(() => new ThreadNotFoundError({ threadId: childId })),
      Effect.flatMap((value) =>
        Option.isSome(value)
          ? Effect.succeed(value.value)
          : Effect.fail(new ThreadNotFoundError({ threadId: childId })),
      ),
    );
    const command: ClientOrchestrationCommand = {
      type: "thread.turn.start",
      commandId: commandIdFor(`turn:${suffix}`, childId),
      threadId: childId,
      runtimeMode: child.runtimeMode,
      interactionMode: child.interactionMode,
      modelSelection: child.modelSelection,
      createdAt: timestamp,
      message: {
        messageId: messageIdFor(childId, suffix),
        role: "user",
        text,
        attachments: [...attachments],
      },
    };
    const normalized = yield* normalizeDispatchCommand(command).pipe(
      Effect.mapError((error) => new ThreadDelegationFailedError({ message: error.message })),
    );
    if (normalized.type !== "thread.turn.start") {
      return yield* new ThreadDelegationFailedError({ message: "Invalid child thread command." });
    }
    return yield* engine
      .dispatch(normalized)
      .pipe(Effect.tapError(() => cleanupFailedUploadedAttachments(command, normalized)));
  });

  const startThread = (input: StartThreadInput) =>
    Effect.gen(function* () {
      const invocation = yield* requireCapability();
      const parent = yield* requireParentDetail(invocation);
      // Agent-created top-level threads are intentionally leaves. This keeps a
      // model from recursively multiplying provider sessions; a human-created
      // parent may fan out at most four children per delegated conversation.
      if (parent.parentThreadId !== undefined && parent.parentThreadId !== null) {
        return yield* new ThreadDelegationFailedError({
          message: "Delegated threads cannot create additional delegated threads.",
        });
      }
      const shellSnapshot = yield* snapshots
        .getShellSnapshot()
        .pipe(
          Effect.mapError(
            () => new ThreadDelegationFailedError({ message: "Could not read child threads." }),
          ),
        );
      if (
        shellSnapshot.threads.filter((thread) => thread.parentThreadId === invocation.threadId)
          .length >= 4
      ) {
        return yield* new ThreadDelegationFailedError({
          message: "This thread has reached the maximum of four delegated child threads.",
        });
      }
      const childId = childIdFor(invocation.threadId, input.taskKey);
      const existing = yield* snapshots
        .getThreadShellById(childId)
        .pipe(
          Effect.mapError(
            () => new ThreadDelegationFailedError({ message: "Could not read child thread." }),
          ),
        );
      if (Option.isSome(existing)) {
        if (
          existing.value.parentThreadId !== invocation.threadId ||
          existing.value.spawnKey !== input.taskKey
        ) {
          return yield* new ThreadDelegationFailedError({
            message: "The stable task key is already used by another thread.",
          });
        }
        return yield* referenceOf(invocation, existing.value, true);
      }

      const projectId = input.projectId ?? parent.projectId;
      const projectOption = yield* snapshots
        .getProjectShellById(projectId)
        .pipe(
          Effect.mapError(
            () => new ThreadDelegationFailedError({ message: "Could not read project." }),
          ),
        );
      if (Option.isNone(projectOption)) return yield* new ThreadProjectNotFoundError({ projectId });
      const project = projectOption.value;
      const modelSelection =
        input.modelSelection ?? project.defaultModelSelection ?? parent.modelSelection;
      const workspace = input.workspace ?? { mode: "local" as const };
      let branch: string | null = workspace.branch ?? null;
      let worktreePath: string | null = workspace.worktreePath ?? null;
      if (workspace.mode === "local") {
        branch = projectId === parent.projectId ? parent.branch : null;
        worktreePath = null;
      } else if (workspace.mode === "existing-worktree" && worktreePath === null) {
        return yield* new ThreadDelegationFailedError({
          message: "existing-worktree requires worktreePath.",
        });
      } else if (workspace.mode === "new-worktree") {
        branch = branch ?? `t3/agent/${childId.slice(-12)}`;
        worktreePath = null;
      }

      const createdAt = yield* nowIso;
      const startCommand: ClientOrchestrationCommand = {
        type: "thread.turn.start",
        commandId: commandIdFor("start", childId),
        threadId: childId,
        runtimeMode: parent.runtimeMode,
        interactionMode: parent.interactionMode,
        createdAt,
        message: {
          messageId: messageIdFor(childId, "initial"),
          role: "user",
          text: input.prompt,
          attachments: [...(input.attachments ?? [])],
        },
        modelSelection,
        bootstrap: {
          createThread: {
            projectId,
            title: input.prompt.trim().slice(0, 120) || "Delegated task",
            modelSelection,
            runtimeMode: parent.runtimeMode,
            interactionMode: parent.interactionMode,
            branch,
            worktreePath,
            parentThreadId: invocation.threadId,
            parentTurnId: parent.latestTurn?.turnId ?? null,
            spawnKey: input.taskKey,
            createdAt,
          },
          ...(workspace.mode === "new-worktree"
            ? {
                prepareWorktree: {
                  projectCwd: project.workspaceRoot,
                  baseBranch:
                    workspace.baseBranch ??
                    (projectId === parent.projectId ? parent.branch : null) ??
                    "HEAD",
                  branch: branch ?? `t3/agent/${childId.slice(-12)}`,
                  ...(workspace.startFromOrigin === undefined
                    ? {}
                    : { startFromOrigin: workspace.startFromOrigin }),
                },
              }
            : {}),
          runSetupScript: true,
        },
      };
      const normalizedCommand = yield* normalizeDispatchCommand(startCommand).pipe(
        Effect.mapError((error) => new ThreadDelegationFailedError({ message: error.message })),
      );
      if (normalizedCommand.type !== "thread.turn.start") {
        return yield* new ThreadDelegationFailedError({
          message: "Invalid delegated thread command.",
        });
      }
      yield* Option.match(bootstrap, {
        onNone: () =>
          Effect.fail(
            new ThreadDelegationFailedError({
              message: "Thread bootstrap service is unavailable.",
            }),
          ),
        onSome: (service) =>
          service.start(normalizedCommand).pipe(
            Effect.tapError(() =>
              cleanupFailedUploadedAttachments(startCommand, normalizedCommand),
            ),
            Effect.mapError((error) => new ThreadDelegationFailedError({ message: error.message })),
          ),
      });
      yield* appendDelegationActivity(invocation.threadId, {
        childThreadId: childId,
        taskKey: input.taskKey,
        projectId,
        prompt: input.prompt,
        status: "queued",
      });
      const child = yield* snapshots.getThreadShellById(childId).pipe(
        Effect.map(Option.getOrUndefined),
        Effect.mapError(
          () => new ThreadDelegationFailedError({ message: "Child was not projected." }),
        ),
      );
      return yield* referenceOf(invocation, child, false);
    });

  const getStatus = (childId: ThreadId) =>
    Effect.gen(function* () {
      const scope = yield* requireCapability();
      const child = yield* requireChild(childId);
      return yield* referenceOf(scope, child, true);
    });

  const listChildren = (input: ListChildThreadsInput) =>
    Effect.gen(function* () {
      const scope = yield* requireCapability();
      const snapshot = yield* snapshots
        .getShellSnapshot()
        .pipe(
          Effect.mapError(
            () => new ThreadDelegationFailedError({ message: "Could not read child threads." }),
          ),
        );
      const children = snapshot.threads.filter(
        (thread) => thread.parentThreadId === scope.threadId,
      );
      const refs = yield* Effect.forEach(children, (child) => referenceOf(scope, child, true));
      return {
        threads: refs.filter(
          (ref) => input.includeTerminal === true || !TERMINAL_STATUSES.has(ref.status),
        ),
      };
    });

  const sendMessage = (input: SendThreadMessageInput) =>
    Effect.gen(function* () {
      const child = yield* requireChild(input.threadId);
      if (child === undefined) return yield* new ThreadNotFoundError({ threadId: input.threadId });
      const suffix = `followup-${NodeCrypto.createHash("sha256").update(input.prompt).digest("hex").slice(0, 12)}`;
      yield* dispatchTurn(input.threadId, input.prompt, input.attachments ?? [], suffix).pipe(
        Effect.mapError((error) => new ThreadDelegationFailedError({ message: error.message })),
      );
      const scope = yield* requireCapability();
      yield* appendDelegationActivity(scope.threadId, {
        childThreadId: input.threadId,
        status: "running",
        prompt: input.prompt,
      });
      return yield* getStatus(input.threadId);
    });

  const settleThread = (input: SettleThreadInput) =>
    Effect.gen(function* () {
      // Deliberately not requireCapability(): thread delegation and settling
      // one's own thread are separate grants, and the toolkit is registered
      // whether or not either is enabled.
      const scope = yield* McpInvocationContext.requireMcpCapability("thread-settle");
      const before = yield* snapshots.getThreadShellById(scope.threadId).pipe(
        Effect.map(Option.getOrUndefined),
        Effect.mapError(() => new ThreadNotFoundError({ threadId: scope.threadId })),
      );
      if (before === undefined) return yield* new ThreadNotFoundError({ threadId: scope.threadId });
      // The turn the settle waits on comes from the live session, never from the
      // caller: an agent cannot arm a turn other than the one it is running in.
      const turnId = before.session?.activeTurnId ?? null;
      const reason = input.reason?.trim().slice(0, AGENT_SETTLE_REASON_MAX_LENGTH) || null;
      yield* engine
        .dispatch({
          type: "thread.agent-settle.request",
          // Same turn and same reason is the same request; a changed reason
          // re-arms rather than being swallowed by command dedup.
          commandId: CommandId.make(
            `mcp:threads:agent-settle:${scope.threadId}:${turnId ?? "idle"}:${NodeCrypto.createHash(
              "sha256",
            )
              .update(reason ?? "")
              .digest("hex")
              .slice(0, 12)}`,
          ),
          threadId: scope.threadId,
          turnId,
          reason,
        })
        .pipe(
          Effect.mapError((error) => new ThreadDelegationFailedError({ message: error.message })),
        );
      const after = yield* snapshots.getThreadShellById(scope.threadId).pipe(
        Effect.map(Option.getOrUndefined),
        Effect.mapError(() => new ThreadNotFoundError({ threadId: scope.threadId })),
      );
      // The SQLite projection can lag the dispatch, so an armed turn wins over
      // a read that has not caught up yet.
      const outcome: SettleThreadResult["outcome"] =
        after?.settledOverride === "settled"
          ? "settled"
          : after?.agentSettleRequestedAt != null || turnId !== null
            ? "settling"
            : "not-settled";
      return {
        threadId: scope.threadId,
        outcome,
        detail:
          outcome === "settled"
            ? "This thread is settled."
            : outcome === "settling"
              ? "This thread settles when the current turn finishes."
              : "This thread stayed in the inbox; the timeline says why.",
      };
    });

  const waitForThread = (input: WaitForThreadInput) =>
    Effect.gen(function* () {
      const initial = yield* getStatus(input.threadId);
      if (TERMINAL_STATUSES.has(initial.status)) return initial;
      const requestedTimeoutMs = input.timeoutMs;
      const timeoutMs = Number.isFinite(requestedTimeoutMs)
        ? Math.min(Math.max(requestedTimeoutMs ?? MAX_WAIT_TIMEOUT_MS, 1), MAX_WAIT_TIMEOUT_MS)
        : MAX_WAIT_TIMEOUT_MS;
      const completed = yield* engine.streamDomainEvents.pipe(
        Stream.filter((event: OrchestrationEvent) => event.aggregateId === input.threadId),
        Stream.mapEffect(() => getStatus(input.threadId)),
        Stream.filter((reference) => TERMINAL_STATUSES.has(reference.status)),
        Stream.runHead,
        Effect.timeoutOption(timeoutMs),
        // runHead already returns Option, so flatten the timeout's Option
        // wrapper before treating an elapsed wait as a missing completion.
        Effect.map(Option.flatten),
      );
      if (Option.isNone(completed)) {
        return yield* new ThreadWaitTimedOutError({ threadId: input.threadId });
      }
      const finalStatus = yield* getStatus(input.threadId);
      const scope = yield* requireCapability();
      yield* appendDelegationActivity(scope.threadId, {
        childThreadId: input.threadId,
        status: finalStatus.status,
        ...(finalStatus.resultPreview === undefined
          ? {}
          : { resultPreview: finalStatus.resultPreview }),
      });
      return finalStatus;
    });

  return ThreadsToolkit.of({
    settle_thread: settleThread,
    start_thread: startThread,
    list_child_threads: listChildren,
    get_thread_status: (input) => getStatus(input.threadId),
    send_thread_message: sendMessage,
    wait_for_thread: waitForThread,
  });
});

export const ThreadsToolkitHandlersLive = ThreadsToolkit.toLayer(make);
