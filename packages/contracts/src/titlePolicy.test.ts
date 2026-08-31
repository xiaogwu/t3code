import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { TitlePolicy, TitlePolicyPreviewResult, defaultTitlePolicy } from "./titlePolicy.ts";

const decodeTitlePolicy = Schema.decodeUnknownSync(TitlePolicy);
const decodeTitlePolicyPreviewResult = Schema.decodeUnknownSync(TitlePolicyPreviewResult);

describe("TitlePolicy", () => {
  it("decodes the built-in default policy", () => {
    const decoded = decodeTitlePolicy(defaultTitlePolicy);
    expect(decoded.version).toBe(1);
    expect(decoded.defaults.maxCharacters).toBe(50);
    expect(decoded.defaults.refreshEveryTurns).toBe(4);
    expect(decoded.rules.map((rule) => rule.name)).toEqual([
      "GitHub pull requests",
      "ProdGit pull requests",
      "Oliver sessions",
      "GitHub issues",
      "Radar",
    ]);
  });

  it("rejects a rule with an empty name", () => {
    expect(() =>
      decodeTitlePolicy({
        ...defaultTitlePolicy,
        rules: [{ ...defaultTitlePolicy.rules[0], name: "" }],
      }),
    ).toThrow();
  });
});

describe("TitlePolicyPreviewResult", () => {
  it("decodes a sample preview result", () => {
    const decoded = decodeTitlePolicyPreviewResult({
      example: defaultTitlePolicy.examples[0],
      actual: "PR#4821: Review sidebar regressions",
      pass: true,
    });
    expect(decoded.pass).toBe(true);
    expect(decoded.actual).toBe("PR#4821: Review sidebar regressions");
  });
});
