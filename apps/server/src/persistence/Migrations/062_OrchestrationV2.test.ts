import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationEntries, runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

// The fork renumbers every upstream migration past its own ids. Live fork
// databases have recorded these exact ids, so moving one silently skips it.
layer("062_OrchestrationV2", (it) => {
  it.effect("keeps released migrations contiguous", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(
        migrationEntries.map(([id]) => id),
        Array.from({ length: 75 }, (_, index) => index + 1),
      );
    }),
  );

  it.effect("upgrades fork schema 61 through the latest migrations", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 61 });

      const executed = yield* runMigrations();
      assert.deepStrictEqual(executed, [
        [62, "OrchestrationV2"],
        [63, "RemoveRedundantProjectionIndexes"],
        [64, "ScheduledTaskWebhooks"],
        [65, "WebhookRelayDeliveries"],
        [66, "McpAppModelContext"],
        [67, "ThreadSnapshotWindowIndexes"],
        [68, "PullRequestReviewGuides"],
        [69, "ThreadFailureLookupIndex"],
        [70, "DropUnusedV1Projections"],
        [71, "CanonicalizeThreadPullRequestLinks"],
        [72, "CodexUsageNativeTurnIndex"],
        [73, "RepairClientSettlementTimestamps"],
        [74, "WebhookDedupe"],
        [75, "ShellStopRequestIndex"],
      ]);
      assert.deepStrictEqual(yield* runMigrations(), []);

      const migrations = yield* sql<{
        readonly migration_id: number;
        readonly name: string;
      }>`
        SELECT migration_id, name
        FROM effect_sql_migrations
        WHERE migration_id >= 55 AND migration_id <= 61
        ORDER BY migration_id
      `;
      assert.deepStrictEqual(migrations, [
        { migration_id: 55, name: "ProjectionThreadDelegation" },
        { migration_id: 56, name: "ProjectionThreadsAgentSettle" },
        { migration_id: 57, name: "ProjectionThreadMessageContext" },
        { migration_id: 58, name: "ProjectionThreadsSnoozedTurn" },
        { migration_id: 59, name: "ProjectionThreadTitleState" },
        { migration_id: 60, name: "PullRequestFilesViewed" },
        { migration_id: 61, name: "ProjectionThreadsAutoSettleDisabledAt" },
      ]);
    }),
  );
});
