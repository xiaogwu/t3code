type HastNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/** Rendered as `data-reply-block` on each block an assistant message offers a reply for. */
export const REPLY_BLOCK_PROPERTY = "dataReplyBlock";

const QUOTABLE_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "table"]);
const BLOCK_TAGS = new Set([...QUOTABLE_TAGS, "ul", "ol", "blockquote", "div", "details", "hr"]);

function hasText(node: HastNode): boolean {
  return node.type === "text"
    ? (node.value ?? "").trim().length > 0
    : (node.children ?? []).some(hasText);
}

function markReplyBlocks(children: ReadonlyArray<HastNode>): void {
  for (const node of children) {
    if (node.type !== "element" || node.tagName === undefined) continue;
    if (QUOTABLE_TAGS.has(node.tagName)) {
      // A paragraph holding only an image has nothing to quote.
      if (hasText(node)) node.properties = { ...node.properties, [REPLY_BLOCK_PROPERTY]: "" };
    } else if (node.tagName === "ul" || node.tagName === "ol") {
      for (const item of node.children ?? []) {
        if (item.type !== "element" || item.tagName !== "li") continue;
        // An item holding paragraphs or a nested list offers each of those instead,
        // so every reply button sits inline at the end of the text it quotes.
        const holdsBlocks = (item.children ?? []).some(
          (child) => child.type === "element" && BLOCK_TAGS.has(child.tagName ?? ""),
        );
        if (holdsBlocks) markReplyBlocks(item.children ?? []);
        else if (hasText(item)) {
          item.properties = { ...item.properties, [REPLY_BLOCK_PROPERTY]: "" };
        }
      }
    } else if (node.tagName === "blockquote") {
      markReplyBlocks(node.children ?? []);
    }
  }
}

/**
 * Marks the blocks of an assistant response that each get an inline reply
 * button: top-level paragraphs, headings, code blocks and tables, plus list
 * items and quoted paragraphs. Runs after sanitizing, which would strip the mark.
 */
export function rehypeMarkReplyBlocks() {
  return (tree: HastNode) => markReplyBlocks(tree.children ?? []);
}
