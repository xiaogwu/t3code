import { MessageId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProjectionThreadMessageRepository } from "../Services/ProjectionThreadMessages.ts";
import { ProjectionThreadMessageRepositoryLive } from "./ProjectionThreadMessages.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  ProjectionThreadMessageRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ProjectionThreadMessageRepository", (it) => {
  it.effect("preserves existing attachments when upsert omits attachments", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.make("thread-preserve-attachments");
      const messageId = MessageId.make("message-preserve-attachments");
      const createdAt = "2026-02-28T19:00:00.000Z";
      const updatedAt = "2026-02-28T19:00:01.000Z";
      const persistedAttachments = [
        {
          type: "image" as const,
          id: "thread-preserve-attachments-att-1",
          name: "example.png",
          mimeType: "image/png",
          sizeBytes: 5,
        },
      ];

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "user",
        text: "initial",
        attachments: persistedAttachments,
        isStreaming: false,
        createdAt,
        updatedAt,
      });

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "user",
        text: "updated",
        isStreaming: false,
        createdAt,
        updatedAt: "2026-02-28T19:00:02.000Z",
      });

      const rows = yield* repository.listByThreadId({ threadId });
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.text, "updated");
      assert.deepEqual(rows[0]?.attachments, persistedAttachments);

      const rowById = yield* repository.getByMessageId({ messageId });
      assert.equal(rowById._tag, "Some");
      if (rowById._tag === "Some") {
        assert.equal(rowById.value.text, "updated");
        assert.deepEqual(rowById.value.attachments, persistedAttachments);
      }
    }),
  );

  it.effect("allows explicit attachment clearing with an empty array", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.make("thread-clear-attachments");
      const messageId = MessageId.make("message-clear-attachments");
      const createdAt = "2026-02-28T19:10:00.000Z";

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "assistant",
        text: "with attachment",
        attachments: [
          {
            type: "image",
            id: "thread-clear-attachments-att-1",
            name: "example.png",
            mimeType: "image/png",
            sizeBytes: 5,
          },
        ],
        isStreaming: false,
        createdAt,
        updatedAt: "2026-02-28T19:10:01.000Z",
      });

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "assistant",
        text: "cleared",
        attachments: [],
        isStreaming: false,
        createdAt,
        updatedAt: "2026-02-28T19:10:02.000Z",
      });

      const rows = yield* repository.listByThreadId({ threadId });
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.text, "cleared");
      assert.deepEqual(rows[0]?.attachments, []);
    }),
  );

  it.effect("round-trips reply metadata and preserves it on streaming updates", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.make("thread-reply-context");
      const messageId = MessageId.make("message-reply-context");
      const replyToMessageId = MessageId.make("message-assistant-target");
      const replyTo = {
        messageId: replyToMessageId,
        blockId: "block-1",
        quote: "The exact quoted assistant response",
      } as const;

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "user",
        text: "Please clarify this",
        replyToMessageId,
        replyTo,
        isStreaming: false,
        createdAt: "2026-02-28T19:20:00.000Z",
        updatedAt: "2026-02-28T19:20:01.000Z",
      });
      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "user",
        text: "Please clarify this further",
        isStreaming: true,
        createdAt: "2026-02-28T19:20:00.000Z",
        updatedAt: "2026-02-28T19:20:02.000Z",
      });

      const result = yield* repository.getByMessageId({ messageId });
      assert.equal(result._tag, "Some");
      if (result._tag === "Some") {
        assert.equal(result.value.replyToMessageId, replyToMessageId);
        assert.deepEqual(result.value.replyTo, replyTo);
      }
    }),
  );

  it.effect("reads the direct reply reference format from older fork databases", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const repository = yield* ProjectionThreadMessageRepository;
      yield* sql`
        INSERT INTO projection_thread_messages
          (message_id, thread_id, turn_id, role, text, reply_to_json, is_streaming,
           created_at, updated_at)
        VALUES
          ('message-legacy-reply', 'thread-legacy-reply', NULL, 'user', 'follow up',
           '{"messageId":"message-assistant","blockId":"10-42","quote":"legacy quote"}',
           0, '2026-02-28T19:30:00.000Z', '2026-02-28T19:30:00.000Z')
      `;

      const result = yield* repository.getByMessageId({
        messageId: MessageId.make("message-legacy-reply"),
      });
      assert.equal(result._tag, "Some");
      if (result._tag === "Some") {
        assert.equal(result.value.replyToMessageId, MessageId.make("message-assistant"));
        assert.deepEqual(result.value.replyTo, {
          messageId: MessageId.make("message-assistant"),
          blockId: "10-42",
          quote: "legacy quote",
        });
      }
    }),
  );
});
