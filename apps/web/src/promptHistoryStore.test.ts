import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { removeLocalStorageItem } from "./hooks/useLocalStorage";
import {
  MAX_HISTORY_ENTRIES,
  PROMPT_HISTORY_STORAGE_KEY,
  usePromptHistoryStore,
  writePromptHistoryStorageForTest,
} from "./promptHistoryStore";

function resetPromptHistoryStore() {
  usePromptHistoryStore.setState({ entries: [] });
  writePromptHistoryStorageForTest("");
  removeLocalStorageItem(PROMPT_HISTORY_STORAGE_KEY);
}

describe("promptHistoryStore", () => {
  beforeEach(resetPromptHistoryStore);
  afterEach(resetPromptHistoryStore);

  it("pushes newest entries first", () => {
    const store = usePromptHistoryStore.getState();
    store.pushEntry("first");
    store.pushEntry("second");
    expect(usePromptHistoryStore.getState().entries.map((entry) => entry.text)).toEqual([
      "second",
      "first",
    ]);
  });

  it("ignores empty prompts and only suppresses the newest duplicate", () => {
    const store = usePromptHistoryStore.getState();
    store.pushEntry("   ");
    store.pushEntry("first");
    store.pushEntry(" first ");
    store.pushEntry("second");
    store.pushEntry("first");
    expect(usePromptHistoryStore.getState().entries.map((entry) => entry.text)).toEqual([
      "first",
      "second",
      "first",
    ]);
  });

  it("caps history by dropping the oldest entries", () => {
    const store = usePromptHistoryStore.getState();
    for (let index = 0; index <= MAX_HISTORY_ENTRIES; index += 1) {
      store.pushEntry(`entry ${index}`);
    }
    const entries = usePromptHistoryStore.getState().entries;
    expect(entries).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(entries[0]?.text).toBe(`entry ${MAX_HISTORY_ENTRIES}`);
    expect(entries.at(-1)?.text).toBe("entry 1");
  });

  it("round trips through persisted storage", () => {
    writePromptHistoryStorageForTest(
      JSON.stringify({
        state: { entries: [{ text: "saved", createdAt: "2026-08-12T00:00:00.000Z" }] },
      }),
    );
    expect(usePromptHistoryStore.getState().entries).toEqual([
      { text: "saved", createdAt: "2026-08-12T00:00:00.000Z" },
    ]);
  });

  it("treats malformed persisted data as empty", () => {
    writePromptHistoryStorageForTest("not json");
    expect(usePromptHistoryStore.getState().entries).toEqual([]);
  });

  it("keeps history when persistence rejects a write", () => {
    expect(() => usePromptHistoryStore.getState().pushEntry("keep this")).not.toThrow();
  });
});
