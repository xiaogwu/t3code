/**
 * Per-thread timeline reading position, persisted to this client's
 * `localStorage`. Keyed by scoped thread key (environment + thread) so
 * positions never collide across environments.
 *
 * Nothing subscribes to this store: it is read at mount and written on
 * scroll, both imperative, so a React subscriber would re-render on every
 * scroll event. Use the exported functions below, not the store hook.
 */

import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createDeferredStorage, resolveStorage, type StateStorage } from "./lib/storage";

const THREAD_TIMELINE_POSITION_STORAGE_KEY = "t3code:thread-timeline-position:v1";

// localStorage is a hard ~5MB per origin shared with every other persisted
// store in the app; cap how many threads' positions we keep.
const MAX_THREAD_TIMELINE_POSITIONS = 200;

export interface ThreadTimelinePosition {
  readonly rowId: string;
  readonly offsetWithinRow: number;
}

interface PersistedThreadTimelinePositionStoreState {
  positionByThreadKey: Record<string, ThreadTimelinePosition>;
  threadKeyOrder: readonly string[];
}

/** Drops entries whose key is not a valid scoped thread key. */
export function migratePersistedThreadTimelinePositionStoreState(
  persistedState: unknown,
  _version: number,
): PersistedThreadTimelinePositionStoreState {
  if (!persistedState || typeof persistedState !== "object") {
    return { positionByThreadKey: {}, threadKeyOrder: [] };
  }

  const candidate = persistedState as Partial<PersistedThreadTimelinePositionStoreState>;
  const rawPositionByThreadKey = candidate.positionByThreadKey ?? {};
  const positionByThreadKey = Object.fromEntries(
    Object.entries(rawPositionByThreadKey).filter(([threadKey]) => parseScopedThreadKey(threadKey)),
  );
  const validThreadKeys = new Set(Object.keys(positionByThreadKey));
  const rawThreadKeyOrder = Array.isArray(candidate.threadKeyOrder) ? candidate.threadKeyOrder : [];
  const orderedKeys = rawThreadKeyOrder.filter((threadKey) => validThreadKeys.has(threadKey));
  // Any valid key missing from the order (e.g. legacy data with no order
  // tracking) is treated as oldest, so it is first to evict.
  for (const threadKey of validThreadKeys) {
    if (!orderedKeys.includes(threadKey)) {
      orderedKeys.unshift(threadKey);
    }
  }

  return { positionByThreadKey, threadKeyOrder: orderedKeys };
}

/**
 * A reading position is never worth an exception. Storage can throw on access
 * when the browser blocks it, and on write when the shared ~5MB origin quota
 * is full — and this store writes from a scroll handler. Swallow both: the
 * in-memory position still works, it just stops surviving a reload.
 */
export function createFailSoftStorage(
  base: Partial<StateStorage> | null | undefined,
): StateStorage {
  const resolved = resolveStorage(base);
  return {
    getItem: (name) => {
      try {
        return resolved.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        resolved.setItem(name, value);
      } catch (error) {
        console.error(
          "[THREAD-TIMELINE-POSITION] Could not persist position (storage quota?).",
          error,
        );
      }
    },
    removeItem: (name) => {
      try {
        resolved.removeItem(name);
      } catch {
        // Nothing to recover: the entry either never landed or stays stale.
      }
    },
  };
}

function createThreadTimelinePositionStorage() {
  // Scroll-frequency writer: the in-memory state updates on every scroll
  // event, but the serialize-and-write is debounced so it never shows up in
  // a scroll profile. Fail-soft sits underneath, so the debounced write and
  // the rehydrate read both absorb a throwing storage.
  //
  // `createJSONStorage` has already serialized by the time it calls setItem, so
  // the deferred value is the JSON string itself and the serializer is identity.
  return createDeferredStorage<string>(
    createFailSoftStorage(typeof window !== "undefined" ? window.localStorage : undefined),
    (value) => value,
    300,
  );
}

interface ThreadTimelinePositionStoreState {
  positionByThreadKey: Record<string, ThreadTimelinePosition>;
  /** Oldest first. Tracked explicitly; JSON round trips do not preserve object key order. */
  threadKeyOrder: readonly string[];
}

export const useThreadTimelinePositionStore = create<ThreadTimelinePositionStoreState>()(
  persist(
    (): ThreadTimelinePositionStoreState => ({
      positionByThreadKey: {},
      threadKeyOrder: [],
    }),
    {
      name: THREAD_TIMELINE_POSITION_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(createThreadTimelinePositionStorage),
      migrate: migratePersistedThreadTimelinePositionStoreState,
      partialize: (state) => ({
        positionByThreadKey: state.positionByThreadKey,
        threadKeyOrder: state.threadKeyOrder,
      }),
    },
  ),
);

export function saveThreadTimelinePosition(
  threadKey: string,
  position: ThreadTimelinePosition,
): void {
  useThreadTimelinePositionStore.setState((state) => {
    const nextOrder = [...state.threadKeyOrder.filter((key) => key !== threadKey), threadKey];
    const nextPositionByThreadKey = {
      ...state.positionByThreadKey,
      [threadKey]: position,
    };

    while (nextOrder.length > MAX_THREAD_TIMELINE_POSITIONS) {
      const oldestThreadKey = nextOrder.shift();
      if (oldestThreadKey !== undefined) {
        delete nextPositionByThreadKey[oldestThreadKey];
      }
    }

    return {
      positionByThreadKey: nextPositionByThreadKey,
      threadKeyOrder: nextOrder,
    };
  });
}

export function clearThreadTimelinePosition(threadKey: string): void {
  const state = useThreadTimelinePositionStore.getState();
  if (state.positionByThreadKey[threadKey] === undefined) {
    return;
  }
  const { [threadKey]: _removed, ...remainingPositions } = state.positionByThreadKey;
  useThreadTimelinePositionStore.setState({
    positionByThreadKey: remainingPositions,
    threadKeyOrder: state.threadKeyOrder.filter((key) => key !== threadKey),
  });
}

export function readThreadTimelinePosition(threadKey: string): ThreadTimelinePosition | undefined {
  return useThreadTimelinePositionStore.getState().positionByThreadKey[threadKey];
}
