import * as Migrator from "effect/sql/Migrator";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import Migration0001 from "./Migrations/001_OrchestrationEvents.ts";
import Migration0002 from "./Migrations/002_OrchestrationCommandReceipts.ts";
import Migration0003 from "./Migrations/003_CheckpointDiffBlobs.ts";
import Migration0004 from "./Migrations/004_ProviderSessionRuntime.ts";
import Migration0005 from "./Migrations/005_Projections.ts";
import Migration0006 from "./Migrations/006_ProjectionThreadSessionRuntimeModeColumns.ts";
import Migration0007 from "./Migrations/007_ProjectionThreadMessageAttachments.ts";
import Migration0008 from "./Migrations/008_ProjectionThreadActivitySequence.ts";
import Migration0009 from "./Migrations/009_ProviderSessionRuntimeMode.ts";
import Migration0010 from "./Migrations/010_ProjectionThreadsRuntimeMode.ts";
import Migration0011 from "./Migrations/011_OrchestrationThreadCreatedRuntimeMode.ts";
import Migration0012 from "./Migrations/012_ProjectionThreadsInteractionMode.ts";
import Migration0013 from "./Migrations/013_ProjectionThreadProposedPlans.ts";
import Migration0014 from "./Migrations/014_ProjectionThreadProposedPlanImplementation.ts";
import Migration0015 from "./Migrations/015_ProjectionTurnsSourceProposedPlan.ts";
import Migration0016 from "./Migrations/016_CanonicalizeModelSelections.ts";
import Migration0017 from "./Migrations/017_ProjectionThreadsArchivedAt.ts";
import Migration0018 from "./Migrations/018_ProjectionThreadsArchivedAtIndex.ts";
import Migration0019 from "./Migrations/019_ProjectionSnapshotLookupIndexes.ts";
import Migration0020 from "./Migrations/020_AuthAccessManagement.ts";
import Migration0021 from "./Migrations/021_AuthSessionClientMetadata.ts";
import Migration0022 from "./Migrations/022_AuthSessionLastConnectedAt.ts";
import Migration0023 from "./Migrations/023_ProjectionThreadShellSummary.ts";
import Migration0024 from "./Migrations/024_BackfillProjectionThreadShellSummary.ts";
import Migration0025 from "./Migrations/025_CleanupInvalidProjectionPendingApprovals.ts";
import Migration0026 from "./Migrations/026_CanonicalizeModelSelectionOptions.ts";
import Migration0027 from "./Migrations/027_ProviderSessionRuntimeInstanceId.ts";
import Migration0028 from "./Migrations/028_ProjectionThreadSessionInstanceId.ts";
import Migration0029 from "./Migrations/029_ProjectionThreadDetailOrderingIndexes.ts";
import Migration0030 from "./Migrations/030_ProjectionThreadShellArchiveIndexes.ts";
import Migration0031 from "./Migrations/031_AuthAuthorizationScopes.ts";
import Migration0032 from "./Migrations/032_AuthPairingProofKeyThumbprint.ts";
import Migration0033 from "./Migrations/033_ProjectionThreadsSettled.ts";
import Migration0034 from "./Migrations/034_ProjectionThreadsSnoozed.ts";
import Migration0035 from "./Migrations/035_ProjectionThreadTitleRegeneration.ts";
import Migration0036 from "./Migrations/036_ProjectionThreadsPinned.ts";
import Migration0037 from "./Migrations/037_ProjectionTurnsKeysetIndex.ts";
import Migration0038 from "./Migrations/038_ProjectionThreadsPinOrderKey.ts";
import Migration0039 from "./Migrations/039_ProjectionProjectsDefaultThreadEnvMode.ts";
import Migration0040 from "./Migrations/040_ProjectionProjectFaviconPath.ts";
import Migration0041 from "./Migrations/041_AuthSessionClientConnection.ts";
import Migration0042 from "./Migrations/042_ProjectionThreadLinkedPullRequest.ts";
import Migration0043 from "./Migrations/043_ProjectionThreadsUnsettledAt.ts";
import Migration0044 from "./Migrations/044_ReconcileForkMigrationCollisions.ts";
import Migration0045 from "./Migrations/045_ProjectionThreadMessageReplies.ts";
import Migration0046 from "./Migrations/046_ProjectionThreadsTitlePolicy.ts";
import Migration0047 from "./Migrations/047_ClearAutomaticProjectModelDefaults.ts";
import Migration0048 from "./Migrations/048_ProjectionProjectsAutoPull.ts";
import Migration0049 from "./Migrations/049_RepairAutomaticSettlementTimestamps.ts";
import Migration0050 from "./Migrations/050_ProjectionProjectIcon.ts";
import Migration0051 from "./Migrations/051_ProjectionThreadBookmarks.ts";
import Migration0052 from "./Migrations/052_ProjectionThreadBranchPullRequest.ts";
import Migration0053 from "./Migrations/053_ProjectionThreadsActiveOrderKey.ts";
import Migration0054 from "./Migrations/054_ProjectionThreadPullRequests.ts";
import Migration0055 from "./Migrations/055_ProjectionThreadDelegation.ts";
import Migration0056 from "./Migrations/056_ProjectionThreadsAgentSettle.ts";
// Upstream shipped this as 051; the fork's ids 044-046, 051, 055-056 are already
// taken, so it lands at the end of the fork's sequence instead.
import Migration0057 from "./Migrations/057_ProjectionThreadMessageContext.ts";
import Migration0058 from "./Migrations/058_ProjectionThreadsSnoozedTurn.ts";
// Upstream shipped this as 052, where the fork already has
// ProjectionThreadBranchPullRequest, so it lands at the end too.
import Migration0059 from "./Migrations/059_ProjectionThreadTitleState.ts";
// Upstream shipped this as 053, where the fork already has
// ProjectionThreadsActiveOrderKey, so it lands at the end too.
import Migration0060 from "./Migrations/060_PullRequestFilesViewed.ts";
// Upstream shipped this as 054, where the fork already has
// ProjectionThreadPullRequests, so it lands at the end too.
import Migration0061 from "./Migrations/061_ProjectionThreadsAutoSettleDisabledAt.ts";
import Migration0062 from "./Migrations/062_OrchestrationV2.ts";
import Migration0063 from "./Migrations/063_RemoveRedundantProjectionIndexes.ts";
// Upstream ships these as 057-061; the fork's ids run to 063, so they land after it.
import Migration0064 from "./Migrations/064_ScheduledTaskWebhooks.ts";
import Migration0065 from "./Migrations/065_WebhookRelayDeliveries.ts";
import Migration0066 from "./Migrations/066_McpAppModelContext.ts";
import Migration0067 from "./Migrations/067_ThreadSnapshotWindowIndexes.ts";
import Migration0068 from "./Migrations/068_PullRequestReviewGuides.ts";
// Upstream ships this as 062.
import Migration0069 from "./Migrations/069_ThreadFailureLookupIndex.ts";
// Upstream ships these as 063-066; every upstream migration after 56 lands 7
// ids later here.
import Migration0070 from "./Migrations/070_DropUnusedV1Projections.ts";
import Migration0071 from "./Migrations/071_CanonicalizeThreadPullRequestLinks.ts";
import Migration0072 from "./Migrations/072_CodexUsageNativeTurnIndex.ts";
import Migration0073 from "./Migrations/073_RepairClientSettlementTimestamps.ts";
// Upstream ships this as 067.
import Migration0074 from "./Migrations/074_WebhookDedupe.ts";
// Upstream ships this as 068.
import Migration0075 from "./Migrations/075_ShellStopRequestIndex.ts";
// Upstream ships this as 069.
import Migration0076 from "./Migrations/076_ThreadMessageSearch.ts";
// Upstream ships these as 070-072.
import Migration0077 from "./Migrations/077_PeerLinks.ts";
import Migration0078 from "./Migrations/078_PeerLinkFence.ts";
import Migration0079 from "./Migrations/079_WaitingLinkRequestIndex.ts";

export const migrationEntries = [
  [1, "OrchestrationEvents", Migration0001],
  [2, "OrchestrationCommandReceipts", Migration0002],
  [3, "CheckpointDiffBlobs", Migration0003],
  [4, "ProviderSessionRuntime", Migration0004],
  [5, "Projections", Migration0005],
  [6, "ProjectionThreadSessionRuntimeModeColumns", Migration0006],
  [7, "ProjectionThreadMessageAttachments", Migration0007],
  [8, "ProjectionThreadActivitySequence", Migration0008],
  [9, "ProviderSessionRuntimeMode", Migration0009],
  [10, "ProjectionThreadsRuntimeMode", Migration0010],
  [11, "OrchestrationThreadCreatedRuntimeMode", Migration0011],
  [12, "ProjectionThreadsInteractionMode", Migration0012],
  [13, "ProjectionThreadProposedPlans", Migration0013],
  [14, "ProjectionThreadProposedPlanImplementation", Migration0014],
  [15, "ProjectionTurnsSourceProposedPlan", Migration0015],
  [16, "CanonicalizeModelSelections", Migration0016],
  [17, "ProjectionThreadsArchivedAt", Migration0017],
  [18, "ProjectionThreadsArchivedAtIndex", Migration0018],
  [19, "ProjectionSnapshotLookupIndexes", Migration0019],
  [20, "AuthAccessManagement", Migration0020],
  [21, "AuthSessionClientMetadata", Migration0021],
  [22, "AuthSessionLastConnectedAt", Migration0022],
  [23, "ProjectionThreadShellSummary", Migration0023],
  [24, "BackfillProjectionThreadShellSummary", Migration0024],
  [25, "CleanupInvalidProjectionPendingApprovals", Migration0025],
  [26, "CanonicalizeModelSelectionOptions", Migration0026],
  [27, "ProviderSessionRuntimeInstanceId", Migration0027],
  [28, "ProjectionThreadSessionInstanceId", Migration0028],
  [29, "ProjectionThreadDetailOrderingIndexes", Migration0029],
  [30, "ProjectionThreadShellArchiveIndexes", Migration0030],
  [31, "AuthAuthorizationScopes", Migration0031],
  [32, "AuthPairingProofKeyThumbprint", Migration0032],
  [33, "ProjectionThreadsSettled", Migration0033],
  [34, "ProjectionThreadsSnoozed", Migration0034],
  [35, "ProjectionThreadTitleRegeneration", Migration0035],
  [36, "ProjectionThreadsPinned", Migration0036],
  [37, "ProjectionTurnsKeysetIndex", Migration0037],
  [38, "ProjectionThreadsPinOrderKey", Migration0038],
  [39, "ProjectionProjectsDefaultThreadEnvMode", Migration0039],
  [40, "ProjectionProjectFaviconPath", Migration0040],
  [41, "AuthSessionClientConnection", Migration0041],
  [42, "ProjectionThreadLinkedPullRequest", Migration0042],
  [43, "ProjectionThreadsUnsettledAt", Migration0043],
  [44, "ReconcileForkMigrationCollisions", Migration0044],
  [45, "ProjectionThreadMessageReplies", Migration0045],
  [46, "ProjectionThreadsTitlePolicy", Migration0046],
  [47, "ClearAutomaticProjectModelDefaults", Migration0047],
  [48, "ProjectionProjectsAutoPull", Migration0048],
  [49, "RepairAutomaticSettlementTimestamps", Migration0049],
  [50, "ProjectionProjectIcon", Migration0050],
  [51, "ProjectionThreadBookmarks", Migration0051],
  [52, "ProjectionThreadBranchPullRequest", Migration0052],
  [53, "ProjectionThreadsActiveOrderKey", Migration0053],
  [54, "ProjectionThreadPullRequests", Migration0054],
  [55, "ProjectionThreadDelegation", Migration0055],
  [56, "ProjectionThreadsAgentSettle", Migration0056],
  [57, "ProjectionThreadMessageContext", Migration0057],
  [58, "ProjectionThreadsSnoozedTurn", Migration0058],
  [59, "ProjectionThreadTitleState", Migration0059],
  [60, "PullRequestFilesViewed", Migration0060],
  [61, "ProjectionThreadsAutoSettleDisabledAt", Migration0061],
  // Upstream ships these two as 55 and 56. The fork already recorded 55 and 56
  // (delegation, agent settle) on live databases, and the migrator skips any id
  // at or below the highest recorded one, so they land past the fork's range.
  // Preserve this migration's schema. Future V2 schema changes need new migrations.
  [62, "OrchestrationV2", Migration0062],
  [63, "RemoveRedundantProjectionIndexes", Migration0063],
  // Upstream ships these as 57-61. Every upstream migration after 56 lands 7 ids
  // later here, because the fork's ledger already holds 57-63.
  [64, "ScheduledTaskWebhooks", Migration0064],
  [65, "WebhookRelayDeliveries", Migration0065],
  [66, "McpAppModelContext", Migration0066],
  [67, "ThreadSnapshotWindowIndexes", Migration0067],
  [68, "PullRequestReviewGuides", Migration0068],
  [69, "ThreadFailureLookupIndex", Migration0069],
  // Upstream ships these as 63-66.
  [70, "DropUnusedV1Projections", Migration0070],
  [71, "CanonicalizeThreadPullRequestLinks", Migration0071],
  [72, "CodexUsageNativeTurnIndex", Migration0072],
  [73, "RepairClientSettlementTimestamps", Migration0073],
  // Upstream ships this as 67.
  [74, "WebhookDedupe", Migration0074],
  // Upstream ships this as 68.
  [75, "ShellStopRequestIndex", Migration0075],
  // Upstream ships this as 69.
  [76, "ThreadMessageSearch", Migration0076],
  // Upstream ships these as 70-72.
  [77, "PeerLinks", Migration0077],
  [78, "PeerLinkFence", Migration0078],
  [79, "WaitingLinkRequestIndex", Migration0079],
] as const;

export const migrationManifest = migrationEntries.map(([id, name]) => [id, name] as const);

const makeMigrationLoader = (throughId?: number) =>
  Migrator.fromRecord(
    Object.fromEntries(
      migrationEntries
        .filter(([id]) => throughId === undefined || id <= throughId)
        .map(([id, name, migration]) => [`${id}_${name}`, migration]),
    ),
  );

// V2's schema migrations start at 62 after the legacy and fork schema migrations
// (upstream: 55).
const FIRST_V2_MIGRATION_ID = 62;

// Migrators skip ids up to the highest recorded; reject collisions that would skip V2 schema.
const assertV2MigrationsCanRun = Effect.fn("assertV2MigrationsCanRun")(function* (
  throughId?: number,
) {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
  if (tables.length === 0) return;
  const recorded = yield* sql<{
    readonly migration_id: number;
    readonly name: string;
  }>`SELECT migration_id, name FROM effect_sql_migrations`;
  const latestRecordedId = Math.max(0, ...recorded.map((row) => row.migration_id));
  const recordedNames = new Map(recorded.map((row) => [row.migration_id, row.name]));
  const skipped = migrationEntries.flatMap(([id, name]) => {
    if (
      id < FIRST_V2_MIGRATION_ID ||
      id > latestRecordedId ||
      (throughId !== undefined && id > throughId)
    )
      return [];
    const recordedName = recordedNames.get(id);
    if (recordedName === name) return [];
    return [`${id}_${name} (recorded: ${recordedName ?? "nothing"})`];
  });
  if (skipped.length === 0) return;
  return yield* new Migrator.MigrationError({
    kind: "BadState",
    message: `This database's migration history would skip required schema migrations: ${skipped.join(", ")}. The migrator skips every id up to the highest recorded id (${latestRecordedId}), regardless of name. It was probably written by a different build. Start the build that wrote it, or report this migration history so an upgrade path can be added.`,
  });
});

const run = Migrator.make({});

export interface RunMigrationsOptions {
  readonly toMigrationInclusive?: number | undefined;
}

export const runMigrations = Effect.fn("runMigrations")(function* ({
  toMigrationInclusive,
}: RunMigrationsOptions = {}) {
  // Upstream reconciles V2 preview ledgers (OrchestrationV2 at 53 or 54) here.
  // The fork drops it: no fork store recorded V2 there, and its renumbering
  // targets ids 54-56, which the fork already uses.
  const includesV2 =
    toMigrationInclusive === undefined || toMigrationInclusive >= FIRST_V2_MIGRATION_ID;
  if (includesV2) {
    yield* assertV2MigrationsCanRun(toMigrationInclusive);
  }
  const executedMigrations = [
    ...(yield* run({ loader: makeMigrationLoader(toMigrationInclusive) })),
  ];
  const migrations = executedMigrations.map(([id, name]) => `${id}_${name}`);
  yield* migrations.length === 0
    ? Effect.logDebug("Database schema is current")
    : Effect.log("Migrations ran successfully").pipe(Effect.annotateLogs({ migrations }));

  const sql = yield* SqlClient.SqlClient;
  const recorded = yield* sql<{
    readonly migration_id: number;
    readonly name: string;
  }>`SELECT migration_id, name FROM effect_sql_migrations`;
  const manifestNames = new Map<number, string>(migrationEntries.map(([id, name]) => [id, name]));
  const divergent = recorded.flatMap((row) => {
    const expected = manifestNames.get(row.migration_id);
    if (expected === undefined) {
      return [`${row.migration_id}:${row.name} (unknown to this build)`];
    }
    return expected === row.name
      ? []
      : [`${row.migration_id}:${row.name} (this build: ${expected})`];
  });
  if (divergent.length > 0) {
    yield* Effect.logWarning(
      "Database migration history diverges from this build; recorded migration ids are skipped, not reconciled by name.",
    ).pipe(Effect.annotateLogs({ divergent }));
  }
  return executedMigrations;
});
