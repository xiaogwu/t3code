import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

/**
 * Stores the reply target alongside the projected message. This migration is
 * deliberately idempotent: fork databases may already have this column from
 * an older migration with a different id/name.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_messages)
  `;
  if (!columns.some((column) => column.name === "reply_to_json")) {
    yield* sql`
      ALTER TABLE projection_thread_messages
      ADD COLUMN reply_to_json TEXT
    `;
  }

  // Recover replies written before this projection field existed. Invalid or
  // legacy payloads are ignored; the normal projector will handle new events.
  yield* sql`
    UPDATE projection_thread_messages AS message
    SET reply_to_json = (
      SELECT CASE
        WHEN json_extract(event.payload_json, '$.replyToMessageId') IS NOT NULL
          AND json_type(event.payload_json, '$.replyTo') = 'object'
          THEN json_object(
            'replyToMessageId', json_extract(event.payload_json, '$.replyToMessageId'),
            'replyTo', json_extract(event.payload_json, '$.replyTo')
          )
        WHEN json_extract(event.payload_json, '$.replyToMessageId') IS NOT NULL
          THEN json_object(
            'replyToMessageId', json_extract(event.payload_json, '$.replyToMessageId')
          )
        WHEN json_type(event.payload_json, '$.replyTo') = 'object'
          THEN json_object('replyTo', json_extract(event.payload_json, '$.replyTo'))
        ELSE NULL
      END
      FROM orchestration_events AS event
      WHERE event.event_type = 'thread.message-sent'
        AND json_extract(event.payload_json, '$.messageId') = message.message_id
        AND (
          json_extract(event.payload_json, '$.replyToMessageId') IS NOT NULL
          OR json_type(event.payload_json, '$.replyTo') = 'object'
        )
      ORDER BY event.sequence DESC
      LIMIT 1
    )
    WHERE message.reply_to_json IS NULL
      AND EXISTS (
        SELECT 1
        FROM orchestration_events AS event
        WHERE event.event_type = 'thread.message-sent'
          AND json_extract(event.payload_json, '$.messageId') = message.message_id
          AND (
            json_extract(event.payload_json, '$.replyToMessageId') IS NOT NULL
            OR json_type(event.payload_json, '$.replyTo') = 'object'
          )
      )
  `;
});
