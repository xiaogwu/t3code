import { describe, expect, it } from "vite-plus/test";

import { buildThreadExportHtml } from "./threadExport";

describe("buildThreadExportHtml", () => {
  it("escapes the title in the document head", () => {
    const html = buildThreadExportHtml({ title: 'A <b>"quoted"</b> & more', markdown: "# x" });

    expect(html).toContain("<title>A &lt;b&gt;&quot;quoted&quot;&lt;/b&gt; &amp; more</title>");
    expect(html.startsWith("<!doctype html>")).toBe(true);
  });

  it("drops scripts and event handlers that arrive as raw HTML", () => {
    const html = buildThreadExportHtml({
      title: "t",
      markdown: 'before\n\n<script>alert(1)</script>\n\n<img src="x" onerror="alert(2)">\n\nafter',
    });

    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).toContain("after");
  });

  it("renders GFM tables and fenced code", () => {
    const html = buildThreadExportHtml({
      title: "t",
      markdown: "| a | b |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```",
    });

    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
    expect(html).toContain("<pre>");
    expect(html).toContain("const x = 1;");
  });
});
