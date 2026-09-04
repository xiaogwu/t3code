import {
  CommandId,
  EventId,
  ProjectId,
  ThreadId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { createEmptyReadModel, projectEvent } from "./projector.ts";

function makeEvent(input: {
  readonly sequence: number;
  readonly type: OrchestrationEvent["type"];
  readonly payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.make(`event-${input.sequence}`),
    type: input.type,
    aggregateKind: "thread",
    aggregateId: ThreadId.make("thread-1"),
    occurredAt: "2026-01-01T00:00:00.000Z",
    commandId: CommandId.make(`command-${input.sequence}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent;
}

const CITATION = {
  version: 1,
  environmentId: "env-1",
  threadId: "thread-1",
  messageId: "message-1",
  text: "quoted text",
  start: 0,
  end: 11,
  prefix: "",
  suffix: "",
};

it.effect("projects bookmark add/remove lifecycle", () =>
  Effect.gen(function* () {
    const now = "2026-01-01T00:00:00.000Z";
    const created = yield* projectEvent(
      createEmptyReadModel(now),
      makeEvent({
        sequence: 1,
        type: "thread.created",
        payload: {
          threadId: ThreadId.make("thread-1"),
          projectId: ProjectId.make("project-1"),
          title: "Thread",
          modelSelection: { provider: "codex", model: "gpt-5.4" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    expect(created.threads[0]?.bookmarks ?? []).toEqual([]);

    const added = yield* projectEvent(
      created,
      makeEvent({
        sequence: 2,
        type: "thread.bookmark.added",
        payload: {
          threadId: ThreadId.make("thread-1"),
          bookmark: { id: "bookmark-1", citation: CITATION, createdAt: now },
          updatedAt: now,
        },
      }),
    );
    expect(added.threads[0]?.bookmarks).toHaveLength(1);
    expect(added.threads[0]?.bookmarks?.[0]?.id).toBe("bookmark-1");

    // Adding a second bookmark keeps the first.
    const addedSecond = yield* projectEvent(
      added,
      makeEvent({
        sequence: 3,
        type: "thread.bookmark.added",
        payload: {
          threadId: ThreadId.make("thread-1"),
          bookmark: {
            id: "bookmark-2",
            citation: { ...CITATION, start: 20, end: 30 },
            createdAt: now,
          },
          updatedAt: now,
        },
      }),
    );
    expect(addedSecond.threads[0]?.bookmarks?.map((bookmark) => bookmark.id)).toEqual([
      "bookmark-1",
      "bookmark-2",
    ]);

    const removedFirst = yield* projectEvent(
      addedSecond,
      makeEvent({
        sequence: 4,
        type: "thread.bookmark.removed",
        payload: { threadId: ThreadId.make("thread-1"), bookmarkId: "bookmark-1", updatedAt: now },
      }),
    );
    expect(removedFirst.threads[0]?.bookmarks?.map((bookmark) => bookmark.id)).toEqual([
      "bookmark-2",
    ]);

    const removedSecond = yield* projectEvent(
      removedFirst,
      makeEvent({
        sequence: 5,
        type: "thread.bookmark.removed",
        payload: { threadId: ThreadId.make("thread-1"), bookmarkId: "bookmark-2", updatedAt: now },
      }),
    );
    expect(removedSecond.threads[0]?.bookmarks ?? []).toEqual([]);
  }),
);
