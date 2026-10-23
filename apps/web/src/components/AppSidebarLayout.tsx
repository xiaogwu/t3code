import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { isCommandPaletteOpen } from "../commandPaletteBus";
import { isElectron } from "../env";
import {
  releaseThreadUndoShortcut,
  threadUndoClaimsShortcut,
  undoLatestThreadAction,
} from "../hooks/showThreadUndoNotice";
import { getLocalStorageItem, removeLocalStorageItem } from "../hooks/useLocalStorage";
import {
  isRichTextBoldShortcut,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { cn, isMacPlatform } from "../lib/utils";
import { primaryServerKeybindingsAtom } from "../state/server";
import {
  toggleLegacySidebarPreference,
  toggleSidebarThreadSortPreference,
  useClientSettings,
  useEnvironmentIdentificationMode,
  updateClientSettings,
  useLegacySidebarEnabled,
} from "../hooks/useSettings";
import {
  PanelAnimationSuppressionProvider,
  usePanelAnimationSettings,
  usePanelNavigationSuppression,
} from "../panelAnimations";
import LegacyThreadSidebar from "./LegacySidebar";
import { useThreadVisitedMigration } from "../hooks/useThreadVisitedMigration";
import ThreadSidebar from "./Sidebar";
import { SettingsSidebarNav } from "./settings/SettingsSidebarNav";
import { SidebarBrandWidthProbe, SidebarChromeHeader } from "./sidebar/SidebarChrome";
import { SidebarEdgeTrigger } from "./SidebarEdgeTrigger";
import { MainAppLocationTracker } from "./sidebar/mainAppLocation";
import type { SidebarRouteReveal } from "./sidebar/routeReveal";
import { useSidebarStageBackdropVariant } from "./SidebarStageBackdrop";
import { useProjects } from "../state/entities";
import {
  clampThreadSidebarWidth,
  resolveInitialThreadSidebarWidth,
  resolveThreadSidebarMaximumWidth,
  resolveThreadSidebarMinimumWidth,
  THREAD_MAIN_CONTENT_MIN_WIDTH,
  THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
} from "./threadSidebarWidth";
import {
  Sidebar,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
  useSidebarVisibility,
} from "./ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { useThreadRouteRef } from "../hooks/useThreadRouteTarget";

const MACOS_TRAFFIC_LIGHTS_LEFT_INSET = "var(--desktop-window-controls-inset, 90px)";

function subscribeToViewportWidth(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function readViewportWidth(): number {
  return window.innerWidth;
}

// getWindowFullscreenState is a synchronous IPC round trip, so the snapshot is cached
// and only re-read when a subscription starts.
let windowFullscreenSnapshot: boolean | null = null;

function macosDesktopBridge() {
  if (!isElectron || !isMacPlatform(navigator.platform)) return null;
  return window.desktopBridge ?? null;
}

function subscribeToWindowFullscreen(onChange: () => void): () => void {
  const bridge = macosDesktopBridge();
  if (
    typeof bridge?.getWindowFullscreenState !== "function" ||
    typeof bridge.onWindowFullscreenStateChange !== "function"
  ) {
    return () => {};
  }
  const unsubscribe = bridge.onWindowFullscreenStateChange((fullscreen) => {
    windowFullscreenSnapshot = fullscreen;
    onChange();
  });
  // The window may have changed state between the first render and this subscription.
  windowFullscreenSnapshot = bridge.getWindowFullscreenState();
  return () => {
    unsubscribe();
    windowFullscreenSnapshot = null;
  };
}

function readWindowFullscreen(): boolean {
  if (windowFullscreenSnapshot === null) {
    const getWindowFullscreenState = macosDesktopBridge()?.getWindowFullscreenState;
    windowFullscreenSnapshot =
      typeof getWindowFullscreenState === "function" ? getWindowFullscreenState() : false;
  }
  return windowFullscreenSnapshot;
}

function readInitialThreadSidebarWidth(): number {
  try {
    return resolveInitialThreadSidebarWidth(
      getLocalStorageItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY, Schema.Finite),
      window.innerWidth,
    );
  } catch (error) {
    console.error("Could not read persisted thread sidebar width.", error);
    return resolveInitialThreadSidebarWidth(null, window.innerWidth);
  }
}

function SidebarControl() {
  const usagePageOpen = useLocation({ select: (location) => location.pathname === "/usage" });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { toggleSidebar, peeked, peekPanelHandlers, isMobile, mobileSheetMounted } = useSidebar();
  const isSidebarVisible = useSidebarVisibility();
  const legacySidebarEnabled = useLegacySidebarEnabled();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const stageBackdropVariant = useSidebarStageBackdropVariant(
    environmentIdentificationMode === "artwork",
  );
  const shortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.toggle", {
    context: { usagePageOpen },
  });
  const sidebarAutoHide = useClientSettings((settings) => settings.sidebarAutoHide);
  const sidebarThreadSortOrder = useClientSettings((settings) => settings.sidebarV2ThreadSortOrder);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      if (
        isRichTextBoldShortcut(event, window.getSelection()) &&
        event.target instanceof HTMLElement &&
        event.target.closest('[data-composer-rich-text="true"]')
      ) {
        // The rich-text composer claims Mod+B only to bold selected text;
        // the toggle stays available everywhere else.
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, { context: { usagePageOpen } });
      if (
        command !== "sidebar.toggle" &&
        command !== "sidebar.version.toggle" &&
        command !== "sidebar.sort.toggle" &&
        command !== "sidebarAutoHide.toggle"
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (command === "sidebar.toggle") {
        toggleSidebar();
        return;
      }
      if (command === "sidebarAutoHide.toggle") {
        void updateClientSettings({ sidebarAutoHide: !sidebarAutoHide });
        return;
      }
      if (command === "sidebar.sort.toggle") {
        void updateClientSettings(toggleSidebarThreadSortPreference(sidebarThreadSortOrder));
        return;
      }
      updateClientSettings(toggleLegacySidebarPreference(legacySidebarEnabled));
    };

    window.addEventListener("keydown", onKeyDown, true);
    const unsubscribe = window.desktopBridge?.onMenuAction((action) => {
      if (action === "sidebar.toggle") toggleSidebar();
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      unsubscribe?.();
    };
  }, [
    keybindings,
    legacySidebarEnabled,
    sidebarAutoHide,
    sidebarThreadSortOrder,
    toggleSidebar,
    usagePageOpen,
  ]);

  return (
    <div
      className={cn(
        "pointer-events-none fixed left-[var(--workspace-controls-left)] top-[var(--workspace-controls-top)] z-50 ml-px flex h-[var(--workspace-topbar-height)] items-center",
        // The trigger sits inside the peeked panel's footprint, so it has to
        // clear the panel's own `z-[60]` or the only affordance for pinning
        // the panel open disappears underneath it.
        peeked && "z-[70]",
        isMobile && mobileSheetMounted && "hidden",
      )}
      data-sidebar-control=""
      // Hovering the trigger counts as being in the panel, exactly as if the
      // pointer were over the panel itself. Without this the trigger is not a
      // DOM descendant of the panel, so reaching for it fires the panel's
      // `pointerleave` and retracts it out from under the cursor.
      onPointerEnter={peekPanelHandlers.onPointerEnter}
      onPointerLeave={peekPanelHandlers.onPointerLeave}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarTrigger
              variant={isSidebarVisible && stageBackdropVariant ? "media-navigation" : "ghost"}
              className={cn(
                "pointer-events-auto",
                isSidebarVisible && stageBackdropVariant && "relative top-auto translate-y-0",
              )}
              aria-label="Toggle main sidebar"
            />
          }
        />
        <TooltipPopup side="bottom">
          Toggle main sidebar{shortcutLabel ? ` (${shortcutLabel})` : ""}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

function routePanelsOpen(routeThreadRef: ReturnType<typeof useThreadRouteRef>) {
  if (!routeThreadRef) return { terminalOpen: false, previewOpen: false };
  return {
    terminalOpen: selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
      routeThreadRef,
    ).terminalOpen,
    previewOpen:
      selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, routeThreadRef) ===
      "preview",
  };
}

export function NavigationHistoryShortcuts() {
  const usagePageOpen = useLocation({ select: (location) => location.pathname === "/usage" });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const routeThreadRef = useThreadRouteRef();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          previewFocus: isPreviewFocused(),
          ...routePanelsOpen(routeThreadRef),
          editableFocus: isEditableFocused(event.target),
          modelPickerOpen: isModelPickerOpen(),
          usagePageOpen,
        },
      });
      if (command !== "navigation.back" && command !== "navigation.forward") return;

      event.preventDefault();
      event.stopPropagation();
      if (command === "navigation.back") window.history.back();
      else window.history.forward();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keybindings, routeThreadRef, usagePageOpen]);

  return null;
}

const MODIFIER_KEYS = new Set(["Alt", "Control", "Meta", "Shift"]);

// Undoes the thread actions in the sidebar's notice. Mounted wherever the
// thread sidebar can show; Settings replaces it. Listens in the capture phase
// so mod+z reaches it before the composer's own undo handler consumes the key.
function ThreadUndoShortcut() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const routeThreadRef = useThreadRouteRef();
  // A collapsed sidebar hides the notice, so text fields keep their own undo.
  const noticeVisible = useSidebarVisibility();
  // Outlives the effect: undoing an archive navigates, which re-runs it mid-hold.
  const heldUndoKey = useRef<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A held key undoes once. Cancel its repeats so they cannot fall through
      // to the editor's own undo, even after the last notice is gone.
      if (event.repeat) {
        if (event.code === heldUndoKey.current) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      // A modifier tapped mid-hold leaves the held key repeating.
      if (!MODIFIER_KEYS.has(event.key)) heldUndoKey.current = null;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          previewFocus: isPreviewFocused(),
          ...routePanelsOpen(routeThreadRef),
          editableFocus:
            isEditableFocused(event.target) && !(noticeVisible && threadUndoClaimsShortcut()),
          modelPickerOpen: isModelPickerOpen(),
        },
      });
      if (command !== "thread.undo") {
        if (!MODIFIER_KEYS.has(event.key)) releaseThreadUndoShortcut();
        return;
      }
      if (isCommandPaletteOpen() || isModelPickerOpen()) return;
      if (undoLatestThreadAction()) {
        heldUndoKey.current = event.code;
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // Pastes from a menu, dictation and drops edit text without a keypress.
    const onInput = () => releaseThreadUndoShortcut();

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("input", onInput, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("input", onInput, true);
    };
  }, [keybindings, noticeVisible, routeThreadRef]);

  return null;
}

// Settings swaps the thread sidebar out of the tree. Keep the lightweight
// project projection subscribed so returning to a draft never renders the
// zero-project state while the environment snapshot reconnects.
function ProjectProjectionRetention() {
  useProjects();
  return null;
}

// A peeked panel puts itself away on any deliberate move into the content:
// clicking into it, or backing out with Escape. Filters by DOM position
// instead of wrapping `{children}` in an event-boundary element — `Sidebar`
// and `SidebarInset` communicate through `peer-*` sibling selectors, which a
// wrapper div would break (it changes DOM nesting even at `display:
// contents`, since CSS sibling combinators match the DOM tree, not the box
// tree).
function SidebarPeekRetractOnContentInteraction({ children }: { children: ReactNode }) {
  const { peeked, retractPeek } = useSidebar();

  useEffect(() => {
    if (!peeked) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") retractPeek();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      // Only a pointerdown that lands outside the sidebar's own DOM (and
      // outside the reveal strip) counts as "into the content".
      if (target?.closest('[data-slot="sidebar"], [data-slot="sidebar-edge-trigger"]')) return;
      retractPeek();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [peeked, retractPeek]);

  return children;
}

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const legacySidebarEnabled = useLegacySidebarEnabled();
  const sidebarAutoHide = useClientSettings((settings) => settings.sidebarAutoHide);
  const [sidebarRouteReveal] = useState<SidebarRouteReveal>(() => ({
    observedKey: null,
    pendingKey: null,
  }));
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  useThreadVisitedMigration();
  const pathname = useLocation({ select: (location) => location.pathname });
  const panelAnimationsSuppressed = usePanelNavigationSuppression(pathname);
  const routePanelAnimationsActive = panelAnimationsActive && !panelAnimationsSuppressed;
  const isOnSettings = pathname === "/settings" || pathname.startsWith("/settings/");
  const isMacosDesktop = isElectron && isMacPlatform(navigator.platform);
  const [sidebarWidth, setSidebarWidth] = useState(readInitialThreadSidebarWidth);
  // Subscribed rather than read once: the clamp must track live window size,
  // and a clamped drag ends with an unchanged width, which skips the re-render
  // that would otherwise refresh a render-time snapshot.
  const viewportWidth = useSyncExternalStore(subscribeToViewportWidth, readViewportWidth);
  const [brandWidth, setBrandWidth] = useState(0);
  const sidebarMinimumWidth = resolveThreadSidebarMinimumWidth(brandWidth);
  const sidebarMaximumWidth = resolveThreadSidebarMaximumWidth(viewportWidth, sidebarMinimumWidth);
  const resetSidebarWidth = () => {
    try {
      removeLocalStorageItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY);
    } catch (error) {
      console.error("Could not clear persisted thread sidebar width.", error);
    }
    setSidebarWidth(resolveInitialThreadSidebarWidth(null, viewportWidth));
  };
  const isWindowFullscreen = useSyncExternalStore(
    subscribeToWindowFullscreen,
    readWindowFullscreen,
  );
  const windowControlsInsetStyle = (
    isMacosDesktop && !isWindowFullscreen
      ? { "--workspace-controls-left": MACOS_TRAFFIC_LIGHTS_LEFT_INSET }
      : {}
  ) as CSSProperties;
  const sidebarProviderStyle = {
    "--sidebar-width": `${clampThreadSidebarWidth(sidebarWidth, sidebarMinimumWidth, sidebarMaximumWidth)}px`,
    "--panel-animation-duration": `${panelAnimationDurationMs}ms`,
    ...windowControlsInsetStyle,
  } as CSSProperties;

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action === "open-settings") {
        const isSettingsRoute = /^\/settings(\/|$)/.test(pathname);
        if (!isSettingsRoute) {
          void navigate({ to: "/settings" });
        }
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate, pathname]);

  return (
    <PanelAnimationSuppressionProvider value={panelAnimationsSuppressed}>
      <SidebarProvider
        autoHide={sidebarAutoHide}
        className="h-dvh! min-h-0!"
        data-panel-animations={routePanelAnimationsActive ? "true" : "false"}
        defaultOpen
        style={sidebarProviderStyle}
      >
        <SidebarBrandWidthProbe onWidthChange={setBrandWidth} />
        <ProjectProjectionRetention />
        <Sidebar
          side="left"
          // Auto-hide peek is an offcanvas overlay. Upstream retired the compact
          // rail, so there is no longer an `icon` mode to lose the race against.
          collapsible="offcanvas"
          data-app-sidebar=""
          role="navigation"
          aria-label={isOnSettings ? "Settings" : "Threads"}
          resizable={{
            maxWidth: sidebarMaximumWidth,
            minWidth: sidebarMinimumWidth,
            shouldAcceptWidth: ({ currentWidth, nextWidth, wrapper }) =>
              nextWidth <= currentWidth ||
              wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
            storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
            onResize: setSidebarWidth,
          }}
          style={windowControlsInsetStyle}
        >
          {isOnSettings ? (
            <>
              <SidebarChromeHeader isElectron={isElectron} />
              <SettingsSidebarNav pathname={pathname} />
            </>
          ) : legacySidebarEnabled ? (
            <LegacyThreadSidebar routeReveal={sidebarRouteReveal} />
          ) : (
            <ThreadSidebar routeReveal={sidebarRouteReveal} />
          )}
          <SidebarRail onDoubleClick={resetSidebarWidth} />
        </Sidebar>
        <SidebarEdgeTrigger />
        <SidebarPeekRetractOnContentInteraction>{children}</SidebarPeekRetractOnContentInteraction>
        <SidebarControl />
        <NavigationHistoryShortcuts />
        {isOnSettings ? null : <ThreadUndoShortcut />}
        <MainAppLocationTracker />
      </SidebarProvider>
    </PanelAnimationSuppressionProvider>
  );
}
