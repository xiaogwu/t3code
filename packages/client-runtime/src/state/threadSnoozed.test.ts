// @effect-diagnostics globalDate:off -- Tests exercise local calendar snooze boundaries.
import { ThreadId } from "@t3tools/contracts";
import { TurnId } from "@t3tools/contracts";
import type { SnoozePresetSetting } from "@t3tools/contracts/settings";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  canSnooze,
  effectiveSnoozed,
  hasQueuedTurnStart,
  pickSnoozePreset,
  resolveSnoozeDuration,
  resolveSnoozePresets,
  resolveSnoozeForDefault,
  snoozeForTimeError,
  snoozeWakeLabel,
  threadRaisedHandWhileSnoozed,
  threadWokeAt,
  isThreadWokeUnseen,
  type ThreadSnoozeShell,
} from "./threadSettled.ts";

const NOW = "2026-04-10T12:00:00.000Z";
const SNOOZED_AT = "2026-04-10T09:00:00.000Z";
const FUTURE_WAKE = "2026-04-11T09:00:00.000Z";
const PAST_WAKE = "2026-04-10T10:00:00.000Z";

function localDate(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function makeShell(input: {
  readonly snoozedUntil?: string | null;
  readonly snoozedAt?: string | null;
  readonly sessionStatus?: "starting" | "running" | "ready" | "error";
  readonly pending?: "approval" | "user-input";
  readonly turnRequestedAt?: string | null;
  readonly turnCompletedAt?: string | null;
}): ThreadSnoozeShell {
  const threadId = ThreadId.make("thread-1");
  return {
    snoozedUntil: input.snoozedUntil ?? null,
    snoozedAt: input.snoozedAt ?? (input.snoozedUntil != null ? SNOOZED_AT : null),
    hasPendingApprovals: input.pending === "approval",
    hasPendingUserInput: input.pending === "user-input",
    session:
      input.sessionStatus === undefined
        ? null
        : {
            threadId,
            status: input.sessionStatus,
            providerName: "Codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: input.sessionStatus === "error" ? "boom" : null,
            updatedAt: "2026-04-10T11:00:00.000Z",
          },
    latestTurn:
      input.turnCompletedAt === undefined
        ? null
        : {
            turnId: TurnId.make("turn-1"),
            state: "completed",
            requestedAt: input.turnRequestedAt === undefined ? SNOOZED_AT : input.turnRequestedAt,
            startedAt: null,
            completedAt: input.turnCompletedAt,
            assistantMessageId: null,
          },
  };
}

type QueuedTurnShell = Parameters<typeof hasQueuedTurnStart>[0];

function makeQueuedTurnShell(overrides: Partial<QueuedTurnShell> = {}): QueuedTurnShell {
  return { latestUserMessageAt: null, latestTurn: null, session: null, ...overrides };
}

describe("effectiveSnoozed", () => {
  it("never hides on malformed wake data", () => {
    expect(effectiveSnoozed(makeShell({ snoozedUntil: "not-a-date" }), { now: NOW })).toBe(false);
  });

  it("wakes early when the agent is blocked on the user", () => {
    expect(
      effectiveSnoozed(makeShell({ snoozedUntil: FUTURE_WAKE, pending: "approval" }), {
        now: NOW,
      }),
    ).toBe(false);
    expect(
      effectiveSnoozed(makeShell({ snoozedUntil: FUTURE_WAKE, pending: "user-input" }), {
        now: NOW,
      }),
    ).toBe(false);
  });

  it.each([
    {
      reason: "stale failure",
      completedAt: "2026-04-10T08:00:00.000Z",
      pending: undefined,
      wokeAt: null,
    },
    {
      reason: "fresh failure",
      completedAt: "2026-04-10T10:00:00.000Z",
      pending: undefined,
      wokeAt: "2026-04-10T10:00:00.000Z",
    },
    {
      reason: "approval after a stale failure",
      completedAt: "2026-04-10T08:00:00.000Z",
      pending: "approval",
      wokeAt: "2026-04-10T11:00:00.000Z",
    },
    {
      reason: "input after a stale failure",
      completedAt: "2026-04-10T08:00:00.000Z",
      pending: "user-input",
      wokeAt: "2026-04-10T11:00:00.000Z",
    },
  ] as const)(
    "uses the wake event time for $reason despite newer metadata",
    ({ completedAt, pending, wokeAt }) => {
      const shell: ThreadSnoozeShell = {
        ...makeShell({ snoozedUntil: FUTURE_WAKE }),
        hasPendingApprovals: pending === "approval",
        hasPendingUserInput: pending === "user-input",
        runtime: { status: "failed", updatedAt: "2026-04-10T11:00:00.000Z" },
        latestRun: { status: "failed", requestedAt: "2026-04-10T07:00:00.000Z", completedAt },
      };
      expect(effectiveSnoozed(shell, { now: NOW })).toBe(wokeAt === null);
      expect(threadWokeAt(shell, { now: NOW })).toBe(wokeAt);
    },
  );

  it("stays snoozed while the session keeps working — snooze never pauses the agent", () => {
    expect(
      effectiveSnoozed(makeShell({ snoozedUntil: FUTURE_WAKE, sessionStatus: "running" }), {
        now: NOW,
      }),
    ).toBe(true);
  });

  it("stays snoozed when a run requested after the snooze completes", () => {
    const shell = {
      ...makeShell({ snoozedUntil: FUTURE_WAKE }),
      latestRun: {
        status: "completed",
        requestedAt: "2026-04-10T09:00:00.001Z",
        startedAt: "2026-04-10T09:15:00.000Z",
        completedAt: "2026-04-10T10:30:00.000Z",
      },
    };

    expect(effectiveSnoozed(shell, { now: NOW })).toBe(true);
    expect(threadWokeAt(shell, { now: NOW })).toBe(null);
  });
});

describe("threadRaisedHandWhileSnoozed", () => {
  it("is true for approvals, input, and failures", () => {
    expect(
      threadRaisedHandWhileSnoozed(makeShell({ snoozedUntil: FUTURE_WAKE, pending: "approval" })),
    ).toBe(true);
    expect(
      threadRaisedHandWhileSnoozed(makeShell({ snoozedUntil: FUTURE_WAKE, pending: "user-input" })),
    ).toBe(true);
    expect(
      threadRaisedHandWhileSnoozed(
        makeShell({ snoozedUntil: FUTURE_WAKE, sessionStatus: "error" }),
      ),
    ).toBe(true);
  });
});

describe("canSnooze", () => {
  it("refuses blocked-on-you work", () => {
    expect(
      canSnooze({ ...makeShell({ pending: "approval" }), latestUserMessageAt: null }, { now: NOW }),
    ).toBe(false);
    expect(
      canSnooze(
        { ...makeShell({ pending: "user-input" }), latestUserMessageAt: null },
        { now: NOW },
      ),
    ).toBe(false);
    expect(
      canSnooze(
        { ...makeShell({}), latestUserMessageAt: null, pendingSubagentRequest: "approval" },
        { now: NOW },
      ),
    ).toBe(false);
  });

  it("refuses a queued turn start — same invisible-pending-work rule as settle", () => {
    expect(
      canSnooze(
        { ...makeShell({}), latestUserMessageAt: "2026-04-10T11:59:30.000Z" },
        { now: NOW },
      ),
    ).toBe(false);
    expect(
      canSnooze(
        { ...makeShell({}), latestUserMessageAt: "2026-04-10T11:00:00.000Z" },
        { now: NOW },
      ),
    ).toBe(true);
  });
});

describe("hasQueuedTurnStart", () => {
  it("clears queued state when a turn adopts the message or the session fails", () => {
    const messageAt = "2026-04-10T11:59:00.000Z";
    const adopted = makeQueuedTurnShell({
      latestUserMessageAt: messageAt,
      latestTurn: {
        turnId: TurnId.make("turn-adopted"),
        state: "running",
        requestedAt: messageAt,
        startedAt: null,
        completedAt: null,
        assistantMessageId: null,
      },
    });
    const failed = makeQueuedTurnShell({
      latestUserMessageAt: messageAt,
      session: {
        threadId: ThreadId.make("thread-failed"),
        status: "error",
        providerName: "Codex",
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: "failed",
        updatedAt: NOW,
      },
    });
    expect(hasQueuedTurnStart(adopted, { now: NOW })).toBe(false);
    expect(hasQueuedTurnStart(failed, { now: NOW })).toBe(false);
  });
});

describe("threadWokeAt", () => {
  it("reports the timer wake even after an already-requested run completes", () => {
    expect(threadWokeAt(makeShell({ snoozedUntil: PAST_WAKE }), { now: NOW })).toBe(PAST_WAKE);
    const shell = makeShell({
      snoozedUntil: PAST_WAKE,
      turnCompletedAt: "2026-04-10T09:30:00.000Z",
    });
    expect(effectiveSnoozed(shell, { now: NOW })).toBe(false);
    expect(threadWokeAt(shell, { now: NOW })).toBe(PAST_WAKE);
  });

  it.each([
    { reason: "failure", sessionStatus: "error" },
    { reason: "approval", sessionStatus: "ready", pending: "approval" },
    { reason: "user input", sessionStatus: "ready", pending: "user-input" },
  ] as const)("reports $reason activity instead of an already-requested completion", (activity) => {
    const shell = makeShell({
      ...activity,
      snoozedUntil: FUTURE_WAKE,
      turnCompletedAt: "2026-04-10T10:30:00.000Z",
    });
    expect(effectiveSnoozed(shell, { now: NOW })).toBe(false);
    expect(threadWokeAt(shell, { now: NOW })).toBe("2026-04-10T11:00:00.000Z");
  });

  it("keeps the early wake authoritative after the scheduled time passes", () => {
    const shell: ThreadSnoozeShell = {
      ...makeShell({ snoozedUntil: PAST_WAKE }),
      runtime: { status: "failed", updatedAt: "2026-04-10T11:00:00.000Z" },
      latestRun: {
        status: "failed",
        requestedAt: "2026-04-10T09:15:00.000Z",
        completedAt: "2026-04-10T09:30:00.000Z",
      },
    };
    expect(threadWokeAt(shell, { now: NOW })).toBe("2026-04-10T09:30:00.000Z");
  });
});

describe("snoozeWakeLabel", () => {
  const now = "2026-06-02T00:00:00.000Z";

  it("formats remaining time coarsely", () => {
    expect(snoozeWakeLabel("2026-06-02T00:30:00.000Z", { now })).toBe("30m");
    expect(snoozeWakeLabel("2026-06-02T01:30:00.000Z", { now })).toBe("2h");
    expect(snoozeWakeLabel("2026-06-03T02:00:00.000Z", { now })).toBe("1d");
  });

  it("counts calendar days once the wake time is at least a day away", () => {
    expect(snoozeWakeLabel("2026-08-31T17:00:00.000Z", { now: "2026-08-27T16:54:06.737Z" })).toBe(
      "4d",
    );
  });

  it("never reads zero or negative while still snoozed", () => {
    expect(snoozeWakeLabel("2026-06-02T00:00:30.000Z", { now })).toBe("1m");
    expect(snoozeWakeLabel("2026-06-01T23:59:59.000Z", { now })).toBe("now");
    expect(snoozeWakeLabel("not-a-date", { now })).toBe("now");
    expect(snoozeWakeLabel("2026-06-02T09:00:00.000Z", { now: "bad" })).toBe("now");
  });
});

describe("resolveSnoozePresets", () => {
  const formatTime = (date: Date) =>
    `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
  const menu = (now: Date, presets?: ReadonlyArray<SnoozePresetSetting>) =>
    resolveSnoozePresets(now, { formatTime, ...(presets ? { presets } : {}) }).map(
      (preset) => `${preset.label} ${preset.whenLabel}`,
    );

  it("lists custom presets soonest first and names the day when the label does not", () => {
    // Wednesday 20:00.
    expect(
      menu(localDate(2026, 4, 8, 20), [
        { kind: "at", day: "monday", time: "18:00" },
        { kind: "at", day: "tomorrow", time: "21:00" },
        { kind: "after", minutes: 360 },
        { kind: "after", minutes: 180 },
      ]),
    ).toEqual(["In 3 hours 23:00", "In 6 hours Thu 2:00", "Tomorrow 21:00", "Next week Mon 18:00"]);
  });

  it("drops a today preset once its time passes and moves a weekday on that day to next week", () => {
    // Monday 18:30.
    const now = localDate(2026, 4, 13, 18, 30);
    const presets = resolveSnoozePresets(now, {
      presets: [
        { kind: "at", day: "today", time: "18:00" },
        { kind: "at", day: "monday", time: "09:00" },
      ],
    });
    expect(presets.map((preset) => preset.id)).toEqual(["at:monday:09:00"]);
    expect(new Date(presets[0]!.snoozedUntil)).toEqual(localDate(2026, 4, 20, 9));
  });

  it("names the real day gap: a Monday option on Sunday is Tomorrow, a weekday a week out is Next", () => {
    const theo: ReadonlyArray<SnoozePresetSetting> = [
      { kind: "at", day: "tomorrow", time: "21:00" },
      { kind: "at", day: "monday", time: "18:00" },
      { kind: "at", day: "friday", time: "17:00" },
    ];
    // Sunday 14:00.
    expect(menu(localDate(2026, 8, 30, 14), theo)).toEqual([
      "Tomorrow 18:00",
      "Tomorrow 21:00",
      "Friday 17:00",
    ]);
    // Friday 10:00: today's 17:00 is a week away.
    expect(menu(localDate(2026, 9, 4, 10), theo)).toEqual([
      "Tomorrow 21:00",
      "Next week Mon 18:00",
      "Next Friday 17:00",
    ]);
  });

  it("shows one row when two presets wake at the same time", () => {
    // Sunday, so Tomorrow 9:00 and Next week 9:00 are the same Monday.
    expect(menu(localDate(2026, 8, 30, 7, 1))).toEqual([
      "In 1 hour 8:01",
      "In 3 hours 10:01",
      "This evening 18:00",
      "Tomorrow 9:00",
    ]);
  });

  it("treats a duration and a set time in the same minute as one row", () => {
    const now = localDate(2026, 4, 8, 15);
    now.setSeconds(25);
    expect(
      menu(now, [
        { kind: "after", minutes: 180 },
        { kind: "at", day: "today", time: "18:00" },
      ]),
    ).toEqual(["In 3 hours 18:00"]);
  });
});

describe("pickSnoozePreset", () => {
  it("starts a duration when it is picked, even when the menu merged it with a set time", () => {
    const presets: ReadonlyArray<SnoozePresetSetting> = [
      { kind: "at", day: "today", time: "18:30" },
      { kind: "after", minutes: 180 },
    ];
    // At 15:00 the two differ; at 15:30 "In 3 hours" lands on 18:30 and the menu shows one row.
    const shown = resolveSnoozePresets(localDate(2026, 4, 8, 15), { presets });
    const picked = pickSnoozePreset({
      shown,
      id: "after:180",
      now: localDate(2026, 4, 8, 15, 30),
      presets,
    });
    expect(picked?.snoozedUntil).toBe(localDate(2026, 4, 8, 18, 30).toISOString());
  });

  it("keeps a set time's shown wake when the day changes while the menu is open", () => {
    // Sunday 23:59: "Tomorrow" means Monday 9:00, even if the pick lands after midnight.
    const shown = resolveSnoozePresets(localDate(2026, 8, 30, 23, 59));
    const picked = pickSnoozePreset({
      shown,
      id: "at:tomorrow:09:00",
      now: localDate(2026, 8, 31, 0, 1),
    });
    expect(picked?.snoozedUntil).toBe(localDate(2026, 8, 31, 9).toISOString());
  });
});

describe("custom snooze times", () => {
  it("defaults to at least an hour ahead on a 15-minute boundary", () => {
    const now = localDate(2026, 4, 8, 10, 7);
    const value = resolveSnoozeForDefault(now);

    expect(value.getTime()).toBeGreaterThanOrEqual(now.getTime() + 60 * 60 * 1_000);
    expect(value.getMinutes() % 15).toBe(0);
    expect(value.getSeconds()).toBe(0);
    expect(value.getMilliseconds()).toBe(0);
  });

  it("rejects invalid, equal, and past values", () => {
    const now = localDate(2026, 4, 8, 10);

    expect(snoozeForTimeError(new Date(Number.NaN), { now })).toBe("Choose a valid date and time.");
    expect(snoozeForTimeError(new Date(now), { now })).toBe("Choose a time in the future.");
    expect(snoozeForTimeError(localDate(2026, 4, 8, 9), { now })).toBe(
      "Choose a time in the future.",
    );
    expect(snoozeForTimeError(localDate(2026, 4, 8, 11), { now })).toBeNull();
  });
});

describe("resolveSnoozeDuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["minutes", "45", 45 * 60_000],
    ["hours", "1.5", 90 * 60_000],
    ["hours", " 2 ", 2 * 60 * 60_000],
  ] as const)("resolves %s from the moment it is confirmed", (unit, amount, elapsed) => {
    const now = localDate(2026, 4, 8, 10);
    const result = resolveSnoozeDuration({ amount, unit }, { now });

    expect(result.ok && result.value.getTime()).toBe(now.getTime() + elapsed);
  });

  it("keeps the wall-clock time when days cross a spring-forward boundary", () => {
    // Deliberately unlike upstream, which added a flat 24h per day and so woke
    // an hour late in local terms. "In 1 day" means this time tomorrow.
    vi.stubEnv("TZ", "America/Los_Angeles");
    const now = localDate(2027, 3, 13, 12);
    const result = resolveSnoozeDuration({ amount: "1", unit: "days" }, { now });

    expect(result.ok && result.value.getDate()).toBe(14);
    expect(result.ok && result.value.getHours()).toBe(12);
    // 23 hours of elapsed time, because that Sunday is 23 hours long.
    expect(result.ok && result.value.getTime() - now.getTime()).toBe(23 * 60 * 60_000);
  });

  it("carries a fractional day as elapsed time", () => {
    const now = localDate(2026, 4, 8, 10);
    const result = resolveSnoozeDuration({ amount: "1.5", unit: "days" }, { now });

    expect(result.ok && result.value.getDate()).toBe(9);
    expect(result.ok && result.value.getHours()).toBe(22);
  });

  it.each(["", "   ", "0", "-1", "abc", "NaN", "Infinity"])(
    "refuses %s with a message the form can show",
    (amount) => {
      const result = resolveSnoozeDuration(
        { amount, unit: "hours" },
        { now: localDate(2026, 4, 8, 10) },
      );

      expect(result).toEqual({ ok: false, error: "Enter how long to snooze for." });
    },
  );

  it.each(["hours", "days"] as const)("refuses a %s value that overflows the clock", (unit) => {
    const result = resolveSnoozeDuration(
      { amount: "1e300", unit },
      { now: localDate(2026, 4, 8, 10) },
    );

    expect(result).toEqual({ ok: false, error: "Choose a valid date and time." });
  });
});

it("dismisses a wake at its timestamp without hiding a later wake", () => {
  const firstWake = "2026-04-10T10:00:00.000Z";
  const state = {
    wokeAt: firstWake,
    settled: false,
    lastVisitedAt: null,
    latestRunCompletedAt: null,
  };
  expect(isThreadWokeUnseen(state)).toBe(true);
  expect(isThreadWokeUnseen({ ...state, lastVisitedAt: firstWake })).toBe(false);
  expect(isThreadWokeUnseen({ ...state, lastVisitedAt: firstWake, wokeAt: NOW })).toBe(true);
});
