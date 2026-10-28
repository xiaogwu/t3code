import { describe, expect, it } from "vite-plus/test";

import { isMacPlatform } from "~/lib/utils";
import { composerSubmitTooltip } from "./ComposerPrimaryActions";

describe("composerSubmitTooltip", () => {
  const running = {
    status: null,
    compactTokens: null,
    compactsBeforeSend: false,
    queuesBehindCompaction: false,
    isRunning: true,
    isEditingQueuedMessage: false,
    followUpBehavior: "steer" as const,
    alternateAction: "queue",
    alternateShortcutLabel: null,
    submitLabel: "Steer message",
  };

  it("explains the queue instead of offering steer while compacting", () => {
    const modifier = isMacPlatform(navigator.platform) ? "⌘" : "Ctrl";
    expect(composerSubmitTooltip(running)).toBe(`Click to steer, ${modifier}-click to queue`);
    expect(composerSubmitTooltip({ ...running, queuesBehindCompaction: true })).toBe(
      "Sends after compacting",
    );
  });

  it("lets a blocking status win over the compaction hint", () => {
    expect(
      composerSubmitTooltip({ ...running, queuesBehindCompaction: true, status: "Connecting" }),
    ).toBe("Connecting");
  });
});
