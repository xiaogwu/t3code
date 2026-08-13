import * as Schema from "effect/Schema";
import { create } from "zustand";

import { createMemoryStorage, type StateStorage } from "./lib/storage";

export const PROMPT_HISTORY_STORAGE_KEY = "t3code:prompt-history:v1";
export const MAX_HISTORY_ENTRIES = 50;

const HistoryEntrySchema = Schema.Struct({
  text: Schema.String,
  createdAt: Schema.String,
});
export type PromptHistoryEntry = typeof HistoryEntrySchema.Type;

const PersistedPromptHistoryState = Schema.Struct({
  entries: Schema.Array(HistoryEntrySchema),
});
type PersistedPromptHistoryState = typeof PersistedPromptHistoryState.Type;

const decodePersistedPromptHistoryState = Schema.decodeUnknownSync(PersistedPromptHistoryState);

// Accessing `localStorage` can itself throw when browser storage is blocked.
function resolveBaseStorage(): StateStorage {
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage;
    }
  } catch {
    // Fall through to the in-memory store.
  }
  return createMemoryStorage();
}

const baseHistoryStorage = resolveBaseStorage();

function persistEntries(entries: ReadonlyArray<PromptHistoryEntry>): void {
  try {
    baseHistoryStorage.setItem(PROMPT_HISTORY_STORAGE_KEY, JSON.stringify({ state: { entries } }));
  } catch (error) {
    console.error("[PROMPT-HISTORY] Could not persist history (storage quota?).", error);
  }
}

function readPersistedEntries(): ReadonlyArray<PromptHistoryEntry> | null {
  try {
    const raw = baseHistoryStorage.getItem(PROMPT_HISTORY_STORAGE_KEY);
    if (typeof raw !== "string" || raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    const state = (parsed as { state?: unknown } | null)?.state;
    if (!state) return null;
    return decodePersistedPromptHistoryState(state).entries;
  } catch {
    return null;
  }
}

interface PromptHistoryStoreState {
  entries: ReadonlyArray<PromptHistoryEntry>;
  pushEntry: (text: string) => void;
}

export const usePromptHistoryStore = create<PromptHistoryStoreState>()((set, get) => ({
  entries: [],
  pushEntry: (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().entries[0]?.text === trimmed) return;
    const entries = [
      { text: trimmed, createdAt: new Date().toISOString() },
      ...get().entries,
    ].slice(0, MAX_HISTORY_ENTRIES);
    persistEntries(entries);
    set({ entries });
  },
}));

// Like the app's other persisted stores, tabs are last-write-wins.
{
  const persisted = readPersistedEntries();
  if (persisted) {
    usePromptHistoryStore.setState({ entries: persisted });
  }
}

/** Test seam: seed persisted history and rehydrate through the normal decoder. */
export function writePromptHistoryStorageForTest(raw: string): void {
  baseHistoryStorage.setItem(PROMPT_HISTORY_STORAGE_KEY, raw);
  usePromptHistoryStore.setState({ entries: readPersistedEntries() ?? [] });
}
