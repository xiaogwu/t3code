import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Upstream ships this as 076. Idempotent because the fork renumbers upstream
// migrations; a database that already ran it under another id must not fail on re-apply.
// Null means unpinned and not archived.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_projects)`;
  const has = (name: string) => columns.some((column) => column.name === name);
  if (!has("pinned_at")) yield* sql`ALTER TABLE projection_projects ADD COLUMN pinned_at TEXT`;
  if (!has("archived_at")) yield* sql`ALTER TABLE projection_projects ADD COLUMN archived_at TEXT`;
});
