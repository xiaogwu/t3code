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

function sectionFor(row: OrchestrationV2ProjectedTurnItem): string | null {
  const item = row.item;
  const at = DateTime.formatIso(item.startedAt ?? item.updatedAt);
  switch (item.type) {
    case "user_message": {
      const attachments = item.attachments.map((attachment) => attachment.name);
      if (item.text.trim().length === 0 && attachments.length === 0) return null;
      const lines = [`## User · ${at}`, "", item.text.trim()];
      if (attachments.length > 0) lines.push("", `Attachments: ${attachments.join(", ")}`);
      return lines.join("\n");
    }
    case "assistant_message": {
      const attachments = (item.attachments ?? []).map((attachment) => attachment.name);
      if (item.text.trim().length === 0 && attachments.length === 0) return null;
      const lines = [`## Assistant · ${at}`, "", item.text.trim()];
      if (attachments.length > 0) lines.push("", `Attachments: ${attachments.join(", ")}`);
      return lines.join("\n");
    }
    case "proposed_plan":
      return item.markdown.trim().length === 0
        ? null
        : [`## Plan · ${at}`, "", item.markdown.trim()].join("\n");
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
    `- Exported: ${DateTime.formatIso(input.exportedAt)}`,
  ];
  const sections = input.rows.flatMap((row) => {
    const section = sectionFor(row);
    return section === null ? [] : [section];
  });
  return [
    `# ${input.title}`,
    meta.join("\n"),
    "---",
    ...(sections.length === 0 ? ["_This thread has no messages._"] : sections),
  ]
    .join("\n\n")
    .concat("\n");
}
