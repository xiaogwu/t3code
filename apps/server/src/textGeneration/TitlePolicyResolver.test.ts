import { describe, expect, it } from "vite-plus/test";

import { composeTitle, expandTitleTemplate, shouldEvaluateNow } from "./TitlePolicyResolver.ts";

describe("composeTitle", () => {
  it("puts the protected prefix first and truncates the description to fit", () => {
    const title = composeTitle({
      protectedPrefix: "PR#4821:",
      description: "Review sidebar cleanup and terminal font regressions",
      maxCharacters: 30,
    });
    expect(title.startsWith("PR#4821: ")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(30);
  });

  it("returns just the description when there is no protected prefix", () => {
    expect(
      composeTitle({ protectedPrefix: null, description: "Fix audio handoff", maxCharacters: 50 }),
    ).toBe("Fix audio handoff");
  });

  it("truncates a description-only title that exceeds the budget", () => {
    const title = composeTitle({
      protectedPrefix: null,
      description: "A very long description that will not fit in the budget",
      maxCharacters: 20,
    });
    expect(title.length).toBeLessThanOrEqual(20);
    expect(title.endsWith("…")).toBe(true);
  });

  it("returns the empty string for an empty description and no prefix", () => {
    expect(composeTitle({ protectedPrefix: null, description: "   ", maxCharacters: 50 })).toBe("");
  });

  it("returns just the prefix when the description is empty or whitespace-only", () => {
    expect(
      composeTitle({ protectedPrefix: "PR#4821:", description: "   ", maxCharacters: 50 }),
    ).toBe("PR#4821:");
  });

  it("returns the protected prefix intact, never truncated, even over budget", () => {
    const title = composeTitle({
      protectedPrefix: "Radar 182440013 super long identifier prefix",
      description: "Fix the crash",
      maxCharacters: 10,
    });
    expect(title.startsWith("Radar 182440013 super long identifier prefix")).toBe(true);
  });
});

describe("expandTitleTemplate", () => {
  it("formats deterministic local dates for exact title rules", () => {
    expect(expandTitleTemplate("Oliver {today:MM/DD/YYYY}", Date.UTC(2026, 7, 31, 12))).toBe(
      "Oliver 08/31/2026",
    );
  });

  it("stamps a zero-padded 24-hour local time so same-day runs get distinct titles", () => {
    // Asserted as a shape and a difference rather than a literal, because the
    // wall-clock reading of a fixed instant depends on the host timezone.
    const earlier = expandTitleTemplate("Upgrade {now:HH:mm}", Date.UTC(2026, 7, 31, 9, 5));
    const later = expandTitleTemplate("Upgrade {now:HH:mm}", Date.UTC(2026, 7, 31, 21, 35));
    expect(earlier).toMatch(/^Upgrade (?:[01]\d|2[0-3]):[0-5]\d$/);
    expect(later).toMatch(/^Upgrade (?:[01]\d|2[0-3]):[0-5]\d$/);
    expect(later).not.toBe(earlier);
  });

  it("accepts an ISO timestamp so callers can anchor to a thread's createdAt", () => {
    expect(expandTitleTemplate("Oliver {today:MM/DD/YYYY}", "2026-08-31T12:00:00.000Z")).toBe(
      "Oliver 08/31/2026",
    );
  });

  it("falls back to now rather than writing Invalid Date into a title", () => {
    expect(expandTitleTemplate("Upgrade {today:MM/DD/YYYY}", "not-a-timestamp")).toMatch(
      /^Upgrade \d{2}\/\d{2}\/\d{4}$/,
    );
  });
});

describe("shouldEvaluateNow", () => {
  it("never evaluates a manually locked title when preserveManualTitles is set", () => {
    expect(
      shouldEvaluateNow({
        titleProvenance: "manual",
        preserveManualTitles: true,
        protectedPrefixChanged: true,
        turnsSincePolicyEval: 10,
        refreshEveryTurns: 4,
        isTurnRunning: false,
      }),
    ).toBe(false);
  });

  it("evaluates immediately when a new protected prefix appears", () => {
    expect(
      shouldEvaluateNow({
        titleProvenance: "automatic",
        preserveManualTitles: true,
        protectedPrefixChanged: true,
        turnsSincePolicyEval: 0,
        refreshEveryTurns: 4,
        isTurnRunning: false,
      }),
    ).toBe(true);
  });

  it("evaluates once refreshEveryTurns is reached", () => {
    expect(
      shouldEvaluateNow({
        titleProvenance: "automatic",
        preserveManualTitles: true,
        protectedPrefixChanged: false,
        turnsSincePolicyEval: 4,
        refreshEveryTurns: 4,
        isTurnRunning: false,
      }),
    ).toBe(true);
  });

  it("does not evaluate before refreshEveryTurns and without a new prefix", () => {
    expect(
      shouldEvaluateNow({
        titleProvenance: "automatic",
        preserveManualTitles: true,
        protectedPrefixChanged: false,
        turnsSincePolicyEval: 2,
        refreshEveryTurns: 4,
        isTurnRunning: false,
      }),
    ).toBe(false);
  });

  it("never evaluates while a turn is still running, even with a new prefix", () => {
    expect(
      shouldEvaluateNow({
        titleProvenance: "automatic",
        preserveManualTitles: true,
        protectedPrefixChanged: true,
        turnsSincePolicyEval: 10,
        refreshEveryTurns: 4,
        isTurnRunning: true,
      }),
    ).toBe(false);
  });

  it("evaluates a manual title past the threshold when preserveManualTitles is false", () => {
    expect(
      shouldEvaluateNow({
        titleProvenance: "manual",
        preserveManualTitles: false,
        protectedPrefixChanged: false,
        turnsSincePolicyEval: 4,
        refreshEveryTurns: 4,
        isTurnRunning: false,
      }),
    ).toBe(true);
  });
});
