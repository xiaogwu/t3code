import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  ComposerPromptHistorySearch,
  scrollPromptHistoryEntryIntoView,
} from "./ComposerPromptHistorySearch";

describe("ComposerPromptHistorySearch", () => {
  it("renders recorded prompts in an attached searchable composer drawer", () => {
    const markup = renderToStaticMarkup(
      <ComposerPromptHistorySearch
        entries={[
          {
            text: "Run the focused tests",
            createdAt: "2026-08-28T12:00:00.000Z",
          },
        ]}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

    expect(markup).toContain('data-composer-prompt-history-search="true"');
    expect(markup).toContain('data-composer-banner-surface="attached"');
    expect(markup).toContain("bg-(--chat-composer-attached-surface)!");
    expect(markup).toContain('aria-label="Search prompt history"');
    expect(markup).toContain("Run the focused tests");
    expect(markup).toContain("Ctrl+R");
  });

  it("explains when no prompt history has been recorded", () => {
    const markup = renderToStaticMarkup(
      <ComposerPromptHistorySearch entries={[]} onSelect={() => {}} onClose={() => {}} />,
    );

    expect(markup).toContain("No prompts have been recorded yet.");
  });

  it("keeps the keyboard-highlighted prompt visible", () => {
    const scrollIntoView = vi.fn();
    const entry = { scrollIntoView } as unknown as HTMLElement;

    scrollPromptHistoryEntryIntoView(entry);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });
});
