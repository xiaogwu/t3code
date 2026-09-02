import type { AgySettings, ModelCapabilities, ServerProviderModel } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { parseAgyModelsOutput } from "../agy/AgyProtocol.ts";
import {
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

const PRESENTATION = {
  displayName: "Antigravity",
  badgeLabel: "Early Access",
  showInteractionModeToggle: true,
} as const;
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({ optionDescriptors: [] });
const PROBE_TIMEOUT_MS = 15_000;
const FALLBACK_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "gemini-3.8-flash-medium",
    name: "Gemini 3.8 Flash (Medium)",
    isCustom: false,
    capabilities: EMPTY_CAPABILITIES,
  },
];

const modelsFromSettings = (
  customModels: ReadonlyArray<string>,
  discovered: ReadonlyArray<ServerProviderModel> = FALLBACK_MODELS,
) => providerModelsFromSettings(discovered, customModels, EMPTY_CAPABILITIES);

export const buildInitialAgyProviderSnapshot = Effect.fn("buildInitialAgyProviderSnapshot")(
  function* (settings: AgySettings): Effect.fn.Return<ServerProviderDraft> {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    return buildServerProvider({
      presentation: PRESENTATION,
      enabled: settings.enabled,
      checkedAt,
      models: modelsFromSettings(settings.customModels),
      probe: settings.enabled
        ? {
            installed: true,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "Checking Antigravity CLI availability...",
          }
        : {
            installed: false,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "Antigravity is disabled in T3 Code settings.",
          },
    });
  },
);

const run = Effect.fn("runAgyProbe")(function* (
  settings: AgySettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv,
) {
  const commandPath = settings.binaryPath || "agy";
  const spawnCommand = yield* resolveSpawnCommand(commandPath, args, { env: environment });
  return yield* spawnAndCollect(
    commandPath,
    ChildProcess.make(spawnCommand.command, spawnCommand.args, {
      env: environment,
      extendEnv: true,
      shell: spawnCommand.shell,
    }),
  );
});

export const checkAgyProviderStatus = Effect.fn("checkAgyProviderStatus")(function* (
  settings: AgySettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fallbackModels = modelsFromSettings(settings.customModels);
  if (!settings.enabled) return yield* buildInitialAgyProviderSnapshot(settings);

  const versionResult = yield* run(settings, ["--version"], environment).pipe(
    Effect.timeoutOption(PROBE_TIMEOUT_MS),
    Effect.result,
  );
  if (Result.isFailure(versionResult)) {
    return buildServerProvider({
      presentation: PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: !isCommandMissingCause(versionResult.failure),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(versionResult.failure)
          ? "Antigravity CLI (`agy`) is not installed or not on PATH."
          : "Failed to execute the Antigravity CLI health check.",
      },
    });
  }
  if (Option.isNone(versionResult.success)) {
    return buildServerProvider({
      presentation: PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Antigravity CLI timed out while running `agy --version`.",
      },
    });
  }

  const versionOutput = versionResult.success.value;
  const version = parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`);
  if (versionOutput.code !== 0) {
    return buildServerProvider({
      presentation: PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: "Antigravity CLI is installed but failed to run.",
      },
    });
  }

  const modelsResult = yield* run(settings, ["models"], environment).pipe(
    Effect.timeoutOption(PROBE_TIMEOUT_MS),
    Effect.result,
  );
  if (Result.isFailure(modelsResult) || Option.isNone(modelsResult.success)) {
    return buildServerProvider({
      presentation: PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "warning",
        auth: { status: "unknown" },
        message: "Antigravity is installed, but model discovery failed or timed out.",
      },
    });
  }

  const result = modelsResult.success.value;
  const discovered =
    result.code === 0
      ? parseAgyModelsOutput(`${result.stdout}\n${result.stderr}`).map(
          (model): ServerProviderModel => ({
            ...model,
            isCustom: false,
            capabilities: EMPTY_CAPABILITIES,
          }),
        )
      : [];
  return buildServerProvider({
    presentation: PRESENTATION,
    enabled: true,
    checkedAt,
    models: modelsFromSettings(
      settings.customModels,
      discovered.length ? discovered : FALLBACK_MODELS,
    ),
    probe: {
      installed: true,
      version,
      status: result.code === 0 && discovered.length > 0 ? "ready" : "warning",
      auth: { status: "unknown" },
      ...(result.code !== 0 || discovered.length === 0
        ? { message: "Antigravity is installed, but no models were discovered." }
        : {}),
    },
  });
});
