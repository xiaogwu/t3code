import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationMessage,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";

function message(overrides: Partial<OrchestrationMessage>): OrchestrationMessage {
  return {
    id: MessageId.make("message-assistant"),
    role: "assistant",
    text: "Earlier answer",
    turnId: null,
    streaming: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeReadModel(messages: ReadonlyArray<OrchestrationMessage>): OrchestrationReadModel {
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
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        deletedAt: null,
        messages,
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ],
    updatedAt: NOW,
  };
}

function turnStart(replyToMessageId?: string) {
  return {
    type: "thread.turn.start" as const,
    commandId: CommandId.make("cmd-turn-start"),
    threadId: ThreadId.make("thread-1"),
    message: {
      messageId: MessageId.make("message-user"),
      role: "user" as const,
      text: "Follow up",
      attachments: [],
      ...(replyToMessageId === undefined
        ? {}
        : { replyToMessageId: MessageId.make(replyToMessageId) }),
    },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    createdAt: NOW,
  };
}

it.layer(NodeServices.layer)("reply-to-message decider", (it) => {
  it.effect("rejects a reply to a message that is not on the thread", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: turnStart("message-missing"),
        readModel: makeReadModel([message({})]),
      }).pipe(Effect.flip);
      // Narrowed, not just tag-checked: the decider's error union also carries
      // PlatformError, and only the invariant error has a detail to assert on.
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("does not exist on thread");
      }
    }),
  );

  // A reply's whole purpose is to re-send an earlier answer as context, so a user
  // message is not a valid target: there would be no assistant text to quote.
  it.effect("rejects a reply to a user message", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: turnStart("message-earlier-user"),
        readModel: makeReadModel([
          message({ id: MessageId.make("message-earlier-user"), role: "user", text: "First ask" }),
        ]),
      }).pipe(Effect.flip);
      // Narrowed, not just tag-checked: the decider's error union also carries
      // PlatformError, and only the invariant error has a detail to assert on.
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("must be a completed assistant message");
      }
    }),
  );

  // Still streaming means the text is incomplete. Quoting it would send a
  // truncated answer back to the provider as if it were the whole thing.
  it.effect("rejects a reply to an assistant message that is still streaming", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: turnStart("message-assistant"),
        readModel: makeReadModel([message({ streaming: true })]),
      }).pipe(Effect.flip);
      // Narrowed, not just tag-checked: the decider's error union also carries
      // PlatformError, and only the invariant error has a detail to assert on.
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("must be a completed assistant message");
      }
    }),
  );

  it.effect("carries the reply target through to the sent user message", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: turnStart("message-assistant"),
        readModel: makeReadModel([message({})]),
      });
      const events = Array.isArray(result) ? result : [result];
      const sent = events.find((event) => event.type === "thread.message-sent");

      expect(sent).toBeDefined();
      if (sent?.type === "thread.message-sent") {
        expect(sent.payload.replyToMessageId).toBe(MessageId.make("message-assistant"));
      }
    }),
  );

  // The key is omitted rather than set to null or undefined: the schema marks it
  // optional, and a present-but-empty key would round-trip into the event log.
  it.effect("omits the reply key entirely for an ordinary turn", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: turnStart(),
        readModel: makeReadModel([message({})]),
      });
      const events = Array.isArray(result) ? result : [result];
      const sent = events.find((event) => event.type === "thread.message-sent");

      expect(sent).toBeDefined();
      if (sent?.type === "thread.message-sent") {
        expect(Object.hasOwn(sent.payload, "replyToMessageId")).toBe(false);
      }
    }),
  );
});
