// @effect-diagnostics nodeBuiltinImport:off - the copy under test is a raw filesystem operation, so the fixture is built with the same APIs.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import {
  copyStageArtifactTree,
  selectStageArtifacts,
  type StageArtifactEntry,
} from "./build-artifacts.ts";

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

  it("copies a bundle out of the stage with its framework symlinks still relative", async () => {
    // The layout that matters: a macOS framework reaches its binary through two
    // relative links. Resolve either one against the stage and the copied app
    // dangles as soon as the stage is removed.
    const stage = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "stage-artifact-"));
    try {
      const framework = NodePath.join(stage, "src/App.app/Contents/Frameworks/E.framework");
      await NodeFSP.mkdir(NodePath.join(framework, "Versions/A"), { recursive: true });
      await NodeFSP.writeFile(NodePath.join(framework, "Versions/A/E"), "binary");
      await NodeFSP.symlink("A", NodePath.join(framework, "Versions/Current"));
      await NodeFSP.symlink("Versions/Current/E", NodePath.join(framework, "E"));

      const out = NodePath.join(stage, "out");
      await copyStageArtifactTree(NodePath.join(stage, "src"), out);
      const copied = NodePath.join(out, "App.app/Contents/Frameworks/E.framework");

      assert.strictEqual(await NodeFSP.readlink(NodePath.join(copied, "E")), "Versions/Current/E");
      assert.strictEqual(await NodeFSP.readlink(NodePath.join(copied, "Versions/Current")), "A");
      // Removing the stage source must not break the copy.
      await NodeFSP.rm(NodePath.join(stage, "src"), { recursive: true, force: true });
      assert.strictEqual(await NodeFSP.readFile(NodePath.join(copied, "E"), "utf8"), "binary");
    } finally {
      await NodeFSP.rm(stage, { recursive: true, force: true });
    }
  });
});
