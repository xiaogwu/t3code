import { afterEach, describe, expect, it, vi } from "vite-plus/test";

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

  it("groups each speaker heading and its content into a message section", () => {
    const html = buildThreadExportHtml({
      title: "t",
      markdown: [
        "# t",
        "- Exported: 2026-11-10T20:24:59.243Z",
        "---",
        "## User · 2026-10-16T01:01:30.019Z",
        "Hi",
        "## Assistant · 2026-10-16T01:01:51.035Z",
        "## Notes\n\nOne",
        "## Assistant · 2026-10-16T01:02:02.990Z",
        "Two",
      ].join("\n\n"),
    });

    expect(html).toContain('<ul class="meta">');
    expect(html).not.toContain("2026-11-10T20:24:59.243Z</li>");
    expect(html).not.toContain("<hr>");
    expect(html).toMatch(
      /<section class="message user"><header>.*?<time datetime="2026-10-16T01:01:30.019Z">.*?<p>Hi<\/p>\s*<\/section>/s,
    );
    expect(html).toMatch(
      /<section class="message assistant">.*?<h2>Notes<\/h2>\s*<p>One<\/p>\s*<\/section>/s,
    );
    expect(html).toContain('<section class="message assistant continued">');
  });
});

describe("thread sharing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const input = { title: "T", fileName: "t.md", markdown: "# T" };

  it("shares a Markdown file", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share });
    const { shareThreadFile } = await import("./threadExport");

    expect(await shareThreadFile(input)).toBe("shared");
    const shared = share.mock.calls[0]![0] as { files: File[]; title: string };
    expect(shared.title).toBe("T");
    expect(shared.files[0]!.name).toBe("t.md");
    expect(shared.files[0]!.type).toBe("text/markdown");
  });

  it.each([
    ["AbortError", "cancelled"],
    ["NotAllowedError", "activation-lost"],
  ] as const)("maps %s to %s", async (name, outcome) => {
    vi.stubGlobal("navigator", { share: vi.fn().mockRejectedValue(new DOMException("x", name)) });
    const { shareThreadFile } = await import("./threadExport");

    expect(await shareThreadFile(input)).toBe(outcome);
  });

  it("rethrows other errors", async () => {
    vi.stubGlobal("navigator", { share: vi.fn().mockRejectedValue(new Error("boom")) });
    const { shareThreadFile } = await import("./threadExport");

    await expect(shareThreadFile(input)).rejects.toThrow("boom");
  });

  it("cannot share without canShare, or when it throws", async () => {
    vi.stubGlobal("navigator", {});
    expect((await import("./threadExport")).canShareThreadFile()).toBe(false);

    vi.resetModules();
    vi.stubGlobal("navigator", {
      canShare: () => {
        throw new Error("nope");
      },
    });
    expect((await import("./threadExport")).canShareThreadFile()).toBe(false);
  });

  it("can share when the browser accepts files", async () => {
    vi.stubGlobal("navigator", { canShare: () => true });
    expect((await import("./threadExport")).canShareThreadFile()).toBe(true);
  });
});
