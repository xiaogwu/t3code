import { chatMarkdownToHast } from "@t3tools/shared/markdownPipeline";
import { toHtml } from "hast-util-to-html";

const PRINT_STYLES = `
@page { margin: 16mm; }
html { color-scheme: light; }
body { margin: 0; color: #1a1a1a; background: #fff; font: 11pt/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
h1 { font-size: 20pt; margin: 0 0 8pt; }
h2 { font-size: 13pt; margin: 18pt 0 6pt; break-after: avoid; }
h3, h4 { break-after: avoid; }
hr { border: 0; border-top: 1px solid #ccc; margin: 12pt 0; }
ul { padding-left: 18pt; }
a { color: #0b5cad; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 9.5pt; }
code { background: #f1f1f1; border-radius: 3px; padding: 0 3px; }
pre { background: #f6f6f6; border: 1px solid #e0e0e0; border-radius: 4px; padding: 8pt; white-space: pre-wrap; overflow-wrap: anywhere; break-inside: avoid; }
pre code { background: none; padding: 0; }
blockquote { margin: 8pt 0; padding-left: 10pt; border-left: 3px solid #ccc; color: #444; }
table { border-collapse: collapse; margin: 8pt 0; }
th, td { border: 1px solid #bbb; padding: 4pt 8pt; text-align: left; }
img { max-width: 100%; }
`;

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * A standalone, script-free document for printing. The Markdown already opens
 * with the thread title, so the title only names the document here. Raw HTML
 * in messages passes through the chat sanitizer, and the CSP is a second wall.
 */
export function buildThreadExportHtml(input: {
  readonly title: string;
  readonly markdown: string;
}): string {
  const body = toHtml(chatMarkdownToHast(input.markdown));
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`,
    `<title>${escapeHtml(input.title)}</title>`,
    `<style>${PRINT_STYLES}</style>`,
    `</head><body>${body}</body></html>`,
  ].join("");
}

let printFrame: HTMLIFrameElement | null = null;

/** Opens the browser print dialog for a document; the user picks "Save as PDF". */
export function printHtmlDocument(html: string): void {
  printFrame?.remove();
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  const release = () => {
    frame.remove();
    if (printFrame === frame) printFrame = null;
  };
  frame.addEventListener(
    "load",
    () => {
      const frameWindow = frame.contentWindow;
      if (!frameWindow) {
        release();
        return;
      }
      frameWindow.addEventListener("afterprint", release, { once: true });
      frameWindow.focus();
      frameWindow.print();
    },
    { once: true },
  );
  frame.srcdoc = html;
  document.body.append(frame);
  printFrame = frame;
}

let canShareFiles: boolean | undefined;

/** Whether this browser can hand a Markdown file to the system share sheet. Computed once. */
export function canShareThreadFile(): boolean {
  canShareFiles ??= (() => {
    try {
      return (
        typeof navigator !== "undefined" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [new File([""], "thread.md", { type: "text/markdown" })] })
      );
    } catch {
      return false;
    }
  })();
  return canShareFiles;
}

/**
 * Shares a thread's Markdown file through the system share sheet. The browser
 * only allows this inside a user gesture, so "activation-lost" means the caller
 * should ask for a fresh click and try again.
 */
export async function shareThreadFile(input: {
  readonly title: string;
  readonly fileName: string;
  readonly markdown: string;
}): Promise<"shared" | "cancelled" | "activation-lost"> {
  const file = new File([input.markdown], input.fileName, { type: "text/markdown" });
  try {
    await navigator.share({ files: [file], title: input.title });
    return "shared";
  } catch (error) {
    if (error instanceof DOMException || error instanceof Error) {
      if (error.name === "AbortError") return "cancelled";
      if (error.name === "NotAllowedError") return "activation-lost";
    }
    throw error;
  }
}
