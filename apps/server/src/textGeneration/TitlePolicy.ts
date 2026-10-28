/**
 * The thread title policy (a fork setting): deterministic identifier prefixes
 * and exact title templates around the model's title, so the model never has
 * to guess whether or where a PR, issue, or Radar number goes.
 *
 * @module textGeneration/TitlePolicy
 */
import type { TitlePolicy, TitlePolicyRule } from "@t3tools/contracts";

// Bounded, linear patterns only: no nested quantifiers over the same class,
// so untrusted policy text (urlMatches) can't trigger backtracking blowup.
const BUILT_IN_PATTERNS: Record<string, RegExp> = {
  github_pull: /github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/,
  github_issue: /github\.com\/[^/\s]+\/[^/\s]+\/issues\/(\d+)/,
  radar: /r(?:dar|adar):\/\/(\d+)/,
};

// Agents cite Radars and issues in passing, so only the user's own words pick
// those prefixes. PR links still count from replies: an agent opening a PR is
// what the thread is about.
const USER_ONLY_URL_KINDS = new Set(["radar", "github_issue"]);

function userMessages(context: string): string {
  const parts = context.split(/(?:^|\n\n)(USER|ASSISTANT):\n/);
  if (parts.length === 1) return context;
  return parts.flatMap((part, index) => (parts[index - 1] === "USER" ? [part] : [])).join("\n\n");
}

function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

// Glob-style rule pattern ("linear.app/*/issue/{identifier}") to a linear regex.
// Escape literals first, then substitute `*` and `{name}` placeholders so no
// user-controlled quantifier or alternation reaches the compiled pattern.
// Placeholders capture only identifier characters: agents write links as
// markdown (`**[#548](…/pull/548)**`), and a looser class would swallow the
// trailing `)**` into the title prefix.
function globPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const withWildcards = escaped.replace(/\*/g, "[^/\\s]+");
  const withCapture = withWildcards.replace(/\\\{(\w+)\\\}/g, "([\\w-]+)");
  return new RegExp(withCapture);
}

function matchRule(context: string, rule: TitlePolicyRule): string | null {
  if (rule.when.initialCommand !== undefined) {
    const firstUserLine = context.match(/(?:^|\n)USER:\n([^\n]*)/i)?.[1]?.trim();
    return firstUserLine?.split(/\s+/)[0] === rule.when.initialCommand
      ? rule.when.initialCommand
      : null;
  }
  if (rule.when.urlKind !== undefined) {
    const pattern = BUILT_IN_PATTERNS[rule.when.urlKind];
    const source = USER_ONLY_URL_KINDS.has(rule.when.urlKind) ? userMessages(context) : context;
    return pattern === undefined ? null : (source.match(pattern)?.[1] ?? null);
  }
  if (rule.when.urlMatches !== undefined) {
    // A pattern without a `{name}` capture never matches.
    return context.match(globPatternToRegExp(rule.when.urlMatches))?.[1] ?? null;
  }
  return null;
}

/**
 * The highest-priority rule matching a `USER:`/`ASSISTANT:` transcript, with
 * its prefix filled in. Equal priorities resolve to the earlier rule.
 */
export function resolveTitlePolicyRule(
  context: string,
  rules: ReadonlyArray<TitlePolicyRule>,
): { readonly rule: TitlePolicyRule; readonly prefix: string } | null {
  let best: { readonly rule: TitlePolicyRule; readonly prefix: string } | null = null;
  for (const rule of rules) {
    const value = matchRule(context, rule);
    if (value === null) continue;
    if (best === null || rule.priority > best.rule.priority) {
      best = { rule, prefix: interpolate(rule.prefix, { number: value, identifier: value }) };
    }
  }
  return best;
}

/** "{prefix} {description}", truncated with an ellipsis to `maxCharacters`. */
export function composeTitle(input: {
  readonly protectedPrefix: string | null;
  readonly description: string;
  readonly maxCharacters: number;
}): string {
  const description = input.description.trim();
  if (input.protectedPrefix === null) {
    return description.length <= input.maxCharacters
      ? description
      : `${description.slice(0, input.maxCharacters - 1).trimEnd()}…`;
  }
  const prefix = `${input.protectedPrefix} `;
  const available = Math.max(0, input.maxCharacters - prefix.length);
  const truncated =
    description.length <= available
      ? description
      : `${description.slice(0, Math.max(0, available - 1)).trimEnd()}…`;
  return `${prefix}${truncated}`.trim();
}

/**
 * Expand `{today:MM/DD/YYYY}` and `{now:HH:mm}` in the host's timezone. Callers
 * pass the thread's creation time: the policy re-expands templates on later
 * turns, and anchoring to thread start keeps the time from ticking forward
 * and the date from flipping on a thread that crosses midnight.
 */
export function expandTitleTemplate(template: string, at: number): string {
  const date = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(at);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
  return template.replaceAll("{today:MM/DD/YYYY}", date).replaceAll("{now:HH:mm}", time).trim();
}

/**
 * What the policy makes of a thread: an exact title, or a model title to
 * compose behind `prefix` with `instructions` passed to the model.
 */
export type TitlePlan =
  | { readonly type: "template"; readonly title: string }
  | {
      readonly type: "generate";
      readonly prefix: string | null;
      readonly instructions: string | undefined;
      readonly maxCharacters: number | null;
    };

const UNCHANGED: TitlePlan = {
  type: "generate",
  prefix: null,
  instructions: undefined,
  maxCharacters: null,
};

/** `context` is a `USER:`/`ASSISTANT:` transcript; `createdAt` anchors templates. */
export function planTitle(policy: TitlePolicy, context: string, createdAt: number): TitlePlan {
  if (!policy.enabled) return UNCHANGED;
  const matched = resolveTitlePolicyRule(context, policy.rules);
  if (matched?.rule.titleTemplate !== undefined) {
    return { type: "template", title: expandTitleTemplate(matched.rule.titleTemplate, createdAt) };
  }
  const prefix = matched?.prefix ?? null;
  const lines = [
    ...(prefix === null
      ? []
      : [
          `The title is shown after the fixed prefix ${JSON.stringify(prefix)}, so leave the prefix and any PR, issue, or Radar number out of it, and keep it under ${Math.max(10, policy.defaults.maxCharacters - prefix.length - 1)} characters.`,
        ]),
    ...(matched?.rule.guidance ? [matched.rule.guidance] : []),
    ...policy.suggestions,
  ];
  return {
    type: "generate",
    prefix,
    instructions: lines.length === 0 ? undefined : lines.map((line) => `- ${line}`).join("\n"),
    maxCharacters: policy.defaults.maxCharacters,
  };
}

/**
 * The instructions a generated title is asked to follow: the user's own title
 * instructions setting, then the plan's rule guidance. `undefined` when neither has any.
 */
export function titleInstructions(
  userInstructions: string | undefined,
  planInstructions: string | undefined,
): string | undefined {
  const parts = [userInstructions?.trim(), planInstructions?.trim()].filter(
    (part): part is string => part !== undefined && part.length > 0,
  );
  return parts.length === 0 ? undefined : parts.join("\n\n");
}

/** The model's title behind the plan's prefix. A model that repeated the prefix anyway loses it. */
export function finishTitle(
  plan: Extract<TitlePlan, { readonly type: "generate" }>,
  generated: string,
): string {
  if (plan.maxCharacters === null) return generated;
  const description =
    plan.prefix !== null && generated.startsWith(plan.prefix)
      ? generated.slice(plan.prefix.length).trim()
      : generated;
  return composeTitle({
    protectedPrefix: plan.prefix,
    description,
    maxCharacters: plan.maxCharacters,
  });
}
