import * as Schema from "effect/Schema";
import { NonNegativeInt } from "@t3tools/contracts";

const AgyUsage = Schema.Struct({
  input_tokens: Schema.optional(NonNegativeInt),
  output_tokens: Schema.optional(NonNegativeInt),
  thinking_tokens: Schema.optional(NonNegativeInt),
  cache_read_tokens: Schema.optional(NonNegativeInt),
  total_tokens: Schema.optional(NonNegativeInt),
});

const AgyInitEvent = Schema.Struct({
  event: Schema.Literal("init"),
  conversation_id: Schema.String,
  init: Schema.Struct({
    cwd: Schema.optional(Schema.String),
    tools: Schema.optional(Schema.Array(Schema.String)),
    permission_mode: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    agent: Schema.optional(Schema.String),
  }),
});

const AgyStepUpdate = Schema.Struct({
  conversation_id: Schema.String,
  step_index: NonNegativeInt,
  state: Schema.Literals(["ACTIVE", "DONE"]),
  step_type: Schema.Literals(["user_input", "agent_response", "tool", "checkpoint"]),
  tool_name: Schema.optional(Schema.String),
  text_delta: Schema.optional(Schema.String),
  duration_seconds: Schema.optional(Schema.Number),
  usage: Schema.optional(AgyUsage),
  tool_info: Schema.optional(
    Schema.Struct({
      name: Schema.optional(Schema.String),
      parameters: Schema.optional(Schema.Unknown),
      output: Schema.optional(Schema.Unknown),
      error: Schema.optional(Schema.Unknown),
    }),
  ),
  subagent_info: Schema.optional(Schema.Unknown),
});

const AgyStepUpdateEvent = Schema.Struct({
  event: Schema.Literal("step_update"),
  step_update: AgyStepUpdate,
});

const AgyResultEvent = Schema.Struct({
  event: Schema.Literal("result"),
  result: Schema.Struct({
    conversation_id: Schema.String,
    status: Schema.String,
    response: Schema.String,
    error: Schema.optional(Schema.String),
    duration_seconds: Schema.optional(Schema.Number),
    num_turns: Schema.optional(NonNegativeInt),
    usage: Schema.optional(AgyUsage),
  }),
});

export const AgyStreamEvent = Schema.Union([AgyInitEvent, AgyStepUpdateEvent, AgyResultEvent]);
export type AgyStreamEvent = typeof AgyStreamEvent.Type;
export type AgyStreamUsage = typeof AgyUsage.Type;

const decodeAgyStreamEvent = Schema.decodeUnknownExit(Schema.fromJsonString(AgyStreamEvent));

export function parseAgyStreamLine(line: string): AgyStreamEvent | undefined {
  const decoded = decodeAgyStreamEvent(line);
  return decoded._tag === "Success" ? decoded.value : undefined;
}

export interface AgyModelEntry {
  readonly slug: string;
  readonly name: string;
}

export function parseAgyModelsOutput(stdout: string): ReadonlyArray<AgyModelEntry> {
  const seen = new Set<string>();
  const models: AgyModelEntry[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.toLowerCase().startsWith("fetching available models")) continue;
    const match = line.match(/^(\S+)\s+(.+)$/);
    if (!match) continue;
    const slug = match[1]?.trim() ?? "";
    const name = match[2]?.trim() ?? "";
    if (!slug || !name || seen.has(slug)) continue;
    seen.add(slug);
    models.push({ slug, name });
  }
  return models;
}
