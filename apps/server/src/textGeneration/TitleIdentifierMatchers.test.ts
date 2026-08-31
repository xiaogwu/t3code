import { defaultTitlePolicy } from "@t3tools/contracts";
import type { TitlePolicyRule } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveProtectedPrefix } from "./TitleIdentifierMatchers.ts";

describe("resolveProtectedPrefix", () => {
  it("matches an initial /oliver command", () => {
    const result = resolveProtectedPrefix(
      "USER:\n/oliver please help me",
      defaultTitlePolicy.rules,
    );
    expect(result).toEqual({ prefix: "Oliver", ruleName: "Oliver sessions" });
  });
  it("extracts a GitHub PR prefix", () => {
    const result = resolveProtectedPrefix(
      "Please review https://github.com/acme/app/pull/4821 for sidebar regressions",
      defaultTitlePolicy.rules,
    );
    expect(result).toEqual({ prefix: "PR#4821:", ruleName: "GitHub pull requests" });
  });

  it("extracts a ProdGit PR prefix", () => {
    const result = resolveProtectedPrefix(
      "$pr-review https://prodgit.apple.com/content-engineering/politics-embeds-us/pull/391",
      defaultTitlePolicy.rules,
    );
    expect(result).toEqual({ prefix: "PR#391:", ruleName: "ProdGit pull requests" });
  });

  it("extracts a GitHub issue prefix", () => {
    const result = resolveProtectedPrefix(
      "See https://github.com/acme/app/issues/932",
      defaultTitlePolicy.rules,
    );
    expect(result).toEqual({ prefix: "#932", ruleName: "GitHub issues" });
  });

  it("extracts a Radar prefix from rdar:// and radar:// forms", () => {
    expect(resolveProtectedPrefix("rdar://12345678", defaultTitlePolicy.rules)).toEqual({
      prefix: "Radar 12345678",
      ruleName: "Radar",
    });
    expect(resolveProtectedPrefix("radar://182440013", defaultTitlePolicy.rules)).toEqual({
      prefix: "Radar 182440013",
      ruleName: "Radar",
    });
  });

  it("supports a custom urlMatches rule", () => {
    const customRule: TitlePolicyRule = {
      name: "Linear",
      when: { urlMatches: "linear.app/*/issue/{identifier}" },
      prefix: "{identifier}",
      placement: "start",
      priority: 100,
    };
    const result = resolveProtectedPrefix("https://linear.app/acme/issue/ENG-417/reduce-latency", [
      customRule,
    ]);
    expect(result).toEqual({ prefix: "ENG-417", ruleName: "Linear" });
  });

  it("returns the highest-priority match when multiple rules match", () => {
    const result = resolveProtectedPrefix(
      "https://github.com/acme/app/pull/4821 and https://github.com/acme/app/issues/932",
      defaultTitlePolicy.rules,
    );
    expect(result?.ruleName).toBe("GitHub pull requests"); // priority 100 vs 90
  });

  it("breaks priority ties by earliest matching rule in the array", () => {
    const first: TitlePolicyRule = {
      name: "First",
      when: { urlKind: "github_pull" },
      prefix: "PR #{number}",
      placement: "start",
      priority: 100,
    };
    const second: TitlePolicyRule = {
      name: "Second",
      when: { urlKind: "radar" },
      prefix: "Radar {identifier}",
      placement: "start",
      priority: 100,
    };
    const text = "https://github.com/acme/app/pull/4821 rdar://12345678";

    expect(resolveProtectedPrefix(text, [first, second])?.ruleName).toBe("First");
    expect(resolveProtectedPrefix(text, [second, first])?.ruleName).toBe("Second");
  });

  it("returns null when nothing matches", () => {
    expect(resolveProtectedPrefix("just a plain message", defaultTitlePolicy.rules)).toBeNull();
  });

  it("returns null for a malformed reference that doesn't satisfy the rule pattern", () => {
    expect(
      resolveProtectedPrefix("see github.com/acme/app/pull/ for details", defaultTitlePolicy.rules),
    ).toBeNull();
  });

  it("returns null when a rule's when clause has neither urlKind nor urlMatches", () => {
    const emptyRule: TitlePolicyRule = {
      name: "Empty",
      when: {},
      prefix: "X {number}",
      placement: "start",
      priority: 100,
    };
    expect(resolveProtectedPrefix("https://github.com/acme/app/pull/4821", [emptyRule])).toBeNull();
  });

  it("does not resolve the huge glob patterns pathologically (linear time)", () => {
    const rule: TitlePolicyRule = {
      name: "Custom",
      when: { urlMatches: "example.com/*/*/*/{identifier}" },
      prefix: "ID {identifier}",
      placement: "start",
      priority: 100,
    };
    const adversarialText = `example.com/${"a".repeat(5000)}!`;
    const start = performance.now();
    const result = resolveProtectedPrefix(adversarialText, [rule]);
    expect(performance.now() - start).toBeLessThan(200);
    expect(result).toBeNull();
  });
});
