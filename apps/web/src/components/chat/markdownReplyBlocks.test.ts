import { describe, expect, it } from "vite-plus/test";

import { REPLY_BLOCK_PROPERTY, rehypeMarkReplyBlocks } from "./markdownReplyBlocks";

type Node = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
};

const text = (value: string): Node => ({ type: "text", value });
const el = (tagName: string, ...children: Node[]): Node => ({
  type: "element",
  tagName,
  properties: {},
  children,
});

function replyBlocks(...children: Node[]): string[] {
  const tree: Node = { type: "root", children };
  rehypeMarkReplyBlocks()(tree);
  const marked: string[] = [];
  const visit = (node: Node) => {
    if (node.properties?.[REPLY_BLOCK_PROPERTY] !== undefined) {
      const plain = (n: Node): string => n.value ?? (n.children ?? []).map(plain).join("");
      marked.push(`${node.tagName}:${plain(node)}`);
    }
    node.children?.forEach(visit);
  };
  visit(tree);
  return marked;
}

describe("rehypeMarkReplyBlocks", () => {
  it("offers top-level paragraphs, headings, code, and tables, but not image-only paragraphs", () => {
    expect(
      replyBlocks(
        el("h2", text("Summary")),
        el("p", text("First point.")),
        el("p", el("img")),
        el("pre", el("code", text("vp test run\n"))),
        el("table", el("tr", el("td", text("cell")))),
        el("hr"),
      ),
    ).toEqual(["h2:Summary", "p:First point.", "pre:vp test run\n", "table:cell"]);
  });

  it("offers each tight list item, and the paragraphs and sub-items of a loose one", () => {
    expect(
      replyBlocks(
        el("ul", text("\n"), el("li", text("Tight item")), text("\n")),
        el(
          "ol",
          el("li", el("p", text("Loose paragraph")), el("ul", el("li", text("Nested item")))),
        ),
      ),
    ).toEqual(["li:Tight item", "p:Loose paragraph", "li:Nested item"]);
  });

  it("offers the paragraphs inside a quote, not the quote", () => {
    expect(
      replyBlocks(el("blockquote", el("p", text("Quoted one")), el("p", text("Quoted two")))),
    ).toEqual(["p:Quoted one", "p:Quoted two"]);
  });
});
