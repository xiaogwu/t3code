import type { ServerProviderSkill } from "@t3tools/contracts";

export type InlineSkill = Pick<ServerProviderSkill, "name" | "displayName">;

/** Initialisms that read wrong title-cased ("Pr Review"); keyed by lowercase. */
const SKILL_NAME_INITIALISMS: Record<string, string> = {
  ai: "AI",
  api: "API",
  aws: "AWS",
  ci: "CI",
  cli: "CLI",
  css: "CSS",
  html: "HTML",
  ios: "iOS",
  json: "JSON",
  mcp: "MCP",
  pdf: "PDF",
  pr: "PR",
  qa: "QA",
  sdk: "SDK",
  sql: "SQL",
  ui: "UI",
  url: "URL",
  ux: "UX",
};

function titleCaseWords(value: string): string {
  const words: string[] = [];
  for (const segment of value.split(/[\s:_-]+/)) {
    if (segment.length === 0) continue;
    words.push(
      SKILL_NAME_INITIALISMS[segment.toLowerCase()] ??
        segment.charAt(0).toUpperCase() + segment.slice(1),
    );
  }
  return words.join(" ");
}

export function formatProviderSkillDisplayName(
  skill: Pick<ServerProviderSkill, "name" | "displayName">,
): string {
  const displayName = skill.displayName?.trim();
  if (displayName) {
    return displayName;
  }
  return titleCaseWords(skill.name);
}

const SKILL_TOKEN_REGEX =
  /(^|\s)\p{Sc}(?![0-9][0-9_]*(?:[kKmMbBtT]|[eE][0-9]+)?(?:\s|$))(?=[a-zA-Z0-9:_-]*[a-zA-Z])([a-zA-Z0-9][a-zA-Z0-9:_-]*)(?=\s|$)/gu;

export function* matchInlineSkills<Skill extends InlineSkill>(
  text: string,
  skills: readonly Skill[],
) {
  const byName = new Map<string, Skill | undefined>();
  for (const match of text.matchAll(SKILL_TOKEN_REGEX)) {
    const name = match[2] ?? "";
    if (!byName.has(name)) {
      byName.set(
        name,
        skills.find((candidate) => candidate.name === name),
      );
    }
    const skill = byName.get(name);
    if (!skill) continue;
    const start = match.index + (match[1]?.length ?? 0);
    yield { start, end: match.index + match[0].length, skill, rawText: `$${name}` };
  }
}
