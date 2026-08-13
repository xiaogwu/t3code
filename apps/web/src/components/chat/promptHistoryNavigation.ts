/** -1 means no active history-recall session; 0 is the newest entry. */
export function resolvePromptHistoryStep(input: {
  entries: ReadonlyArray<{ text: string }>;
  index: number;
  direction: "older" | "newer";
  prompt: string;
}): { index: number; text: string } | null {
  const { entries, index, direction, prompt } = input;
  if (direction === "older") {
    if (index === -1) {
      if (prompt.trim().length > 0 || entries.length === 0) return null;
      return { index: 0, text: entries[0]!.text };
    }
    const nextIndex = Math.min(index + 1, entries.length - 1);
    const next = entries[nextIndex];
    return next ? { index: nextIndex, text: next.text } : null;
  }

  if (index === -1) return null;
  if (index === 0) return { index: -1, text: "" };
  const next = entries[index - 1];
  return next ? { index: index - 1, text: next.text } : null;
}
