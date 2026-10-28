import { describe, expect, it } from "vite-plus/test";

import { shouldHideCursorForKey } from "./hideCursorWhileTyping";

const key = (key: string, mods: { metaKey?: boolean; ctrlKey?: boolean } = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  ...mods,
});

describe("shouldHideCursorForKey", () => {
  it.each(["a", "A", " ", "é", "Backspace", "Delete", "Enter", "Tab"])("hides for %s", (k) => {
    expect(shouldHideCursorForKey(key(k))).toBe(true);
  });

  it.each(["ArrowUp", "Escape", "Shift", "Meta", "F5"])("keeps the cursor for %s", (k) => {
    expect(shouldHideCursorForKey(key(k))).toBe(false);
  });

  it("keeps the cursor for command chords", () => {
    expect(shouldHideCursorForKey(key("k", { metaKey: true }))).toBe(false);
    expect(shouldHideCursorForKey(key("c", { ctrlKey: true }))).toBe(false);
  });
});
