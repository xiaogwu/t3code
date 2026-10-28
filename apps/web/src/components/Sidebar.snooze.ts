import type { EnvironmentId } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import {
  pickSnoozePreset as pickSharedSnoozePreset,
  resolveSnoozePresets as resolveSharedSnoozePresets,
  snoozeForTimeError,
  snoozeWakeLabel,
  type SnoozePreset,
} from "@t3tools/client-runtime/state/thread-settled";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { serverEnvironment } from "../state/server";
import { formatShortTimestamp } from "../timestampFormat";
import { toastManager } from "./ui/toast";

export { snoozeWakeLabel, type SnoozePreset };

const DAY_MS = 24 * 60 * 60 * 1_000;
const MINUTE_MS = 60 * 1_000;

export type SnoozeForInputResult =
  | { readonly ok: true; readonly value: Date }
  | { readonly ok: false; readonly error: string };

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

/** Formats a Date for an HTML datetime-local input without losing local time. */
export function formatSnoozeForInput(value: Date): string {
  return [
    `${value.getFullYear()}-${padDatePart(value.getMonth() + 1)}-${padDatePart(value.getDate())}`,
    `${padDatePart(value.getHours())}:${padDatePart(value.getMinutes())}`,
  ].join("T");
}

function matchesLocalParts(
  value: Date,
  parts: readonly [number, number, number, number, number],
): boolean {
  return (
    value.getFullYear() === parts[0] &&
    value.getMonth() === parts[1] - 1 &&
    value.getDate() === parts[2] &&
    value.getHours() === parts[3] &&
    value.getMinutes() === parts[4]
  );
}

/**
 * Parses a browser local wall time. Component round-tripping rejects DST-gap
 * normalization, while nearby timezone offsets let a repeated wall time
 * resolve to its still-future occurrence regardless of the fallback size.
 */
export function parseSnoozeForInput(
  input: string,
  options: { readonly now: Date },
): SnoozeForInputResult {
  const match = /^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input);
  if (!match) return { ok: false, error: "Choose a valid date and time." };
  const parts = match.slice(1).map(Number) as unknown as readonly [
    number,
    number,
    number,
    number,
    number,
  ];
  const initial = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], 0, 0);
  if (!matchesLocalParts(initial, parts)) {
    return { ok: false, error: "Choose a valid date and time." };
  }

  const initialOffset = initial.getTimezoneOffset();
  const nearbyOffsets = new Set(
    [-2, -1, 0, 1, 2].map((dayDelta) =>
      new Date(initial.getTime() + dayDelta * DAY_MS).getTimezoneOffset(),
    ),
  );
  const candidates = [...nearbyOffsets]
    .map((offset) => new Date(initial.getTime() + (offset - initialOffset) * MINUTE_MS))
    .filter((candidate) => matchesLocalParts(candidate, parts))
    .toSorted((left, right) => left.getTime() - right.getTime());
  const future = candidates.findLast(
    (candidate) => snoozeForTimeError(candidate, options) === null,
  );
  if (future) return { ok: true, value: future };
  return {
    ok: false,
    error: snoozeForTimeError(initial, options) ?? "Choose a valid date and time.",
  };
}

/** The snooze menu for a thread, from its environment's presets, read when the menu opens. */
export function resolveSnoozePresets(
  now: Date,
  timestampFormat: TimestampFormat,
  environmentId: EnvironmentId,
): ReadonlyArray<SnoozePreset> {
  return resolveSharedSnoozePresets(now, snoozeOptions(timestampFormat, environmentId));
}

/** A shown menu choice as picked; see the shared `pickSnoozePreset`. */
export function pickSnoozePreset(
  shown: ReadonlyArray<SnoozePreset>,
  id: string,
  timestampFormat: TimestampFormat,
  environmentId: EnvironmentId,
): SnoozePreset | undefined {
  const picked = pickSharedSnoozePreset({
    shown,
    id,
    now: new Date(),
    ...snoozeOptions(timestampFormat, environmentId),
  });
  if (!picked) {
    toastManager.add({
      type: "warning",
      title: "Could not snooze thread",
      description: "That snooze time has passed. Choose another time.",
    });
  }
  return picked;
}

function snoozeOptions(timestampFormat: TimestampFormat, environmentId: EnvironmentId) {
  const presets = appAtomRegistry.get(
    serverEnvironment.settingsValueAtom(environmentId),
  )?.snoozePresets;
  return {
    ...(presets ? { presets } : {}),
    formatTime: (date: Date) => formatShortTimestamp(date.toISOString(), timestampFormat),
  };
}

/**
 * Preset stand-in for a wake time the user picked in the "Until…" dialog.
 * Snoozing only reads `snoozedUntil`; the label and time column exist for
 * the menu rows a custom time never renders in.
 */
export function customSnoozePreset(snoozedUntil: string): SnoozePreset {
  return { id: "hour", label: "Until", whenLabel: "", snoozedUntil };
}
