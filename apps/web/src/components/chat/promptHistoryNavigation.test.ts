import { describe, expect, it } from "vite-plus/test";

import { resolvePromptHistoryStep } from "./promptHistoryNavigation";

const entries = [{ text: "newest" }, { text: "older" }, { text: "oldest" }];

describe("resolvePromptHistoryStep", () => {
  it("starts an older walk from an empty composer", () => {
    expect(
      resolvePromptHistoryStep({ entries, index: -1, direction: "older", prompt: "" }),
    ).toEqual({
      index: 0,
      text: "newest",
    });
  });

  it("walks older and stays on the oldest entry", () => {
    expect(
      resolvePromptHistoryStep({ entries, index: 0, direction: "older", prompt: "newest" }),
    ).toEqual({
      index: 1,
      text: "older",
    });
    expect(
      resolvePromptHistoryStep({ entries, index: 2, direction: "older", prompt: "oldest" }),
    ).toEqual({
      index: 2,
      text: "oldest",
    });
  });

  it("walks newer and clears after the newest entry", () => {
    expect(
      resolvePromptHistoryStep({ entries, index: 2, direction: "newer", prompt: "oldest" }),
    ).toEqual({
      index: 1,
      text: "older",
    });
    expect(
      resolvePromptHistoryStep({ entries, index: 0, direction: "newer", prompt: "newest" }),
    ).toEqual({
      index: -1,
      text: "",
    });
  });

  it("leaves ordinary caret movement unhandled", () => {
    expect(
      resolvePromptHistoryStep({ entries, index: -1, direction: "older", prompt: "draft" }),
    ).toBeNull();
    expect(
      resolvePromptHistoryStep({ entries: [], index: -1, direction: "older", prompt: "" }),
    ).toBeNull();
    expect(
      resolvePromptHistoryStep({ entries, index: -1, direction: "newer", prompt: "" }),
    ).toBeNull();
  });

  it("treats whitespace-only prompts as empty", () => {
    expect(
      resolvePromptHistoryStep({ entries, index: -1, direction: "older", prompt: "  \n " }),
    ).toEqual({
      index: 0,
      text: "newest",
    });
  });
});
