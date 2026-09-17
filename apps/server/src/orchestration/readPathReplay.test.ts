// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeSqlite from "node:sqlite";

import { describe, expect, it } from "vite-plus/test";
import {
  OrchestrationEvent,
  OrchestrationEventType,
  OrchestrationMessage,
  OrchestrationThreadActivity,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { projectActivityPayload } from "./ActivityPayloadProjection.ts";

/**
 * Replays a real database through the read path's real codecs.
 *
 * Every DEV build break so far has been this: the app compiles, every unit
 * test passes, and then the server chokes the first time it reads state a
 * shipped build wrote. Two examples, neither visible to typecheck — a stored
 * message role the contract union does not list (the whole thread read fails),
 * and a projected activity payload holding `undefined` (the whole snapshot
 * response fails to encode). This test is the gate for that class: point it at
 * a copy of a real database and it decodes the events, encodes the projected
 * activities, and decodes the messages, naming any row the current contracts
 * cannot carry.
 *
 * Run it before staging a build, against a snapshot of live state:
 *
 *   bun -e "new (require('bun:sqlite').Database)(process.env.HOME + \
 *     '/.t3/userdata/state.sqlite', { readonly: true }) \
 *     .run(\"VACUUM INTO '/tmp/replay/state.sqlite'\")"
 *   T3CODE_REPLAY_STATE_DB=/tmp/replay/state.sqlite vp test run \
 *     apps/server/src/orchestration/readPathReplay.test.ts
 *
 * `VACUUM INTO` is safe while a server holds the source open; a plain `cp` is
 * not. Never point this at `~/.t3/userdata` itself.
 *
 * Rows are grouped by payload shape and one row per shape is replayed, which
 * turns ~570K rows into a couple of seconds without losing a distinct shape.
 * The signature keeps short token-like strings and empty strings verbatim,
 * since those are what union discriminants and non-empty-string checks turn
 * on, and collapses free-form text to its type.
 *
 * Deliberately not replayed: reply context (`reply_to_json`) and the turn and
 * session projections. Add them here when a break comes from one.
 */

const fixturePath = process.env.T3CODE_REPLAY_STATE_DB;

const MAX_SHAPE_DEPTH = 8;
const MAX_ARRAY_SAMPLE = 8;
const MAX_REPORTED_FAILURES = 10;

function isTokenLike(value: string): boolean {
  return value.trim().length === 0 || (value.length <= 24 && /^[a-z][a-z0-9._-]*$/i.test(value));
}

function shapeSignature(value: unknown, depth = 0): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    if (depth >= MAX_SHAPE_DEPTH) {
      return "[...]";
    }
    const entries = new Set(
      value.slice(0, MAX_ARRAY_SAMPLE).map((entry) => shapeSignature(entry, depth + 1)),
    );
    return `[${[...entries].sort().join("|")}]`;
  }
  if (typeof value === "object") {
    if (depth >= MAX_SHAPE_DEPTH) {
      return "{...}";
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${key}:${shapeSignature(record[key], depth + 1)}`)
      .join(",")}}`;
  }
  if (typeof value === "string") {
    return isTokenLike(value) ? JSON.stringify(value) : "string";
  }
  return typeof value;
}

interface Replay<Row> {
  readonly rows: ReadonlyArray<Row>;
  readonly signature: (row: Row) => string;
  readonly label: (row: Row) => string;
  readonly carry: (row: Row) => void;
}

/**
 * Runs `carry` once per distinct shape and returns the failures, so a broken
 * shape is reported with the id of a row that has it rather than as a count.
 */
function replayDistinctShapes<Row>({ rows, signature, label, carry }: Replay<Row>) {
  const seen = new Set<string>();
  const failures: string[] = [];
  for (const row of rows) {
    const key = signature(row);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    try {
      carry(row);
    } catch (error) {
      failures.push(`${label(row)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { shapes: seen.size, failures };
}

function report(kind: string, scanned: number, result: ReturnType<typeof replayDistinctShapes>) {
  const detail = result.failures
    .slice(0, MAX_REPORTED_FAILURES)
    .map((failure) => `  - ${failure}`)
    .join("\n");
  const overflow =
    result.failures.length > MAX_REPORTED_FAILURES
      ? `\n  ... and ${result.failures.length - MAX_REPORTED_FAILURES} more`
      : "";
  return [
    `${kind}: ${result.failures.length} of ${result.shapes} distinct shapes (${scanned} rows) cannot cross the wire`,
    detail + overflow,
  ].join("\n");
}

interface EventRow {
  readonly sequence: number;
  readonly eventId: string;
  readonly type: string;
  readonly aggregateKind: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly commandId: string | null;
  readonly causationEventId: string | null;
  readonly correlationId: string | null;
  readonly payloadJson: string;
  readonly metadataJson: string;
}

describe.skipIf(fixturePath === undefined)("read path replay", () => {
  const openFixture = () => {
    if (fixturePath === undefined || !NodeFS.existsSync(fixturePath)) {
      throw new Error(`T3CODE_REPLAY_STATE_DB is not a file: ${fixturePath}`);
    }
    return new NodeSqlite.DatabaseSync(fixturePath, { readOnly: true });
  };

  it("decodes every stored event shape this build claims to understand", () => {
    const db = openFixture();
    try {
      // Event types outside this build's union are version skew the store
      // already filters in SQL, so they are not this test's business. A known
      // type whose payload no longer decodes is the bug being hunted.
      const rows = db
        .prepare(
          `SELECT sequence, event_id AS eventId, event_type AS type, aggregate_kind AS aggregateKind,
                  stream_id AS aggregateId, occurred_at AS occurredAt, command_id AS commandId,
                  causation_event_id AS causationEventId, correlation_id AS correlationId,
                  payload_json AS payloadJson, metadata_json AS metadataJson
           FROM orchestration_events
           WHERE event_type IN (${OrchestrationEventType.literals.map(() => "?").join(",")})
           ORDER BY sequence ASC`,
        )
        .all(...OrchestrationEventType.literals) as unknown as ReadonlyArray<EventRow>;
      const decode = Schema.decodeUnknownSync(OrchestrationEvent);

      const result = replayDistinctShapes({
        rows,
        signature: (row) => `${row.type}${shapeSignature(JSON.parse(row.payloadJson))}`,
        label: (row) => `${row.type} (event ${row.eventId})`,
        carry: ({ payloadJson, metadataJson, ...row }) =>
          decode({
            ...row,
            payload: JSON.parse(payloadJson),
            metadata: JSON.parse(metadataJson),
          }),
      });

      expect(result.failures, report("events", rows.length, result)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("keeps every stored activity payload encodable after projection", () => {
    const db = openFixture();
    try {
      const rows = db
        .prepare(
          `SELECT activity_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
           FROM projection_thread_activities`,
        )
        .all() as ReadonlyArray<Record<string, string | number | null>>;
      const encode = Schema.encodeUnknownSync(Schema.toCodecJson(OrchestrationThreadActivity));
      const toActivity = (row: Record<string, string | number | null>) => ({
        id: row.activity_id,
        tone: row.tone,
        kind: row.kind,
        summary: row.summary,
        payload: JSON.parse(String(row.payload_json)),
        turnId: row.turn_id,
        ...(row.sequence === null ? {} : { sequence: row.sequence }),
        createdAt: row.created_at,
      });

      const result = replayDistinctShapes({
        rows,
        signature: (row) => `${row.kind}${shapeSignature(JSON.parse(String(row.payload_json)))}`,
        label: (row) => `${row.kind} (activity ${row.activity_id})`,
        // The projection is what the snapshot endpoint serves, so the encode
        // has to happen on its output, not on the stored row.
        carry: (row) => encode(projectActivityPayload(toActivity(row) as never)),
      });

      expect(result.failures, report("activities", rows.length, result)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("decodes every stored message shape", () => {
    const db = openFixture();
    try {
      const rows = db
        .prepare(
          `SELECT message_id, turn_id, role, text, attachments_json, context_json,
                  is_streaming, created_at, updated_at
           FROM projection_thread_messages`,
        )
        .all() as ReadonlyArray<Record<string, string | number | null>>;
      const decode = Schema.decodeUnknownSync(OrchestrationMessage);

      const result = replayDistinctShapes({
        rows,
        signature: (row) =>
          [
            row.role,
            row.attachments_json === null
              ? ""
              : shapeSignature(JSON.parse(String(row.attachments_json))),
            row.context_json === null ? "" : shapeSignature(JSON.parse(String(row.context_json))),
            row.turn_id === null ? "no-turn" : "turn",
            String(row.text).trim().length === 0 ? "empty-text" : "text",
          ].join("|"),
        label: (row) => `role=${row.role} (message ${row.message_id})`,
        carry: (row) =>
          decode({
            id: row.message_id,
            role: row.role,
            text: row.text,
            turnId: row.turn_id,
            streaming: row.is_streaming !== 0,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            ...(row.attachments_json === null
              ? {}
              : { attachments: JSON.parse(String(row.attachments_json)) }),
            ...(row.context_json === null ? {} : { context: JSON.parse(String(row.context_json)) }),
          }),
      });

      expect(result.failures, report("messages", rows.length, result)).toEqual([]);
    } finally {
      db.close();
    }
  });
});
