import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { beforeEach, vi } from "vite-plus/test";

const { createFromDataURLMock, setDockIconMock } = vi.hoisted(() => ({
  createFromDataURLMock: vi.fn(() => ({ themed: true })),
  setDockIconMock: vi.fn(),
}));

vi.mock("electron", () => ({
  nativeImage: {
    createFromDataURL: createFromDataURLMock,
  },
  app: {
    dock: {
      setIcon: setDockIconMock,
    },
  },
}));

import * as ElectronApp from "./ElectronApp.ts";

describe("ElectronApp", () => {
  beforeEach(() => {
    createFromDataURLMock.mockClear();
    setDockIconMock.mockClear();
  });

  it.effect("decodes a renderer-generated Dock icon before applying it", () =>
    Effect.gen(function* () {
      const electronApp = yield* ElectronApp.ElectronApp;
      yield* electronApp.setDockIcon("data:image/png;base64,grove");

      assert.deepEqual(createFromDataURLMock.mock.calls, [["data:image/png;base64,grove"]]);
      assert.deepEqual(setDockIconMock.mock.calls, [[{ themed: true }]]);
    }).pipe(Effect.provide(ElectronApp.layer)),
  );
});
