import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("046_ProjectionThreadsTitlePolicy", (it) => {
  it.effect("adds the nullable title policy columns to thread projections", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 45 });
      yield* runMigrations({ toMigrationInclusive: 46 });

      const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        PRAGMA table_info(projection_threads)
      `;
      const titleProvenance = columns.find((column) => column.name === "title_provenance");
      const titleProtectedPrefix = columns.find(
        (column) => column.name === "title_protected_prefix",
      );
      const titleTurnsSincePolicyEval = columns.find(
        (column) => column.name === "title_turns_since_policy_eval",
      );

      assert.equal(titleProvenance?.name, "title_provenance");
      assert.equal(titleProvenance?.notnull, 0);
      assert.equal(titleProtectedPrefix?.name, "title_protected_prefix");
      assert.equal(titleProtectedPrefix?.notnull, 0);
      assert.equal(titleTurnsSincePolicyEval?.name, "title_turns_since_policy_eval");
      assert.equal(titleTurnsSincePolicyEval?.notnull, 0);
    }),
  );
});
