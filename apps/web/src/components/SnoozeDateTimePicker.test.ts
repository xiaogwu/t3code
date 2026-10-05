import { describe, expect, it } from "vite-plus/test";

import { monthDays, resolveFirstDayOfWeek } from "./SnoozeDateTimePicker";

describe("resolveFirstDayOfWeek", () => {
  it("prefers the desktop system override", () => {
    expect(resolveFirstDayOfWeek(1, "en-US")).toBe(1);
  });

  it("uses locale week metadata on the web", () => {
    expect(resolveFirstDayOfWeek(null, "en-GB")).toBe(1);
    expect(resolveFirstDayOfWeek(null, "en-US")).toBe(0);
  });

  it("falls back to Sunday for an invalid locale", () => {
    expect(resolveFirstDayOfWeek(undefined, "not_a_locale")).toBe(0);
  });
});

describe("monthDays", () => {
  it("aligns the date grid with the configured first weekday", () => {
    const september = new Date(2026, 8, 1);
    expect(monthDays(september, 1)[0]).toEqual(new Date(2026, 7, 31));
    expect(monthDays(september, 0)[0]).toEqual(new Date(2026, 7, 30));
  });
});
