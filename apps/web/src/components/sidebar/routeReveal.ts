import type { SidebarAutoReveal } from "@t3tools/contracts/settings";
import { useRef } from "react";

import { filterSidebarV2VisibleThreads } from "../Sidebar.logic";

// AppSidebarLayout owns this so drawer and Settings remounts preserve the chosen project scope.
// Only route changes may widen that scope; scroll position is lost on remount.
// Leaving Settings commits the router's location before its matches, briefly hiding thread params.
// Ignore null keys so the same thread does not look new during that gap.
export interface SidebarRouteReveal {
  observedKey: string | null;
  pendingKey: string | null;
  // Set by the Reveal Thread in Sidebar command: the row scrolls despite hover and flashes once.
  manualKey?: string | null;
}

// Pending until a Sidebar consumes it, so a command that opens a hidden sidebar still lands.
let revealRequested = false;
const revealRequestListeners = new Set<() => void>();

export function requestSidebarReveal(): void {
  revealRequested = true;
  for (const listener of revealRequestListeners) listener();
}

export function consumeSidebarRevealRequest(): void {
  revealRequested = false;
}

export const sidebarRevealRequest = {
  subscribe: (listener: () => void) => {
    revealRequestListeners.add(listener);
    return () => {
      revealRequestListeners.delete(listener);
    };
  },
  getSnapshot: () => revealRequested,
};

function flashRow(row: HTMLElement): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  row.animate(
    [
      { boxShadow: "inset 0 0 0 0 transparent" },
      { boxShadow: "inset 0 0 0 2px color-mix(in oklab, var(--color-primary) 70%, transparent)" },
      { boxShadow: "inset 0 0 0 0 transparent" },
    ],
    { duration: 650, iterations: 2 },
  );
}

export function pendingSidebarRouteReveal(
  reveal: SidebarRouteReveal,
  routeKey: string | null,
): string | null {
  if (routeKey === null) return null;
  if (reveal.observedKey !== routeKey) {
    reveal.observedKey = routeKey;
    reveal.pendingKey = routeKey;
    reveal.manualKey = null;
  }
  return reveal.pendingKey;
}

function claimManualSidebarReveal(reveal: SidebarRouteReveal, rowKey: string): boolean {
  if (reveal.manualKey !== rowKey) return false;
  reveal.manualKey = null;
  reveal.pendingKey = null;
  return true;
}

export function armManualSidebarReveal(reveal: SidebarRouteReveal, rowKey: string): void {
  reveal.manualKey = rowKey;
}

export function completeSidebarRouteReveal(reveal: SidebarRouteReveal): void {
  reveal.pendingKey = null;
}

// Each route change and each mount scroll to the open thread once. Render records
// the route, so a thread left before its row mounted still counts as a change.
// The row can mount after the route, once its shells arrive, so its ref scrolls.
// A reveal after a state change finds the row mounted and no ref fires: `revealNow` scrolls it.
export function useActiveRowReveal(
  reveal: SidebarRouteReveal,
  routeKey: string | null,
  autoReveal: SidebarAutoReveal = "scrollOnly",
) {
  const mountRevealOwed = useRef(true);
  const activeRow = useRef<{ readonly row: HTMLElement; readonly key: string } | null>(null);
  pendingSidebarRouteReveal(reveal, routeKey);
  const scrollRow = (row: HTMLElement, manual: boolean) => {
    // A row under the pointer was just clicked, so it is in view; scrolling it would force a
    // layout mid-commit. Keyboard activation can come from a focused row scrolled out of view.
    if (!manual && row.matches(":hover")) return;
    row.scrollIntoView({ block: "nearest" });
    if (manual) flashRow(row);
  };
  const revealRow = (row: HTMLElement | null, rowKey: string) => {
    if (row === null) return;
    activeRow.current = { row, key: rowKey };
    if (claimManualSidebarReveal(reveal, rowKey)) {
      mountRevealOwed.current = false;
      scrollRow(row, true);
      return;
    }
    if (reveal.pendingKey !== rowKey && !mountRevealOwed.current) return;
    completeSidebarRouteReveal(reveal);
    mountRevealOwed.current = false;
    if (autoReveal === "off") return;
    scrollRow(row, false);
  };
  const revealNow = (manual: boolean) => {
    const current = activeRow.current;
    if (current === null || !current.row.isConnected || current.key !== routeKey) return;
    if (manual) claimManualSidebarReveal(reveal, current.key);
    scrollRow(current.row, manual);
  };
  return { revealRow, revealNow };
}

type RevealableThread = Parameters<typeof filterSidebarV2VisibleThreads>[0][number];

export function isHiddenByProjectScope(
  thread: RevealableThread,
  scopedProjectKeys: ReadonlySet<string> | null,
  delegatedUnderParent: ReadonlySet<string>,
): boolean {
  return (
    scopedProjectKeys !== null &&
    filterSidebarV2VisibleThreads([thread], scopedProjectKeys, delegatedUnderParent).length === 0 &&
    filterSidebarV2VisibleThreads([thread], null, delegatedUnderParent).length === 1
  );
}

// Render records the route before deciding, so the first render of a new route
// already widens the scope. Only a route reveal widens: the once-per-mount
// scroll never changes a scope the user chose.
export function resolveSidebarRouteReveal<T extends RevealableThread>(input: {
  readonly reveal: SidebarRouteReveal;
  readonly routeKey: string | null;
  readonly isSearching: boolean;
  readonly scopedProjectKeys: ReadonlySet<string> | null;
  readonly delegatedUnderParent: ReadonlySet<string>;
  readonly findThread: (key: string) => T | undefined;
}): { readonly pendingKey: string | null; readonly widensScope: boolean } {
  const { reveal, routeKey, isSearching, scopedProjectKeys, delegatedUnderParent, findThread } =
    input;
  const pendingKey = pendingSidebarRouteReveal(reveal, routeKey);
  // Search results replace the thread list; the reveal waits for it to return.
  const thread = pendingKey === null || isSearching ? undefined : findThread(pendingKey);
  const widensScope =
    thread !== undefined && isHiddenByProjectScope(thread, scopedProjectKeys, delegatedUnderParent);
  return { pendingKey, widensScope };
}
