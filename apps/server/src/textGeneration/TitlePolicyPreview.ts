/**
 * Dry-runs an unsaved title policy against its own examples, so the settings
 * editor can show pass or fail before the policy is applied.
 *
 * @module textGeneration/TitlePolicyPreview
 */
import type { TitlePolicy, TitlePolicyPreviewResult } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "./TextGeneration.ts";
import { finishTitle, planTitle, titleInstructions } from "./TitlePolicy.ts";

export const previewTitlePolicy = Effect.fn("previewTitlePolicy")(function* (policy: TitlePolicy) {
  const settings = yield* (yield* ServerSettings.ServerSettingsService).getSettings;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const now = DateTime.toEpochMillis(yield* DateTime.now);
  return yield* Effect.forEach(
    policy.examples,
    (example) =>
      Effect.gen(function* () {
        // Examples may be bare first messages or USER:/ASSISTANT: transcripts.
        const context = /^(?:USER|ASSISTANT):\n/.test(example.thread)
          ? example.thread
          : `USER:\n${example.thread}`;
        // Templates expand to the time of the preview, as for a thread started now.
        const plan = planTitle({ ...policy, enabled: true }, context, now);
        const actual =
          plan.type === "template"
            ? plan.title
            : finishTitle(
                plan,
                (yield* textGeneration.generateThreadTitle({
                  cwd: process.cwd(),
                  message: example.thread,
                  ...(example.previousTitle === undefined
                    ? {}
                    : { previousTitle: example.previousTitle }),
                  instructions: titleInstructions(
                    settings.threadTitleInstructions,
                    plan.instructions,
                  ),
                  modelSelection: settings.textGenerationModelSelection,
                  fallbackModelSelections: settings.textGenerationFallbackModelSelections,
                })).title.trim(),
              );
        return {
          example,
          actual,
          pass: actual === example.expected,
        } satisfies TitlePolicyPreviewResult;
      }),
    { concurrency: 3 },
  );
});
