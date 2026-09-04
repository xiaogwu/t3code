import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("051_ProjectionThreadBookmarks", (it) => {
  it.effect("creates the per-bookmark projection table", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 50 });
      yield* runMigrations({ toMigrationInclusive: 51 });

      const columns = yield* sql<{ readonly name: string; readonly pk: number }>`
        PRAGMA table_info(projection_thread_bookmarks)
      `;
      const columnNames = columns.map((column) => column.name);

      assert.deepEqual(columnNames, [
        "bookmark_id",
        "thread_id",
        "environment_id",
        "message_id",
        "text",
        "comment",
        "start_offset",
        "end_offset",
        "prefix",
        "suffix",
        "created_at",
      ]);
      assert.equal(columns.find((column) => column.name === "bookmark_id")?.pk, 1);

      // A single removal is a single-row DELETE, not a read-modify-write of
      // a thread-wide blob: exercise that the table actually stores one row
      // per bookmark rather than one row per thread.
      yield* sql`
        INSERT INTO projection_thread_bookmarks (
          bookmark_id, thread_id, environment_id, message_id, text, comment,
          start_offset, end_offset, prefix, suffix, created_at
        ) VALUES
          ('bookmark-1', 'thread-1', 'env-1', 'message-1', 'a', NULL, 0, 1, '', '', '2026-01-01T00:00:00.000Z'),
          ('bookmark-2', 'thread-1', 'env-1', 'message-2', 'b', NULL, 0, 1, '', '', '2026-01-01T00:00:00.000Z')
      `;
      yield* sql`DELETE FROM projection_thread_bookmarks WHERE bookmark_id = 'bookmark-1'`;
      const remaining = yield* sql<{ readonly bookmark_id: string }>`
        SELECT bookmark_id FROM projection_thread_bookmarks
      `;
      assert.deepEqual(
        remaining.map((row) => row.bookmark_id),
        ["bookmark-2"],
      );
    }),
  );
});
