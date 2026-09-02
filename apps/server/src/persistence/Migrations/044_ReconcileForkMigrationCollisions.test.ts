import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("044_ReconcileForkMigrationCollisions", (it) => {
  it.effect("adds upstream columns after fork migration ids were already consumed", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 40 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (41, 'ProjectionThreadMessageReplies'),
          (42, 'ProjectionThreadsTitlePolicy'),
          (43, 'ReconcileUpstreamMigrationCollisions')
      `;

      yield* runMigrations({ toMigrationInclusive: 44 });

      const authColumns = yield* sql<{ readonly name: string }>`PRAGMA table_info(auth_sessions)`;
      const threadColumns = yield* sql<{
        readonly name: string;
      }>`PRAGMA table_info(projection_threads)`;
      assert.ok(authColumns.some((column) => column.name === "client_surface"));
      assert.ok(authColumns.some((column) => column.name === "client_app_version"));
      assert.ok(threadColumns.some((column) => column.name === "linked_pull_request_json"));
      assert.ok(threadColumns.some((column) => column.name === "unsettled_at"));
    }),
  );
});
