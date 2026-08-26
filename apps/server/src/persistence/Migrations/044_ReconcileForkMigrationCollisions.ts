import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Fork releases previously assigned migrations 41-43 to different schema
// changes. Reconcile every upstream column introduced at those ids so an
// existing fork database cannot skip one based only on its migration number.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const authSessionColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(auth_sessions)
  `;
  if (!authSessionColumns.some((column) => column.name === "client_surface")) {
    yield* sql`ALTER TABLE auth_sessions ADD COLUMN client_surface TEXT`;
  }
  if (!authSessionColumns.some((column) => column.name === "client_app_version")) {
    yield* sql`ALTER TABLE auth_sessions ADD COLUMN client_app_version TEXT`;
  }

  const threadColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (!threadColumns.some((column) => column.name === "linked_pull_request_json")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN linked_pull_request_json TEXT`;
  }
  if (!threadColumns.some((column) => column.name === "unsettled_at")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN unsettled_at TEXT`;
  }
});
