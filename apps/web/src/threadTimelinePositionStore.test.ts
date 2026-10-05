import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createJSONStorage } from "zustand/middleware";

import {
  clearThreadTimelinePosition,
  createFailSoftStorage,
  migratePersistedThreadTimelinePositionStoreState,
  readThreadTimelinePosition,
  saveThreadTimelinePosition,
  useThreadTimelinePositionStore,
} from "./threadTimelinePositionStore";

const THREAD_REF = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));
const THREAD_KEY = scopedThreadKey(THREAD_REF);
const OTHER_THREAD_REF = scopeThreadRef(
  EnvironmentId.make("environment-1"),
  ThreadId.make("thread-2"),
);
const OTHER_THREAD_KEY = scopedThreadKey(OTHER_THREAD_REF);

describe("threadTimelinePositionStore", () => {
  beforeEach(() => {
    useThreadTimelinePositionStore.setState({
      positionByThreadKey: {},
      threadKeyOrder: [],
    });
  });

  it("round-trips a saved position", () => {
    saveThreadTimelinePosition(THREAD_KEY, { rowId: "row-5", offsetWithinRow: 12 });
    expect(readThreadTimelinePosition(THREAD_KEY)).toEqual({
      rowId: "row-5",
      offsetWithinRow: 12,
    });
  });

  it("clears the entry, and read on an unknown key returns undefined", () => {
    saveThreadTimelinePosition(THREAD_KEY, { rowId: "row-5", offsetWithinRow: 12 });
    clearThreadTimelinePosition(THREAD_KEY);
    expect(readThreadTimelinePosition(THREAD_KEY)).toBeUndefined();
    expect(readThreadTimelinePosition("environment-x:thread-x")).toBeUndefined();
  });

  it("keeps positions independent across thread keys", () => {
    saveThreadTimelinePosition(THREAD_KEY, { rowId: "row-1", offsetWithinRow: 1 });
    saveThreadTimelinePosition(OTHER_THREAD_KEY, { rowId: "row-2", offsetWithinRow: 2 });

    expect(readThreadTimelinePosition(THREAD_KEY)).toEqual({ rowId: "row-1", offsetWithinRow: 1 });
    expect(readThreadTimelinePosition(OTHER_THREAD_KEY)).toEqual({
      rowId: "row-2",
      offsetWithinRow: 2,
    });

    clearThreadTimelinePosition(THREAD_KEY);
    expect(readThreadTimelinePosition(THREAD_KEY)).toBeUndefined();
    expect(readThreadTimelinePosition(OTHER_THREAD_KEY)).toEqual({
      rowId: "row-2",
      offsetWithinRow: 2,
    });
  });

  it("evicts the oldest key past the cap while the newest survives", () => {
    for (let index = 0; index < 201; index += 1) {
      saveThreadTimelinePosition(`environment-1:thread-${index}`, {
        rowId: `row-${index}`,
        offsetWithinRow: index,
      });
    }

    expect(readThreadTimelinePosition("environment-1:thread-0")).toBeUndefined();
    expect(readThreadTimelinePosition("environment-1:thread-200")).toEqual({
      rowId: "row-200",
      offsetWithinRow: 200,
    });
    expect(Object.keys(useThreadTimelinePositionStore.getState().positionByThreadKey)).toHaveLength(
      200,
    );
  });

  it("re-saving an existing key does not evict it as if it were new", () => {
    for (let index = 0; index < 200; index += 1) {
      saveThreadTimelinePosition(`environment-1:thread-${index}`, {
        rowId: `row-${index}`,
        offsetWithinRow: index,
      });
    }
    // Touch the oldest key again; it should move to the back of the order,
    // not be treated as a 201st distinct entry.
    saveThreadTimelinePosition("environment-1:thread-0", { rowId: "row-0b", offsetWithinRow: 99 });
    saveThreadTimelinePosition("environment-1:thread-200", {
      rowId: "row-200",
      offsetWithinRow: 0,
    });

    expect(readThreadTimelinePosition("environment-1:thread-0")).toEqual({
      rowId: "row-0b",
      offsetWithinRow: 99,
    });
    expect(readThreadTimelinePosition("environment-1:thread-1")).toBeUndefined();
  });

  it("drops persisted entries whose thread keys are not valid scoped keys", () => {
    const migrated = migratePersistedThreadTimelinePositionStoreState(
      {
        positionByThreadKey: {
          [THREAD_KEY]: { rowId: "row-1", offsetWithinRow: 1 },
          "legacy-thread-id": { rowId: "row-2", offsetWithinRow: 2 },
        },
        threadKeyOrder: [THREAD_KEY, "legacy-thread-id"],
      },
      0,
    );

    expect(migrated).toEqual({
      positionByThreadKey: {
        [THREAD_KEY]: { rowId: "row-1", offsetWithinRow: 1 },
      },
      threadKeyOrder: [THREAD_KEY],
    });
  });

  it("returns an empty state when migrating a non-object", () => {
    expect(migratePersistedThreadTimelinePositionStoreState(null, 0)).toEqual({
      positionByThreadKey: {},
      threadKeyOrder: [],
    });
    expect(migratePersistedThreadTimelinePositionStoreState(undefined, 0)).toEqual({
      positionByThreadKey: {},
      threadKeyOrder: [],
    });
  });

  it("still saves and reads in memory when the underlying storage throws", () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error("storage blocked");
      },
      setItem: () => {
        throw new Error("storage blocked");
      },
      removeItem: () => {
        throw new Error("storage blocked");
      },
    };
    useThreadTimelinePositionStore.persist.setOptions({
      storage: createJSONStorage(() => createFailSoftStorage(throwingStorage)),
    });

    expect(() =>
      saveThreadTimelinePosition(THREAD_KEY, { rowId: "row-9", offsetWithinRow: 3 }),
    ).not.toThrow();
    expect(readThreadTimelinePosition(THREAD_KEY)).toEqual({ rowId: "row-9", offsetWithinRow: 3 });
  });
});
