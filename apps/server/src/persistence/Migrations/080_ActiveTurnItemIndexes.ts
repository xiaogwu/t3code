import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Upstream ships this as 073. Idempotent because the fork renumbers upstream
// migrations; a database that already ran it under another id must not fail on re-apply.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Recovery and provider-thread reads filter live items by this exact predicate; without
  // these, each read walked every historical item in the thread.
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_projection_turn_items_active_ordinal_idx
    ON orchestration_v2_projection_turn_items(thread_id, ordinal, turn_item_id)
    WHERE status IN ('pending', 'running', 'waiting')
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_projection_turn_items_active_run_idx
    ON orchestration_v2_projection_turn_items(thread_id, run_id)
    WHERE status IN ('pending', 'running', 'waiting')
  `;
});
