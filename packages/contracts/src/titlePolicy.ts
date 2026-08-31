/**
 * Structured auto-title policy: deterministic identifier rules plus
 * model-facing suggestions/examples for the descriptive remainder.
 *
 * @module titlePolicy
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const TitlePolicyUrlKind = Schema.Literals([
  "github_pull",
  "github_issue",
  "radar",
  "linear",
  "custom",
]);
export type TitlePolicyUrlKind = typeof TitlePolicyUrlKind.Type;

export const TitlePolicyRuleWhen = Schema.Struct({
  /** Match the first user command in a thread, such as `/oliver`. */
  initialCommand: Schema.optional(TrimmedNonEmptyString),
  urlKind: Schema.optional(TitlePolicyUrlKind),
  // Glob-style pattern with a `{number}`/`{identifier}` capture, e.g.
  // "github.com/*/*/pull/{number}". Used for any urlKind without a built-in
  // pattern (currently "linear" and "custom"), and on its own when urlKind is
  // omitted. A recognized urlKind's built-in pattern takes precedence.
  urlMatches: Schema.optional(TrimmedNonEmptyString),
});
export type TitlePolicyRuleWhen = typeof TitlePolicyRuleWhen.Type;

export const TitlePolicyRule = Schema.Struct({
  name: TrimmedNonEmptyString,
  when: TitlePolicyRuleWhen,
  // Template with `{number}`/`{identifier}` interpolation, e.g. "PR #{number}".
  prefix: TrimmedNonEmptyString,
  placement: Schema.Literals(["start"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("start" as const)),
  ),
  priority: Schema.Int,
  guidance: Schema.optional(Schema.String),
  /** Deterministic exact-title template. Supports `{today:MM/DD/YYYY}`. */
  titleTemplate: Schema.optional(TrimmedNonEmptyString),
});
export type TitlePolicyRule = typeof TitlePolicyRule.Type;

export const TitlePolicyExample = Schema.Struct({
  thread: TrimmedNonEmptyString,
  previousTitle: Schema.optional(TrimmedNonEmptyString),
  expected: TrimmedNonEmptyString,
});
export type TitlePolicyExample = typeof TitlePolicyExample.Type;

export const TitlePolicyDefaults = Schema.Struct({
  maxCharacters: Schema.Int.check(Schema.isGreaterThan(0)),
  refreshEveryTurns: Schema.Int.check(Schema.isGreaterThan(0)),
  renameOnGoalChange: Schema.Boolean,
  preserveManualTitles: Schema.Boolean,
});
export type TitlePolicyDefaults = typeof TitlePolicyDefaults.Type;

export const TitlePolicy = Schema.Struct({
  version: Schema.Literal(1),
  enabled: Schema.Boolean,
  defaults: TitlePolicyDefaults,
  rules: Schema.Array(TitlePolicyRule),
  suggestions: Schema.Array(Schema.String),
  examples: Schema.Array(TitlePolicyExample),
});
export type TitlePolicy = typeof TitlePolicy.Type;

// Later tasks (preview RPC / settings UI) run a policy against an example
// thread and compare the actual title against the expected one.
export const TitlePolicyPreviewResult = Schema.Struct({
  example: TitlePolicyExample,
  actual: Schema.String,
  pass: Schema.Boolean,
});
export type TitlePolicyPreviewResult = typeof TitlePolicyPreviewResult.Type;

export const defaultTitlePolicy: TitlePolicy = {
  version: 1,
  enabled: true,
  defaults: {
    maxCharacters: 50,
    refreshEveryTurns: 4,
    renameOnGoalChange: true,
    preserveManualTitles: true,
  },
  rules: [
    {
      name: "GitHub pull requests",
      when: { urlKind: "github_pull" },
      prefix: "PR#{number}:",
      placement: "start",
      priority: 100,
      guidance:
        "Use PR metadata retrieved by /pr-review, especially the PR title and description, as authoritative context. Describe what the PR changes or fixes, not the review process.",
    },
    {
      name: "ProdGit pull requests",
      when: { urlMatches: "prodgit.apple.com/*/*/pull/{number}" },
      prefix: "PR#{number}:",
      placement: "start",
      priority: 100,
      guidance:
        "Use PR metadata retrieved by /pr-review, especially the PR title and description, as authoritative context. Describe what the PR changes or fixes, not the review process.",
    },
    {
      name: "Oliver sessions",
      when: { initialCommand: "/oliver" },
      prefix: "Oliver",
      placement: "start",
      priority: 200,
      titleTemplate: "Oliver {today:MM/DD/YYYY}",
      guidance: "Use the exact deterministic title template.",
    },
    {
      name: "GitHub issues",
      when: { urlKind: "github_issue" },
      prefix: "#{number}",
      placement: "start",
      priority: 90,
      guidance: "Describe the reported behavior or desired fix.",
    },
    {
      name: "Radar",
      when: { urlKind: "radar" },
      prefix: "Radar {identifier}",
      placement: "start",
      priority: 100,
      guidance: "Describe the reported behavior or desired fix.",
    },
  ],
  suggestions: [
    "Prefer the durable product goal over the current implementation step.",
    "Use recognizable product nouns.",
    "Avoid completion claims.",
  ],
  examples: [
    {
      thread: "Please review https://github.com/acme/app/pull/4821 for sidebar regressions",
      expected: "PR#4821: Prevent sidebar scroll resets",
    },
    {
      thread: "Run CI and merge it",
      previousTitle: "PR#4821: Prevent sidebar scroll resets",
      expected: "PR#4821: Prevent sidebar scroll resets",
    },
    {
      thread:
        "$pr-review https://prodgit.apple.com/content-engineering/politics-embeds-us/pull/391\n\nASSISTANT:\nPR title: Add labels for polls-closed race sections. The description explains that the change supplies fallback labels for key and statewide race tables.",
      expected: "PR#391: Add polls-closed race labels",
    },
  ],
};
