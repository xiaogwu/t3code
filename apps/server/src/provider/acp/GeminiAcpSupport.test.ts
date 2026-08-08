import { describe, expect, it } from "vite-plus/test";

import {
  buildGeminiAcpSpawnInput,
  geminiAcpModeId,
  resolveGeminiAcpBaseModelId,
} from "./GeminiAcpSupport.ts";

describe("GeminiAcpSupport", () => {
  it("launches Apple Gemini in ACP mode without auto-updating", () => {
    expect(
      buildGeminiAcpSpawnInput({ binaryPath: "/opt/apple/bin/apple-gemini" }, "/workspace", {
        GEMINI_HOME: "/tmp/gemini",
      }),
    ).toEqual({
      command: "/opt/apple/bin/apple-gemini",
      args: ["--no-auto-update", "--acp"],
      cwd: "/workspace",
      env: { GEMINI_HOME: "/tmp/gemini" },
    });
  });

  it("maps T3 permission and interaction modes onto Gemini ACP modes", () => {
    expect(geminiAcpModeId("approval-required")).toBe("default");
    expect(geminiAcpModeId("auto-accept-edits")).toBe("autoEdit");
    expect(geminiAcpModeId("auto")).toBe("autoEdit");
    expect(geminiAcpModeId("full-access")).toBe("yolo");
    expect(geminiAcpModeId("full-access", "plan")).toBe("plan");
  });

  it("normalizes an empty model selection to auto", () => {
    expect(resolveGeminiAcpBaseModelId(undefined)).toBe("auto");
    expect(resolveGeminiAcpBaseModelId("gemini-2.5-pro")).toBe("gemini-2.5-pro");
  });
});
