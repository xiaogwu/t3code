// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeFSP from "node:fs/promises";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  GeminiSettings,
  ProviderDriverKind,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";

import { ServerConfig } from "../../config.ts";
import type { AcpToolCallState } from "../acp/AcpRuntimeModel.ts";
import { geminiHasUnsettledToolCalls, makeGeminiAdapter } from "./GeminiAdapter.ts";

const decodeGeminiSettings = Schema.decodeSync(GeminiSettings);

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../../scripts/acp-mock-agent.ts");
const mockAgentCommand = process.execPath;

async function makeMockGeminiWrapper(extraEnv?: Record<string, string>) {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "gemini-acp-mock-"));
  const wrapperPath = NodePath.join(dir, "fake-gemini.sh");
  const envExports = Object.entries(extraEnv ?? {})
    .map(([key, value]) => `export ${key}=${JSON.stringify(value)}`)
    .join("\n");
  const script = `#!/bin/sh
${envExports}
exec ${JSON.stringify(mockAgentCommand)} ${JSON.stringify(mockAgentPath)} "$@"
`;
  await NodeFSP.writeFile(wrapperPath, script, "utf8");
  await NodeFSP.chmod(wrapperPath, 0o755);
  return wrapperPath;
}

const geminiAdapterTestLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-gemini-adapter-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

const makeTestAdapter = (binaryPath: string, options?: Parameters<typeof makeGeminiAdapter>[1]) =>
  makeGeminiAdapter(decodeGeminiSettings({ binaryPath }), options).pipe(Effect.orDie);

function toolCall(status: NonNullable<AcpToolCallState["status"]>): AcpToolCallState {
  return { toolCallId: "tool-1", status, data: {} };
}

it("rejects ACP end_turn while a Gemini tool call is unfinished", () => {
  assert.isTrue(geminiHasUnsettledToolCalls(new Map([["tool-1", toolCall("pending")]])));
  assert.isTrue(geminiHasUnsettledToolCalls(new Map([["tool-1", toolCall("inProgress")]])));
});

it("accepts ACP end_turn after Gemini tool calls settle", () => {
  assert.isFalse(geminiHasUnsettledToolCalls(new Map([["tool-1", toolCall("completed")]])));
  assert.isFalse(geminiHasUnsettledToolCalls(new Map([["tool-1", toolCall("failed")]])));
  assert.isFalse(geminiHasUnsettledToolCalls(new Map()));
});

/**
 * The unit tests above only cover the predicate. These drive the adapter against
 * the mock ACP agent so the wiring is covered too: recording tool call state from
 * ToolCallUpdated, and choosing the turn.completed payload at end_turn.
 */
it.layer(geminiAdapterTestLayer)("GeminiAdapterLive tool call settlement", (it) => {
  const runTurn = (threadId: string, env: Record<string, string>) =>
    Effect.gen(function* () {
      const wrapperPath = yield* Effect.promise(() => makeMockGeminiWrapper(env));
      const adapter = yield* makeTestAdapter(wrapperPath);

      const runtimeEvents: ProviderRuntimeEvent[] = [];
      const turnCompleted = yield* Deferred.make<void>();
      const runtimeEventsFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          runtimeEvents.push(event);
        }).pipe(
          Effect.andThen(
            event.type === "turn.completed"
              ? Deferred.succeed(turnCompleted, undefined)
              : Effect.void,
          ),
        ),
      ).pipe(Effect.forkChild);

      const thread = ThreadId.make(threadId);
      yield* adapter.startSession({
        threadId: thread,
        provider: ProviderDriverKind.make("gemini"),
        cwd: process.cwd(),
        runtimeMode: "full-access",
      });

      yield* adapter.sendTurn({ threadId: thread, input: "run a tool", attachments: [] });
      yield* Deferred.await(turnCompleted);
      for (let yieldAttempt = 0; yieldAttempt < 8; yieldAttempt += 1) {
        yield* Effect.yieldNow;
      }

      const turnCompletedEvent = runtimeEvents.find(
        (event): event is Extract<ProviderRuntimeEvent, { type: "turn.completed" }> =>
          event.type === "turn.completed",
      );

      yield* Fiber.interrupt(runtimeEventsFiber);
      yield* adapter.stopSession(thread);
      return turnCompletedEvent;
    });

  it.effect("fails the turn when Gemini ends it with a tool call still in progress", () =>
    Effect.gen(function* () {
      const turnCompletedEvent = yield* runTurn("gemini-unsettled-tool-call", {
        T3_ACP_EMIT_UNSETTLED_TOOL_CALL_THEN_END_TURN: "1",
      });

      assert.isDefined(turnCompletedEvent);
      assert.equal(turnCompletedEvent?.payload.state, "failed");
      assert.include(
        turnCompletedEvent?.payload.state === "failed"
          ? turnCompletedEvent.payload.errorMessage
          : "",
        "tool call was still pending",
      );
    }),
  );

  it.effect("completes the turn when every Gemini tool call settled first", () =>
    Effect.gen(function* () {
      const turnCompletedEvent = yield* runTurn("gemini-settled-tool-call", {
        T3_ACP_EMIT_INTERLEAVED_ASSISTANT_TOOL_CALLS: "1",
      });

      assert.isDefined(turnCompletedEvent);
      assert.equal(turnCompletedEvent?.payload.state, "completed");
    }),
  );
});
