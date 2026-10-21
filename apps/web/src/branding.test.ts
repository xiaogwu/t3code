import { describe, expect, it } from "vite-plus/test";
import { resolveServerBackedAppStageLabel } from "./branding.logic";

describe("branding logic", () => {
  it("keeps DEV build identification when connected to a nightly server", () => {
    expect(
      resolveServerBackedAppStageLabel({
        primaryServerVersion: "0.0.28-nightly.20260616.12",
        fallbackStageLabel: "Dev",
      }),
    ).toBe("Dev");
  });
});
