import "../../index.css";

import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { page, userEvent } from "vite-plus/test/browser";

import { Sidebar, SidebarProvider, SidebarTrigger, useSidebar } from "./sidebar";
import { resolveSidebarState } from "./sidebarState";

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

async function renderSidebar(open: boolean) {
  await act(async () => {
    root.render(
      <SidebarProvider open={open}>
        <Sidebar>
          <SidebarTrigger data-testid="internal-trigger" />
          <button data-testid="sidebar-control">Thread</button>
        </Sidebar>
        <SidebarTrigger data-testid="external-trigger" />
        <button data-testid="content-control">Content</button>
      </SidebarProvider>,
    );
  });
}

function element(selector: string) {
  const node = container.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
}

describe("responsive sidebar state", () => {
  it("uses mobile sheet visibility for the shared responsive state", () => {
    expect(resolveSidebarState({ isMobile: true, open: true, openMobile: false })).toBe(
      "collapsed",
    );
    expect(resolveSidebarState({ isMobile: true, open: false, openMobile: true })).toBe("expanded");
    expect(resolveSidebarState({ isMobile: false, open: true, openMobile: false })).toBe(
      "expanded",
    );
  });
});

describe("desktop sidebar focus", () => {
  it("moves focus to the external toggle on collapse and restores sidebar access on expansion", async () => {
    await renderSidebar(true);
    const control = element('[data-testid="sidebar-control"]');
    const sidebar = element('[data-slot="sidebar"]');
    control.focus();
    expect(document.activeElement).toBe(control);

    await renderSidebar(false);

    expect(document.activeElement).toBe(element('[data-testid="external-trigger"]'));
    expect(sidebar.inert).toBe(true);
    control.focus();
    expect(document.activeElement).toBe(element('[data-testid="external-trigger"]'));
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).not.toBe(element('[data-testid="internal-trigger"]'));
    expect(document.activeElement).not.toBe(control);
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(element('[data-testid="external-trigger"]'));
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(element('[data-testid="content-control"]'));

    await renderSidebar(true);

    expect(sidebar.inert).toBe(false);
    control.focus();
    expect(document.activeElement).toBe(control);
  });

  it("keeps focus in the content when the sidebar collapses", async () => {
    await renderSidebar(true);
    const control = element('[data-testid="content-control"]');
    control.focus();
    expect(document.activeElement).toBe(control);

    await renderSidebar(false);

    expect(document.activeElement).toBe(control);
  });
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
