import {
  EventId,
  type AgySettings,
  type ProviderRuntimeEvent,
  type ProviderSession,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeItemId,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { tokenizeCliArgs } from "@t3tools/shared/cliArgs";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import type { AgyAdapterShape } from "../Services/AgyAdapter.ts";
import {
  type AgyStreamEvent,
  type AgyStreamUsage,
  parseAgyStreamLine,
} from "../agy/AgyProtocol.ts";

const PROVIDER = ProviderDriverKind.make("agy");

type ProcessHandle = ChildProcessSpawner.ChildProcessHandle;

interface AgyTurnRecord {
  readonly id: TurnId;
  readonly items: Array<unknown>;
}

interface AgySessionContext {
  session: ProviderSession;
  conversationId: string | undefined;
  turns: Array<AgyTurnRecord>;
  activeProcess: ProcessHandle | undefined;
  activeFiber: Fiber.Fiber<void, never> | undefined;
  activeTurnId: TurnId | undefined;
  emittedItems: Set<string>;
  completedItems: Set<string>;
  itemTypes: Map<string, ReturnType<typeof itemTypeForTool> | "assistant_message">;
  receivedResult: boolean;
  threadStarted: boolean;
  stopped: boolean;
}

export interface AgyAdapterOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly instanceId?: ProviderInstanceId;
}

function parseResumeCursor(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const conversationId = (value as { readonly conversationId?: unknown }).conversationId;
  return typeof conversationId === "string" && conversationId.trim()
    ? conversationId.trim()
    : undefined;
}

function itemTypeForTool(toolName: string) {
  const normalized = toolName.toLowerCase();
  if (normalized.includes("command")) return "command_execution" as const;
  if (
    normalized.includes("write") ||
    normalized.includes("replace") ||
    normalized.includes("notebook_edit")
  ) {
    return "file_change" as const;
  }
  if (normalized.includes("browser") || normalized.includes("web")) {
    return "web_search" as const;
  }
  return "dynamic_tool_call" as const;
}

function toolDetail(parameters: unknown): string | undefined {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return undefined;
  const record = parameters as Record<string, unknown>;
  for (const key of ["CommandLine", "command", "path", "file_path", "query"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function usageSnapshot(usage: AgyStreamUsage) {
  const inputTokens = usage.input_tokens ?? 0;
  const cachedInputTokens = usage.cache_read_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const reasoningOutputTokens = usage.thinking_tokens ?? 0;
  const usedTokens = usage.total_tokens ?? inputTokens + outputTokens;
  return {
    usedTokens,
    totalProcessedTokens: usedTokens,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
  };
}

export const makeAgyAdapter = Effect.fn("makeAgyAdapter")(function* (
  settings: AgySettings,
  options?: AgyAdapterOptions,
) {
  const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("agy");
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const scope = yield* Scope.Scope;
  const serverConfig = yield* ServerConfig;
  const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const sessions = new Map<ThreadId, AgySessionContext>();

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const nextUuid = crypto.randomUUIDv4.pipe(
    Effect.mapError(
      (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "crypto/randomUUIDv4",
          detail: "Failed to generate an Antigravity runtime identifier.",
          cause,
        }),
    ),
  );
  const stamp = () =>
    Effect.all({ eventId: Effect.map(nextUuid, EventId.make), createdAt: nowIso });
  const emit = (event: ProviderRuntimeEvent) => PubSub.publish(events, event).pipe(Effect.asVoid);

  const requireSession = (
    threadId: ThreadId,
  ): Effect.Effect<AgySessionContext, ProviderAdapterSessionNotFoundError> => {
    const context = sessions.get(threadId);
    return context
      ? Effect.succeed(context)
      : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
  };

  const emitSessionState = Effect.fn("emitAgySessionState")(function* (
    context: AgySessionContext,
    state: "ready" | "running" | "stopped" | "error",
    reason?: string,
  ) {
    const eventStamp = yield* stamp();
    yield* emit({
      type: "session.state.changed",
      eventId: eventStamp.eventId,
      provider: PROVIDER,
      providerInstanceId: boundInstanceId,
      threadId: context.session.threadId,
      createdAt: eventStamp.createdAt,
      payload: { state, ...(reason ? { reason } : {}) },
    });
  });

  const buildPrompt = (
    context: AgySessionContext,
    input: Parameters<AgyAdapterShape["sendTurn"]>[0],
  ) => {
    const paths = (input.attachments ?? []).flatMap((attachment) => {
      const path = resolveAttachmentPath({
        attachmentsDir: serverConfig.attachmentsDir,
        attachment,
      });
      return path ? [path] : [];
    });
    const prompt = input.input?.trim() ?? "";
    if (paths.length === 0) return prompt;
    return [
      prompt,
      "",
      "Attachments available in the workspace:",
      ...paths.map((path) => `- ${path}`),
    ]
      .join("\n")
      .trim();
  };

  const closeOpenItems = Effect.fn("closeAgyOpenItems")(function* (
    context: AgySessionContext,
    turnId: TurnId,
    status: "completed" | "failed" | "declined" = "completed",
  ) {
    for (const key of context.emittedItems) {
      if (context.completedItems.has(key)) continue;
      const eventStamp = yield* stamp();
      const itemId = RuntimeItemId.make(key);
      yield* emit({
        type: "item.completed",
        eventId: eventStamp.eventId,
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        threadId: context.session.threadId,
        turnId,
        itemId,
        createdAt: eventStamp.createdAt,
        payload: { itemType: context.itemTypes.get(key) ?? "unknown", status },
      });
      context.completedItems.add(key);
    }
  });

  const settleFailedTurn = Effect.fn("settleFailedAgyTurn")(function* (
    context: AgySessionContext,
    turnId: TurnId,
    detail: string,
    exitCode?: number,
  ) {
    if (context.stopped || context.activeTurnId !== turnId) return;
    context.activeProcess = undefined;
    context.activeFiber = undefined;
    yield* closeOpenItems(context, turnId, "failed");
    const errorStamp = yield* stamp();
    yield* emit({
      type: "runtime.error",
      eventId: errorStamp.eventId,
      provider: PROVIDER,
      providerInstanceId: boundInstanceId,
      threadId: context.session.threadId,
      turnId,
      createdAt: errorStamp.createdAt,
      payload: {
        message: detail,
        class: "provider_error",
        ...(exitCode === undefined ? {} : { detail: { exitCode } }),
      },
    });
    const turnStamp = yield* stamp();
    yield* emit({
      type: "turn.completed",
      eventId: turnStamp.eventId,
      provider: PROVIDER,
      providerInstanceId: boundInstanceId,
      threadId: context.session.threadId,
      turnId,
      createdAt: turnStamp.createdAt,
      payload: { state: "failed", errorMessage: detail },
    });
    context.activeTurnId = undefined;
    context.session = {
      ...context.session,
      status: "error",
      activeTurnId: undefined,
      updatedAt: yield* nowIso,
      lastError: detail,
    };
    yield* emitSessionState(context, "error", detail);
  });

  const handleStreamEvent = Effect.fn("handleAgyStreamEvent")(function* (
    context: AgySessionContext,
    turnId: TurnId,
    event: AgyStreamEvent,
  ) {
    if (event.event === "init") {
      context.conversationId = event.conversation_id || context.conversationId;
      context.session = {
        ...context.session,
        resumeCursor: context.conversationId
          ? { conversationId: context.conversationId }
          : context.session.resumeCursor,
        updatedAt: yield* nowIso,
      };
      if (!context.threadStarted) {
        context.threadStarted = true;
        const eventStamp = yield* stamp();
        yield* emit({
          type: "thread.started",
          eventId: eventStamp.eventId,
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: context.session.threadId,
          turnId,
          createdAt: eventStamp.createdAt,
          payload: event.conversation_id ? { providerThreadId: event.conversation_id } : {},
          raw: { source: "agy.cli.event", method: "agy/init", payload: event },
        });
      }
      return;
    }

    if (event.event === "step_update") {
      const step = event.step_update;
      const itemKey = `agy-${turnId}-${step.step_index}`;
      const itemId = RuntimeItemId.make(itemKey);
      if (step.step_type === "agent_response") {
        if (!context.emittedItems.has(itemKey)) {
          context.emittedItems.add(itemKey);
          context.itemTypes.set(itemKey, "assistant_message");
          const eventStamp = yield* stamp();
          yield* emit({
            type: "item.started",
            eventId: eventStamp.eventId,
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            threadId: context.session.threadId,
            turnId,
            itemId,
            createdAt: eventStamp.createdAt,
            payload: { itemType: "assistant_message", status: "inProgress" },
            raw: { source: "agy.cli.event", method: "agy/step_update", payload: event },
          });
        }
        if (step.text_delta !== undefined && step.text_delta.length > 0) {
          const eventStamp = yield* stamp();
          yield* emit({
            type: "content.delta",
            eventId: eventStamp.eventId,
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            threadId: context.session.threadId,
            turnId,
            itemId,
            createdAt: eventStamp.createdAt,
            payload: { streamKind: "assistant_text", delta: step.text_delta },
            raw: { source: "agy.cli.event", method: "agy/step_update", payload: event },
          });
        }
        if (step.state === "DONE" && !context.completedItems.has(itemKey)) {
          context.completedItems.add(itemKey);
          const eventStamp = yield* stamp();
          yield* emit({
            type: "item.completed",
            eventId: eventStamp.eventId,
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            threadId: context.session.threadId,
            turnId,
            itemId,
            createdAt: eventStamp.createdAt,
            payload: { itemType: "assistant_message", status: "completed" },
            raw: { source: "agy.cli.event", method: "agy/step_update", payload: event },
          });
        }
        return;
      }

      if (step.step_type === "tool") {
        const toolName = step.tool_name || step.tool_info?.name || "Antigravity tool";
        const itemType = itemTypeForTool(toolName);
        const detail = toolDetail(step.tool_info?.parameters);
        const data = {
          toolName,
          input: step.tool_info?.parameters,
          output: step.tool_info?.output,
          error: step.tool_info?.error,
        };
        if (!context.emittedItems.has(itemKey)) {
          context.emittedItems.add(itemKey);
          context.itemTypes.set(itemKey, itemType);
          const eventStamp = yield* stamp();
          yield* emit({
            type: "item.started",
            eventId: eventStamp.eventId,
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            threadId: context.session.threadId,
            turnId,
            itemId,
            createdAt: eventStamp.createdAt,
            payload: {
              itemType,
              status: "inProgress",
              title: toolName,
              ...(detail ? { detail } : {}),
              data,
            },
            raw: { source: "agy.cli.event", method: "agy/step_update", payload: event },
          });
        }
        if (step.state === "DONE" && !context.completedItems.has(itemKey)) {
          context.completedItems.add(itemKey);
          const eventStamp = yield* stamp();
          yield* emit({
            type: "item.completed",
            eventId: eventStamp.eventId,
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            threadId: context.session.threadId,
            turnId,
            itemId,
            createdAt: eventStamp.createdAt,
            payload: {
              itemType,
              status: step.tool_info?.error === undefined ? "completed" : "failed",
              title: toolName,
              ...(detail ? { detail } : {}),
              data,
            },
            raw: { source: "agy.cli.event", method: "agy/step_update", payload: event },
          });
        }
      }
      return;
    }

    context.receivedResult = true;
    context.conversationId = event.result.conversation_id || context.conversationId;
    const completed = event.result.status === "SUCCESS";
    yield* closeOpenItems(context, turnId, completed ? "completed" : "failed");
    if (event.result.usage) {
      const usageStamp = yield* stamp();
      yield* emit({
        type: "thread.token-usage.updated",
        eventId: usageStamp.eventId,
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        threadId: context.session.threadId,
        turnId,
        createdAt: usageStamp.createdAt,
        payload: { usage: usageSnapshot(event.result.usage) },
        raw: { source: "agy.cli.event", method: "agy/result", payload: event },
      });
    }
    const resultStamp = yield* stamp();
    yield* emit({
      type: "turn.completed",
      eventId: resultStamp.eventId,
      provider: PROVIDER,
      providerInstanceId: boundInstanceId,
      threadId: context.session.threadId,
      turnId,
      createdAt: resultStamp.createdAt,
      payload: {
        state: completed ? "completed" : "failed",
        stopReason: event.result.status,
        ...(event.result.usage ? { usage: event.result.usage } : {}),
        ...(event.result.error ? { errorMessage: event.result.error } : {}),
      },
      raw: { source: "agy.cli.event", method: "agy/result", payload: event },
    });
    context.turns.push({ id: turnId, items: [event.result] });
    context.activeTurnId = undefined;
    context.session = {
      ...context.session,
      status: completed ? "ready" : "error",
      activeTurnId: undefined,
      resumeCursor: context.conversationId ? { conversationId: context.conversationId } : undefined,
      updatedAt: yield* nowIso,
      ...(event.result.error ? { lastError: event.result.error } : {}),
    };
    yield* emitSessionState(context, completed ? "ready" : "error", event.result.error);
  });

  const runTurn = Effect.fn("runAgyTurn")(function* (
    context: AgySessionContext,
    turnId: TurnId,
    prompt: string,
    input: Parameters<AgyAdapterShape["sendTurn"]>[0],
  ) {
    const selectedModel =
      input.modelSelection?.instanceId === boundInstanceId ? input.modelSelection.model : undefined;
    const args = [
      "--print",
      prompt,
      "--output-format",
      "stream-json",
      ...(context.conversationId ? ["--conversation", context.conversationId] : []),
      ...(selectedModel ? ["--model", selectedModel] : []),
      ...(input.interactionMode === "plan" ? ["--mode", "plan"] : []),
      ...(context.session.runtimeMode === "full-access" ? ["--dangerously-skip-permissions"] : []),
      ...tokenizeCliArgs(settings.launchArgs),
    ];
    const commandPath = settings.binaryPath || "agy";
    const spawnCommand = yield* resolveSpawnCommand(
      commandPath,
      args,
      options?.environment ? { env: options.environment } : {},
    ).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
    const child = yield* spawner.spawn(
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        cwd: context.session.cwd,
        env: options?.environment,
        extendEnv: true,
        shell: spawnCommand.shell,
      }),
    );
    context.activeProcess = child;

    const stderrFiber = yield* child.stderr.pipe(
      Stream.decodeText(),
      Stream.runFold(
        () => "",
        (acc, chunk) => acc + chunk,
      ),
      Effect.forkChild,
    );

    yield* child.stdout.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.map(parseAgyStreamLine),
      Stream.runForEach((event) =>
        event === undefined ? Effect.void : handleStreamEvent(context, turnId, event),
      ),
    );
    const exitCode = Number(yield* child.exitCode);
    const stderr = yield* Fiber.join(stderrFiber);
    context.activeProcess = undefined;
    context.activeFiber = undefined;

    if (!context.receivedResult && !context.stopped) {
      const detail = stderr.trim() || `Antigravity CLI exited with code ${exitCode}.`;
      yield* settleFailedTurn(context, turnId, detail, exitCode);
    }
  });

  const startSession: AgyAdapterShape["startSession"] = Effect.fn("AgyAdapter.startSession")(
    function* (input) {
      if (sessions.has(input.threadId)) return (yield* requireSession(input.threadId)).session;
      const createdAt = yield* nowIso;
      const conversationId = parseResumeCursor(input.resumeCursor);
      const session: ProviderSession = {
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        status: "ready",
        runtimeMode: input.runtimeMode,
        threadId: input.threadId,
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
        ...(conversationId ? { resumeCursor: { conversationId } } : {}),
        createdAt,
        updatedAt: createdAt,
      };
      const context: AgySessionContext = {
        session,
        conversationId,
        turns: [],
        activeProcess: undefined,
        activeFiber: undefined,
        activeTurnId: undefined,
        emittedItems: new Set(),
        completedItems: new Set(),
        itemTypes: new Map(),
        receivedResult: false,
        threadStarted: false,
        stopped: false,
      };
      sessions.set(input.threadId, context);
      const startedStamp = yield* stamp();
      yield* emit({
        type: "session.started",
        eventId: startedStamp.eventId,
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        threadId: input.threadId,
        createdAt: startedStamp.createdAt,
        payload: input.resumeCursor === undefined ? {} : { resume: input.resumeCursor },
      });
      yield* emitSessionState(context, "ready");
      return { ...session };
    },
  );

  const sendTurn: AgyAdapterShape["sendTurn"] = Effect.fn("AgyAdapter.sendTurn")(function* (input) {
    const context = yield* requireSession(input.threadId);
    if (context.activeTurnId !== undefined) {
      return yield* new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "sendTurn",
        issue: "Antigravity does not support steering while a turn is running.",
      });
    }
    const prompt = buildPrompt(context, input);
    if (!prompt) {
      return yield* new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "sendTurn",
        issue: "A turn requires text or an attachment.",
      });
    }
    const turnId = TurnId.make(yield* nextUuid);
    context.activeTurnId = turnId;
    context.receivedResult = false;
    context.emittedItems = new Set();
    context.completedItems = new Set();
    context.itemTypes = new Map();
    context.session = {
      ...context.session,
      status: "running",
      activeTurnId: turnId,
      ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
      updatedAt: yield* nowIso,
    };
    const turnStamp = yield* stamp();
    yield* emit({
      type: "turn.started",
      eventId: turnStamp.eventId,
      provider: PROVIDER,
      providerInstanceId: boundInstanceId,
      threadId: input.threadId,
      turnId,
      createdAt: turnStamp.createdAt,
      payload: input.modelSelection?.model ? { model: input.modelSelection.model } : {},
    });
    yield* emitSessionState(context, "running");
    const fiber = yield* runTurn(context, turnId, prompt, input).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : settleFailedTurn(context, turnId, Cause.pretty(cause)).pipe(
              Effect.catchCause((settlementCause) =>
                Effect.logError("Failed to settle Antigravity turn", {
                  cause: settlementCause,
                }),
              ),
            ),
      ),
      Effect.provideService(Scope.Scope, scope),
      Effect.forkIn(scope),
    );
    context.activeFiber = fiber;
    return {
      threadId: input.threadId,
      turnId,
      ...(context.session.resumeCursor ? { resumeCursor: context.session.resumeCursor } : {}),
    };
  });

  const interruptTurn: AgyAdapterShape["interruptTurn"] = Effect.fn("AgyAdapter.interruptTurn")(
    function* (threadId, requestedTurnId) {
      const context = yield* requireSession(threadId);
      const turnId = context.activeTurnId;
      if (!turnId || (requestedTurnId && requestedTurnId !== turnId)) return;
      yield* (
        context.activeProcess
          ?.kill({ killSignal: "SIGTERM", forceKillAfter: "1 second" })
          .pipe(Effect.ignore) ?? Effect.void
      );
      if (context.activeFiber) yield* Fiber.interrupt(context.activeFiber).pipe(Effect.ignore);
      context.activeProcess = undefined;
      context.activeFiber = undefined;
      context.activeTurnId = undefined;
      const eventStamp = yield* stamp();
      yield* emit({
        type: "turn.completed",
        eventId: eventStamp.eventId,
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        threadId,
        turnId,
        createdAt: eventStamp.createdAt,
        payload: { state: "interrupted", stopReason: "interrupted" },
      });
      context.session = {
        ...context.session,
        status: "ready",
        activeTurnId: undefined,
        updatedAt: yield* nowIso,
      };
      yield* emitSessionState(context, "ready");
    },
  );

  const stopSession: AgyAdapterShape["stopSession"] = Effect.fn("AgyAdapter.stopSession")(
    function* (threadId) {
      const context = yield* requireSession(threadId);
      context.stopped = true;
      yield* (
        context.activeProcess
          ?.kill({ killSignal: "SIGTERM", forceKillAfter: "1 second" })
          .pipe(Effect.ignore) ?? Effect.void
      );
      if (context.activeFiber) yield* Fiber.interrupt(context.activeFiber).pipe(Effect.ignore);
      context.session = { ...context.session, status: "closed", updatedAt: yield* nowIso };
      sessions.delete(threadId);
    },
  );

  yield* Scope.addFinalizer(
    scope,
    Effect.suspend(() =>
      Effect.forEach(
        Array.from(sessions.values()),
        (context) =>
          context.activeProcess
            ?.kill({ killSignal: "SIGTERM", forceKillAfter: "1 second" })
            .pipe(Effect.ignore) ?? Effect.void,
        { discard: true },
      ),
    ),
  );

  const unsupportedRequest = (operation: string) =>
    Effect.fail(
      new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation,
        issue: "Antigravity headless mode does not expose interactive approval responses.",
      }),
    );

  return {
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: "in-session" },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest: () => unsupportedRequest("respondToRequest"),
    respondToUserInput: () => unsupportedRequest("respondToUserInput"),
    stopSession,
    listSessions: () => Effect.succeed(Array.from(sessions.values(), (context) => context.session)),
    hasSession: (threadId) => Effect.succeed(sessions.has(threadId)),
    readThread: (threadId) =>
      requireSession(threadId).pipe(
        Effect.map((context) => ({
          threadId,
          turns: context.turns.map((turn) => ({ id: turn.id, items: [...turn.items] })),
        })),
      ),
    rollbackThread: (threadId) =>
      requireSession(threadId).pipe(
        Effect.flatMap(() =>
          Effect.fail(
            new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "rollbackThread",
              issue: "Antigravity headless mode does not expose conversation rewind.",
            }),
          ),
        ),
      ),
    stopAll: () =>
      Effect.forEach(Array.from(sessions.keys()), stopSession, { discard: true }).pipe(
        Effect.asVoid,
      ),
    streamEvents: Stream.fromPubSub(events),
  } satisfies AgyAdapterShape;
});
