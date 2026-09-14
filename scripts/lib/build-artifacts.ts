// @effect-diagnostics nodeBuiltinImport:off - `cp` with verbatimSymlinks has no Effect FileSystem equivalent, and dropping it breaks macOS bundles.
import * as NodeFSP from "node:fs/promises";

import type * as FileSystem from "effect/FileSystem";

/** One entry electron-builder left behind in a build stage's dist directory. */
export interface StageArtifactEntry {
  readonly name: string;
  readonly type: FileSystem.File.Type;
}

/**
 * Chooses which stage entries a build carries out to its output directory.
 *
 * Distributable targets (dmg/zip/nsis/AppImage) are files that sit beside the
 * unpacked bundle electron-builder built them from, so carrying that directory
 * out as well would double the output for nothing. A `dir` build produces no
 * distributable file — the unpacked bundle is the artifact — so it has to come
 * along or the build leaves the caller empty-handed once the stage is removed.
 */
export function selectStageArtifacts(input: {
  readonly entries: ReadonlyArray<StageArtifactEntry>;
  readonly target: string;
}): ReadonlyArray<StageArtifactEntry> {
  const keepsUnpackedBundle = input.target === "dir";
  return input.entries.filter((entry) =>
    entry.type === "Directory" ? keepsUnpackedBundle : entry.type === "File",
  );
}

/**
 * Copies an unpacked bundle out of a build stage with its symlinks intact.
 *
 * `verbatimSymlinks` is the whole point: without it `cp` resolves every link
 * target against the source, so a macOS bundle arrives with
 * `Electron Framework.framework/Electron Framework` pointing at an absolute
 * path inside the stage. The stage is deleted right after the copy, and the app
 * then dies at launch with `Library not loaded: @rpath/Electron Framework`.
 */
export function copyStageArtifactTree(from: string, to: string): Promise<void> {
  return NodeFSP.cp(from, to, { recursive: true, verbatimSymlinks: true });
}
