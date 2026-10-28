import { defaultTitlePolicy, type TitlePolicyRule } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  composeTitle,
  expandTitleTemplate,
  finishTitle,
  planTitle,
  resolveTitlePolicyRule,
} from "./TitlePolicy.ts";

const prefixOf = (
  context: string,
  rules: ReadonlyArray<TitlePolicyRule> = defaultTitlePolicy.rules,
) => resolveTitlePolicyRule(context, rules)?.prefix ?? null;

const rule = (overrides: Partial<TitlePolicyRule> & Pick<TitlePolicyRule, "name" | "when">) =>
  ({ prefix: "X", placement: "start", priority: 100, ...overrides }) satisfies TitlePolicyRule;

describe("resolveTitlePolicyRule", () => {
  it("reads PR, issue, Radar, and glob references", () => {
    expect(prefixOf("review https://github.com/acme/app/pull/4821 please")).toBe("PR#4821:");
    expect(prefixOf("$pr-review https://prodgit.apple.com/team/repo/pull/391")).toBe("PR#391:");
    expect(prefixOf("see https://github.com/acme/app/issues/932")).toBe("#932");
    expect(prefixOf("rdar://12345678 and radar://9")).toBe("Radar 12345678");
    expect(
      prefixOf("https://linear.app/acme/issue/ENG-417/x", [
        rule({
          name: "Linear",
          when: { urlMatches: "linear.app/*/issue/{identifier}" },
          prefix: "{identifier}",
        }),
      ]),
    ).toBe("ENG-417");
  });

  it("stops a glob capture at markdown and table punctuation", () => {
    const url = "https://prodgit.apple.com/team/repo/pull/548";
    expect(prefixOf(`Opened **[#548](${url})**: ready`)).toBe("PR#548:");
    expect(prefixOf(`| ${url}|PR |`)).toBe("PR#548:");
  });

  it("matches a command only as the first word of the first user message", () => {
    expect(prefixOf("USER:\n/oliver brief me")).toBe("Oliver");
    expect(prefixOf("USER:\nplease run /oliver")).toBeNull();
  });

  it("takes Radar and issue references from user messages, PR links from anyone", () => {
    const radarInReply = "USER:\nRank this backlog\n\nASSISTANT:\n#8 (rdar://71615102) is small";
    expect(prefixOf(radarInReply)).toBeNull();
    expect(prefixOf(`${radarInReply}\n\nUSER:\nlook at rdar://42`)).toBe("Radar 42");
    expect(
      prefixOf("USER:\nfix it\n\nASSISTANT:\nsee https://github.com/acme/app/issues/932"),
    ).toBeNull();
    expect(
      prefixOf("USER:\nfix it\n\nASSISTANT:\nOpened https://github.com/acme/app/pull/4821"),
    ).toBe("PR#4821:");
    expect(
      prefixOf("USER:\nfix it\n\nASSISTANT:\nOpened https://prodgit.apple.com/team/repo/pull/391"),
    ).toBe("PR#391:");
  });

  it("prefers higher priority, then the earlier rule", () => {
    const both = "https://github.com/acme/app/pull/4821 https://github.com/acme/app/issues/932";
    expect(prefixOf(both)).toBe("PR#4821:");
    const first = rule({ name: "First", when: { urlKind: "github_pull" }, prefix: "A" });
    const second = rule({ name: "Second", when: { urlKind: "github_issue" }, prefix: "B" });
    expect(prefixOf(both, [first, second])).toBe("A");
    expect(prefixOf(both, [second, first])).toBe("B");
  });

  it("ignores malformed references and patterns without a capture", () => {
    expect(prefixOf("see github.com/acme/app/pull/ for details")).toBeNull();
    expect(
      prefixOf("https://example.com/a/b", [
        rule({ name: "No capture", when: { urlMatches: "example.com/*" } }),
      ]),
    ).toBeNull();
  });

  it("stays linear on adversarial glob input", () => {
    const glob = rule({ name: "Deep", when: { urlMatches: "example.com/*/*/*/{identifier}" } });
    const start = performance.now();
    expect(prefixOf(`example.com/${"a".repeat(5000)}!`, [glob])).toBeNull();
    expect(performance.now() - start).toBeLessThan(200);
  });
});

describe("expandTitleTemplate", () => {
  it("expands both tokens from the instant it is given", () => {
    const at = DateTime.toEpochMillis(
      DateTime.makeZonedUnsafe("2026-09-19T07:05:00", {
        timeZone: DateTime.zoneMakeLocal(),
        adjustForTimeZone: true,
      }),
    );
    expect(expandTitleTemplate("Oliver {today:MM/DD/YYYY} {now:HH:mm}", at)).toBe(
      "Oliver 09/19/2026 07:05",
    );
  });
});

describe("composing titles", () => {
  it("fits the description behind the prefix", () => {
    expect(
      composeTitle({ protectedPrefix: "PR#1:", description: "a".repeat(60), maxCharacters: 20 }),
    ).toBe(`PR#1: ${"a".repeat(13)}…`);
  });

  it("leaves titles alone when the policy is off", () => {
    const plan = planTitle({ ...defaultTitlePolicy, enabled: false }, "USER:\n/oliver", 0);
    expect(plan).toMatchObject({ type: "generate", prefix: null, instructions: undefined });
    if (plan.type === "generate")
      expect(finishTitle(plan, "Anything at all")).toBe("Anything at all");
  });

  it("passes rule guidance and suggestions to the model and strips a repeated prefix", () => {
    const plan = planTitle(defaultTitlePolicy, "USER:\nhttps://github.com/a/b/pull/7", 0);
    if (plan.type !== "generate") throw new Error("expected a generated title");
    expect(plan.instructions).toContain("Avoid completion claims.");
    expect(plan.instructions).toContain("Use PR metadata");
    expect(finishTitle(plan, "PR#7: Fix login")).toBe("PR#7: Fix login");
    expect(finishTitle(plan, "Fix login")).toBe("PR#7: Fix login");
  });
});
