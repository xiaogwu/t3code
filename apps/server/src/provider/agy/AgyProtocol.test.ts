import { describe, expect, it } from "@effect/vitest";
import { parseAgyModelsOutput, parseAgyStreamLine } from "./AgyProtocol.ts";

describe("AgyProtocol", () => {
  it("parses model rows and ignores CLI progress", () => {
    expect(
      parseAgyModelsOutput(
        "Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\nclaude-sonnet-4-6 Claude Sonnet 4.6 (Thinking)\n",
      ),
    ).toEqual([
      { slug: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
      { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
    ]);
  });

  it("parses streamed assistant deltas", () => {
    expect(
      parseAgyStreamLine(
        '{"event":"step_update","step_update":{"conversation_id":"c1","step_index":2,"state":"ACTIVE","step_type":"agent_response","text_delta":"hello"}}',
      ),
    ).toMatchObject({
      event: "step_update",
      step_update: { state: "ACTIVE", step_type: "agent_response", text_delta: "hello" },
    });
  });

  it("rejects malformed and future event shapes without throwing", () => {
    expect(parseAgyStreamLine("not json")).toBeUndefined();
    expect(parseAgyStreamLine('{"event":"future"}')).toBeUndefined();
  });
});
