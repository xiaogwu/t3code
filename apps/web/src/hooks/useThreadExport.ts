import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { downloadTextFile } from "../proposedPlan";
import { orchestrationEnvironment } from "../state/orchestration";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadExportHtml, printHtmlDocument, shareThreadFile } from "../threadExport";

export type ThreadExportFormat = "markdown" | "html" | "pdf" | "share";

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
 * window) as Markdown, HTML, or PDF. Markdown and HTML download as files. PDF saves through
 * the desktop shell when it can, and otherwise opens the browser print dialog.
 * Share hands the Markdown file to the system share sheet.
 */
export function useThreadExport() {
  const exportThreadCommand = useAtomCommand(orchestrationEnvironment.exportThread, {
    reportFailure: false,
  });

  return async (threadRef: ScopedThreadRef, format: ThreadExportFormat) => {
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
    if (format === "share") {
      const payload = { title, fileName, markdown };
      try {
        const outcome = await shareThreadFile(payload);
        if (outcome !== "activation-lost") return;
        // The export request outlasted the browser's user-activation window;
        // a click on the toast button is a fresh gesture.
        const id = toastManager.add({
          type: "info",
          title: "Thread ready to share",
          actionProps: {
            children: "Share",
            onClick: () => {
              toastManager.close(id);
              void shareThreadFile(payload).catch((error) =>
                failureToast("Could not share thread", error),
              );
            },
          },
        });
      } catch (error) {
        failureToast("Could not share thread", error);
      }
      return;
    }
    const html = buildThreadExportHtml({ title, markdown });
    if (format === "html") {
      downloadTextFile(fileName.replace(/\.md$/, ".html"), html, "text/html;charset=utf-8");
      return;
    }
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
  };
}
