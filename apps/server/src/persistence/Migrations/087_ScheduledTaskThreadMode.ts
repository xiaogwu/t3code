import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Upstream ships this as 080. Idempotent: a store that already has the column
// (written by a build that ran upstream's numbering) keeps its values, so the
// backfill only runs when this migration adds the column.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(scheduled_tasks)
  `;

  if (!columns.some((column) => column.name === "thread_mode")) {
    yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN thread_mode TEXT NOT NULL DEFAULT 'new_thread'`;
    yield* sql`UPDATE scheduled_tasks SET thread_mode = 'continue' WHERE thread_id IS NOT NULL`;
  }
});
