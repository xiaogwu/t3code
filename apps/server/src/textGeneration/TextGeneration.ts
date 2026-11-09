import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schedule from "effect/Schedule";
import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import {
  isProviderAvailable,
  isProviderTextGenerationCapable,
  resolveProjectProviderInstanceEnabled,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { exhaustedUsageWindow } from "@t3tools/shared/usageLimits";
import {
  defaultTextGenerationModel,
  fallbackTextGenerationModelSelection,
} from "@t3tools/shared/serverSettings";
import * as ServerSettings from "../serverSettings.ts";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import { TextGenerationError } from "@t3tools/contracts";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as ThreadTitleLinks from "./ThreadTitleLinks.ts";
import * as TextGenerators from "./TextGenerators.ts";
import * as TextGenerationOperations from "@t3tools/provider-core/server/textGenerationOperations";

export type {
  BranchNameGenerationInput,
  BranchNameGenerationResult,
  CommitMessageGenerationInput,
  CommitMessageGenerationResult,
  PrContentGenerationInput,
  PrContentGenerationResult,
  ReviewGuideGenerationInput,
  ReviewGuideGenerationResult,
  ThreadTitleGenerationInput,
  ThreadTitleGenerationResult,
  TranscriptionPostProcessingInput,
  TranscriptionPostProcessingResult,
} from "@t3tools/provider-core/server/textGeneration";

export class TextGeneration extends Context.Service<TextGeneration, ProviderTextGeneration>()(
  "t3/textGeneration/TextGeneration",
) {}

type TextGenerationOp =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle"
  | "generateReviewGuide"
  | "generateTranscriptionPostProcessing";

const resolveInstance = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
  operation: TextGenerationOp,
  instanceId: ProviderInstanceId,
): Effect.Effect<ProviderInstance, TextGenerationError> =>
  registry.getInstance(instanceId).pipe(
    Effect.filterOrFail(
      (instance): instance is ProviderInstance => instance !== undefined,
      () =>
        new TextGenerationError({
          operation,
          detail: `No provider instance registered for id '${instanceId}'.`,
        }),
    ),
  );

type TextGeneratorsService = TextGenerators.TextGenerators["Service"];

interface ResolvedTextGeneration {
  readonly enabled: boolean;
  readonly textGeneration: ProviderTextGeneration;
}

/** A text generator id runs on its model API; any other id resolves to a provider instance. */
const resolveTextGeneration = Effect.fn("TextGeneration.resolveTextGeneration")(function* (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
  textGenerators: TextGeneratorsService | undefined,
  operation: TextGenerationOp,
  instanceId: ProviderInstanceId,
): Effect.fn.Return<ResolvedTextGeneration, TextGenerationError, never> {
  const textGenerator =
    textGenerators === undefined ? undefined : yield* textGenerators.runner(instanceId);
  if (textGenerator !== undefined) {
    // A switched-off generator's runner fails with its own "is off" message.
    return {
      enabled: true,
      textGeneration: TextGenerationOperations.fromRunner("TextGenerator", textGenerator),
    };
  }
  return yield* resolveInstance(registry, operation, instanceId);
});

interface WithModelSelection {
  readonly modelSelection: ModelSelection;
  readonly fallbackModelSelections?: ReadonlyArray<ModelSelection> | undefined;
}

/** A candidate model, plus its zero-based position in the attempt order (0 is the primary). */
interface Candidate {
  readonly index: number;
  readonly modelSelection: ModelSelection;
}

/**
 * Builds the ordered attempt list: the primary selection, then its fallbacks, deduped by
 * instanceId + model + options so a fallback equal to the primary is never attempted twice.
 */
const dedupeCandidates = (input: WithModelSelection): ReadonlyArray<Candidate> => {
  const seen = new Set<string>();
  const candidates: Array<Candidate> = [];
  for (const modelSelection of [input.modelSelection, ...(input.fallbackModelSelections ?? [])]) {
    const key = `${modelSelection.instanceId} ${modelSelection.model} ${JSON.stringify(modelSelection.options ?? [])}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ index: candidates.length, modelSelection });
  }
  return candidates;
};

interface CandidateFailure {
  readonly candidate: Candidate;
  readonly error: TextGenerationError;
}

const describeCandidateFailure = ({ candidate, error }: CandidateFailure): string =>
  `#${candidate.index} ${candidate.modelSelection.instanceId}/${candidate.modelSelection.model}: ${error.detail}`;

/**
 * Runs a text-generation op against the primary model selection, then walks
 * `fallbackModelSelections` in order on failure. Each candidate gets one retry (an unregistered,
 * or disabled fallback, instance fails fast so it just advances). Exhaustion logs a warning naming
 * every attempt and fails with a `TextGenerationError` that keeps the first candidate's cause.
 */
const runWithFallback = Effect.fn("TextGeneration.runWithFallback")(function* <
  Input extends WithModelSelection,
  A,
>(
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
  textGenerators: TextGeneratorsService | undefined,
  operation: TextGenerationOp,
  input: Input,
  run: (
    textGeneration: ProviderTextGeneration,
    attemptInput: Input,
  ) => Effect.Effect<A, TextGenerationError>,
): Effect.fn.Return<A, TextGenerationError, never> {
  const candidates = dedupeCandidates(input);
  const failures: Array<CandidateFailure> = [];

  for (const candidate of candidates) {
    const attempt = yield* resolveTextGeneration(
      registry,
      textGenerators,
      operation,
      candidate.modelSelection.instanceId,
    ).pipe(
      Effect.flatMap((instance) =>
        // A fallback whose provider the user has switched off must not generate text. The
        // primary selection is repaired to an enabled provider by settings normalization
        // (`resolveTextGenerationProvider`), but nothing rewrites this list, and the registry
        // keeps disabled instances — so this is the only place the check can happen.
        candidate.index > 0 && !instance.enabled
          ? Effect.fail(
              new TextGenerationError({
                operation,
                detail: `Provider instance '${candidate.modelSelection.instanceId}' is disabled.`,
              }),
            )
          : // Retry wraps only the generation call, suspended so each attempt re-invokes the
            // provider rather than re-running an effect it already built. Retrying
            // `resolveTextGeneration` instead would add a dead wait before advancing past an
            // unregistered or disabled instance.
            Effect.suspend(() =>
              run(instance.textGeneration, { ...input, modelSelection: candidate.modelSelection }),
            ).pipe(Effect.retry({ times: 1, schedule: Schedule.exponential("2 seconds") })),
      ),
      Effect.result,
    );

    if (Result.isSuccess(attempt)) {
      yield* Effect.annotateCurrentSpan({
        "textGeneration.operation": operation,
        "textGeneration.candidateIndex": candidate.index,
        "textGeneration.instanceId": candidate.modelSelection.instanceId,
      });
      return attempt.success;
    }
    failures.push({ candidate, error: attempt.failure });
  }

  const first = failures[0];
  // Unreachable: `candidates` always contains at least `input.modelSelection`.
  if (first === undefined) {
    return yield* new TextGenerationError({
      operation,
      detail: "No candidate model selections to try.",
    });
  }

  yield* Effect.logWarning(`Text generation exhausted every candidate for ${operation}`, {
    attempts: failures.map(describeCandidateFailure),
  });

  return yield* new TextGenerationError({
    operation,
    detail: `All ${failures.length} candidate model(s) failed: ${failures
      .map(describeCandidateFailure)
      .join("; ")}`,
    cause: first.error.cause,
  });
});

// Review guides investigate the checkout read-only; the other drivers reject that request.
const INVESTIGATING_DRIVERS = new Set(["codex", "claudeAgent"]);

/**
 * When the selected provider's usage window is already exhausted, swap the
 * primary selection for an available text-generation-capable provider before any attempt.
 * The fork's `fallbackModelSelections` walk (`runWithFallback`) still runs after this, so a
 * failure on the swapped-in primary advances through the configured fallbacks.
 */
const resolveUsageLimitedSelection = Effect.fn("TextGeneration.resolveUsageLimitedSelection")(
  function* (
    registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
    serverSettings: ServerSettings.ServerSettingsService["Service"],
    textGenerators: TextGeneratorsService | undefined,
    operation: TextGenerationOp,
    selection: ModelSelection,
  ): Effect.fn.Return<ModelSelection, TextGenerationError, never> {
    const textGenerator =
      textGenerators === undefined ? undefined : yield* textGenerators.runner(selection.instanceId);
    // A review guide reaches a text generator only through a fallback; it needs an agent instead.
    const textGeneratorCannotRun =
      textGenerator !== undefined && operation === "generateReviewGuide";
    if (textGenerator !== undefined && !textGeneratorCannotRun) return selection;
    const snapshots = yield* registry.listInstances.pipe(
      Effect.flatMap((instances) =>
        Effect.forEach(instances, (instance) => instance.snapshot.getSnapshot),
      ),
    );
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    const selected = snapshots.find((provider) => provider.instanceId === selection.instanceId);
    // Only a failed probe counts: a pending one is also not installed yet.
    const unusable =
      textGeneratorCannotRun ||
      (selected?.enabled === true &&
        selected.status === "error" &&
        (!selected.installed || selected.auth.status === "unauthenticated"));
    if (!unusable && !exhaustedUsageWindow(selected, now, selection.model)) return selection;
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation,
            detail: "Could not read fallback model settings.",
            cause,
          }),
      ),
    );
    const resolved =
      fallbackTextGenerationModelSelection(
        settings.providerInstances,
        (instanceId, driver) => {
          const provider = snapshots.find((candidate) => candidate.instanceId === instanceId);
          return (
            instanceId !== selection.instanceId &&
            provider?.enabled === true &&
            resolveProjectProviderInstanceEnabled(settings, null, instanceId) &&
            provider.installed &&
            provider.auth.status !== "unauthenticated" &&
            provider.status !== "error" &&
            isProviderAvailable(provider) &&
            isProviderTextGenerationCapable(provider) &&
            (operation !== "generateReviewGuide" || INVESTIGATING_DRIVERS.has(driver)) &&
            !exhaustedUsageWindow(provider, now, defaultTextGenerationModel(driver))
          );
        },
        { includeConfiguredInstances: true },
      ) ?? selection;
    if (textGeneratorCannotRun && resolved.instanceId === selection.instanceId) {
      return yield* new TextGenerationError({
        operation,
        detail:
          "Review guides need a coding agent that can read the checkout. None is ready. Pick Codex or Claude as the review guide model in Settings → Source control.",
      });
    }
    return resolved;
  },
);

export const makeTextGenerationFromRegistry = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
  // Optional: callers that only exercise model fallback build the service from a
  // bare registry. Without it a thread title skips source-control link
  // resolution and uses whatever `linkedContext` the caller already supplied.
  sourceControl?: SourceControlProviderRegistry.SourceControlProviderRegistry["Service"],
  // Optional for the same reason: without it the usage-limit preflight is skipped and the
  // primary selection is attempted as given.
  serverSettings?: ServerSettings.ServerSettingsService["Service"],
  // Optional too: without it every id resolves to a provider instance.
  textGenerators?: TextGeneratorsService,
): TextGeneration["Service"] => {
  const preflight = <Input extends { readonly modelSelection: ModelSelection }>(
    operation: TextGenerationOp,
    input: Input,
  ): Effect.Effect<Input, TextGenerationError> =>
    serverSettings === undefined
      ? Effect.succeed(input)
      : resolveUsageLimitedSelection(
          registry,
          serverSettings,
          textGenerators,
          operation,
          input.modelSelection,
        ).pipe(Effect.map((modelSelection) => ({ ...input, modelSelection })));

  return TextGeneration.of({
    generateCommitMessage: Effect.fn("TextGeneration.generateCommitMessage")(function* (input) {
      const prepared = yield* preflight("generateCommitMessage", input);
      return yield* runWithFallback(
        registry,
        textGenerators,
        "generateCommitMessage",
        prepared,
        (textGeneration, attemptInput) => textGeneration.generateCommitMessage(attemptInput),
      );
    }),
    generatePrContent: Effect.fn("TextGeneration.generatePrContent")(function* (input) {
      const prepared = yield* preflight("generatePrContent", input);
      return yield* runWithFallback(
        registry,
        textGenerators,
        "generatePrContent",
        prepared,
        (textGeneration, attemptInput) => textGeneration.generatePrContent(attemptInput),
      );
    }),
    generateBranchName: Effect.fn("TextGeneration.generateBranchName")(function* (input) {
      const prepared = yield* preflight("generateBranchName", input);
      return yield* runWithFallback(
        registry,
        textGenerators,
        "generateBranchName",
        prepared,
        (textGeneration, attemptInput) => textGeneration.generateBranchName(attemptInput),
      );
    }),
    generateReviewGuide: Effect.fn("TextGeneration.generateReviewGuide")(function* (input) {
      const prepared = yield* preflight("generateReviewGuide", input);
      return yield* resolveTextGeneration(
        registry,
        textGenerators,
        "generateReviewGuide",
        prepared.modelSelection.instanceId,
      ).pipe(Effect.flatMap((resolved) => resolved.textGeneration.generateReviewGuide(prepared)));
    }),
    generateTranscriptionPostProcessing: Effect.fn(
      "TextGeneration.generateTranscriptionPostProcessing",
    )(function* (input) {
      const prepared = yield* preflight("generateTranscriptionPostProcessing", input);
      return yield* resolveTextGeneration(
        registry,
        textGenerators,
        "generateTranscriptionPostProcessing",
        prepared.modelSelection.instanceId,
      ).pipe(
        Effect.flatMap((resolved) =>
          resolved.textGeneration.generateTranscriptionPostProcessing(prepared),
        ),
      );
    }),
    generateThreadTitle: Effect.fn("TextGeneration.generateThreadTitle")(function* (input) {
      const prepared = yield* preflight("generateThreadTitle", input);
      // Resolve source-control links once, ahead of the fallback walk, so a
      // retry against a fallback model does not re-fetch the same subjects.
      const linkedContext =
        prepared.linkedContext ??
        (sourceControl === undefined
          ? undefined
          : yield* ThreadTitleLinks.resolveThreadTitleLinks(prepared).pipe(
              Effect.provideService(
                SourceControlProviderRegistry.SourceControlProviderRegistry,
                sourceControl,
              ),
            ));
      return yield* runWithFallback(
        registry,
        textGenerators,
        "generateThreadTitle",
        { ...prepared, linkedContext },
        (textGeneration, attemptInput) => textGeneration.generateThreadTitle(attemptInput),
      );
    }),
  });
};

/** @public */
export const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const sourceControl = yield* SourceControlProviderRegistry.SourceControlProviderRegistry;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGenerators = yield* TextGenerators.TextGenerators;
  return makeTextGenerationFromRegistry(registry, sourceControl, serverSettings, textGenerators);
});

export const layer = Layer.effect(TextGeneration, make).pipe(
  Layer.provideMerge(TextGenerators.layer),
);
