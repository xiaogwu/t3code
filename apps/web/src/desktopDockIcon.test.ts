import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { GROVE_THEME } from "./themePalette";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("desktop Dock icon", () => {
  it("uses the active Grove palette", async () => {
    const { resolveThemeDockIconColors } = await import("./desktopDockIcon");

    expect(resolveThemeDockIconColors("grove", "light")).toEqual(GROVE_THEME.colors);
  });

  it("renders a PNG and sends it to a compatible desktop shell", async () => {
    const addColorStop = vi.fn();
    const context = {
      beginPath: vi.fn(),
      clip: vi.fn(),
      closePath: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop })),
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
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      getContext: vi.fn(() => context),
      height: 0,
      toDataURL: vi.fn(() => "data:image/png;base64,grove"),
      width: 0,
    } as unknown as HTMLCanvasElement;
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
    vi.stubGlobal("Path2D", class Path2DMock {});
    const setDockIcon = vi.fn().mockResolvedValue(undefined);
    const { syncDesktopDockIconPreference } = await import("./desktopDockIcon");

    await expect(syncDesktopDockIconPreference({ setDockIcon }, "grove", "light")).resolves.toBe(
      true,
    );

    expect(canvas.width).toBe(512);
    expect(canvas.height).toBe(512);
    expect(addColorStop).toHaveBeenNthCalledWith(1, 0, GROVE_THEME.colors.messageAction);
    expect(addColorStop).toHaveBeenNthCalledWith(2, 0.48, GROVE_THEME.colors.accent);
    expect(setDockIcon).toHaveBeenCalledWith({ dataUrl: "data:image/png;base64,grove" });
  });
});
