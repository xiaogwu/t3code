import { assert, describe, it } from "@effect/vitest";

import { selectStageArtifacts, type StageArtifactEntry } from "./build-artifacts.ts";

const names = (entries: ReadonlyArray<StageArtifactEntry>) => entries.map((entry) => entry.name);

describe("build-artifacts", () => {
  it("leaves the unpacked bundle behind when a distributable target produced it", () => {
    // The layout electron-builder leaves in the stage for `--target dmg`: the
    // distributables, plus the mac-arm64 bundle they were built from.
    const selected = selectStageArtifacts({
      target: "dmg",
      entries: [
        { name: "T3-Code-0.0.41-arm64.dmg", type: "File" },
        { name: "T3-Code-0.0.41-arm64.dmg.blockmap", type: "File" },
        { name: "T3-Code-0.0.41-arm64.zip", type: "File" },
        { name: "T3-Code-0.0.41-arm64.zip.blockmap", type: "File" },
        { name: "builder-debug.yml", type: "File" },
        { name: "mac-arm64", type: "Directory" },
      ],
    });

    assert.deepStrictEqual(names(selected), [
      "T3-Code-0.0.41-arm64.dmg",
      "T3-Code-0.0.41-arm64.dmg.blockmap",
      "T3-Code-0.0.41-arm64.zip",
      "T3-Code-0.0.41-arm64.zip.blockmap",
      "builder-debug.yml",
    ]);
  });

  it("carries the unpacked bundle out of a dir build, whose bundle is the artifact", () => {
    const selected = selectStageArtifacts({
      target: "dir",
      entries: [
        { name: "builder-debug.yml", type: "File" },
        { name: "mac-arm64", type: "Directory" },
      ],
    });

    assert.deepStrictEqual(names(selected), ["builder-debug.yml", "mac-arm64"]);
  });

  it("ignores stage entries that are neither files nor directories", () => {
    const selected = selectStageArtifacts({
      target: "dir",
      entries: [
        { name: "mac-arm64", type: "Directory" },
        { name: "build.sock", type: "Socket" },
        { name: "latest-mac.yml", type: "SymbolicLink" },
      ],
    });

    assert.deepStrictEqual(names(selected), ["mac-arm64"]);
  });
});
