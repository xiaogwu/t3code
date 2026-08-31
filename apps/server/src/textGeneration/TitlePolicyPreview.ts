/**
 * Dry-runs a TitlePolicy against its own examples so the settings UI can
 * show pass/fail before the user saves a policy edit.
 *
 * @module titlePolicyPreview
 */
import type { ModelSelection, TitlePolicy, TitlePolicyPreviewResult } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as TextGeneration from "./TextGeneration.ts";
import { resolveTitlePolicyRule } from "./TitleIdentifierMatchers.ts";
import { composeTitle, expandTitleTemplate } from "./TitlePolicyResolver.ts";

export const previewTitlePolicy = Effect.fn("previewTitlePolicy")(function* (
  policy: TitlePolicy,
  modelSelection: ModelSelection,
) {
  const textGeneration = yield* TextGeneration.TextGeneration;
  const results: TitlePolicyPreviewResult[] = [];

  for (const example of policy.examples) {
    const matched = resolveTitlePolicyRule(example.thread, policy.rules);
    const protectedPrefix = matched?.prefix ?? null;
    const availableDescriptionCharacters =
      protectedPrefix === null
        ? policy.defaults.maxCharacters
        : Math.max(10, policy.defaults.maxCharacters - protectedPrefix.length - 1);
    const actual =
      matched?.rule.titleTemplate !== undefined
        ? expandTitleTemplate(matched.rule.titleTemplate)
        : yield* textGeneration
            .evaluateTitlePolicy({
              cwd: process.cwd(),
              threadContext: example.thread,
              previousTitle: example.previousTitle ?? "New thread",
              protectedPrefix,
              availableDescriptionCharacters,
              guidance: [
                ...(matched?.rule.guidance ? [matched.rule.guidance] : []),
                ...policy.suggestions,
              ],
              modelSelection,
            })
            .pipe(
              Effect.map((evaluation) =>
                composeTitle({
                  protectedPrefix,
                  description: evaluation.suggestedTitle,
                  maxCharacters: policy.defaults.maxCharacters,
                }),
              ),
            );
    results.push({ example, actual, pass: actual === example.expected });
  }

  return results;
});
