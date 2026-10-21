import { describe, expect, it } from "vite-plus/test";

import { formatSnoozeForInput, parseSnoozeForInput } from "./Sidebar.snooze";

function localDate(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

describe("custom snooze browser input", () => {
  it("round-trips local date and time without applying a UTC offset", () => {
    const value = localDate(2026, 4, 8, 13, 45);
    const input = formatSnoozeForInput(value);
    const parsed = parseSnoozeForInput(input, { now: localDate(2026, 4, 8, 10) });

    expect(input).toBe("2026-04-08T13:45");
    expect(parsed).toEqual({ ok: true, value });
  });

  it("round-trips dates with more than four year digits", () => {
    const value = localDate(10_000, 1, 1, 13, 45);
    const input = formatSnoozeForInput(value);

    expect(input).toBe("10000-01-01T13:45");
    expect(parseSnoozeForInput(input, { now: localDate(9_999, 12, 31, 0) })).toEqual({
      ok: true,
      value,
    });
  });

  it("rejects malformed, normalized, and expired local values", () => {
    const now = localDate(2026, 4, 8, 10);

    expect(parseSnoozeForInput("", { now })).toEqual({
      ok: false,
      error: "Choose a valid date and time.",
    });
    expect(parseSnoozeForInput("2026-02-30T11:00", { now })).toEqual({
      ok: false,
      error: "Choose a valid date and time.",
    });
    expect(parseSnoozeForInput("2026-04-08T09:00", { now })).toEqual({
      ok: false,
      error: "Choose a time in the future.",
    });
  });

  it("rejects a local wall time normalized through a daylight-saving gap", () => {
    const normalized = localDate(2026, 3, 8, 2, 30);
    // UTC and zones without a March DST transition have no gap to exercise.
    if (normalized.getHours() === 2 && normalized.getMinutes() === 30) return;

    expect(parseSnoozeForInput("2026-03-08T02:30", { now: localDate(2026, 3, 7, 12) })).toEqual({
      ok: false,
      error: "Choose a valid date and time.",
    });
  });

  it("chooses the future occurrence of a repeated local hour", () => {
    const firstOccurrence = localDate(2026, 11, 1, 1, 30);
    const secondOccurrence = new Date(firstOccurrence.getTime() + 60 * 60 * 1_000);
    // UTC and zones without a one-hour November fallback have no repeat.
    if (formatSnoozeForInput(secondOccurrence) !== "2026-11-01T01:30") return;

    expect(
      parseSnoozeForInput("2026-11-01T01:30", {
        now: new Date(firstOccurrence.getTime() + 30 * 60 * 1_000),
      }),
    ).toEqual({ ok: true, value: secondOccurrence });
  });

  it("supports repeated local times from a 30-minute fallback", () => {
    const originalTimezone = process.env.TZ;
    try {
      process.env.TZ = "Australia/Lord_Howe";
      const firstOccurrence = localDate(2026, 4, 5, 1, 45);
      const secondOccurrence = new Date(firstOccurrence.getTime() + 30 * 60 * 1_000);

      expect(formatSnoozeForInput(secondOccurrence)).toBe("2026-04-05T01:45");
      expect(
        parseSnoozeForInput("2026-04-05T01:45", {
          now: new Date(firstOccurrence.getTime() + 15 * 60 * 1_000),
        }),
      ).toEqual({ ok: true, value: secondOccurrence });
    } finally {
      process.env.TZ = originalTimezone;
    }
  });
});
