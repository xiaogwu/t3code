/**
 * Guardrail and composition logic for the auto-title policy: decides
 * *whether* to re-evaluate a thread's title after a completed turn, and
 * assembles the final "{protectedPrefix} {description}" string within the
 * policy's character budget.
 *
 * @module titlePolicyResolver
 */

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
  const availableForDescription = Math.max(0, input.maxCharacters - prefix.length);
  const truncatedDescription =
    description.length <= availableForDescription
      ? description
      : `${description.slice(0, Math.max(0, availableForDescription - 1)).trimEnd()}…`;
  return `${prefix}${truncatedDescription}`.trim();
}

/**
 * Expand the small, deliberately fixed set of date variables allowed in policy
 * templates, in the host's local timezone.
 *
 * `at` is the moment the title should describe, and callers with a thread in
 * hand pass that thread's `createdAt` rather than letting this default to now.
 * The policy re-evaluates every `refreshEveryTurns` turns and re-expands the
 * template each time, so anchoring to thread start is what keeps a title still:
 * `{now:HH:mm}` would otherwise tick forward mid-thread, and
 * `{today:MM/DD/YYYY}` would flip on a thread that crosses midnight.
 */
export function expandTitleTemplate(template: string, at?: Date | number | string): string {
  const instant = typeof at === "string" ? Date.parse(at) : at;
  // A malformed timestamp must not become "Invalid Date" in a title.
  const resolved = typeof instant === "number" && Number.isNaN(instant) ? undefined : instant;
  const date = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(resolved);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(resolved);
  return template.replaceAll("{today:MM/DD/YYYY}", date).replaceAll("{now:HH:mm}", time).trim();
}

export function shouldEvaluateNow(input: {
  readonly titleProvenance: "automatic" | "manual";
  readonly preserveManualTitles: boolean;
  readonly protectedPrefixChanged: boolean;
  readonly turnsSincePolicyEval: number;
  readonly refreshEveryTurns: number;
  // A turn still in flight has no final description to title with; the
  // reactor (Task 11) is expected to only reach this gate at turn end, but
  // the check lives here too since renaming mid-stream is a hard guardrail.
  readonly isTurnRunning: boolean;
}): boolean {
  if (input.isTurnRunning) {
    return false;
  }
  if (input.titleProvenance === "manual" && input.preserveManualTitles) {
    return false;
  }
  if (input.protectedPrefixChanged) {
    return true;
  }
  return input.turnsSincePolicyEval >= input.refreshEveryTurns;
}
