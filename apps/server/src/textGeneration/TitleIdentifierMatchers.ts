/**
 * Deterministic identifier extraction for the auto-title policy: turns a
 * PR/issue/Radar/custom URL embedded in thread text into a protected title
 * prefix, so the title model never has to guess whether/where to put it.
 *
 * @module titleIdentifierMatchers
 */
import type { TitlePolicyRule } from "@t3tools/contracts";

// Bounded, linear patterns only: no nested quantifiers over the same class,
// so untrusted policy text (urlMatches) can't trigger backtracking blowup.
const BUILT_IN_PATTERNS: Record<string, RegExp> = {
  github_pull: /github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/,
  github_issue: /github\.com\/[^/\s]+\/[^/\s]+\/issues\/(\d+)/,
  radar: /r(?:dar|adar):\/\/(\d+)/,
};

function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

// Glob-style rule pattern ("linear.app/*/issue/{identifier}") to a linear regex.
// Escape literals first, then substitute `*` and `{name}` placeholders so no
// user-controlled quantifier or alternation reaches the compiled pattern.
function globPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const withWildcards = escaped.replace(/\*/g, "[^/\\s]+");
  const withCapture = withWildcards.replace(/\\\{(\w+)\\\}/g, "([^/\\s]+)");
  return new RegExp(withCapture);
}

function matchRule(text: string, rule: TitlePolicyRule): { readonly value: string } | null {
  if (rule.when.initialCommand !== undefined) {
    const firstUserMessage = text.match(/(?:^|\n)USER:\n([^\n]*)/i)?.[1]?.trim();
    return firstUserMessage?.split(/\s+/)[0] === rule.when.initialCommand
      ? { value: rule.when.initialCommand }
      : null;
  }
  if (rule.when.urlKind !== undefined) {
    const pattern = BUILT_IN_PATTERNS[rule.when.urlKind];
    if (!pattern) return null;
    const value = text.match(pattern)?.[1];
    return value !== undefined ? { value } : null;
  }
  if (rule.when.urlMatches !== undefined) {
    // A malformed rule pattern (no `*`/`{name}` placeholder) yields no
    // capture group; treat that as a non-match rather than an unsafe read.
    const value = text.match(globPatternToRegExp(rule.when.urlMatches))?.[1];
    return value !== undefined ? { value } : null;
  }
  return null;
}

/**
 * Scan `text` for the highest-priority matching rule and build its protected
 * prefix. Ties in priority resolve by rule order (earlier wins), matching how
 * policy authors read the rules list top to bottom. Returns null when no rule
 * matches or the text has no reference at all.
 */
export function resolveProtectedPrefix(
  text: string,
  rules: ReadonlyArray<TitlePolicyRule>,
): { readonly prefix: string; readonly ruleName: string } | null {
  let best: {
    readonly prefix: string;
    readonly ruleName: string;
    readonly priority: number;
  } | null = null;

  // Iterating in array order and only replacing on strictly-greater priority
  // means a tie keeps whichever matching rule appears first in `rules`.
  for (const rule of rules) {
    const matched = matchRule(text, rule);
    if (!matched) continue;
    const prefix = interpolate(rule.prefix, { number: matched.value, identifier: matched.value });
    if (best === null || rule.priority > best.priority) {
      best = { prefix, ruleName: rule.name, priority: rule.priority };
    }
  }

  return best ? { prefix: best.prefix, ruleName: best.ruleName } : null;
}

/** Resolve the highest-priority matching rule, including deterministic actions. */
export function resolveTitlePolicyRule(
  text: string,
  rules: ReadonlyArray<TitlePolicyRule>,
): { readonly rule: TitlePolicyRule; readonly prefix: string; readonly ruleName: string } | null {
  let best: {
    readonly rule: TitlePolicyRule;
    readonly prefix: string;
    readonly ruleName: string;
    readonly priority: number;
  } | null = null;
  for (const rule of rules) {
    const matched = matchRule(text, rule);
    if (!matched) continue;
    const prefix = interpolate(rule.prefix, { number: matched.value, identifier: matched.value });
    if (best === null || rule.priority > best.priority) {
      best = { rule, prefix, ruleName: rule.name, priority: rule.priority };
    }
  }
  return best;
}
