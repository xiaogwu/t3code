import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { downloadTextFile } from "../proposedPlan";
import { orchestrationEnvironment } from "../state/orchestration";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadExportHtml, printHtmlDocument } from "../threadExport";

export type ThreadExportFormat = "markdown" | "pdf";

function failureToast(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

/**
 * Exports a whole thread (the server reads every message, not the loaded
 * window) as Markdown or PDF. Markdown downloads as a file. PDF saves through
 * the desktop shell when it can, and otherwise opens the browser print dialog.
 */
export function useThreadExport() {
  const exportThreadCommand = useAtomCommand(orchestrationEnvironment.exportThread, {
    reportFailure: false,
  });

  return useCallback(
    async (threadRef: ScopedThreadRef, format: ThreadExportFormat) => {
      const result = await exportThreadCommand({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          failureToast("Could not export thread", squashAtomCommandFailure(result));
        }
        return;
      }
      const { title, fileName, markdown } = result.value;
      if (format === "markdown") {
        downloadTextFile(fileName, markdown);
        return;
      }
      const html = buildThreadExportHtml({ title, markdown });
      const bridge = window.desktopBridge;
      if (!bridge?.exportThreadPdf) {
        printHtmlDocument(html);
        return;
      }
      try {
        const saved = await bridge.exportThreadPdf({
          html,
          defaultFileName: fileName.replace(/\.md$/, ".pdf"),
        });
        if (saved.status === "saved") {
          toastManager.add({ type: "success", title: "Saved PDF", description: saved.path });
        }
      } catch (error) {
        failureToast("Could not save PDF", error);
      }
    },
    [exportThreadCommand],
  );
}
