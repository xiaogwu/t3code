import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  const names = new Set(columns.map((column) => column.name));

  if (!names.has("title_provenance")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN title_provenance TEXT
    `;
  }
  if (!names.has("title_protected_prefix")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN title_protected_prefix TEXT
    `;
  }
  if (!names.has("title_turns_since_policy_eval")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN title_turns_since_policy_eval INTEGER
    `;
  }
});
