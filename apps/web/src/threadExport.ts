import type { Element, ElementContent, Root, RootContent } from "hast";
import { chatMarkdownToHast } from "@t3tools/shared/markdownPipeline";
import { toHtml } from "hast-util-to-html";

const PRINT_STYLES = `
@page { margin: 16mm; }
html { color-scheme: light; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
body { max-width: 760px; margin: 40px auto; padding: 0 24px; color: #1f2328; background: #fff; font: 11pt/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
@media print { body { max-width: none; margin: 0; padding: 0; } }
h1 { font-size: 20pt; line-height: 1.25; margin: 0 0 6pt; }
h2, h3, h4 { line-height: 1.3; margin: 14pt 0 4pt; break-after: avoid; }
h2 { font-size: 13pt; }
h3 { font-size: 11.5pt; }
h4 { font-size: 11pt; }
p { margin: 6pt 0; }
ul, ol { margin: 6pt 0; padding-left: 18pt; }
li + li { margin-top: 2pt; }
hr { border: 0; border-top: 1px solid #d8dee4; margin: 12pt 0; }
a { color: #0b5cad; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 9.5pt; }
code { background: #eff1f3; border-radius: 4px; padding: 1px 4px; }
pre { background: #f6f8fa; border: 1px solid #e1e4e8; border-radius: 6px; padding: 8pt 10pt; white-space: pre-wrap; overflow-wrap: anywhere; break-inside: avoid; }
pre code { background: none; padding: 0; }
blockquote { margin: 8pt 0; padding-left: 10pt; border-left: 3px solid #d0d7de; color: #57606a; }
table { border-collapse: collapse; margin: 8pt 0; }
th, td { border: 1px solid #d0d7de; padding: 4pt 8pt; text-align: left; }
th { background: #f6f8fa; }
img { max-width: 100%; }
ul.meta { display: flex; flex-wrap: wrap; gap: 4pt 16pt; list-style: none; margin: 0 0 18pt; padding: 0 0 12pt; border-bottom: 1px solid #d8dee4; color: #6e7781; font-size: 9.5pt; }
ul.meta li + li { margin-top: 0; }
.message { margin: 16pt 0; }
.message.continued { margin-top: 10pt; }
.message > header { display: flex; align-items: baseline; gap: 8pt; margin-bottom: 4pt; color: #6e7781; font-size: 9pt; break-after: avoid; }
.message > header .role { color: #1f2328; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.message.continued > header .role { display: none; }
.message.user, .message.plan { border-radius: 8px; padding: 8pt 12pt; }
.message.user { background: #f1f4f8; }
.message.plan { border: 1px solid #d0d7de; }
.message > header + * { margin-top: 0; }
.message > :last-child { margin-bottom: 0; }
`;

const SPEAKER_HEADING = /^(User|Assistant|Plan) · (\S+)$/;
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const TIMESTAMP_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : TIMESTAMP_FORMAT.format(date);
}

function textOf(node: Element): string {
  return node.children.map((child) => (child.type === "text" ? child.value : "")).join("");
}

function element(tagName: string, className: string[], children: ElementContent[]): Element {
  return {
    type: "element",
    tagName,
    properties: className.length > 0 ? { className } : {},
    children,
  };
}

/**
 * Restyles the export Markdown's structure: the "Branch / Exported" list
 * under the title becomes a muted meta line, and each "User · <iso>" heading
 * opens a message section with a readable local time.
 */
function shapeThreadDocument(root: Root): Root {
  const children: RootContent[] = [];
  let section: Element | null = null;
  let previousRole: string | null = null;
  let afterTitle = false;
  for (const node of root.children) {
    if (node.type === "element" && node.tagName === "h1") {
      afterTitle = true;
      children.push(node);
      continue;
    }
    if (afterTitle && node.type === "element") {
      afterTitle = false;
      if (node.tagName === "ul") {
        for (const item of node.children) {
          if (item.type !== "element") continue;
          for (const child of item.children) {
            if (child.type === "text")
              child.value = child.value.replace(ISO_TIMESTAMP, formatTimestamp);
          }
        }
        node.properties = { ...node.properties, className: ["meta"] };
        children.push(node);
        continue;
      }
    }
    if (section === null && node.type === "element" && node.tagName === "hr") continue;
    const speaker =
      node.type === "element" && node.tagName === "h2" ? SPEAKER_HEADING.exec(textOf(node)) : null;
    if (speaker) {
      const [, label = "", iso = ""] = speaker;
      const role = label.toLowerCase();
      const className = ["message", role, ...(role === previousRole ? ["continued"] : [])];
      section = element("section", className, [
        element(
          "header",
          [],
          [
            element("span", ["role"], [{ type: "text", value: label }]),
            {
              type: "element",
              tagName: "time",
              properties: { dateTime: iso },
              children: [{ type: "text", value: formatTimestamp(iso) }],
            },
          ],
        ),
      ]);
      previousRole = role;
      children.push(section);
      continue;
    }
    if (section !== null) {
      if (node.type !== "doctype") section.children.push(node);
    } else {
      children.push(node);
    }
  }
  return { ...root, children };
}

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
  const body = toHtml(shapeThreadDocument(chatMarkdownToHast(input.markdown)));
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
