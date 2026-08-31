/**
 * Evaluates the automatic title policy after completed turns and dispatches
 * the resulting protected prefix and optional rename through orchestration.
 *
 * @module titlePolicyReactor
 */
import { CommandId, type OrchestrationEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { ServerSettingsService } from "../../serverSettings.ts";
import { TextGeneration } from "../../textGeneration/TextGeneration.ts";
import { resolveTitlePolicyRule } from "../../textGeneration/TitleIdentifierMatchers.ts";
import {
  composeTitle,
  expandTitleTemplate,
  shouldEvaluateNow,
} from "../../textGeneration/TitlePolicyResolver.ts";
import { forkParked } from "../../serverActivation.ts";
import {
  TitlePolicyReactor,
  type TitlePolicyReactorShape,
} from "../Services/TitlePolicyReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { formatThreadTitleContext } from "./ProviderCommandReactor.ts";

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const serverSettings = yield* ServerSettingsService;
  const textGeneration = yield* TextGeneration;

  const handleTurnDiffCompleted = Effect.fn("TitlePolicyReactor.handleTurnDiffCompleted")(
    function* (event: Extract<OrchestrationEvent, { type: "thread.turn-diff-completed" }>) {
      const settings = yield* serverSettings.getSettings;
      const policy = settings.titlePolicy;
      if (!policy.enabled) {
        return;
      }

      const threadOption = yield* projectionSnapshotQuery.getThreadDetailById(
        event.payload.threadId,
      );
      if (Option.isNone(threadOption)) {
        return;
      }
      const thread = threadOption.value;
      const { message: threadContext } = formatThreadTitleContext(thread.messages);
      const matched = resolveTitlePolicyRule(threadContext, policy.rules);
      const protectedPrefix = matched?.prefix ?? null;
      const protectedPrefixChanged = protectedPrefix !== (thread.titleProtectedPrefix ?? null);
      const shouldEvaluate = shouldEvaluateNow({
        titleProvenance: thread.titleProvenance ?? "automatic",
        preserveManualTitles: policy.defaults.preserveManualTitles,
        protectedPrefixChanged,
        turnsSincePolicyEval: thread.titleTurnsSincePolicyEval ?? 0,
        refreshEveryTurns: policy.defaults.refreshEveryTurns,
        isTurnRunning: thread.session !== null && thread.session.activeTurnId !== null,
      });

      let rename: { readonly title: string } | undefined;
      if (shouldEvaluate) {
        const availableDescriptionCharacters =
          protectedPrefix === null
            ? policy.defaults.maxCharacters
            : Math.max(10, policy.defaults.maxCharacters - protectedPrefix.length - 1);
        if (matched?.rule.titleTemplate !== undefined) {
          rename = { title: expandTitleTemplate(matched.rule.titleTemplate) };
        } else {
          const evaluation = yield* textGeneration.evaluateTitlePolicy({
            cwd: thread.worktreePath ?? process.cwd(),
            threadContext,
            previousTitle: thread.title,
            protectedPrefix,
            availableDescriptionCharacters,
            guidance: [
              ...(matched?.rule.guidance ? [matched.rule.guidance] : []),
              ...policy.suggestions,
            ],
            modelSelection: settings.textGenerationModelSelection,
          });
          if (evaluation.shouldRename && evaluation.confidence >= 0.6) {
            rename = {
              title: composeTitle({
                protectedPrefix,
                description: evaluation.suggestedTitle,
                maxCharacters: policy.defaults.maxCharacters,
              }),
            };
          }
        }
      }

      const commandId = yield* crypto.randomUUIDv4.pipe(
        Effect.map((uuid) => CommandId.make(`server:title-policy:${uuid}`)),
      );
      yield* orchestrationEngine.dispatch({
        type: "thread.title.policy.evaluated",
        commandId,
        threadId: event.payload.threadId,
        turnId: event.payload.turnId,
        protectedPrefix,
        ...(rename === undefined ? {} : { rename }),
      });
    },
  );

  const processEventSafely = (
    event: Extract<OrchestrationEvent, { type: "thread.turn-diff-completed" }>,
  ) =>
    handleTurnDiffCompleted(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("title policy reactor failed to process event", {
          eventType: event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processEventSafely);
  const start: TitlePolicyReactorShape["start"] = Effect.fn("start")(function* () {
    yield* forkParked(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) =>
        event.type === "thread.turn-diff-completed" ? worker.enqueue(event) : Effect.void,
      ),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies TitlePolicyReactorShape;
});

export const TitlePolicyReactorLive = Layer.effect(TitlePolicyReactor, make);
