import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schedule from "effect/Schedule";
import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import { TextGenerationError } from "@t3tools/contracts";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as ThreadTitleLinks from "./ThreadTitleLinks.ts";

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
} from "@t3tools/provider-core/server/textGeneration";

export class TextGeneration extends Context.Service<TextGeneration, ProviderTextGeneration>()(
  "t3/textGeneration/TextGeneration",
) {}

type TextGenerationOp =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle"
  | "generateReviewGuide";

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
  operation: TextGenerationOp,
  input: Input,
  run: (
    textGeneration: ProviderInstance["textGeneration"],
    attemptInput: Input,
  ) => Effect.Effect<A, TextGenerationError>,
): Effect.fn.Return<A, TextGenerationError, never> {
  const candidates = dedupeCandidates(input);
  const failures: Array<CandidateFailure> = [];

  for (const candidate of candidates) {
    const attempt = yield* resolveInstance(
      registry,
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
            // `resolveInstance` instead would add a dead wait before advancing past an
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

export const makeTextGenerationFromRegistry = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
  // Optional: callers that only exercise model fallback build the service from a
  // bare registry. Without it a thread title skips source-control link
  // resolution and uses whatever `linkedContext` the caller already supplied.
  sourceControl?: SourceControlProviderRegistry.SourceControlProviderRegistry["Service"],
): TextGeneration["Service"] =>
  TextGeneration.of({
    generateCommitMessage: Effect.fn("TextGeneration.generateCommitMessage")(function (input) {
      return runWithFallback(
        registry,
        "generateCommitMessage",
        input,
        (textGeneration, attemptInput) => textGeneration.generateCommitMessage(attemptInput),
      );
    }),
    generatePrContent: Effect.fn("TextGeneration.generatePrContent")(function (input) {
      return runWithFallback(registry, "generatePrContent", input, (textGeneration, attemptInput) =>
        textGeneration.generatePrContent(attemptInput),
      );
    }),
    generateBranchName: Effect.fn("TextGeneration.generateBranchName")(function (input) {
      return runWithFallback(
        registry,
        "generateBranchName",
        input,
        (textGeneration, attemptInput) => textGeneration.generateBranchName(attemptInput),
      );
    }),
    generateReviewGuide: Effect.fn("TextGeneration.generateReviewGuide")(function (input) {
      return resolveInstance(registry, "generateReviewGuide", input.modelSelection.instanceId).pipe(
        Effect.flatMap((instance) => instance.textGeneration.generateReviewGuide(input)),
      );
    }),
    generateThreadTitle: Effect.fn("TextGeneration.generateThreadTitle")(function* (input) {
      // Resolve source-control links once, ahead of the fallback walk, so a
      // retry against a fallback model does not re-fetch the same subjects.
      const linkedContext =
        input.linkedContext ??
        (sourceControl === undefined
          ? undefined
          : yield* ThreadTitleLinks.resolveThreadTitleLinks(input).pipe(
              Effect.provideService(
                SourceControlProviderRegistry.SourceControlProviderRegistry,
                sourceControl,
              ),
            ));
      return yield* runWithFallback(
        registry,
        "generateThreadTitle",
        { ...input, linkedContext },
        (textGeneration, attemptInput) => textGeneration.generateThreadTitle(attemptInput),
      );
    }),
  });

/** @public */
export const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const sourceControl = yield* SourceControlProviderRegistry.SourceControlProviderRegistry;
  return makeTextGenerationFromRegistry(registry, sourceControl);
});

export const layer = Layer.effect(TextGeneration, make);
