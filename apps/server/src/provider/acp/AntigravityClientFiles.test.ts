import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { writeAntigravityClientTextFile } from "./AntigravityClientFiles.ts";

it.layer(NodeServices.layer)("Antigravity client files", (it) => {
  it.effect("writes a new file under a missing directory of a symlinked workspace root", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const base = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-agy-client-files-" });
      const realRoot = path.join(base, "real");
      const linkedRoot = path.join(base, "linked");
      yield* fileSystem.makeDirectory(realRoot);
      yield* fileSystem.symlink(realRoot, linkedRoot);

      yield* writeAntigravityClientTextFile({
        fileSystem,
        path,
        allowedRoots: [linkedRoot],
        request: {
          sessionId: "session",
          path: path.join(linkedRoot, "new", "nested", "file.txt"),
          content: "hello",
        },
      });

      expect(
        yield* fileSystem.readFileString(path.join(realRoot, "new", "nested", "file.txt")),
      ).toBe("hello");
    }),
  );

  it.effect("rejects a new file outside every workspace root", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const base = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-agy-client-files-" });
      const root = path.join(base, "root");
      yield* fileSystem.makeDirectory(root);

      const failure = yield* writeAntigravityClientTextFile({
        fileSystem,
        path,
        allowedRoots: [root],
        request: {
          sessionId: "session",
          path: path.join(base, "elsewhere", "file.txt"),
          content: "hello",
        },
      }).pipe(Effect.flip);

      expect(failure.message).toContain("outside the session workspace");
    }),
  );
});
