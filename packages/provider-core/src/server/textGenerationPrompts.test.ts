import { describe, expect, it } from "vite-plus/test";

import { buildThreadTitlePrompt } from "./textGenerationPrompts.ts";
import { normalizeCliError } from "./textGenerationUtils.ts";

describe("buildThreadTitlePrompt", () => {
  it("allows a PR number only for work on a linked pull request", () => {
    expect(
      buildThreadTitlePrompt({
        message: "Investigate reconnect regressions after session restore",
      }).prompt,
    ).toContain(
      "Omit PR numbers unless the request is work on a pull request and includes its URL;",
    );
    expect(
      buildThreadTitlePrompt({
        message: `USER:\nInvestigate reconnect regressions\n\nASSISTANT:\nThe remaining issue is stale session state`,
        previousTitle: "Investigate reconnect regressions",
      }).prompt,
    ).toContain(
      "Omit PR numbers unless the thread is doing work on a pull request and contains its URL;",
    );
  });
});

describe("normalizeCliError", () => {
  it("does not expose CLI failure details in the public error message", () => {
    const result = normalizeCliError(
      "codex",
      "generateCommitMessage",
      new Error("request failed with access_token=secret-token"),
      "Failed to generate a commit message",
    );

    expect(result.detail).toBe("Failed to generate a commit message");
    expect(result.message).not.toContain("secret-token");
  });
});
