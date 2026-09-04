import {
  CommandId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadBookmarkId,
  ThreadId,
  type AssistantCitation,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const BOOKMARKED_AT = "1969-12-30T00:00:00.000Z";

const CITATION: AssistantCitation = {
  version: 1,
  environmentId: EnvironmentId.make("env-1"),
  threadId: ThreadId.make("thread-1"),
  messageId: MessageId.make("message-1"),
  text: "quoted text",
  start: 0,
  end: 11,
  prefix: "",
  suffix: "",
};

function makeReadModel(input: {
  readonly bookmarks?: OrchestrationThread["bookmarks"];
  readonly archivedAt?: string | null;
}): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: input.archivedAt ?? null,
        settledOverride: null,
        settledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
        pinOrderKey: null,
        bookmarks: input.bookmarks ?? [],
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ],
    updatedAt: NOW,
  };
}

it.layer(NodeServices.layer)("bookmark decider", (it) => {
  it.effect("adds a bookmark, stamping the bookmark and thread updatedAt together", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.bookmark.add",
          commandId: CommandId.make("cmd-bookmark-add"),
          threadId: ThreadId.make("thread-1"),
          bookmarkId: ThreadBookmarkId.make("bookmark-1"),
          citation: CITATION,
        },
        readModel: makeReadModel({}),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("thread.bookmark.added");
      if (events[0]?.type === "thread.bookmark.added") {
        expect(events[0].payload.bookmark.id).toBe("bookmark-1");
        expect(events[0].payload.bookmark.citation.text).toBe("quoted text");
        expect(events[0].payload.bookmark.createdAt).toBe(events[0].payload.updatedAt);
      }
    }),
  );

  it.effect("re-adding the same bookmarkId preserves the original bookmark and updatedAt", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.bookmark.add",
          commandId: CommandId.make("cmd-bookmark-add-again"),
          threadId: ThreadId.make("thread-1"),
          bookmarkId: ThreadBookmarkId.make("bookmark-1"),
          // A raced retry might carry a different in-flight citation payload;
          // the existing anchor must win regardless.
          citation: { ...CITATION, text: "different text" },
        },
        readModel: makeReadModel({
          bookmarks: [
            {
              id: ThreadBookmarkId.make("bookmark-1"),
              citation: CITATION,
              createdAt: BOOKMARKED_AT,
            },
          ],
        }),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events[0]?.type).toBe("thread.bookmark.added");
      if (events[0]?.type === "thread.bookmark.added") {
        expect(events[0].payload.bookmark.citation.text).toBe("quoted text");
        expect(events[0].payload.bookmark.createdAt).toBe(BOOKMARKED_AT);
        expect(events[0].payload.updatedAt).toBe(NOW);
      }
    }),
  );

  it.effect("removes an existing bookmark", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.bookmark.remove",
          commandId: CommandId.make("cmd-bookmark-remove"),
          threadId: ThreadId.make("thread-1"),
          bookmarkId: ThreadBookmarkId.make("bookmark-1"),
        },
        readModel: makeReadModel({
          bookmarks: [
            {
              id: ThreadBookmarkId.make("bookmark-1"),
              citation: CITATION,
              createdAt: BOOKMARKED_AT,
            },
          ],
        }),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events[0]?.type).toBe("thread.bookmark.removed");
      if (events[0]?.type === "thread.bookmark.removed") {
        expect(events[0].payload.bookmarkId).toBe("bookmark-1");
        expect(events[0].payload.updatedAt).not.toBe(NOW);
      }
    }),
  );

  it.effect("removing a bookmark that does not exist preserves updatedAt", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.bookmark.remove",
          commandId: CommandId.make("cmd-bookmark-remove-noop"),
          threadId: ThreadId.make("thread-1"),
          bookmarkId: ThreadBookmarkId.make("bookmark-missing"),
        },
        readModel: makeReadModel({}),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events[0]?.type).toBe("thread.bookmark.removed");
      if (events[0]?.type === "thread.bookmark.removed") {
        expect(events[0].payload.updatedAt).toBe(NOW);
      }
    }),
  );

  it.effect("rejects bookmarking an archived thread", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.bookmark.add",
          commandId: CommandId.make("cmd-bookmark-archived"),
          threadId: ThreadId.make("thread-1"),
          bookmarkId: ThreadBookmarkId.make("bookmark-1"),
          citation: CITATION,
        },
        readModel: makeReadModel({ archivedAt: NOW }),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("add then remove is a full round trip", () =>
    Effect.gen(function* () {
      const added = yield* decideOrchestrationCommand({
        command: {
          type: "thread.bookmark.add",
          commandId: CommandId.make("cmd-bookmark-roundtrip-add"),
          threadId: ThreadId.make("thread-1"),
          bookmarkId: ThreadBookmarkId.make("bookmark-1"),
          citation: CITATION,
        },
        readModel: makeReadModel({}),
      });
      const addedEvents = Array.isArray(added) ? added : [added];
      expect(addedEvents[0]?.type).toBe("thread.bookmark.added");
      const bookmark =
        addedEvents[0]?.type === "thread.bookmark.added" ? addedEvents[0].payload.bookmark : null;
      expect(bookmark).not.toBeNull();

      const removed = yield* decideOrchestrationCommand({
        command: {
          type: "thread.bookmark.remove",
          commandId: CommandId.make("cmd-bookmark-roundtrip-remove"),
          threadId: ThreadId.make("thread-1"),
          bookmarkId: bookmark!.id,
        },
        readModel: makeReadModel({ bookmarks: bookmark ? [bookmark] : [] }),
      });
      const removedEvents = Array.isArray(removed) ? removed : [removed];
      expect(removedEvents[0]?.type).toBe("thread.bookmark.removed");
    }),
  );
});
