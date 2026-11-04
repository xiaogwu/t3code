import { describe, expect, it } from "vite-plus/test";
import { formatProviderSkillDisplayName } from "./inlineSkills.ts";

describe("formatProviderSkillDisplayName", () => {
  it.each([
    ["mca_lab_status", "Mca Lab Status"],
    ["frontend-design:frontend-design", "Frontend Design Frontend Design"],
    ["superpowers:brainstorming", "Superpowers Brainstorming"],
    ["DesignSync", "DesignSync"],
  ])("title-cases %s when the provider sets no display name", (name, label) => {
    expect(formatProviderSkillDisplayName({ name })).toBe(label);
  });

  it("prefers the provider display name", () => {
    expect(formatProviderSkillDisplayName({ name: "gh-fix-ci", displayName: " Fix CI " })).toBe(
      "Fix CI",
    );
  });
});
