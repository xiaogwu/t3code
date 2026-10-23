import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Upstream ships this as 068. Idempotent because the fork renumbers upstream
// migrations; a database that already ran this schema under another id must
// not fail on re-apply.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_projection_turn_items_stop_request_idx
    ON orchestration_v2_projection_turn_items(thread_id, run_id)
    WHERE type = 'run_interrupt_request'
  `;
});
