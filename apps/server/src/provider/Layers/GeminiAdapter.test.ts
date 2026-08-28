import { assert, it } from "@effect/vitest";

import type { AcpToolCallState } from "../acp/AcpRuntimeModel.ts";
import { geminiHasUnsettledToolCalls } from "./GeminiAdapter.ts";

function toolCall(status: NonNullable<AcpToolCallState["status"]>): AcpToolCallState {
  return { toolCallId: "tool-1", status, data: {} };
}

it("rejects ACP end_turn while a Gemini tool call is unfinished", () => {
  assert.isTrue(geminiHasUnsettledToolCalls(new Map([["tool-1", toolCall("pending")]])));
  assert.isTrue(geminiHasUnsettledToolCalls(new Map([["tool-1", toolCall("inProgress")]])));
});

it("accepts ACP end_turn after Gemini tool calls settle", () => {
  assert.isFalse(geminiHasUnsettledToolCalls(new Map([["tool-1", toolCall("completed")]])));
  assert.isFalse(geminiHasUnsettledToolCalls(new Map([["tool-1", toolCall("failed")]])));
  assert.isFalse(geminiHasUnsettledToolCalls(new Map()));
});
