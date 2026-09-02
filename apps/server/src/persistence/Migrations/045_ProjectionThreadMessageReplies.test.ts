import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("045_ProjectionThreadMessageReplies", (it) => {
  it.effect("reuses a fork column and backfills durable reply payloads", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 36 });
      yield* sql`
        ALTER TABLE projection_thread_messages ADD COLUMN reply_to_json TEXT
      `;
      yield* sql`
        INSERT INTO projection_thread_messages
          (message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at)
        VALUES
          ('message-reply', 'thread-reply', NULL, 'user', 'follow up', 0,
           '2026-02-28T19:00:00.000Z', '2026-02-28T19:00:00.000Z')
      `;
      yield* sql`
        INSERT INTO orchestration_events
          (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
           payload_json, metadata_json, actor_kind)
        VALUES
          ('event-reply', 'thread', 'thread-reply', 1, 'thread.message-sent',
           '2026-02-28T19:00:00.000Z',
           '{"messageId":"message-reply","replyToMessageId":"message-assistant"}',
           '{}', 'user')
      `;

      yield* runMigrations({ toMigrationInclusive: 45 });
      const rows = yield* sql<{ readonly replyTo: string | null }>`
        SELECT reply_to_json AS "replyTo"
        FROM projection_thread_messages
        WHERE message_id = 'message-reply'
      `;
      assert.equal(rows[0]?.replyTo, '{"replyToMessageId":"message-assistant"}');
      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_messages)
      `;
      assert.equal(columns.filter((column) => column.name === "reply_to_json").length, 1);
    }),
  );
});
