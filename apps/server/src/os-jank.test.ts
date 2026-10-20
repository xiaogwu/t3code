import * as NodeOS from "node:os";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { assert, it } from "vite-plus/test";

import { hydratePosixHome, retryPosixPathHydration } from "./os-jank.ts";

it("hydrates HOME for minimal service environments from the user account", () => {
  const env: NodeJS.ProcessEnv = {};

  hydratePosixHome(env);

  assert.equal(env.HOME, NodeOS.userInfo().homedir);
});

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

effectIt.effect("repairs PATH once a timed-out login shell answers on a later retry", () =>
  Effect.gen(function* () {
    const env: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", PATH: "/usr/bin:/bin" };
    let shellIsCold = true;
    const readPath = async () => {
      if (shellIsCold) throw new Error("spawn /bin/zsh ETIMEDOUT");
      return "/Users/test/.nvm/bin:/opt/homebrew/bin:/usr/bin";
    };

    const fiber = yield* retryPosixPathHydration(env, "darwin", readPath).pipe(Effect.forkChild);
    yield* TestClock.adjust("30 seconds");
    assert.equal(env.PATH, "/usr/bin:/bin");
    shellIsCold = false;
    yield* TestClock.adjust("30 seconds");

    assert.isTrue(yield* Fiber.join(fiber));
    assert.equal(env.PATH, "/Users/test/.nvm/bin:/opt/homebrew/bin:/usr/bin:/bin");
  }),
);
