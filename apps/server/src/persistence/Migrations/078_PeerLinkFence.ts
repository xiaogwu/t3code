import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Upstream ships this as 071. Idempotent because the fork renumbers upstream
// migrations; a database that already ran this schema under another id must
// not fail on re-apply.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(peer_environment_links)
  `;
  if (columns.some((column) => column.name === "fenced")) return;

  // Whether the link's session was issued as a link, which the peer fences.
  // Links stored before it are not, and must be made again.
  yield* sql`
    ALTER TABLE peer_environment_links ADD COLUMN fenced INTEGER NOT NULL DEFAULT 0
  `;
});
