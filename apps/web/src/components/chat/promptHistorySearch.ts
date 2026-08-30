function normalizePromptHistorySearchText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function searchPromptHistoryEntries<T extends { text: string }>(
  entries: ReadonlyArray<T>,
  query: string,
): T[] {
  const normalizedQuery = normalizePromptHistorySearchText(query);
  if (!normalizedQuery) return [...entries];
  return entries.filter((entry) =>
    normalizePromptHistorySearchText(entry.text).includes(normalizedQuery),
  );
}
