import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as OpenCodeRuntime from "../OpenCodeRuntime.ts";
import * as OpenCodeServerLedger from "../OpenCodeServerLedger.ts";
import * as OpenCode2Client from "./OpenCode2Client.ts";
import * as OpenCode2Server from "./OpenCode2Server.ts";

interface SpawnRecord {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: Record<string, string | undefined> | undefined;
}

const SERVE_SPAWN_FAILURE = PlatformError.systemError({
  _tag: "NotFound",
  module: "ChildProcess",
  method: "spawn",
  description: "serve spawn intentionally refused by the test spawner",
});

const exitedHandle = (exitCode: number, stderr: string | undefined) =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.empty,
    stderr: stderr ? Stream.encodeText(Stream.make(stderr)) : Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });

/**
 * Records every spawn and answers the prelaunch shell with `prelaunchExitCode`.
 * `opencode serve` always fails: these tests only care whether, and in what
 * order, it was attempted.
 */
const recordingSpawner = (options: {
  readonly spawns: Array<SpawnRecord>;
  readonly prelaunchExitCode?: number;
  readonly prelaunchStderr?: string;
}) =>
  ChildProcessSpawner.make((command) => {
    if (!ChildProcess.isStandardCommand(command)) return Effect.fail(SERVE_SPAWN_FAILURE);
    options.spawns.push({
      command: command.command,
      args: command.args,
      env: command.options.env,
    });
    return command.command === "/bin/sh"
      ? Effect.succeed(exitedHandle(options.prelaunchExitCode ?? 0, options.prelaunchStderr))
      : Effect.fail(SERVE_SPAWN_FAILURE);
  });

// An external server that answers, but not as OpenCode 2; no network involved.
const layerServerError = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(request, new Response("upstream failed", { status: 502 })),
    ),
  ),
);

const withServer = <A, E>(
  options: Parameters<typeof recordingSpawner>[0] & { readonly serverUrl?: string },
  use: (server: OpenCode2Server.OpenCode2Server["Service"]) => Effect.Effect<A, E>,
) => {
  const spawner = recordingSpawner(options);
  return Effect.gen(function* () {
    const server = yield* OpenCode2Server.make({
      binaryPath: "opencode",
      serverUrl: options.serverUrl ?? "",
      serverPassword: "",
      directory: "/project",
      environment: { PATH: "/bin" },
      prelaunchCommand: "  boot-model-server --port 8000  ",
    });
    return yield* use(server);
  }).pipe(
    Effect.scoped,
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    Effect.provide(
      Layer.mergeAll(
        OpenCode2Client.layer.pipe(Layer.provide(layerServerError)),
        OpenCodeRuntime.layer.pipe(
          Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
          Layer.provide(OpenCodeServerLedger.layerTest),
        ),
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
    Effect.provideService(HostProcess.Platform, "darwin"),
  );
};

describe("OpenCode2Server prelaunch command", () => {
  it.effect("runs before the 2.x server spawn, with the session's model", () =>
    Effect.gen(function* () {
      const spawns: Array<SpawnRecord> = [];
      const error = yield* withServer({ spawns }, (server) =>
        server
          .withConnection(() => Effect.void, { prelaunch: { model: "mtplx/qwen38-27b" } })
          .pipe(Effect.flip),
      );

      assert.deepStrictEqual(
        spawns.map(({ command, args }) => ({ command, args: args.slice(0, 2) })),
        [
          { command: "/bin/sh", args: ["-c", "boot-model-server --port 8000"] },
          { command: "opencode", args: ["serve", "--hostname=127.0.0.1"] },
        ],
      );
      const prelaunchEnv = spawns[0]?.env;
      assert.strictEqual(prelaunchEnv?.["T3_OPENCODE_MODEL"], "mtplx/qwen38-27b");
      assert.strictEqual(prelaunchEnv?.["PATH"], "/bin");
      // The generated server password stays with the server.
      assert.isUndefined(prelaunchEnv?.["OPENCODE_PASSWORD"]);
      // The serve spawn is the failure, so the prelaunch itself succeeded.
      assert.include(error.detail, "Failed to spawn OpenCode server process");
    }),
  );

  it.effect("does not run for work that does not ask for it", () =>
    Effect.gen(function* () {
      const spawns: Array<SpawnRecord> = [];
      yield* withServer({ spawns }, (server) =>
        server.withConnection(() => Effect.void).pipe(Effect.flip),
      );

      assert.deepStrictEqual(
        spawns.map((spawn) => spawn.command),
        ["opencode"],
      );
    }),
  );

  it.effect("does not spawn the server when the prelaunch command fails", () =>
    Effect.gen(function* () {
      const spawns: Array<SpawnRecord> = [];
      const error = yield* withServer(
        { spawns, prelaunchExitCode: 3, prelaunchStderr: "model weights missing" },
        (server) =>
          server
            .withConnection(() => Effect.void, { prelaunch: { model: "mtplx/qwen38-27b" } })
            .pipe(Effect.flip),
      );

      assert.deepStrictEqual(
        spawns.map((spawn) => spawn.command),
        ["/bin/sh"],
      );
      assert.strictEqual(error.operation, "runOpenCodePrelaunchCommand");
      assert.include(error.detail, "exited with code 3");
      assert.include(error.detail, "model weights missing");
    }),
  );

  it.effect("is skipped for a server at a configured URL", () =>
    Effect.gen(function* () {
      const spawns: Array<SpawnRecord> = [];
      const error = yield* withServer({ spawns, serverUrl: "http://127.0.0.1:4096" }, (server) =>
        server
          .withConnection(() => Effect.void, { prelaunch: { model: "mtplx/qwen38-27b" } })
          .pipe(Effect.flip),
      );

      assert.deepStrictEqual(spawns, []);
      assert.strictEqual(error.operation, "server.info");
    }),
  );
});
