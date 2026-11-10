import type { OrchestrationV2ProjectedTurnItem, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

const FILE_NAME_MAX_LENGTH = 80;

/**
 * `<title>.md` for a downloaded export: lowercase, dash-separated, safe on
 * every filesystem. An untitled or symbol-only title falls back to the id.
 */
export function threadExportFileName(title: string, threadId: ThreadId): string {
  const segment = title
    .toLowerCase()
    .replace(/[`'".,!?()[\]{}]+/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, FILE_NAME_MAX_LENGTH)
    .replace(/-+$/g, "");
  const fallback = `thread-${threadId.replace(/[^a-zA-Z0-9]/g, "").slice(-8) || "export"}`;
  return `${segment.length > 0 ? segment : fallback}.md`;
}

/** `2026-10-19 10:00 UTC`: readable, and the same wherever the file is opened. */
function exportTime(at: DateTime.DateTime): string {
  const iso = DateTime.formatIso(at);
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** T3 context links (pasted images, mentions) only resolve inside T3, so keep just their names. */
function withoutContextLinks(text: string): string {
  return text.replace(
    /(!?)\[([^\]]*)\]\(t3-context:\/\/[^)\s]*\)/g,
    (_, image: string, name: string) => (image ? `[${name}]` : name),
  );
}

interface Section {
  readonly role: "User" | "Assistant" | "Plan";
  readonly at: string;
  readonly body: string;
}

function messageBody(text: string, attachments: ReadonlyArray<string>): string | null {
  if (text.trim().length === 0 && attachments.length === 0) return null;
  const lines = [withoutContextLinks(text.trim())];
  if (attachments.length > 0) lines.push(`Attachments: ${attachments.join(", ")}`);
  return lines.join("\n\n");
}

function sectionFor(row: OrchestrationV2ProjectedTurnItem): Section | null {
  const item = row.item;
  const at = exportTime(item.startedAt ?? item.updatedAt);
  switch (item.type) {
    case "user_message": {
      const body = messageBody(
        item.text,
        item.attachments.map((attachment) => attachment.name),
      );
      return body === null ? null : { role: "User", at, body };
    }
    case "assistant_message": {
      const body = messageBody(
        item.text,
        (item.attachments ?? []).map((attachment) => attachment.name),
      );
      return body === null ? null : { role: "Assistant", at, body };
    }
    case "proposed_plan":
      return item.markdown.trim().length === 0
        ? null
        : { role: "Plan", at, body: item.markdown.trim() };
    default:
      return null;
  }
}

/**
 * The conversation of one thread as Markdown. Only user messages, assistant
 * messages, and proposed plans are written; tool activity, reasoning, and
 * diffs are left out.
 */
export function renderThreadMarkdown(input: {
  readonly title: string;
  readonly branch: string | null;
  readonly exportedAt: DateTime.Utc;
  readonly rows: ReadonlyArray<OrchestrationV2ProjectedTurnItem>;
}): string {
  const meta = [
    ...(input.branch === null ? [] : [`- Branch: ${input.branch}`]),
    `- Exported: ${exportTime(input.exportedAt)}`,
  ];
  // An agent often answers in several messages; they read as one reply under one heading.
  const sections: string[] = [];
  let previousRole: Section["role"] | null = null;
  for (const row of input.rows) {
    const section = sectionFor(row);
    if (section === null) continue;
    if (section.role === "Assistant" && previousRole === "Assistant") {
      sections.push(section.body);
    } else {
      sections.push(`## ${section.role} · ${section.at}\n\n${section.body}`);
    }
    previousRole = section.role;
  }
  return [
    `# ${input.title}`,
    meta.join("\n"),
    "---",
    ...(sections.length === 0 ? ["_This thread has no messages._"] : sections),
  ]
    .join("\n\n")
    .concat("\n");
}
