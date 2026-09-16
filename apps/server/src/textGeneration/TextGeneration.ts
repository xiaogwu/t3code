import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schedule from "effect/Schedule";
import type { ChatAttachment, ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import { TextGenerationError } from "@t3tools/contracts";

import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as ThreadTitleLinks from "./ThreadTitleLinks.ts";
import type { TextGenerationPolicy } from "./TextGenerationPolicy.ts";

export type TextGenerationProvider = "codex" | "claudeAgent" | "cursor" | "grok" | "opencode";

export interface CommitMessageGenerationInput {
  cwd: string;
  branch: string | null;
  stagedSummary: string;
  stagedPatch: string;
  /** When true, the model also returns a semantic branch name for the change. */
  includeBranch?: boolean;
  policy?: TextGenerationPolicy | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
  /** Additional models to try, in order, if the primary selection fails. */
  fallbackModelSelections?: ReadonlyArray<ModelSelection> | undefined;
}

export interface CommitMessageGenerationResult {
  subject: string;
  body: string;
  /** Only present when `includeBranch` was set on the input. */
  branch?: string | undefined;
}

export interface PrContentGenerationInput {
  cwd: string;
  baseBranch: string;
  headBranch: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
  changeRequestTemplate?: string | undefined;
  policy?: TextGenerationPolicy | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
  /** Additional models to try, in order, if the primary selection fails. */
  fallbackModelSelections?: ReadonlyArray<ModelSelection> | undefined;
}

export interface PrContentGenerationResult {
  title: string;
  body: string;
}

export interface BranchNameGenerationInput {
  cwd: string;
  message: string;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
  /** Additional models to try, in order, if the primary selection fails. */
  fallbackModelSelections?: ReadonlyArray<ModelSelection> | undefined;
}

export interface BranchNameGenerationResult {
  branch: string;
}

export interface ThreadTitleGenerationInput {
  linkedContext?: string | undefined;
  cwd: string;
  message: string;
  /** Present when replacing an existing title from the current thread history. */
  previousTitle?: string | undefined;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
  /** Additional models to try, in order, if the primary selection fails. */
  fallbackModelSelections?: ReadonlyArray<ModelSelection> | undefined;
}

export interface ThreadTitleGenerationResult {
  title: string;
  needsRefinement?: boolean | undefined;
}

export interface TitlePolicyEvaluationInput {
  cwd: string;
  threadContext: string;
  previousTitle: string;
  protectedPrefix: string | null;
  availableDescriptionCharacters: number;
  guidance: ReadonlyArray<string>;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
  /** Additional models to try, in order, if the primary selection fails. */
  fallbackModelSelections?: ReadonlyArray<ModelSelection> | undefined;
}

export interface TitlePolicyEvaluationResult {
  gist: string;
  identifiers: ReadonlyArray<string>;
  shouldRename: boolean;
  suggestedTitle: string;
  reason: string;
  confidence: number;
}

/**
 * TextGeneration - Service tag for commit and change request text generation.
 */
export class TextGeneration extends Context.Service<
  TextGeneration,
  {
    /**
     * Generate a commit message from staged change context.
     */
    readonly generateCommitMessage: (
      input: CommitMessageGenerationInput,
    ) => Effect.Effect<CommitMessageGenerationResult, TextGenerationError>;

    /**
     * Generate change request title/body from branch and diff context.
     */
    readonly generatePrContent: (
      input: PrContentGenerationInput,
    ) => Effect.Effect<PrContentGenerationResult, TextGenerationError>;

    /**
     * Generate a concise branch name from a user message.
     */
    readonly generateBranchName: (
      input: BranchNameGenerationInput,
    ) => Effect.Effect<BranchNameGenerationResult, TextGenerationError>;

    /** Generate a concise thread title from a first message or thread history. */
    readonly generateThreadTitle: (
      input: ThreadTitleGenerationInput,
    ) => Effect.Effect<ThreadTitleGenerationResult, TextGenerationError>;

    /** Decide whether an auto-title policy should refresh a thread's title, and propose the replacement. */
    readonly evaluateTitlePolicy: (
      input: TitlePolicyEvaluationInput,
    ) => Effect.Effect<TitlePolicyEvaluationResult, TextGenerationError>;
  }
>()("t3/textGeneration/TextGeneration") {}

/** @deprecated Use `TextGeneration["Service"]`. */
export type TextGenerationShape = TextGeneration["Service"];

type TextGenerationOp =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle"
  | "evaluateTitlePolicy";

const resolveInstance = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
  operation: TextGenerationOp,
  instanceId: ProviderInstanceId,
): Effect.Effect<ProviderInstance, TextGenerationError> =>
  registry.getInstance(instanceId).pipe(
    Effect.flatMap((instance) =>
      instance
        ? Effect.succeed(instance)
        : Effect.fail(
            new TextGenerationError({
              operation,
              detail: `No provider instance registered for id '${instanceId}'.`,
            }),
          ),
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
    generateCommitMessage: (input) =>
      runWithFallback(registry, "generateCommitMessage", input, (textGeneration, attemptInput) =>
        textGeneration.generateCommitMessage(attemptInput),
      ),
    generatePrContent: (input) =>
      runWithFallback(registry, "generatePrContent", input, (textGeneration, attemptInput) =>
        textGeneration.generatePrContent(attemptInput),
      ),
    generateBranchName: (input) =>
      runWithFallback(registry, "generateBranchName", input, (textGeneration, attemptInput) =>
        textGeneration.generateBranchName(attemptInput),
      ),
    generateThreadTitle: (input) =>
      Effect.gen(function* () {
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
    evaluateTitlePolicy: (input) =>
      runWithFallback(registry, "evaluateTitlePolicy", input, (textGeneration, attemptInput) =>
        textGeneration.evaluateTitlePolicy(attemptInput),
      ),
  });

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const sourceControl = yield* SourceControlProviderRegistry.SourceControlProviderRegistry;
  return makeTextGenerationFromRegistry(registry, sourceControl);
});

export const layer = Layer.effect(TextGeneration, make);
