import { describe, expect, it } from "vite-plus/test";

import { normalizeTitlePolicyEvaluation } from "./TextGenerationUtils.ts";

const base = {
  gist: "Review sidebar cleanup",
  identifiers: ["PR #4821"],
  shouldRename: true,
  suggestedTitle: "Review sidebar cleanup",
  reason: "A PR URL established a durable identifier",
  confidence: 0.9,
};

describe("normalizeTitlePolicyEvaluation", () => {
  it("passes a usable evaluation through unchanged", () => {
    expect(normalizeTitlePolicyEvaluation(base)).toEqual(base);
  });

  it("refuses to rename when the model returns a whitespace-only description", () => {
    const result = normalizeTitlePolicyEvaluation({ ...base, suggestedTitle: "   \n  " });
    expect(result.shouldRename).toBe(false);
    expect(result.suggestedTitle).toBe("");
  });

  it("refuses to rename when the description is only quote characters", () => {
    const result = normalizeTitlePolicyEvaluation({ ...base, suggestedTitle: '"""' });
    expect(result.shouldRename).toBe(false);
    expect(result.suggestedTitle).toBe("");
  });

  it("never substitutes the New thread placeholder for an empty description", () => {
    // sanitizeThreadTitle would return "New thread" here, which would land as
    // real content in a composed title.
    expect(normalizeTitlePolicyEvaluation({ ...base, suggestedTitle: "" }).suggestedTitle).toBe("");
  });

  it("keeps the first line only and collapses runs of whitespace", () => {
    const result = normalizeTitlePolicyEvaluation({
      ...base,
      suggestedTitle: '  "Review   sidebar cleanup"  \nDiscarded second line',
    });
    expect(result.suggestedTitle).toBe("Review sidebar cleanup");
    expect(result.shouldRename).toBe(true);
  });

  it("does not truncate a long description, because composeTitle owns the budget", () => {
    const long = "Review sidebar cleanup and terminal font regressions across every surface";
    expect(normalizeTitlePolicyEvaluation({ ...base, suggestedTitle: long }).suggestedTitle).toBe(
      long,
    );
  });

  it("clamps confidence into the range the prompt asks for", () => {
    expect(normalizeTitlePolicyEvaluation({ ...base, confidence: 5 }).confidence).toBe(1);
    expect(normalizeTitlePolicyEvaluation({ ...base, confidence: -2 }).confidence).toBe(0);
  });

  it("leaves shouldRename false when the model already declined", () => {
    const result = normalizeTitlePolicyEvaluation({ ...base, shouldRename: false });
    expect(result.shouldRename).toBe(false);
  });
});
