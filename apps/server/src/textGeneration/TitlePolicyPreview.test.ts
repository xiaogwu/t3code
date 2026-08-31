import { ProviderInstanceId, defaultTitlePolicy } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it, vi } from "vite-plus/test";

import * as TextGeneration from "./TextGeneration.ts";
import { previewTitlePolicy } from "./TitlePolicyPreview.ts";

const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5-codex",
};

const fakeTextGenerationReturning = (suggestedTitle: string) =>
  Layer.succeed(TextGeneration.TextGeneration, {
    generateCommitMessage: vi.fn(),
    generatePrContent: vi.fn(),
    generateBranchName: vi.fn(),
    generateThreadTitle: vi.fn(),
    evaluateTitlePolicy: vi.fn(() =>
      Effect.succeed({
        gist: suggestedTitle,
        identifiers: [],
        shouldRename: true,
        suggestedTitle,
        reason: "Fixture evaluation for the preview dry run",
        confidence: 0.9,
      }),
    ),
  });

describe("previewTitlePolicy", () => {
  it("reports pass for an example whose deterministic prefix and model description match", async () => {
    const results = await Effect.runPromise(
      previewTitlePolicy(defaultTitlePolicy, modelSelection).pipe(
        Effect.provide(fakeTextGenerationReturning("Prevent sidebar scroll resets")),
      ),
    );
    expect(results[0]!.pass).toBe(true);
    expect(results[0]!.actual).toBe("PR#4821: Prevent sidebar scroll resets");
  });

  it("reports fail when the actual title does not match the expected one", async () => {
    const results = await Effect.runPromise(
      previewTitlePolicy(defaultTitlePolicy, modelSelection).pipe(
        Effect.provide(fakeTextGenerationReturning("Something unrelated")),
      ),
    );
    expect(results[0]!.pass).toBe(false);
  });
});
