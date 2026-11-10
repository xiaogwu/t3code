import { expect, it } from "@effect/vitest";
import { ThreadId, type OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { renderThreadMarkdown, threadExportFileName } from "./threadExportMarkdown.ts";

const threadId = ThreadId.make("thread:export:abcdef123456");
const exportedAt = DateTime.makeUnsafe("2026-10-19T12:00:00.000Z");

const row = (position: number, item: Record<string, unknown>) =>
  ({
    position,
    sourceThreadId: threadId,
    sourceItemId: `item:${position}`,
    visibility: "visible",
    item: {
      startedAt: null,
      updatedAt: DateTime.makeUnsafe(`2026-10-19T10:0${position}:00.000Z`),
      ...item,
    },
  }) as unknown as OrchestrationV2ProjectedTurnItem;

it("renders messages and plans in order, one heading per assistant reply, without T3 links", () => {
  const markdown = renderThreadMarkdown({
    title: "Fix the sidebar",
    branch: "feature/sidebar",
    exportedAt,
    rows: [
      row(0, {
        type: "user_message",
        text: "Please fix it",
        attachments: [
          { type: "image", name: "shot.png" },
          { type: "file", name: "notes.pdf" },
        ],
      }),
      row(1, { type: "assistant_message", text: "On it.\n\n## Not a section" }),
      row(2, { type: "command_execution", text: "ignored" }),
      row(3, { type: "assistant_message", text: "Done." }),
      row(4, { type: "proposed_plan", markdown: "# Plan\n- step" }),
      row(5, {
        type: "user_message",
        text: "See ![shot.png](t3-context://v1/image/image_1) and [notes](t3-context://v1/file/f_2)",
        attachments: [],
      }),
    ],
  });

  expect(markdown).toBe(
    [
      "# Fix the sidebar",
      "- Branch: feature/sidebar\n- Exported: 2026-10-19 12:00 UTC",
      "---",
      "## User · 2026-10-19 10:00 UTC\n\nPlease fix it\n\nAttachments: shot.png, notes.pdf",
      "## Assistant · 2026-10-19 10:01 UTC\n\nOn it.\n\n## Not a section",
      "Done.",
      "## Plan · 2026-10-19 10:04 UTC\n\n# Plan\n- step",
      "## User · 2026-10-19 10:05 UTC\n\nSee [shot.png] and notes",
    ].join("\n\n") + "\n",
  );
});

it("omits the branch line when the thread has none and says so when empty", () => {
  const markdown = renderThreadMarkdown({
    title: "Empty",
    branch: null,
    exportedAt,
    rows: [row(0, { type: "assistant_message", text: "   " })],
  });

  expect(markdown).not.toContain("Branch");
  expect(markdown).toContain("_This thread has no messages._");
});

it("sanitizes titles into file names and falls back to the thread id", () => {
  expect(threadExportFileName("Fix: the Sidebar's  layout!", threadId)).toBe(
    "fix-the-sidebars-layout.md",
  );
  expect(threadExportFileName("../../etc/passwd", threadId)).toBe("etc-passwd.md");
  expect(threadExportFileName("日本語 ✨", threadId)).toBe("thread-ef123456.md");
  expect(threadExportFileName("a".repeat(200), threadId)).toBe(`${"a".repeat(80)}.md`);
});
