import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { mixThemePreviewBase } from "@t3tools/shared/themePreview";
import { GROVE_THEME } from "./themePalette";

const GROVE_DARK = GROVE_THEME.variants!.dark!;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubCanvas() {
  const radialStops: Array<[number, string]> = [];
  const fillStyles: string[] = [];
  const context = {
    beginPath: vi.fn(),
    clip: vi.fn(),
    closePath: vi.fn(),
    createRadialGradient: vi.fn(() => ({
      addColorStop: (offset: number, color: string) => {
        radialStops.push([offset, color]);
      },
    })),
    fill: vi.fn(),
    fillRect: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    restore: vi.fn(),
    roundRect: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    set fillStyle(value: string) {
      fillStyles.push(value);
    },
  } as unknown as CanvasRenderingContext2D;
  const canvas = {
    getContext: vi.fn(() => context),
    height: 0,
    toDataURL: vi.fn(() => "data:image/png;base64,grove"),
    width: 0,
  } as unknown as HTMLCanvasElement;
  vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
  vi.stubGlobal("Path2D", class Path2DMock {});
  return { canvas, context, fillStyles, radialStops };
}

describe("desktop Dock icon", () => {
  it("uses the active Grove palette", async () => {
    const { resolveThemeDockIconPalette } = await import("./desktopDockIcon");

    expect(resolveThemeDockIconPalette("grove", "light")).toEqual({
      appearance: "light",
      colors: GROVE_THEME.colors,
    });
    expect(resolveThemeDockIconPalette("grove", "dark")).toEqual({
      appearance: "dark",
      colors: GROVE_DARK,
    });
  });

  it("reports the half it fell back to when a theme lacks the requested one", async () => {
    const { dockIconPaletteFor } = await import("./desktopDockIcon");
    const lightOnly = {
      id: GROVE_THEME.id,
      label: GROVE_THEME.label,
      appearance: GROVE_THEME.appearance,
      colors: GROVE_THEME.colors,
    };

    expect(dockIconPaletteFor(lightOnly, "dark")).toEqual({
      appearance: "light",
      colors: GROVE_THEME.colors,
    });
  });

  it("renders a PNG and sends it to a compatible desktop shell", async () => {
    const { canvas, fillStyles } = stubCanvas();
    const setDockIcon = vi.fn().mockResolvedValue(undefined);
    const { syncDesktopDockIconPreference } = await import("./desktopDockIcon");

    await expect(syncDesktopDockIconPreference({ setDockIcon }, "grove", "light")).resolves.toBe(
      true,
    );

    expect(canvas.width).toBe(512);
    expect(canvas.height).toBe(512);
    expect(fillStyles[0]).toBe(mixThemePreviewBase(GROVE_THEME.colors, "light"));
    expect(setDockIcon).toHaveBeenCalledWith({ dataUrl: "data:image/png;base64,grove" });
  });

  it("keeps each appearance's own light or dark identity", async () => {
    const { createThemeDockIconDataUrl } = await import("./desktopDockIcon");
    const baseOf = (appearance: "light" | "dark") => {
      const { fillStyles } = stubCanvas();
      createThemeDockIconDataUrl({
        appearance,
        colors: appearance === "dark" ? GROVE_DARK : GROVE_THEME.colors,
      });
      vi.unstubAllGlobals();
      return fillStyles[0]!;
    };
    const luminance = (hex: string) =>
      [1, 3, 5].reduce(
        (total, offset) => total + Number.parseInt(hex.slice(offset, offset + 2), 16),
        0,
      ) / 3;

    // The regression this guards: an accent-only wash made the dark tile as
    // bright as the light one, because dark palettes carry bright accents.
    expect(luminance(baseOf("dark"))).toBeLessThan(80);
    expect(luminance(baseOf("light"))).toBeGreaterThan(200);
  });

  it("fades glows through hex so canvas can parse every stop", async () => {
    const { createThemeDockIconDataUrl } = await import("./desktopDockIcon");
    const { radialStops } = stubCanvas();

    createThemeDockIconDataUrl({ appearance: "dark", colors: GROVE_DARK });

    expect(radialStops.length).toBeGreaterThan(0);
    for (const [, color] of radialStops) expect(color).toMatch(/^#[\da-f]{8}$/i);
    expect(
      radialStops.filter(([offset]) => offset === 1).every(([, color]) => color.endsWith("00")),
    ).toBe(true);
  });
});
