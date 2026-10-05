import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  SidebarMenuButton,
  SidebarMenuSubButton,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "./sidebar";
import { resolveSidebarState } from "./sidebarState";

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

// Static markup can't exercise this: turning auto-hide off must undo turning
// it on, which only shows up across a real re-render with effects.
let capturedOpen: boolean;

function OpenCapture() {
  const { open } = useSidebar();
  useLayoutEffect(() => {
    capturedOpen = open;
  });
  return null;
}

describe("SidebarProvider auto-hide reverse state", () => {
  let renderer: ReactTestRenderer;

  beforeEach(() => {
    // `setOpen` persists to a cookie; stub it rather than teach the provider
    // about a test environment.
    vi.stubGlobal("cookieStore", { set: async () => {} });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    act(() => renderer.unmount());
    vi.unstubAllGlobals();
  });

  it("restores an open sidebar it force-closed once the mode is turned off", () => {
    act(() => {
      renderer = create(
        <SidebarProvider autoHide={false} defaultOpen>
          <OpenCapture />
        </SidebarProvider>,
      );
    });
    expect(capturedOpen).toBe(true);

    act(() => {
      renderer.update(
        <SidebarProvider autoHide defaultOpen>
          <OpenCapture />
        </SidebarProvider>,
      );
    });
    expect(capturedOpen).toBe(false);

    act(() => {
      renderer.update(
        <SidebarProvider autoHide={false} defaultOpen>
          <OpenCapture />
        </SidebarProvider>,
      );
    });
    expect(capturedOpen).toBe(true);
  });

  it("leaves a sidebar that was already closed closed after the mode is turned off", () => {
    act(() => {
      renderer = create(
        <SidebarProvider autoHide={false} defaultOpen={false}>
          <OpenCapture />
        </SidebarProvider>,
      );
    });
    expect(capturedOpen).toBe(false);

    act(() => {
      renderer.update(
        <SidebarProvider autoHide defaultOpen={false}>
          <OpenCapture />
        </SidebarProvider>,
      );
    });
    expect(capturedOpen).toBe(false); // Nothing to force closed; it already was.

    act(() => {
      renderer.update(
        <SidebarProvider autoHide={false} defaultOpen={false}>
          <OpenCapture />
        </SidebarProvider>,
      );
    });
    expect(capturedOpen).toBe(false); // Must not force it open on the way out.
  });
});
