import { describe, expect, it } from "@effect/vitest";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { OpenCodeRuntime, OpenCodeRuntimeLive } from "./opencodeRuntime.ts";

interface SpawnRecord {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly extendEnv?: boolean | undefined;
}

const SERVE_SPAWN_FAILURE = PlatformError.systemError({
  _tag: "NotFound",
  module: "ChildProcess",
  method: "spawn",
  description: "serve spawn intentionally refused by the test spawner",
});

function makeHandle(options: { readonly exitCode: number; readonly stderr?: string }) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(options.exitCode)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.empty,
    stderr: options.stderr ? Stream.encodeText(Stream.make(options.stderr)) : Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

/**
 * Records every spawn and answers the prelaunch shell with `prelaunchExitCode`.
 * The `opencode serve` spawn always fails: these tests only care about whether
 * (and in what order) it was attempted, and failing it keeps the runtime from
 * registering its process-group kill finalizer against a fake pid.
 */
function makeRecordingSpawner(options: {
  readonly spawns: Array<SpawnRecord>;
  readonly prelaunchExitCode?: number;
  readonly prelaunchStderr?: string;
}) {
  return ChildProcessSpawner.make((command) => {
    if (!ChildProcess.isStandardCommand(command)) {
      return Effect.fail(SERVE_SPAWN_FAILURE);
    }
    options.spawns.push({
      command: command.command,
      args: command.args,
      env: command.options.env,
      extendEnv: command.options.extendEnv,
    });
    if (command.command === "/bin/sh" || command.command === "cmd.exe") {
      return Effect.succeed(
        makeHandle({
          exitCode: options.prelaunchExitCode ?? 0,
          ...(options.prelaunchStderr ? { stderr: options.prelaunchStderr } : {}),
        }),
      );
    }
    return Effect.fail(SERVE_SPAWN_FAILURE);
  });
}

function withRuntime<A, E>(
  options: {
    readonly spawns: Array<SpawnRecord>;
    readonly prelaunchExitCode?: number;
    readonly prelaunchStderr?: string;
  },
  use: (runtime: OpenCodeRuntime["Service"]) => Effect.Effect<A, E, never>,
) {
  const layer = OpenCodeRuntimeLive.pipe(
    Layer.provide(
      Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, makeRecordingSpawner(options)),
    ),
  );
  return Effect.gen(function* () {
    const runtime = yield* OpenCodeRuntime;
    return yield* use(runtime);
  }).pipe(Effect.provide(layer), Effect.provideService(HostProcessPlatform, "darwin"));
}

describe("OpenCode prelaunch command", () => {
  it.effect("runs the prelaunch shell line before spawning the server", () =>
    Effect.gen(function* () {
      const spawns: Array<SpawnRecord> = [];
      const error = yield* withRuntime({ spawns }, (runtime) =>
        Effect.scoped(
          runtime.startOpenCodeServerProcess({
            binaryPath: "opencode",
            port: 4096,
            prelaunch: { command: "boot-model-server --port 8000" },
          }),
        ).pipe(Effect.flip),
      );

      expect(spawns.map(({ command, args }) => ({ command, args }))).toEqual([
        { command: "/bin/sh", args: ["-c", "boot-model-server --port 8000"] },
        { command: "opencode", args: ["serve", "--hostname=127.0.0.1", "--port=4096"] },
      ]);
      // The serve spawn is the failure, so the prelaunch itself succeeded.
      expect(error.detail).toContain("Failed to spawn OpenCode server process");
    }),
  );

  it.effect("does not spawn the server when the prelaunch command fails", () =>
    Effect.gen(function* () {
      const spawns: Array<SpawnRecord> = [];
      const error = yield* withRuntime(
        { spawns, prelaunchExitCode: 3, prelaunchStderr: "model weights missing" },
        (runtime) =>
          Effect.scoped(
            runtime.startOpenCodeServerProcess({
              binaryPath: "opencode",
              port: 4096,
              prelaunch: { command: "boot-model-server" },
            }),
          ).pipe(Effect.flip),
      );

      expect(spawns.map((spawn) => spawn.command)).toEqual(["/bin/sh"]);
      expect(error.operation).toBe("runOpenCodePrelaunchCommand");
      expect(error.detail).toContain("exited with code 3");
      expect(error.detail).toContain("model weights missing");
    }),
  );

  it.effect("skips a blank prelaunch command", () =>
    Effect.gen(function* () {
      const spawns: Array<SpawnRecord> = [];
      yield* withRuntime({ spawns }, (runtime) =>
        Effect.scoped(
          runtime.startOpenCodeServerProcess({
            binaryPath: "opencode",
            port: 4096,
            prelaunch: { command: "   " },
          }),
        ).pipe(Effect.flip),
      );

      expect(spawns.map((spawn) => spawn.command)).toEqual(["opencode"]);
    }),
  );

  it.effect("passes the session model to the prelaunch command", () =>
    Effect.gen(function* () {
      const spawns: Array<SpawnRecord> = [];
      yield* withRuntime({ spawns }, (runtime) =>
        Effect.scoped(
          runtime.startOpenCodeServerProcess({
            binaryPath: "opencode",
            port: 4096,
            prelaunch: { command: "boot-model-server", model: "mtplx/qwen38-27b" },
          }),
        ).pipe(Effect.flip),
      );

      const prelaunchSpawn = spawns.find((spawn) => spawn.command === "/bin/sh");
      expect(prelaunchSpawn?.env?.["T3_OPENCODE_MODEL"]).toBe("mtplx/qwen38-27b");
      // Still inherits the ambient environment, or the command loses PATH.
      expect(prelaunchSpawn?.extendEnv).toBe(true);
    }),
  );

  it.effect("leaves the model variable unset when no model is known", () =>
    Effect.gen(function* () {
      const spawns: Array<SpawnRecord> = [];
      yield* withRuntime({ spawns }, (runtime) =>
        Effect.scoped(
          runtime.startOpenCodeServerProcess({
            binaryPath: "opencode",
            port: 4096,
            prelaunch: { command: "boot-model-server" },
          }),
        ).pipe(Effect.flip),
      );

      const prelaunchSpawn = spawns.find((spawn) => spawn.command === "/bin/sh");
      expect(prelaunchSpawn?.env?.["T3_OPENCODE_MODEL"]).toBeUndefined();
      expect(prelaunchSpawn?.extendEnv).toBe(true);
    }),
  );

  it.effect("skips the prelaunch command for an externally managed server", () =>
    Effect.gen(function* () {
      const spawns: Array<SpawnRecord> = [];
      const connection = yield* withRuntime({ spawns }, (runtime) =>
        Effect.scoped(
          runtime.connectToOpenCodeServer({
            binaryPath: "opencode",
            serverUrl: "http://127.0.0.1:4096",
            prelaunch: { command: "boot-model-server" },
          }),
        ),
      );

      expect(connection.external).toBe(true);
      expect(spawns).toEqual([]);
    }),
  );
});
