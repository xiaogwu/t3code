import { isEditableFocused } from "./editableFocus";

const EDITING_KEYS = new Set(["Backspace", "Delete", "Enter", "Tab"]);

export function shouldHideCursorForKey(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">,
): boolean {
  if (event.metaKey || event.ctrlKey) return false;
  return [...event.key].length === 1 || EDITING_KEYS.has(event.key);
}

/** Hide the pointer while typing in an editable; real pointer activity brings it back. */
export function installHideCursorWhileTyping(target: Window): () => void {
  const root = target.document.documentElement;
  const setTyping = (typing: boolean) => {
    if (root.hasAttribute("data-typing") === typing) return;
    if (typing) root.dataset.typing = "";
    else delete root.dataset.typing;
  };
  const clear = () => setTyping(false);
  const onKeyDown = (event: KeyboardEvent) => {
    if (shouldHideCursorForKey(event) && isEditableFocused(event.target)) setTyping(true);
  };
  // Chromium fires zero-delta moves when layout shifts under a still cursor.
  const onPointerMove = (event: PointerEvent) => {
    if (event.movementX !== 0 || event.movementY !== 0) clear();
  };

  target.addEventListener("keydown", onKeyDown, true);
  target.addEventListener("pointermove", onPointerMove, true);
  target.addEventListener("pointerdown", clear, true);
  target.addEventListener("blur", clear);
  target.document.addEventListener("visibilitychange", clear);
  return () => {
    target.removeEventListener("keydown", onKeyDown, true);
    target.removeEventListener("pointermove", onPointerMove, true);
    target.removeEventListener("pointerdown", clear, true);
    target.removeEventListener("blur", clear);
    target.document.removeEventListener("visibilitychange", clear);
    clear();
  };
}
