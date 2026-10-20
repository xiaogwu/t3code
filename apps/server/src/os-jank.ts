import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import {
  listLoginShellCandidates,
  mergePathEntries,
  readPathFromLoginShell,
  readPathFromLoginShellAsync,
  readPathFromLaunchctl,
  resolveWindowsEnvironment,
} from "@t3tools/shared/shell";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeOS from "node:os";

function logPathHydrationWarning(message: string, error?: unknown): void {
  process.stderr.write(
    `[server] ${message} ${error instanceof Error ? error.message : (error ?? "")}\n`,
  );
}

const PATH_RETRY_INTERVAL = Duration.seconds(30);
const PATH_RETRY_ATTEMPTS = 10;
const PATH_RETRY_TIMEOUT_MS = 20_000;

function hydratePosixPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  let shellPath: string | undefined;
  for (const shell of listLoginShellCandidates(platform, env.SHELL)) {
    try {
      shellPath = readPathFromLoginShell(shell);
    } catch (error) {
      logPathHydrationWarning(`Failed to read PATH from login shell ${shell}.`, error);
    }

    if (shellPath) break;
  }

  const launchctlPath = platform === "darwin" && !shellPath ? readPathFromLaunchctl() : undefined;
  const mergedPath = mergePathEntries(shellPath ?? launchctlPath, env.PATH, platform);
  if (mergedPath) {
    env.PATH = mergedPath;
  }
  return Boolean(shellPath);
}

// Right after boot a cold login shell can outlast the startup probe's timeout,
// leaving only the launchd PATH. Without a retry every provider CLI stays "Not
// found" until the app restarts; once PATH is repaired, the next provider health
// refresh finds them.
export const retryPosixPathHydration = Effect.fn("retryPosixPathHydration")(function* (
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  readPath: (
    shell: string,
    timeoutMs: number,
  ) => Promise<string | undefined> = readPathFromLoginShellAsync,
) {
  for (let attempt = 1; attempt <= PATH_RETRY_ATTEMPTS; attempt++) {
    yield* Effect.sleep(PATH_RETRY_INTERVAL);
    for (const shell of listLoginShellCandidates(platform, env.SHELL)) {
      const shellPath = yield* Effect.promise(() =>
        readPath(shell, PATH_RETRY_TIMEOUT_MS).catch((error: unknown) => {
          logPathHydrationWarning(`Retry failed to read PATH from login shell ${shell}.`, error);
          return undefined;
        }),
      );
      if (shellPath) {
        const mergedPath = mergePathEntries(shellPath, env.PATH, platform);
        if (mergedPath) {
          env.PATH = mergedPath;
        }
        return true;
      }
    }
  }
  logPathHydrationWarning("Gave up reading PATH from the login shell.");
  return false;
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

export const fixPath = Effect.fn("fixPath")(function* (): Effect.fn.Return<
  void,
  never,
  FileSystem.FileSystem | Path.Path
> {
  const platform = yield* HostProcessPlatform;
  const env = yield* HostProcessEnvironment;

  if (platform === "win32") {
    const repairedEnvironment = yield* resolveWindowsEnvironment(env).pipe(
      Effect.catchDefect((defect) =>
        Effect.sync(() => {
          logPathHydrationWarning("Failed to hydrate PATH from the user environment.", defect);
          return {} as Partial<NodeJS.ProcessEnv>;
        }),
      ),
    );
    for (const [key, value] of Object.entries(repairedEnvironment)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    return;
  }

  if (platform !== "darwin" && platform !== "linux") return;

  yield* Effect.sync(() => hydratePosixHome(env)).pipe(
    Effect.catchDefect((defect) =>
      Effect.sync(() => {
        logPathHydrationWarning("Failed to hydrate HOME from the user account.", defect);
      }),
    ),
  );
  const hydrated = yield* Effect.sync(() => hydratePosixPath(env, platform)).pipe(
    Effect.catchDefect((defect) =>
      Effect.sync(() => {
        logPathHydrationWarning("Failed to hydrate PATH from the user environment.", defect);
        return false;
      }),
    ),
  );
  if (!hydrated) {
    yield* retryPosixPathHydration(env, platform).pipe(Effect.forkDetach);
  }
});

export const expandHomePath = Effect.fn(function* (input: string) {
  const { join } = yield* Path.Path;
  if (input === "~") {
    return NodeOS.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return join(NodeOS.homedir(), input.slice(2));
  }
  return input;
});

export const resolveBaseDir = Effect.fn(function* (raw: string | undefined) {
  const { join, resolve } = yield* Path.Path;
  if (!raw || raw.trim().length === 0) {
    return join(NodeOS.homedir(), ".t3");
  }
  return resolve(yield* expandHomePath(raw.trim()));
});
