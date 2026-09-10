import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("055_ProjectionThreadDelegation", (it) => {
  it.effect("adds nullable provenance columns and an efficient parent index", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* runMigrations({ toMigrationInclusive: 55 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      const names = columns.map((column) => column.name);
      assert.include(names, "parent_thread_id");
      assert.include(names, "parent_turn_id");
      assert.include(names, "spawn_key");

      const indexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(projection_threads)
      `;
      assert.include(
        indexes.map((index) => index.name),
        "idx_projection_threads_parent_thread",
      );

      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json,
          parent_thread_id, parent_turn_id, spawn_key,
          created_at, updated_at
        ) VALUES (
          'child-1', 'project-1', 'Child', '{"instanceId":"codex","model":"gpt-5"}',
          'parent-1', 'turn-1', 'task-1',
          '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
        )
      `;
      const rows = yield* sql<{
        readonly parent_thread_id: string | null;
        readonly parent_turn_id: string | null;
        readonly spawn_key: string | null;
      }>`
        SELECT parent_thread_id, parent_turn_id, spawn_key FROM projection_threads WHERE thread_id = 'child-1'
      `;
      assert.deepEqual(rows, [
        { parent_thread_id: "parent-1", parent_turn_id: "turn-1", spawn_key: "task-1" },
      ]);
    }),
  );
});
