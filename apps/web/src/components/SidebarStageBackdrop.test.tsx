import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
  StageBackdropArt,
} from "./SidebarStageBackdrop";

describe("SidebarStageBackdrop", () => {
  it("resolves stage artwork only when enabled", () => {
    expect(resolveSidebarStageBackdropVariant("Dev")).toBe("dev");
    expect(resolveSidebarStageBackdropVariant("Nightly")).toBe("nightly");
    expect(resolveSidebarStageBackdropVariant("Dev", false)).toBeNull();
    expect(resolveSidebarStageBackdropVariant("Alpha")).toBeNull();
  });

  it("resolves supported environment pill labels", () => {
    expect(resolveEnvironmentIdentificationPillLabel("Dev")).toBe("Dev");
    expect(resolveEnvironmentIdentificationPillLabel("nightly")).toBe("Nightly");
    expect(resolveEnvironmentIdentificationPillLabel("Latest")).toBeNull();
    expect(resolveEnvironmentIdentificationPillLabel("Alpha")).toBeNull();
  });

  it.each(["nightly", "dev"] as const)(
    "uses unique SVG definition ids when %s artwork is rendered more than once",
    (variant) => {
      const markup = renderToStaticMarkup(
        <>
          <StageBackdropArt variant={variant} />
          <StageBackdropArt variant={variant} />
        </>,
      );
      const ids = Array.from(markup.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);

      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );

  it.each(["nightly", "dev"] as const)("labels the %s artwork in rendered markup", (variant) => {
    const markup = renderToStaticMarkup(<StageBackdropArt variant={variant} />);

    expect(markup).toContain(`data-stage-artwork="${variant}"`);
  });

  it("renders the DEV artwork with blueprint grid and dimension markers", () => {
    const markup = renderToStaticMarkup(<StageBackdropArt variant="dev" />);

    expect(markup).toContain("stage-blueprint");
    expect(markup).toContain("stage-bp-grid-minor");
    expect(markup).toContain("stage-bp-grid-major");
    expect(markup).toContain("stage-bp-arrow-start");
    expect(markup).toContain("stage-bp-arrow-end");
  });
});
