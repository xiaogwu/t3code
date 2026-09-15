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

function renderSidebarButton(className?: string) {
  return renderToStaticMarkup(
    <SidebarProvider>
      <SidebarMenuButton className={className}>Projects</SidebarMenuButton>
    </SidebarProvider>,
  );
}

describe("sidebar interactive cursors", () => {
  it("uses mobile sheet visibility for the shared responsive state", () => {
    expect(resolveSidebarState({ isMobile: true, open: true, openMobile: false })).toBe(
      "collapsed",
    );
    expect(resolveSidebarState({ isMobile: true, open: false, openMobile: true })).toBe("expanded");
    expect(resolveSidebarState({ isMobile: false, open: true, openMobile: false })).toBe(
      "expanded",
    );
  });

  it("exposes collapsed state for shared titlebar inset styling", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider defaultOpen={false}>
        <div />
      </SidebarProvider>,
    );

    expect(html).toContain('data-sidebar-state="collapsed"');
  });

  it("keeps the sidebar trigger interactive inside Electron drag regions", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <SidebarTrigger />
      </SidebarProvider>,
    );

    expect(html).toContain("[-webkit-app-region:no-drag]");
    expect(html).toContain("size-[var(--workspace-titlebar-control-size)]!");
  });

  it("uses shared geometry and icon constraints for menu buttons by default", () => {
    const html = renderSidebarButton();

    expect(html).toContain('data-slot="sidebar-menu-button"');
    expect(html).toContain("h-8");
    expect(html).toContain("rounded-[var(--control-radius)]");
    expect(html).toContain("px-[var(--sidebar-row-content-inset)]");
    expect(html).toContain("py-1.5");
    expect(html).toContain("]:size-4");
    expect(html).toContain("]:shrink-0");
    expect(html).toContain("cursor-pointer");
    expect(html).toContain("gap-[var(--sidebar-control-gap)]");
    expect(html).toContain("text-[var(--sidebar-icon-color)]");
    expect(html).not.toContain("[&amp;&gt;svg]:opacity-60");
  });

  it("applies the shared default treatment to icon-only menu buttons", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <SidebarMenuButton size="icon">
          <span>+</span>
        </SidebarMenuButton>
      </SidebarProvider>,
    );

    expect(html).toContain("size-8");
    expect(html).toContain("justify-center");
    expect(html).toContain("p-0");
    expect(html).toContain("font-medium");
    expect(html).toContain("text-sidebar-muted-foreground/80");
  });

  it("lets project drag handles override the default pointer cursor", () => {
    const html = renderSidebarButton("cursor-grab");

    expect(html).toContain("cursor-grab");
    expect(html).not.toContain("cursor-pointer");
  });

  it("uses a pointer cursor for submenu buttons", () => {
    const html = renderToStaticMarkup(
      <SidebarMenuSubButton render={<button type="button" />}>Show more</SidebarMenuSubButton>,
    );

    expect(html).toContain('data-slot="sidebar-menu-sub-button"');
    expect(html).toContain("cursor-pointer");
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
