import { describe, expect, it } from "vite-plus/test";

import {
  commandPaletteOverflowTooltip,
  isCommandPaletteTextOverflowing,
} from "./CommandPaletteResults";

describe("command palette overflow tooltips", () => {
  it("enables the tooltip only when the rendered text is truncated", () => {
    expect(isCommandPaletteTextOverflowing({ clientWidth: 120, scrollWidth: 240 })).toBe(true);
    expect(isCommandPaletteTextOverflowing({ clientWidth: 120, scrollWidth: 120 })).toBe(false);
    expect(isCommandPaletteTextOverflowing({ clientWidth: 120, scrollWidth: 80 })).toBe(false);
  });

  it("adds a native hover fallback only for truncated text", () => {
    expect(commandPaletteOverflowTooltip("The complete thread title", true)).toBe(
      "The complete thread title",
    );
    expect(commandPaletteOverflowTooltip("The complete thread title", false)).toBeUndefined();
    expect(commandPaletteOverflowTooltip(undefined, true)).toBeUndefined();
  });
});
