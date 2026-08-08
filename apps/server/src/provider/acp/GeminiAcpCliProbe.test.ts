/**
 * Optional integration check against a real Apple Gemini CLI install.
 * Enable with: T3_GEMINI_ACP_PROBE=1 pnpm --filter t3 test GeminiAcpCliProbe
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { describe, expect } from "vite-plus/test";

import { makeGeminiAcpRuntime } from "./GeminiAcpSupport.ts";

const makeProbeRuntime = Effect.gen(function* () {
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* makeGeminiAcpRuntime({
    geminiSettings: { binaryPath: "apple-gemini", authMethodId: "oauth-personal" },
    environment: process.env,
    childProcessSpawner,
    cwd: process.cwd(),
    clientInfo: { name: "t3-gemini-probe", version: "0.0.0" },
  });
});

describe.runIf(process.env.T3_GEMINI_ACP_PROBE === "1")("Gemini ACP CLI probe", () => {
  it.effect("initializes, authenticates, and starts a resumable session", () =>
    Effect.gen(function* () {
      const runtime = yield* makeProbeRuntime;
      const started = yield* runtime.start();
      expect(started.initializeResult.protocolVersion).toBe(1);
      expect(started.initializeResult.agentCapabilities?.loadSession).toBe(true);
      expect(started.sessionId.length).toBeGreaterThan(0);
      expect(started.sessionSetupResult.models?.availableModels.length ?? 0).toBeGreaterThan(0);
      expect(started.sessionSetupResult.modes?.availableModes.map((mode) => mode.id)).toEqual(
        expect.arrayContaining(["default", "autoEdit", "yolo", "plan"]),
      );
      yield* runtime.setMode("plan");
      const currentModel = started.sessionSetupResult.models?.currentModelId;
      if (currentModel) {
        yield* runtime.setSessionModel(currentModel);
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
