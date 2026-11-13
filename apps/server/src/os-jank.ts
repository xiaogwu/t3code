import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  buildEnvironmentCaptureCommand,
  extractEnvironmentValues,
  listLoginShellCandidates,
  mergePathEntries,
  readEnvironmentFromLoginShell,
  readEnvironmentFromLoginShellAsync,
  readPathFromLaunchctl,
  resolveWindowsEnvironment,
  setWindowsPath,
  type ShellEnvironmentAsyncReader,
} from "@t3tools/shared/shell";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- the shared login shell probe runs synchronously through execFileSync.
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";

function logPathHydrationWarning(message: string, error?: unknown): void {
  process.stderr.write(
    `[server] ${message} ${error instanceof Error ? error.message : (error ?? "")}\n`,
  );
}

// __MISE_DIFF is mise's record of the PATH entries it added. It must travel
// with the shell's PATH, or `mise x` can rebuild PATH behind a same-named
// wrapper (`exec mise x claude -- claude`) that then re-runs itself forever.
const LOGIN_SHELL_ENV_NAMES = ["PATH", "__MISE_DIFF", "JAVA_HOME"] as const;
const LOGIN_SHELL_TIMEOUT = Duration.seconds(5);
const SLOW_LOGIN_SHELL_TIMEOUT_MS = 20_000;

function readSlowLoginShellEnvironment(shell: string): Partial<Record<string, string>> {
  return readEnvironmentFromLoginShell(shell, LOGIN_SHELL_ENV_NAMES, (file, args, options) =>
    NodeChildProcess.execFileSync(file, args, {
      ...options,
      timeout: SLOW_LOGIN_SHELL_TIMEOUT_MS,
    }),
  );
}

function applyLoginShellEnvironment(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  shellEnvironment: Partial<Record<string, string>>,
  fallbackPath?: string,
): void {
  const shellPath = shellEnvironment.PATH;
  const mergedPath = mergePathEntries(shellPath ?? fallbackPath, env.PATH, platform);
  if (mergedPath) {
    env.PATH = mergedPath;
  }
  if (shellPath && shellEnvironment.__MISE_DIFF) {
    env.__MISE_DIFF = shellEnvironment.__MISE_DIFF;
  }
  // Android SDK tools are Java programs. A keg-only JDK (Homebrew's openjdk)
  // is only reachable through the JAVA_HOME the shell profile sets.
  if (!env.JAVA_HOME && shellEnvironment.JAVA_HOME) {
    env.JAVA_HOME = shellEnvironment.JAVA_HOME;
  }
}

/** Returns whether the login shell answered with a PATH. */
function hydratePosixPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
  let shellEnvironment: Partial<Record<string, string>> = {};
  let waitedForSlowShell = false;
  for (const shell of listLoginShellCandidates(platform, env.SHELL)) {
    try {
      shellEnvironment = readEnvironmentFromLoginShell(shell, LOGIN_SHELL_ENV_NAMES);
    } catch (error) {
      logPathHydrationWarning(`Failed to read PATH from login shell ${shell}.`, error);
      // A profile can be slow only while the machine boots. Wait for it once,
      // here: providers copy this env when they are built, so a later read
      // would never reach them.
      if (!waitedForSlowShell && (error as NodeJS.ErrnoException | null)?.code === "ETIMEDOUT") {
        waitedForSlowShell = true;
        try {
          shellEnvironment = readSlowLoginShellEnvironment(shell);
        } catch (retryError) {
          logPathHydrationWarning(
            `Failed to read PATH from slow login shell ${shell}.`,
            retryError,
          );
        }
      }
    }

    if (shellEnvironment.PATH) break;
  }

  const launchctlPath =
    platform === "darwin" && !shellEnvironment.PATH ? readPathFromLaunchctl() : undefined;
  applyLoginShellEnvironment(env, platform, shellEnvironment, launchctlPath);
  return shellEnvironment.PATH;
}

// A slow ~/.zshrc (a VPN-gated token fetch right after boot) can time the launch
// probe out. The last PATH a probe returned keeps providers findable meanwhile.
const SAVED_SHELL_PATH_FILE = "login-shell-path.json";
const SavedShellPath = Schema.fromJsonString(Schema.Struct({ PATH: Schema.String }));
const decodeSavedShellPath = Schema.decodeUnknownEffect(SavedShellPath);
const encodeSavedShellPath = Schema.encodeEffect(SavedShellPath);
const LOGIN_SHELL_RETRY_DELAYS = [Duration.seconds(10), Duration.seconds(30), Duration.minutes(1)];
const LOGIN_SHELL_RETRY_INTERVAL = Duration.minutes(5);

const loadSavedShellPath = Effect.fn("os-jank.loadSavedShellPath")(
  function* (stateDir: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const raw = yield* fs.readFileString(path.join(stateDir, SAVED_SHELL_PATH_FILE));
    const { PATH } = yield* decodeSavedShellPath(raw);
    return PATH.length > 0 ? PATH : undefined;
  },
  Effect.catchCause(() => Effect.undefined),
);

// Only PATH is saved: __MISE_DIFF describes one shell session and is stale afterwards.
const saveShellPath = Effect.fn("os-jank.saveShellPath")(
  function* (stateDir: string, shellPath: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const target = path.join(stateDir, SAVED_SHELL_PATH_FILE);
    const temporary = `${target}.${process.pid}.tmp`;
    yield* fs.makeDirectory(stateDir, { recursive: true });
    yield* fs.writeFileString(temporary, yield* encodeSavedShellPath({ PATH: shellPath }));
    yield* fs.rename(temporary, target);
  },
  Effect.catchCause((cause) =>
    Effect.sync(() => logPathHydrationWarning("Failed to save the login shell PATH.", cause)),
  ),
);

const applySavedShellPath = Effect.fn("os-jank.applySavedShellPath")(function* (
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  stateDir: string | undefined,
) {
  if (stateDir === undefined) return;
  const saved = yield* loadSavedShellPath(stateDir);
  const merged = mergePathEntries(saved, env.PATH, platform);
  if (merged) env.PATH = merged;
});

export function hydratePosixHome(
  env: NodeJS.ProcessEnv,
  resolveHomeDir = () => NodeOS.userInfo().homedir,
): void {
  if ((env.HOME?.trim() ?? "").length > 0) return;

  const homeDir = resolveHomeDir();
  if (homeDir.length > 0) {
    env.HOME = homeDir;
  }
}

/**
 * Resolves the server's PATH. Returns true when no login shell PATH is in hand
 * (the launch probe failed), so the caller should keep retrying in the background.
 */
export const fixPath = Effect.fn("fixPath")(function* (options?: {
  /** true: desktop's probe succeeded. false: it ran and failed. undefined: no desktop. */
  readonly shellEnvironmentPrepared?: boolean | undefined;
  readonly stateDir?: string | undefined;
}): Effect.fn.Return<boolean, never, FileSystem.FileSystem | Path.Path> {
  const platform = yield* HostProcess.Platform;
  const env = yield* HostProcess.Environment;

  if (platform === "win32") {
    // The desktop already ran both PowerShell probes into the env this child
    // extends. Repeating them here costs seconds of startup on Windows.
    if (options?.shellEnvironmentPrepared === true) return false;
    const repairedEnvironment = yield* resolveWindowsEnvironment(env).pipe(
      Effect.catchDefect((defect) =>
        Effect.sync(() => {
          logPathHydrationWarning("Failed to hydrate PATH from the user environment.", defect);
          return {} as Partial<NodeJS.ProcessEnv>;
        }),
      ),
    );
    for (const [key, value] of Object.entries(repairedEnvironment)) {
      if (value === undefined) continue;
      if (key === "PATH") {
        setWindowsPath(env, value);
      } else {
        env[key] = value;
      }
    }
    return false;
  }

  if (platform !== "darwin" && platform !== "linux") return false;

  yield* Effect.sync(() => hydratePosixHome(env)).pipe(
    Effect.catchDefect((defect) =>
      Effect.sync(() => {
        logPathHydrationWarning("Failed to hydrate HOME from the user account.", defect);
      }),
    ),
  );
  if (options?.shellEnvironmentPrepared === true) {
    // Desktop's PATH is a good shell PATH; keep it as the fallback for a later bad launch.
    if (options.stateDir !== undefined && env.PATH) {
      yield* saveShellPath(options.stateDir, env.PATH);
    }
    return false;
  }
  // Desktop already spent its probe; a second blocking one would only stall startup.
  const shellPath =
    options?.shellEnvironmentPrepared === false
      ? undefined
      : yield* Effect.sync(() => hydratePosixPath(env, platform)).pipe(
          Effect.catchDefect((defect) =>
            Effect.sync(() => {
              logPathHydrationWarning("Failed to hydrate PATH from the user environment.", defect);
              return undefined;
            }),
          ),
        );
  if (shellPath !== undefined) {
    if (options?.stateDir !== undefined) yield* saveShellPath(options.stateDir, shellPath);
    return false;
  }
  yield* applySavedShellPath(env, platform, options?.stateDir);
  return true;
});

/**
 * Re-probes the login shell in the background until it answers, then adopts its
 * PATH, saves it, and runs `refreshProviders` once.
 */
export const retryLoginShellPath = Effect.fn("os-jank.retryLoginShellPath")(function* (input: {
  readonly stateDir: string;
  readonly refreshProviders: Effect.Effect<unknown>;
  readonly readShell?: ShellEnvironmentAsyncReader | undefined;
}): Effect.fn.Return<void, never, FileSystem.FileSystem | Path.Path> {
  const platform = yield* HostProcess.Platform;
  const env = yield* HostProcess.Environment;
  const readShell = input.readShell ?? readEnvironmentFromLoginShellAsync;

  const probe = Effect.gen(function* () {
    for (const shell of listLoginShellCandidates(platform, env.SHELL)) {
      const shellEnvironment = yield* readShell(shell, ["PATH", "__MISE_DIFF"]).pipe(
        Effect.orElseSucceed(() => ({}) as Partial<Record<string, string>>),
      );
      if (shellEnvironment.PATH) return shellEnvironment;
    }
    return undefined;
  });

  for (let attempt = 0; ; attempt++) {
    yield* Effect.sleep(LOGIN_SHELL_RETRY_DELAYS[attempt] ?? LOGIN_SHELL_RETRY_INTERVAL);
    const shellEnvironment = yield* probe;
    if (shellEnvironment?.PATH === undefined) continue;
    const merged = mergePathEntries(shellEnvironment.PATH, env.PATH, platform);
    if (merged) env.PATH = merged;
    if (shellEnvironment.__MISE_DIFF) env.__MISE_DIFF = shellEnvironment.__MISE_DIFF;
    yield* saveShellPath(input.stateDir, shellEnvironment.PATH);
    yield* input.refreshProviders;
    return;
  }
});

const readLoginShellOutput = Effect.fn("readLoginShellOutput")(
  function* (shell: string) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make(
        shell,
        ["-ilc", buildEnvironmentCaptureCommand(shell, LOGIN_SHELL_ENV_NAMES)],
        {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "ignore",
          // A profile that traps SIGTERM would otherwise hold the scope open
          // past the timeout while cleanup waits for the exit.
          forceKillAfter: "1 second",
        },
      ),
    );
    const [stdout, exitCode] = yield* Effect.all(
      [Stream.mkString(Stream.decodeText(child.stdout)), child.exitCode],
      { concurrency: 2 },
    );
    if (exitCode === 0) return stdout;
    yield* Effect.logWarning(
      `Login shell ${shell} exited with code ${exitCode} while reading PATH.`,
    );
    return "";
  },
  Effect.scoped,
  Effect.timeoutOption(LOGIN_SHELL_TIMEOUT),
);

// Runs even when the desktop prepared the environment: that capture was taken
// once at launch. Only the user's own shell counts; a fallback shell's PATH is
// not their environment. Failure leaves PATH alone.
export const refreshPathFromLoginShell = Effect.fn("refreshPathFromLoginShell")(function* () {
  const platform = yield* HostProcess.Platform;
  if (platform !== "darwin" && platform !== "linux") return;
  const env = yield* HostProcess.Environment;
  const [shell] = listLoginShellCandidates(platform, env.SHELL);
  if (!shell) return;

  const output = yield* readLoginShellOutput(shell).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning(`Failed to read PATH from login shell ${shell}.`, cause).pipe(
        Effect.as(Option.some("")),
      ),
    ),
  );
  if (Option.isNone(output)) {
    yield* Effect.logWarning(
      `Timed out reading PATH from login shell ${shell} after ${Duration.format(LOGIN_SHELL_TIMEOUT)}; PATH is unchanged.`,
    );
    return;
  }
  const shellEnvironment = extractEnvironmentValues(output.value, LOGIN_SHELL_ENV_NAMES);
  if (shellEnvironment.PATH) {
    applyLoginShellEnvironment(env, platform, shellEnvironment);
  } else {
    yield* Effect.logWarning(`Login shell ${shell} printed no PATH; PATH is unchanged.`);
  }
});

export const expandHomePath = Effect.fn(function* (input: string) {
  const { join } = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  if (input === "~") {
    return home;
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return join(home, input.slice(2));
  }
  return input;
});

export const resolveBaseDir = Effect.fn(function* (raw: string | undefined) {
  const { join, resolve } = yield* Path.Path;
  if (!raw || raw.trim().length === 0) {
    return join(yield* HostProcess.HomeDirectory, ".t3");
  }
  return resolve(yield* expandHomePath(raw.trim()));
});
