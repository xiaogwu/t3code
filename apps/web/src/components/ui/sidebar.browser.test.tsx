import "../../index.css";

import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { page } from "vite-plus/test/browser";

import { SidebarProvider, useSidebar } from "./sidebar";

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  await page.viewport(1280, 900);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

// Turning auto-hide off must undo turning it on, which only shows up across a
// real re-render with effects.
let capturedOpen: boolean;

function OpenCapture() {
  const { open } = useSidebar();
  useLayoutEffect(() => {
    capturedOpen = open;
  });
  return null;
}

async function renderAutoHide(autoHide: boolean, defaultOpen: boolean) {
  await act(async () => {
    root.render(
      <SidebarProvider autoHide={autoHide} defaultOpen={defaultOpen}>
        <OpenCapture />
      </SidebarProvider>,
    );
  });
}

describe("SidebarProvider auto-hide reverse state", () => {
  beforeEach(() => {
    // `setOpen` persists to a cookie; stub it so the test leaves no state behind.
    vi.stubGlobal("cookieStore", { set: async () => {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores an open sidebar it force-closed once the mode is turned off", async () => {
    await renderAutoHide(false, true);
    expect(capturedOpen).toBe(true);

    await renderAutoHide(true, true);
    expect(capturedOpen).toBe(false);

    await renderAutoHide(false, true);
    expect(capturedOpen).toBe(true);
  });

  it("leaves a sidebar that was already closed closed after the mode is turned off", async () => {
    await renderAutoHide(false, false);
    expect(capturedOpen).toBe(false);

    await renderAutoHide(true, false);
    expect(capturedOpen).toBe(false); // Nothing to force closed; it already was.

    await renderAutoHide(false, false);
    expect(capturedOpen).toBe(false); // Must not force it open on the way out.
  });
});
