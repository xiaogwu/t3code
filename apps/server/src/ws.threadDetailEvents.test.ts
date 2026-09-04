import { assert, describe, it } from "vite-plus/test";

import { isThreadDetailEvent } from "./ws.ts";

const base = {
  version: 1 as const,
  sequence: 1,
  aggregateKind: "thread" as const,
  aggregateId: "225a9d64-8ae2-439e-b697-3d572e3d4ee5",
  occurredAt: "2026-09-04T20:38:07.599Z",
};

const event = (type: string) => ({ ...base, type, payload: {} }) as never;

describe("isThreadDetailEvent", () => {
  // A thread's bookmarks are part of its detail snapshot, so the subscription
  // has to deliver their events; omitting them left a client that created a
  // bookmark showing nothing until it reloaded the thread from scratch.
  it("delivers bookmark events", () => {
    assert.isTrue(isThreadDetailEvent(event("thread.bookmark.added")));
    assert.isTrue(isThreadDetailEvent(event("thread.bookmark.removed")));
  });

  it("still ignores shell-only events", () => {
    assert.isFalse(isThreadDetailEvent(event("thread.pinned")));
    assert.isFalse(isThreadDetailEvent(event("thread.pin-reordered")));
    assert.isFalse(isThreadDetailEvent(event("thread.meta-updated")));
  });
});
