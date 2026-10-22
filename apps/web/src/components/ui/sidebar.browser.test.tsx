import "../../index.css";

import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { SidebarEdgeTrigger } from "../SidebarEdgeTrigger";
import { Sidebar, SidebarProvider, useSidebar } from "./sidebar";

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

describe("SidebarProvider auto-hide peek at narrow widths", () => {
  const panel = () => document.querySelector("[data-slot=sidebar]:not([data-mobile])");
  const edge = () => document.querySelector("[data-slot=sidebar-edge-trigger]")!;
  const panelLeft = () =>
    document.querySelector("[data-slot=sidebar-container]")?.getBoundingClientRect().left;

  function DrawerToggle() {
    const { toggleSidebar } = useSidebar();
    return <button onClick={toggleSidebar}>Toggle drawer</button>;
  }

  const renderNarrow = async () => {
    await page.viewport(600, 900);
    return render(
      <SidebarProvider autoHide defaultOpen={false}>
        <SidebarEdgeTrigger />
        <DrawerToggle />
        <Sidebar>
          <span>Threads</span>
        </Sidebar>
      </SidebarProvider>,
      // The sidebar needs no routing.
      { router: false },
    );
  };

  it("keeps one parked panel mounted so a peek slides in and out", async () => {
    await using screen = await renderNarrow();

    const parked = panel();
    expect(parked).not.toBeNull();
    expect(parked?.getAttribute("data-state")).toBe("collapsed");
    expect(parked?.hasAttribute("data-peek")).toBe(false);
    expect(parked?.hasAttribute("inert")).toBe(true);
    expect(document.querySelector("[data-mobile]")).toBeNull();
    expect(panelLeft()).toBeLessThan(0);

    await userEvent.hover(edge());
    await expect.poll(() => panel()?.getAttribute("data-peek")).toBe("true");
    expect(panel()).toBe(parked);
    expect(parked?.hasAttribute("inert")).toBe(false);
    await expect.element(screen.getByText("Threads")).toBeVisible();
    expect(panelLeft()).toBeGreaterThanOrEqual(0);

    await userEvent.unhover(document.body);
    await expect.poll(() => panel()?.hasAttribute("data-peek")).toBe(false);
    // The slide-out needs this same node; a remount would pop it away.
    expect(panel()).toBe(parked);
    expect(parked?.isConnected).toBe(true);
    expect(parked?.hasAttribute("inert")).toBe(true);
  });

  it("swaps the parked panel for the drawer while it is open", async () => {
    await using screen = await renderNarrow();

    await userEvent.click(screen.getByText("Toggle drawer"));

    await expect.poll(() => document.querySelector("[data-mobile]")).not.toBeNull();
    expect(panel()).toBeNull();

    // The drawer's overlay covers the edge, so a real hover cannot reach it; fire the event directly.
    await act(async () => {
      edge().dispatchEvent(
        new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }),
      );
    });
    expect(document.querySelector("[data-peek=true]")).toBeNull();
    expect(panel()).toBeNull();
  });
});
