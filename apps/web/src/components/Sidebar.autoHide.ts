import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

/**
 * Dia-style hover-intent state machine for the auto-hiding main sidebar.
 *
 * The panel is a mode, not a state: while `sidebarAutoHide` is on and the
 * sidebar is unpinned, it lives off-screen and reveals itself as a floating
 * overlay when the pointer dwells at the window's leading edge. Retracting
 * requires the pointer to actually leave the strip/panel and stay away for
 * the retreat delay — re-entering at any point cancels it outright, which is
 * what keeps a graze at the boundary from flickering the panel shut.
 */

export type SidebarPeekPointerZone = "edge" | "panel" | "outside";
export type SidebarPeekPhase = "hidden" | "opening" | "peeked" | "retracting";

export interface SidebarPeekState {
  phase: SidebarPeekPhase;
}

export interface SidebarPeekInput {
  pointerZone: SidebarPeekPointerZone;
  /** Count of active holds (menus, focus, drag, ...). Retraction never
   * proceeds while this is above zero. */
  holds: number;
  /** Milliseconds elapsed since the current phase was entered. */
  elapsedMs: number;
}

/** Dwell required in the edge strip before the panel reveals. */
export const REVEAL_DELAY_MS = 120;
/** Delay after leaving the strip/panel before the panel retracts, unless the
 * pointer re-enters or a hold is active first. */
export const RETRACT_DELAY_MS = 220;

export const INITIAL_SIDEBAR_PEEK_STATE: SidebarPeekState = { phase: "hidden" };

/** Whether the panel should be visible (rendered on screen) for a phase. */
export function isSidebarPeekVisible(phase: SidebarPeekPhase): boolean {
  return phase === "peeked" || phase === "retracting";
}

/**
 * Pure transition function. Takes the current state and one input snapshot,
 * returns the next state. No timers, no DOM — a driver (see
 * `useSidebarPeekController`) re-invokes this whenever the pointer zone,
 * holds, or a scheduled deadline changes.
 *
 * An earlier version also gated retraction on the pointer having moved past
 * a tolerance radius from where it left, on top of the delay. That second
 * gate's only distinct effect was a real failure mode: a pointer that left
 * the panel and then went stationary near the edge (e.g. the user moved to
 * the keyboard) never cleared the radius, so the panel never retracted.
 * Whatever flicker the radius was meant to prevent is already covered by
 * `insideAffordance` canceling a pending retreat on re-entry within the
 * delay window — the delay alone is the smaller model that still makes the
 * boundary-graze case unsurprising.
 */
export function reduceSidebarPeekState(
  state: SidebarPeekState,
  input: SidebarPeekInput,
): SidebarPeekState {
  const { pointerZone, holds, elapsedMs } = input;
  const insideAffordance = pointerZone === "edge" || pointerZone === "panel";

  switch (state.phase) {
    case "hidden":
      return pointerZone === "edge" ? { phase: "opening" } : state;

    case "opening":
      if (pointerZone !== "edge") {
        // Left before the dwell finished; nothing was ever shown.
        return { phase: "hidden" };
      }
      return elapsedMs >= REVEAL_DELAY_MS ? { phase: "peeked" } : state;

    case "peeked":
      if (insideAffordance) return state;
      if (holds > 0) return state; // Never start the retreat clock while held.
      return { phase: "retracting" };

    case "retracting":
      if (insideAffordance) return { phase: "peeked" };
      if (holds > 0) return state;
      return elapsedMs >= RETRACT_DELAY_MS ? { phase: "hidden" } : state;
  }
}

// ── Hold registry ────────────────────────────────────────────────────
//
// A hold blocks retraction while active: an open menu owned by the sidebar,
// focus inside the panel, an in-flight thread reorder, or a native file drag.
// Base UI renders menus/popovers in portals outside the panel DOM, so a
// `pointerleave` fires on the panel the instant one opens — holds are how
// callers say "the panel is still in use" despite that.

let holdCount = 0;
const holdListeners = new Set<() => void>();

function emitHoldChange(): void {
  for (const listener of holdListeners) listener();
}

/** Imperative acquire for call sites outside React render (e.g. an awaited
 * native context menu). Always release exactly once. */
export function acquireSidebarPeekHold(): () => void {
  holdCount += 1;
  emitHoldChange();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holdCount -= 1;
    emitHoldChange();
  };
}

/** Runs `work`, holding retraction open for its entire duration. */
export async function withSidebarPeekHold<T>(work: () => Promise<T>): Promise<T> {
  const release = acquireSidebarPeekHold();
  try {
    return await work();
  } finally {
    release();
  }
}

export function getSidebarPeekHoldCount(): number {
  return holdCount;
}

export function subscribeSidebarPeekHold(listener: () => void): () => void {
  holdListeners.add(listener);
  return () => holdListeners.delete(listener);
}

/** Declarative hold for call sites that already track their own open state
 * (a popover's `open`, a drag's in-flight flag, a native drag-over flag). */
export function useSidebarPeekHold(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return acquireSidebarPeekHold();
  }, [active]);
}

/** Panel focus counts as a hold for as long as it lasts. `focusin`/`focusout`
 * bubble, so one listener on the panel root covers every focusable descendant
 * (search field, inline rename, keyboard-navigated rows). */
export function useSidebarPeekFocusHold(panelRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    let release: (() => void) | null = null;
    const onFocusIn = () => {
      release ??= acquireSidebarPeekHold();
    };
    const onFocusOut = () => {
      // A focus move between two panel descendants fires focusout then
      // focusin synchronously; only release once nothing in the panel is
      // focused after that pair settles.
      queueMicrotask(() => {
        if (panel.contains(document.activeElement)) return;
        release?.();
        release = null;
      });
    };
    panel.addEventListener("focusin", onFocusIn);
    panel.addEventListener("focusout", onFocusOut);
    return () => {
      panel.removeEventListener("focusin", onFocusIn);
      panel.removeEventListener("focusout", onFocusOut);
      release?.();
    };
  }, [panelRef]);
}

// ── Runtime controller ───────────────────────────────────────────────

export interface SidebarPeekEdgeHandlers {
  onPointerEnter: (event: { clientX: number; clientY: number }) => void;
  onPointerMove: (event: { clientX: number; clientY: number }) => void;
  onPointerLeave: (event: { clientX: number; clientY: number }) => void;
  onDragEnter: (event: { clientX: number; clientY: number }) => void;
}

export interface SidebarPeekPanelHandlers {
  onPointerEnter: (event: { clientX: number; clientY: number }) => void;
  onPointerLeave: (event: { clientX: number; clientY: number }) => void;
}

export interface SidebarPeekController {
  peeked: boolean;
  edgeHandlers: SidebarPeekEdgeHandlers;
  panelHandlers: SidebarPeekPanelHandlers;
  /** Forces the panel away immediately, bypassing holds. For deliberate
   * dismissals: Escape, clicking into the content, picking a thread. */
  retract: () => void;
}

/**
 * Drives `reduceSidebarPeekState` with real timers. Schedules exactly one
 * timeout per phase (the dwell-to-open deadline, or the retreat deadline) —
 * never a rAF loop or a `pointermove` listener of any kind. The zone alone
 * (edge strip, panel, or neither) is enough: the strip's and panel's own
 * `pointerenter`/`pointerleave` already fire correctly on re-entry with no
 * help from tracking position, so nothing here needs it.
 */
export function useSidebarPeekController(enabled: boolean): SidebarPeekController {
  const [phase, setPhase] = useState<SidebarPeekPhase>("hidden");
  const stateRef = useRef<SidebarPeekState>(INITIAL_SIDEBAR_PEEK_STATE);
  const zoneRef = useRef<SidebarPeekPointerZone>("outside");
  const phaseEnteredAtRef = useRef(0);
  const timeoutRef = useRef<number | null>(null);
  // The absolute time (`performance.now()` epoch) the pending timeout targets,
  // or null when nothing is scheduled. Lets `step` skip touching the timer
  // when re-invoked mid-phase (e.g. a hold-count poke) but the deadline
  // hasn't actually moved — otherwise a step that changes nothing would keep
  // pushing the deadline out and the panel would never leave.
  const scheduledForRef = useRef<number | null>(null);

  const clearScheduled = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    scheduledForRef.current = null;
  }, []);

  // A stable ref, not a `useCallback`, precisely because `step` reschedules
  // itself: closing over the callback's own identity would read it before
  // its declaration finishes initializing. Everything it closes over (refs,
  // the `setPhase` setter) is already stable, so the function itself never
  // needs to change.
  const stepRef = useRef<() => void>(null);
  stepRef.current ??= () => {
    const now = performance.now();
    const holds = getSidebarPeekHoldCount();
    const next = reduceSidebarPeekState(stateRef.current, {
      pointerZone: zoneRef.current,
      holds,
      elapsedMs: now - phaseEnteredAtRef.current,
    });
    if (next.phase !== stateRef.current.phase) {
      phaseEnteredAtRef.current = now;
    }
    const changed = next.phase !== stateRef.current.phase;
    stateRef.current = next;
    if (changed) setPhase(next.phase);

    // The deadline is always anchored to when the phase was entered, never to
    // "now" — a step that re-confirms the same phase (a hold releasing with
    // nothing else different) must not restart the clock. Holds gate
    // retraction specifically: while one is active, no deadline is scheduled
    // at all, and `subscribeSidebarPeekHold` below re-steps on release.
    const target =
      next.phase === "opening"
        ? phaseEnteredAtRef.current + REVEAL_DELAY_MS
        : next.phase === "retracting" && holds === 0
          ? phaseEnteredAtRef.current + RETRACT_DELAY_MS
          : null;
    if (target !== scheduledForRef.current) {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      scheduledForRef.current = target;
      timeoutRef.current =
        target === null
          ? null
          : window.setTimeout(() => stepRef.current?.(), Math.max(0, target - now));
    }
  };
  const step = useCallback(() => stepRef.current?.(), []);

  // A hold releasing is what unblocks a retreat that the delay alone already
  // qualified for; re-run the step whenever the count changes.
  useEffect(() => subscribeSidebarPeekHold(step), [step]);

  useEffect(() => {
    if (enabled) return;
    clearScheduled();
    stateRef.current = INITIAL_SIDEBAR_PEEK_STATE;
    zoneRef.current = "outside";
    setPhase("hidden");
  }, [enabled, clearScheduled]);

  const setZone = useCallback(
    (zone: SidebarPeekPointerZone) => {
      if (!enabled) return;
      zoneRef.current = zone;
      step();
    },
    [enabled, step],
  );

  const edgeHandlers = useMemo<SidebarPeekEdgeHandlers>(
    () => ({
      onPointerEnter: () => setZone("edge"),
      onPointerMove: () => setZone("edge"),
      onPointerLeave: () => setZone("outside"),
      onDragEnter: () => setZone("edge"),
    }),
    [setZone],
  );
  const panelHandlers = useMemo<SidebarPeekPanelHandlers>(
    () => ({
      onPointerEnter: () => setZone("panel"),
      onPointerLeave: () => setZone("outside"),
    }),
    [setZone],
  );

  const retract = useCallback(() => {
    clearScheduled();
    zoneRef.current = "outside";
    stateRef.current = { phase: "hidden" };
    setPhase("hidden");
  }, [clearScheduled]);

  useEffect(() => clearScheduled, [clearScheduled]);

  const peeked = isSidebarPeekVisible(phase);
  return useMemo(
    () => ({ peeked, edgeHandlers, panelHandlers, retract }),
    [peeked, edgeHandlers, panelHandlers, retract],
  );
}
