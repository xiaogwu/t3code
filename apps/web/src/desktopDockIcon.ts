import type { DesktopBridge } from "@t3tools/contracts";
import {
  mixThemePreviewBase,
  THEME_PREVIEW_RENDER_SPECS,
  themePreviewGlowRadius,
} from "@t3tools/shared/themePreview";
import type {
  ThemeAppearance,
  ThemeColors,
  ThemeDefinition,
  ThemePreference,
} from "./themePalette";
import { getThemeColorsForMode, getThemeDefinition, themeColorToHex } from "./themePalette";

type DesktopDockIconBridge = Pick<DesktopBridge, "setDockIcon">;

/** The palette a Dock icon is drawn from, plus the appearance it belongs to. */
export type DockIconPalette = Readonly<{
  appearance: ThemeAppearance;
  colors: ThemeColors;
}>;

const ICON_SIZE = 512;
const T3_MARK_PATH =
  "M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z";

function roundedSquare(context: CanvasRenderingContext2D): void {
  context.beginPath();
  context.roundRect(20, 20, 472, 472, 104);
  context.closePath();
}

// Canvas gradient stops need a concrete alpha, and `oklch()`/`color-mix()`
// support in canvas color strings lags the CSS parser, so fade through hex.
function withAlpha(color: string, alpha: number): string {
  const hex = themeColorToHex(color);
  if (!hex) return color;
  const existing = hex.length > 7 ? Number.parseInt(hex.slice(7, 9), 16) / 255 : 1;
  const channel = Math.round(Math.min(1, Math.max(0, alpha * existing)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex.slice(0, 7)}${channel}`;
}

/**
 * Paints one of the preview spec's glows. The spec's offsets are fractions of
 * a farthest-corner ray, so the glow covers the same share of the icon as it
 * does of a settings preview orb.
 */
function paintGlow(
  context: CanvasRenderingContext2D,
  color: string,
  spec: { center: readonly [x: number, y: number]; endOffset: number },
  stops: ReadonlyArray<readonly [offset: number, alpha: number]>,
): void {
  const x = spec.center[0] * ICON_SIZE;
  const y = spec.center[1] * ICON_SIZE;
  const radius = themePreviewGlowRadius(spec.center) * ICON_SIZE;
  const glow = context.createRadialGradient(x, y, 0, x, y, radius);
  for (const [offset, alpha] of stops) glow.addColorStop(offset, withAlpha(color, alpha));
  glow.addColorStop(1, withAlpha(color, 0));
  context.fillStyle = glow;
  context.fillRect(0, 0, ICON_SIZE, ICON_SIZE);
}

export function createThemeDockIconDataUrl(palette: DockIconPalette): string | null {
  if (typeof document === "undefined" || typeof Path2D === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const { appearance, colors } = palette;
  const spec = THEME_PREVIEW_RENDER_SPECS[appearance];

  context.save();
  roundedSquare(context);
  context.clip();

  // The canvas carries the tile's light/dark identity, exactly as it does for
  // the settings preview orbs: a near-true base with contained accent glows.
  // Washing the tile in accent instead makes both appearances read alike,
  // which is why a dark theme used to ship a bright icon.
  context.fillStyle = mixThemePreviewBase(colors, appearance);
  context.fillRect(0, 0, ICON_SIZE, ICON_SIZE);

  // The action color is a soft tint from the opposite corner, not a second
  // light source — two bright hotspots read as headlights.
  paintGlow(context, colors.messageAction, spec.action, [
    [0, spec.action.startOpacity],
    [spec.action.endOffset, 0],
  ]);
  paintGlow(context, colors.accent, spec.accent, [
    [0, 1],
    [spec.accent.middleOffset, spec.accent.middleOpacity],
    [spec.accent.endOffset, 0],
  ]);

  context.strokeStyle = colors.text;
  context.lineWidth = 1;
  context.globalAlpha = 0.18;
  for (let position = 52; position < 492; position += 32) {
    context.beginPath();
    context.moveTo(position, 20);
    context.lineTo(position, 492);
    context.stroke();
    context.beginPath();
    context.moveTo(20, position);
    context.lineTo(492, position);
    context.stroke();
  }

  context.globalAlpha = 0.28;
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(256, 20);
  context.lineTo(256, 492);
  context.moveTo(20, 256);
  context.lineTo(492, 256);
  context.stroke();

  context.globalAlpha = 0.45;
  context.lineWidth = 3;
  roundedSquare(context);
  context.stroke();
  context.restore();

  context.save();
  context.translate(0, 8);
  context.scale(4, 4);
  // The mark tracks the palette's own text color, so it stays legible whether
  // the base came out near-white or near-black.
  context.fillStyle = colors.text;
  context.shadowColor = "rgba(0, 0, 0, 0.28)";
  context.shadowBlur = 5;
  context.shadowOffsetY = 2;
  context.fill(new Path2D(T3_MARK_PATH));
  context.restore();

  return canvas.toDataURL("image/png");
}

/**
 * Picks the half to draw. A theme without a half for the requested appearance
 * falls back to the one it does define, and reports that half's own appearance
 * so the tile is not mixed toward a base the palette never meant.
 */
export function dockIconPaletteFor(
  definition: ThemeDefinition,
  appearance: ThemeAppearance,
): DockIconPalette {
  const colors = getThemeColorsForMode(definition, appearance);
  return colors
    ? { appearance, colors }
    : { appearance: definition.appearance, colors: definition.colors };
}

export function resolveThemeDockIconPalette(
  theme: ThemePreference,
  appearance: ThemeAppearance,
): DockIconPalette | null {
  const definition = getThemeDefinition(theme);
  return definition ? dockIconPaletteFor(definition, appearance) : null;
}

export async function syncDesktopDockIconPreference(
  bridge: DesktopDockIconBridge,
  theme: ThemePreference,
  appearance: ThemeAppearance,
): Promise<boolean> {
  if (typeof bridge.setDockIcon !== "function") return false;
  const palette = resolveThemeDockIconPalette(theme, appearance);
  if (!palette) return false;
  const dataUrl = createThemeDockIconDataUrl(palette);
  if (!dataUrl) return false;
  await bridge.setDockIcon({ dataUrl });
  return true;
}
