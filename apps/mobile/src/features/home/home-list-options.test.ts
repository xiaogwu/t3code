import { RegistryContext } from "@effect/atom-react";
import {
  DEFAULT_SIDEBAR_PROJECT_SORT_ORDER,
  DEFAULT_SIDEBAR_V2_THREAD_SORT_ORDER,
  EnvironmentId,
} from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const saved = vi.hoisted(() => [] as unknown[]);
vi.mock("../../state/preferences", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    updateMobilePreferencesAtom: Atom.writable(
      () => null,
      (_ctx, patch: unknown) => {
        saved.push(patch);
      },
    ),
  };
});

import type { ThreadListFilters } from "../../persistence/mobile-preferences";
import {
  hasCustomHomeListOptions,
  HomeListOptionsProvider,
  type HomeListOptions,
  useHomeListOptions,
} from "./home-list-options";

describe("home list options across layout changes", () => {
  const environmentId = EnvironmentId.make("environment-1");
  const availableEnvironmentIds = new Set([environmentId]);
  let root: Root;
  let latest: ReturnType<typeof useHomeListOptions>;

  function ThreadList() {
    const state = useHomeListOptions(availableEnvironmentIds);
    useLayoutEffect(() => {
      latest = state;
    });
    return null;
  }

  const registry = AtomRegistry.make();

  async function showLayout(layout: "compact" | "sidebar", savedFilters?: ThreadListFilters) {
    await act(() => {
      root.render(
        createElement(
          RegistryContext,
          { value: registry },
          createElement(
            HomeListOptionsProvider,
            { projectGroupingMode: "repository", savedFilters },
            // Replace the list while keeping the workspace provider mounted.
            createElement(ThreadList, { key: layout }),
          ),
        ),
      );
    });
  }

  beforeEach(() => {
    // The hook probe renders no DOM, but ReactDOM needs an event target.
    const document = {
      nodeType: 9,
      addEventListener() {},
      removeEventListener() {},
    };
    const container = {
      nodeType: 1,
      tagName: "DIV",
      namespaceURI: "http://www.w3.org/1999/xhtml",
      ownerDocument: document,
      addEventListener() {},
      removeEventListener() {},
    };
    vi.stubGlobal("document", document);
    vi.stubGlobal("window", { document, HTMLIFrameElement: EventTarget });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    root = createRoot(container as unknown as HTMLElement);
    saved.length = 0;
  });

  afterEach(async () => {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  it.each([
    ["compact", "sidebar"],
    ["sidebar", "compact"],
  ] as const)(
    "retains filters through repeated %s → %s round trips and keeps clears",
    async (initialLayout, otherLayout) => {
      await showLayout(initialLayout);

      for (const [selectedEnvironmentId, selectedProjectKey] of [
        [environmentId, "repository:one"],
        [environmentId, "repository:two"],
        [environmentId, null],
        [null, null],
        [null, "repository:one"],
      ] as const) {
        await act(() => {
          latest.setSelectedEnvironmentId(selectedEnvironmentId);
          latest.setSelectedProjectKey(selectedProjectKey);
        });
        for (let cycle = 0; cycle < 3; cycle += 1) {
          for (const layout of [otherLayout, initialLayout]) {
            await showLayout(layout);
            expect(latest.options).toMatchObject({
              selectedEnvironmentId,
              selectedProjectKey,
              projectGroupingMode: "repository",
            });
          }
        }
        // Make the next selection (or clear it) from the opposite layout.
        await showLayout(otherLayout);
      }
    },
  );

  it("restores saved filters on launch and saves only real changes", async () => {
    await showLayout("compact", { environmentId, projectKey: "repository:one" });
    expect(latest.options).toMatchObject({
      selectedEnvironmentId: environmentId,
      selectedProjectKey: "repository:one",
    });
    expect(saved).toEqual([]);

    await act(() => latest.setSelectedProjectKey(null));
    expect(saved).toEqual([{ threadListFilters: { environmentId, projectKey: null } }]);
  });
});

describe("home list options", () => {
  const defaults: HomeListOptions = {
    selectedEnvironmentId: null,
    selectedProjectKey: null,
    projectSortOrder:
      DEFAULT_SIDEBAR_PROJECT_SORT_ORDER === "manual"
        ? "updated_at"
        : DEFAULT_SIDEBAR_PROJECT_SORT_ORDER,
    v2ThreadSortOrder: DEFAULT_SIDEBAR_V2_THREAD_SORT_ORDER,
  };

  it("recognizes default options", () => {
    expect(hasCustomHomeListOptions(defaults)).toBe(false);
  });

  it("marks environment filters as customized", () => {
    expect(
      hasCustomHomeListOptions({ ...defaults, selectedEnvironmentId: "environment-1" as never }),
    ).toBe(true);
    expect(
      hasCustomHomeListOptions({ ...defaults, selectedProjectKey: "environment-1:project-1" }),
    ).toBe(true);
  });

  it("marks a non-default v2 thread order as customized", () => {
    const other =
      DEFAULT_SIDEBAR_V2_THREAD_SORT_ORDER === "created_at" ? "updated_at" : "created_at";
    expect(hasCustomHomeListOptions({ ...defaults, v2ThreadSortOrder: other })).toBe(true);
  });
});
