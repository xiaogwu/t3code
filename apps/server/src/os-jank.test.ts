import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { CommandAvailability, WindowsShellEnvironment } from "@t3tools/shared/shell";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Observe the existing synchronous shell probe without launching the user's login shell.
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";
import { assert, it, vi } from "vite-plus/test";

import { LoginShellProbeError } from "@t3tools/shared/shell";
import { fixPath, hydratePosixHome, retryLoginShellPath } from "./os-jank.ts";

vi.mock("node:child_process", { spy: true });

it("hydrates HOME independently of a blank process HOME", () => {
  const originalHome = process.env.HOME;
  const env: NodeJS.ProcessEnv = { HOME: " " };

  try {
    process.env.HOME = " ";
    hydratePosixHome(env);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }

  assert.equal(env.HOME, NodeOS.userInfo().homedir);
});

it("preserves an explicitly configured HOME", () => {
  const env: NodeJS.ProcessEnv = { HOME: "/custom/home" };

  hydratePosixHome(env, () => {
    throw new Error("HOME lookup should not run");
  });

  assert.equal(env.HOME, "/custom/home");
});

effectIt.effect("hydrates PATH when the desktop handoff is absent", () =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      vi
        .spyOn(NodeChildProcess, "execFileSync")
        .mockReturnValue("__T3CODE_ENV_PATH_START__\n/opt/tools/bin\n__T3CODE_ENV_PATH_END__\n"),
    ),
    (probe) =>
      Effect.gen(function* () {
        const env: NodeJS.ProcessEnv = { SHELL: "/bin/bash", PATH: "/usr/bin" };

        yield* fixPath().pipe(
          Effect.provideService(HostProcess.Platform, "linux"),
          Effect.provideService(HostProcess.Environment, env),
          Effect.provide(NodeServices.layer),
        );

        assert.equal(probe.mock.calls.length, 1);
        assert.equal(env.PATH, "/opt/tools/bin:/usr/bin");
      }),
    (probe) => Effect.sync(() => probe.mockRestore()),
  ),
);

effectIt.effect("keeps mise's PATH record with the login shell PATH", () =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      vi
        .spyOn(NodeChildProcess, "execFileSync")
        .mockReturnValue(
          [
            "__T3CODE_ENV_PATH_START__",
            "/home/me/.local/bin:/mise/installs/claude/latest:/mise/shims",
            "__T3CODE_ENV_PATH_END__",
            "__T3CODE_ENV___MISE_DIFF_START__",
            "mise-diff",
            "__T3CODE_ENV___MISE_DIFF_END__",
          ].join("\n"),
        ),
    ),
    () =>
      Effect.gen(function* () {
        const env: NodeJS.ProcessEnv = { SHELL: "/bin/bash", PATH: "/usr/bin" };

        yield* fixPath().pipe(
          Effect.provideService(HostProcess.Platform, "linux"),
          Effect.provideService(HostProcess.Environment, env),
          Effect.provide(NodeServices.layer),
        );

        assert.equal(env.__MISE_DIFF, "mise-diff");
      }),
    (probe) => Effect.sync(() => probe.mockRestore()),
  ),
);

effectIt.effect("hydrates a missing JAVA_HOME from the login shell and keeps an explicit one", () =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      vi
        .spyOn(NodeChildProcess, "execFileSync")
        .mockReturnValue(
          [
            "__T3CODE_ENV_PATH_START__",
            "/opt/homebrew/bin",
            "__T3CODE_ENV_PATH_END__",
            "__T3CODE_ENV_JAVA_HOME_START__",
            "/opt/homebrew/opt/openjdk@17",
            "__T3CODE_ENV_JAVA_HOME_END__",
          ].join("\n"),
        ),
    ),
    () =>
      Effect.gen(function* () {
        const missing: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", PATH: "/usr/bin" };
        const explicit: NodeJS.ProcessEnv = {
          SHELL: "/bin/zsh",
          PATH: "/usr/bin",
          JAVA_HOME: "/custom/jdk",
        };

        for (const env of [missing, explicit]) {
          yield* fixPath().pipe(
            Effect.provideService(HostProcess.Platform, "darwin"),
            Effect.provideService(HostProcess.Environment, env),
            Effect.provide(NodeServices.layer),
          );
        }

        assert.equal(missing.JAVA_HOME, "/opt/homebrew/opt/openjdk@17");
        assert.equal(explicit.JAVA_HOME, "/custom/jdk");
      }),
    (probe) => Effect.sync(() => probe.mockRestore()),
  ),
);

effectIt.effect("replaces a Path-spelled Windows PATH instead of adding a second key", () =>
  Effect.gen(function* () {
    const env: NodeJS.ProcessEnv = { Path: "C:\\Windows" };

    yield* fixPath().pipe(
      Effect.provideService(HostProcess.Platform, "win32"),
      Effect.provideService(HostProcess.Environment, env),
      Effect.provideService(WindowsShellEnvironment, () => Effect.succeed({ PATH: "C:\\Tools" })),
      Effect.provideService(CommandAvailability, () => Effect.succeed(true)),
      Effect.provide(NodeServices.layer),
    );

    assert.deepEqual(env, { PATH: "C:\\Tools;C:\\Windows" });
  }),
);

const withTempStateDir = Effect.fn(function* <A, E, R>(
  use: (stateDir: string) => Effect.Effect<A, E, R>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectory();
  return yield* use(path.join(root, "userdata")).pipe(
    Effect.ensuring(fs.remove(root, { recursive: true, force: true }).pipe(Effect.ignore)),
  );
});

const savedPathFile = (stateDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return JSON.parse(yield* fs.readFileString(path.join(stateDir, "login-shell-path.json")));
  });

effectIt.effect("a login shell PATH is saved, then reused when a later probe fails", () =>
  withTempStateDir((stateDir) =>
    Effect.gen(function* () {
      const run = (env: NodeJS.ProcessEnv) =>
        fixPath({ stateDir }).pipe(
          Effect.provideService(HostProcess.Platform, "linux"),
          Effect.provideService(HostProcess.Environment, env),
        );
      const probe = vi.spyOn(NodeChildProcess, "execFileSync");
      yield* Effect.addFinalizer(() => Effect.sync(() => probe.mockRestore()));

      probe.mockReturnValue("__T3CODE_ENV_PATH_START__\n/opt/tools/bin\n__T3CODE_ENV_PATH_END__\n");
      const first: NodeJS.ProcessEnv = { SHELL: "/bin/bash", PATH: "/usr/bin" };
      assert.equal(yield* run(first), false);
      assert.deepEqual(yield* savedPathFile(stateDir), { PATH: "/opt/tools/bin" });

      probe.mockImplementation(() => {
        throw new Error("timed out");
      });
      const second: NodeJS.ProcessEnv = { SHELL: "/bin/bash", PATH: "/usr/bin" };
      assert.equal(yield* run(second), true);
      assert.equal(second.PATH, "/opt/tools/bin:/usr/bin");
    }),
  ).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

effectIt.effect(
  "a failed desktop probe skips the blocking startup probe and uses the saved PATH",
  () =>
    withTempStateDir((stateDir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.makeDirectory(stateDir, { recursive: true });
        yield* fs.writeFileString(
          path.join(stateDir, "login-shell-path.json"),
          JSON.stringify({ PATH: "/saved/bin" }),
        );
        const probe = vi.spyOn(NodeChildProcess, "execFileSync");
        yield* Effect.addFinalizer(() => Effect.sync(() => probe.mockRestore()));
        const env: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", PATH: "/usr/bin" };

        const pending = yield* fixPath({ shellEnvironmentPrepared: false, stateDir }).pipe(
          Effect.provideService(HostProcess.Platform, "darwin"),
          Effect.provideService(HostProcess.Environment, env),
        );

        assert.equal(pending, true);
        assert.equal(probe.mock.calls.length, 0);
        assert.equal(env.PATH, "/saved/bin:/usr/bin");
      }),
    ).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

effectIt.effect("a prepared desktop environment saves its PATH and makes no shell calls", () =>
  withTempStateDir((stateDir) =>
    Effect.gen(function* () {
      const probe = vi.spyOn(NodeChildProcess, "execFileSync");
      yield* Effect.addFinalizer(() => Effect.sync(() => probe.mockRestore()));
      const env: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", PATH: "/opt/homebrew/bin:/usr/bin" };

      const pending = yield* fixPath({ shellEnvironmentPrepared: true, stateDir }).pipe(
        Effect.provideService(HostProcess.Platform, "darwin"),
        Effect.provideService(HostProcess.Environment, env),
      );

      assert.equal(pending, false);
      assert.equal(probe.mock.calls.length, 0);
      assert.equal(env.PATH, "/opt/homebrew/bin:/usr/bin");
      assert.deepEqual(yield* savedPathFile(stateDir), { PATH: "/opt/homebrew/bin:/usr/bin" });
    }),
  ).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

effectIt.effect("the background retry adopts, saves, and refreshes once the shell answers", () =>
  withTempStateDir((stateDir) =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", PATH: "/usr/bin" };
      const refreshed = yield* Deferred.make<void>();
      let refreshCount = 0;
      let shellAnswers = false;

      yield* retryLoginShellPath({
        stateDir,
        refreshProviders: Effect.sync(() => {
          refreshCount += 1;
        }).pipe(Effect.andThen(Deferred.succeed(refreshed, undefined))),
        readShell: () =>
          Effect.suspend(() =>
            shellAnswers
              ? Effect.succeed({ PATH: "/opt/homebrew/bin:/usr/bin" })
              : Effect.fail(new LoginShellProbeError({ cause: "timed out" })),
          ),
      }).pipe(
        Effect.provideService(HostProcess.Platform, "darwin"),
        Effect.provideService(HostProcess.Environment, env),
        Effect.forkScoped,
      );

      yield* TestClock.adjust("10 seconds");
      assert.equal(env.PATH, "/usr/bin");
      yield* TestClock.adjust("30 seconds");
      assert.equal(env.PATH, "/usr/bin");
      shellAnswers = true;
      yield* TestClock.adjust("1 minute");
      yield* Deferred.await(refreshed);

      assert.equal(env.PATH, "/opt/homebrew/bin:/usr/bin");
      assert.deepEqual(yield* savedPathFile(stateDir), { PATH: "/opt/homebrew/bin:/usr/bin" });
      assert.equal(refreshCount, 1);
      yield* TestClock.adjust("10 minutes");
      assert.equal(refreshCount, 1);
    }),
  ).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
