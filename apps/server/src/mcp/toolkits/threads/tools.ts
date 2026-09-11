import {
  ChatAttachment,
  McpCapabilityUnavailableError,
  ModelSelection,
  OrchestrationThreadShell,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as OrchestrationEngine from "../../../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadTurnBootstrap from "../../../orchestration/Services/ThreadTurnBootstrap.ts";
import { ServerConfig } from "../../../config.ts";
import { WorkspacePaths } from "../../../workspace/WorkspacePaths.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  OrchestrationEngine.OrchestrationEngineService,
  ProjectionSnapshotQuery.ProjectionSnapshotQuery,
  ThreadTurnBootstrap.ThreadTurnBootstrap,
  FileSystem.FileSystem,
  Path.Path,
  ServerConfig,
  WorkspacePaths,
];

export const ThreadWorkspace = Schema.Struct({
  mode: Schema.Literals(["local", "existing-worktree", "new-worktree"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("local" as const)),
  ),
  baseBranch: Schema.optional(TrimmedNonEmptyString),
  branch: Schema.optional(TrimmedNonEmptyString),
  worktreePath: Schema.optional(TrimmedNonEmptyString),
  startFromOrigin: Schema.optional(Schema.Boolean),
});

const ThreadStartInputBase = {
  taskKey: TrimmedNonEmptyString.annotate({
    description:
      "A stable key for this delegated task. Retrying the same key returns the existing child thread.",
  }),
  prompt: Schema.String.annotate({ description: "The first prompt to run in the child thread." }),
  projectId: Schema.optional(ProjectId),
  modelSelection: Schema.optional(ModelSelection),
  workspace: Schema.optional(ThreadWorkspace),
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
};

export const StartThreadInput = Schema.Struct(ThreadStartInputBase);
export type StartThreadInput = typeof StartThreadInput.Type;

export const ThreadReference = Schema.Struct({
  environmentId: TrimmedNonEmptyString,
  projectId: ProjectId,
  threadId: ThreadId,
  title: TrimmedNonEmptyString,
  status: Schema.Literals([
    "queued",
    "running",
    "waiting",
    "completed",
    "failed",
    "settled",
    "deleted",
  ]),
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  resultPreview: Schema.optional(Schema.String),
  alreadyStarted: Schema.Boolean,
});
export type ThreadReference = typeof ThreadReference.Type;

export const ThreadStatusInput = Schema.Struct({ threadId: ThreadId });
export const ListChildThreadsInput = Schema.Struct({
  includeTerminal: Schema.optional(Schema.Boolean),
});
export const ListChildThreadsResult = Schema.Struct({
  threads: Schema.Array(ThreadReference),
});
export const SendThreadMessageInput = Schema.Struct({
  threadId: ThreadId,
  prompt: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
});
export const WaitForThreadInput = Schema.Struct({
  threadId: ThreadId,
  timeoutMs: Schema.optional(Schema.Finite),
});
export type ThreadStatusInput = typeof ThreadStatusInput.Type;
export type ListChildThreadsInput = typeof ListChildThreadsInput.Type;
export type ListChildThreadsResult = typeof ListChildThreadsResult.Type;
export type SendThreadMessageInput = typeof SendThreadMessageInput.Type;
export type WaitForThreadInput = typeof WaitForThreadInput.Type;

export const SettleThreadInput = Schema.Struct({
  reason: Schema.optional(
    Schema.String.annotate({
      description:
        "One short line on why the work is finished. Shown on the thread while it settles. Truncated past 200 characters.",
    }),
  ),
});
export type SettleThreadInput = typeof SettleThreadInput.Type;

export const SettleThreadResult = Schema.Struct({
  threadId: ThreadId,
  /**
   * `settling` is the normal answer: the request is recorded and the thread
   * settles when this turn's checkpoint lands. `settled` means there was no
   * turn left to wait for. `not-settled` means the thread stayed in the inbox.
   */
  outcome: Schema.Literals(["settling", "settled", "not-settled"]),
  detail: Schema.String,
});
export type SettleThreadResult = typeof SettleThreadResult.Type;

export class ThreadDelegationFailedError extends Schema.TaggedError<ThreadDelegationFailedError>()(
  "ThreadDelegationFailedError",
  { message: Schema.String },
) {}

export class ThreadNotFoundError extends Schema.TaggedError<ThreadNotFoundError>()(
  "ThreadNotFoundError",
  { threadId: ThreadId },
) {
  override get message(): string {
    return `Thread ${this.threadId} was not found.`;
  }
}

export class ThreadNotOwnedError extends Schema.TaggedError<ThreadNotOwnedError>()(
  "ThreadNotOwnedError",
  { threadId: ThreadId },
) {
  override get message(): string {
    return `Thread ${this.threadId} was not delegated by this thread.`;
  }
}

export class ThreadProjectNotFoundError extends Schema.TaggedError<ThreadProjectNotFoundError>()(
  "ThreadProjectNotFoundError",
  { projectId: ProjectId },
) {
  override get message(): string {
    return `Project ${this.projectId} was not found in this environment.`;
  }
}

export class ThreadWaitTimedOutError extends Schema.TaggedError<ThreadWaitTimedOutError>()(
  "ThreadWaitTimedOutError",
  { threadId: ThreadId },
) {
  override get message(): string {
    return `Timed out waiting for thread ${this.threadId}.`;
  }
}

export const ThreadToolError = Schema.Union([
  McpCapabilityUnavailableError,
  ThreadDelegationFailedError,
  ThreadNotFoundError,
  ThreadNotOwnedError,
  ThreadProjectNotFoundError,
  ThreadWaitTimedOutError,
]);
export type ThreadToolError = typeof ThreadToolError.Type;

const SettleThreadTool = Tool.make("settle_thread", {
  description:
    "Mark this thread as finished. The thread leaves the inbox once the current turn's checkpoint lands, so call it as the last thing you do when the work is genuinely complete. It does not settle a thread whose turn errored or that is waiting on the user.",
  parameters: SettleThreadInput,
  success: SettleThreadResult,
  failure: ThreadToolError,
  dependencies,
})
  .annotate(Tool.Title, "Settle this thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const StartThreadTool = Tool.make("start_thread", {
  description:
    "Start separate top-level work in this T3 environment. The child is immediately started and remains visible as a separate thread; use list_child_threads or wait_for_thread to coordinate. This tool does not resume the parent automatically.",
  parameters: StartThreadInput,
  success: ThreadReference,
  failure: ThreadToolError,
  dependencies,
})
  .annotate(Tool.Title, "Start T3 thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const ListChildThreadsTool = Tool.make("list_child_threads", {
  description: "List the top-level T3 threads previously delegated by this thread.",
  parameters: ListChildThreadsInput,
  success: ListChildThreadsResult,
  failure: ThreadToolError,
  dependencies,
})
  .annotate(Tool.Title, "List child threads")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const GetThreadStatusTool = Tool.make("get_thread_status", {
  description: "Read the current status and result preview of a delegated T3 thread.",
  parameters: ThreadStatusInput,
  success: ThreadReference,
  failure: ThreadToolError,
  dependencies,
})
  .annotate(Tool.Title, "Get child thread status")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const SendThreadMessageTool = Tool.make("send_thread_message", {
  description: "Send a follow-up prompt to a delegated child thread created by this thread.",
  parameters: SendThreadMessageInput,
  success: ThreadReference,
  failure: ThreadToolError,
  dependencies,
})
  .annotate(Tool.Title, "Message child thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const WaitForThreadTool = Tool.make("wait_for_thread", {
  description:
    "Wait for a delegated child thread to reach completed, failed, settled, or deleted state. Uses the server event stream rather than polling.",
  parameters: WaitForThreadInput,
  success: ThreadReference,
  failure: ThreadToolError,
  dependencies,
})
  .annotate(Tool.Title, "Wait for child thread")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ThreadsToolkit = Toolkit.make(
  SettleThreadTool,
  StartThreadTool,
  ListChildThreadsTool,
  GetThreadStatusTool,
  SendThreadMessageTool,
  WaitForThreadTool,
);

export type ThreadShell = Pick<
  typeof OrchestrationThreadShell.Type,
  | "id"
  | "projectId"
  | "title"
  | "branch"
  | "worktreePath"
  | "session"
  | "latestTurn"
  | "settledOverride"
  | "parentThreadId"
  | "parentTurnId"
  | "spawnKey"
>;
