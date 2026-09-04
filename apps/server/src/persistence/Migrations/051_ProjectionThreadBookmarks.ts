import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Bookmarks are a list, not a per-thread blob: a single removal must not
  // require a read-modify-write of the whole thread row.
  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_bookmarks (
      bookmark_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      environment_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      text TEXT NOT NULL,
      comment TEXT,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      prefix TEXT NOT NULL,
      suffix TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_bookmarks_thread_created
    ON projection_thread_bookmarks(thread_id, created_at)
  `;
});
