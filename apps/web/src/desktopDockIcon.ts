import type { DesktopBridge } from "@t3tools/contracts";
import type { ThemeAppearance, ThemeColors, ThemePreference } from "./themePalette";
import { getThemeColorsForMode, getThemeDefinition } from "./themePalette";

type DesktopDockIconBridge = Pick<DesktopBridge, "setDockIcon">;

const ICON_SIZE = 512;
const T3_MARK_PATH =
  "M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z";

function roundedSquare(context: CanvasRenderingContext2D): void {
  context.beginPath();
  context.roundRect(20, 20, 472, 472, 104);
  context.closePath();
}

export function createThemeDockIconDataUrl(colors: ThemeColors): string | null {
  if (typeof document === "undefined" || typeof Path2D === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.save();
  roundedSquare(context);
  context.clip();

  const background = context.createLinearGradient(70, 34, 450, 490);
  background.addColorStop(0, colors.messageAction);
  background.addColorStop(0.48, colors.accent);
  background.addColorStop(1, colors.focus);
  context.fillStyle = background;
  context.fillRect(0, 0, ICON_SIZE, ICON_SIZE);

  context.strokeStyle = colors.accentForeground;
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
  context.fillStyle = colors.accentForeground;
  context.shadowColor = "rgba(0, 0, 0, 0.28)";
  context.shadowBlur = 5;
  context.shadowOffsetY = 2;
  context.fill(new Path2D(T3_MARK_PATH));
  context.restore();

  return canvas.toDataURL("image/png");
}

export function resolveThemeDockIconColors(
  theme: ThemePreference,
  appearance: ThemeAppearance,
): ThemeColors | null {
  const definition = getThemeDefinition(theme);
  return definition ? (getThemeColorsForMode(definition, appearance) ?? definition.colors) : null;
}

export async function syncDesktopDockIconPreference(
  bridge: DesktopDockIconBridge,
  theme: ThemePreference,
  appearance: ThemeAppearance,
): Promise<boolean> {
  if (typeof bridge.setDockIcon !== "function") return false;
  const colors = resolveThemeDockIconColors(theme, appearance);
  if (!colors) return false;
  const dataUrl = createThemeDockIconDataUrl(colors);
  if (!dataUrl) return false;
  await bridge.setDockIcon({ dataUrl });
  return true;
}
