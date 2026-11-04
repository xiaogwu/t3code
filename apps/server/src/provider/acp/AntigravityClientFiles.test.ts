import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { readAntigravityClientTextFile } from "./AntigravityClientFiles.ts";

it.layer(NodeServices.layer)("Antigravity client files", (it) => {
  // Client writes are off upstream; reads still take the same containment path.
  it.effect("treats a missing file under a symlinked workspace root as inside it", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const base = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-agy-client-files-" });
      const realRoot = path.join(base, "real");
      const linkedRoot = path.join(base, "linked");
      yield* fileSystem.makeDirectory(realRoot);
      yield* fileSystem.symlink(realRoot, linkedRoot);

      const failure = yield* readAntigravityClientTextFile({
        fileSystem,
        path,
        allowedRoots: [linkedRoot],
        request: { sessionId: "session", path: path.join(linkedRoot, "new", "nested", "file.txt") },
      }).pipe(Effect.flip);

      expect(failure.message).toContain("not found");
    }),
  );

  it.effect("rejects a missing file outside every workspace root", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const base = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-agy-client-files-" });
      const root = path.join(base, "root");
      yield* fileSystem.makeDirectory(root);

      const failure = yield* readAntigravityClientTextFile({
        fileSystem,
        path,
        allowedRoots: [root],
        request: { sessionId: "session", path: path.join(base, "elsewhere", "file.txt") },
      }).pipe(Effect.flip);

      expect(failure.message).toContain("outside the session workspace");
    }),
  );
});
