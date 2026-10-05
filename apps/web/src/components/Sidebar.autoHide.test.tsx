import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  acquireSidebarPeekHold,
  getSidebarPeekHoldCount,
  INITIAL_SIDEBAR_PEEK_STATE,
  reduceSidebarPeekState,
  RETRACT_DELAY_MS,
  REVEAL_DELAY_MS,
  subscribeSidebarPeekHold,
  useSidebarPeekController,
  withSidebarPeekHold,
  type SidebarPeekController,
  type SidebarPeekState,
} from "./Sidebar.autoHide";

const peeked: SidebarPeekState = { phase: "peeked" };
const retracting: SidebarPeekState = { phase: "retracting" };

describe("reduceSidebarPeekState", () => {
  it("never opens while dwell in the edge strip is shorter than the reveal delay", () => {
    let state = reduceSidebarPeekState(INITIAL_SIDEBAR_PEEK_STATE, {
      pointerZone: "edge",
      holds: 0,
      elapsedMs: 0,
    });
    expect(state.phase).toBe("opening");

    state = reduceSidebarPeekState(state, {
      pointerZone: "edge",
      holds: 0,
      elapsedMs: REVEAL_DELAY_MS - 1,
    });
    expect(state.phase).toBe("opening");
  });

  it("opens once dwell in the edge strip reaches the reveal delay", () => {
    const opening: SidebarPeekState = { phase: "opening" };
    const state = reduceSidebarPeekState(opening, {
      pointerZone: "edge",
      holds: 0,
      elapsedMs: REVEAL_DELAY_MS,
    });
    expect(state.phase).toBe("peeked");
  });

  it("cancels the dwell if the pointer leaves the strip before it opens", () => {
    const opening: SidebarPeekState = { phase: "opening" };
    const state = reduceSidebarPeekState(opening, {
      pointerZone: "outside",
      holds: 0,
      elapsedMs: 10,
    });
    expect(state.phase).toBe("hidden");
  });

  it("does not retract before the retreat delay elapses", () => {
    const state = reduceSidebarPeekState(retracting, {
      pointerZone: "outside",
      holds: 0,
      elapsedMs: RETRACT_DELAY_MS - 1,
    });
    expect(state.phase).toBe("retracting");
  });

  it("retracts once the retreat delay elapses, even with a pointer that never moved again", () => {
    // The regression this covers: reveal the panel, read it, move the cursor
    // to the keyboard and leave it stationary. No further pointer event ever
    // arrives — the delay alone must be enough to retract; nothing may
    // require the pointer to have traveled any distance.
    const state = reduceSidebarPeekState(retracting, {
      pointerZone: "outside",
      holds: 0,
      elapsedMs: RETRACT_DELAY_MS,
    });
    expect(state.phase).toBe("hidden");
  });

  it("re-entering the strip or panel cancels a pending retreat, however long it's been outside", () => {
    const state = reduceSidebarPeekState(retracting, {
      pointerZone: "panel",
      holds: 0,
      elapsedMs: RETRACT_DELAY_MS * 5,
    });
    expect(state.phase).toBe("peeked");
  });

  it("never retracts while a hold is active, from peeked or already retracting", () => {
    const fromPeeked = reduceSidebarPeekState(peeked, {
      pointerZone: "outside",
      holds: 1,
      elapsedMs: RETRACT_DELAY_MS * 10,
    });
    expect(fromPeeked.phase).toBe("peeked");

    const fromRetracting = reduceSidebarPeekState(retracting, {
      pointerZone: "outside",
      holds: 1,
      elapsedMs: RETRACT_DELAY_MS * 10,
    });
    expect(fromRetracting.phase).toBe("retracting");
  });

  it("retracts once a hold releases, with the delay it already accrued while held", () => {
    // Held for well past the delay: no retreat while it's active.
    const held = reduceSidebarPeekState(retracting, {
      pointerZone: "outside",
      holds: 1,
      elapsedMs: RETRACT_DELAY_MS * 10,
    });
    expect(held.phase).toBe("retracting");

    // The hold releases: elapsed time isn't reset by having been held, so
    // this qualifies immediately, with no further pointer event needed.
    const releasing = reduceSidebarPeekState(held, {
      pointerZone: "outside",
      holds: 0,
      elapsedMs: RETRACT_DELAY_MS * 10,
    });
    expect(releasing.phase).toBe("hidden");
  });
});

describe("sidebar peek hold registry", () => {
  it("counts holds and releases exactly once even if called twice", () => {
    expect(getSidebarPeekHoldCount()).toBe(0);
    const release = acquireSidebarPeekHold();
    expect(getSidebarPeekHoldCount()).toBe(1);
    release();
    release();
    expect(getSidebarPeekHoldCount()).toBe(0);
  });

  it("stacks holds from independent call sites", () => {
    const releaseA = acquireSidebarPeekHold();
    const releaseB = acquireSidebarPeekHold();
    expect(getSidebarPeekHoldCount()).toBe(2);
    releaseA();
    expect(getSidebarPeekHoldCount()).toBe(1);
    releaseB();
    expect(getSidebarPeekHoldCount()).toBe(0);
  });

  it("notifies subscribers on every acquire and release", () => {
    const seen: number[] = [];
    const unsubscribe = subscribeSidebarPeekHold(() => seen.push(getSidebarPeekHoldCount()));
    const release = acquireSidebarPeekHold();
    release();
    unsubscribe();
    expect(seen).toEqual([1, 0]);
  });

  it("holds for the duration of an awaited unit of work", async () => {
    expect(getSidebarPeekHoldCount()).toBe(0);
    let countDuringWork = -1;
    await withSidebarPeekHold(async () => {
      countDuringWork = getSidebarPeekHoldCount();
    });
    expect(countDuringWork).toBe(1);
    expect(getSidebarPeekHoldCount()).toBe(0);
  });
});

// ── Controller (real timers) ───────────────────────────────────────────
//
// The reducer above is exercised directly; this exercises the timer-driven
// hook itself, which is what actually has to retract the panel with no
// further pointer input — the part a pure-reducer test can't see, and where
// the self-rescheduling-timer regression lived.

let renderer: ReactTestRenderer;
let controller: SidebarPeekController;

function Probe({ enabled }: { enabled: boolean }) {
  const value = useSidebarPeekController(enabled);
  useLayoutEffect(() => {
    controller = value;
  });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  // The controller calls `window.setTimeout`/`clearTimeout`; route them to
  // the real (now fake-timer-controlled) globals rather than reimplementing
  // a timer queue.
  vi.stubGlobal("window", {
    setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
    clearTimeout: (...args: Parameters<typeof clearTimeout>) => globalThis.clearTimeout(...args),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  act(() => {
    renderer = create(<Probe enabled />);
  });
});

afterEach(() => {
  act(() => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useSidebarPeekController", () => {
  it("opens after dwelling in the edge strip for the reveal delay", () => {
    act(() => controller.edgeHandlers.onPointerEnter({ clientX: 0, clientY: 100 }));
    expect(controller.peeked).toBe(false);

    act(() => vi.advanceTimersByTime(REVEAL_DELAY_MS - 1));
    expect(controller.peeked).toBe(false);

    act(() => vi.advanceTimersByTime(1));
    expect(controller.peeked).toBe(true);
  });

  it("retracts once the retreat delay elapses with no further pointer input at all", () => {
    act(() => controller.edgeHandlers.onPointerEnter({ clientX: 0, clientY: 100 }));
    act(() => vi.advanceTimersByTime(REVEAL_DELAY_MS));
    expect(controller.peeked).toBe(true);

    // The one and only event the strip/panel fire once the pointer leaves —
    // nothing else arrives afterward. Retraction can't depend on it.
    act(() => controller.panelHandlers.onPointerLeave({ clientX: 0, clientY: 100 }));
    expect(controller.peeked).toBe(true);

    act(() => vi.advanceTimersByTime(RETRACT_DELAY_MS - 1));
    expect(controller.peeked).toBe(true);

    act(() => vi.advanceTimersByTime(1));
    expect(controller.peeked).toBe(false);
  });

  it("cancels the retreat if the pointer re-enters before the delay elapses", () => {
    act(() => controller.edgeHandlers.onPointerEnter({ clientX: 0, clientY: 100 }));
    act(() => vi.advanceTimersByTime(REVEAL_DELAY_MS));

    act(() => controller.panelHandlers.onPointerLeave({ clientX: 0, clientY: 100 }));
    act(() => vi.advanceTimersByTime(RETRACT_DELAY_MS - 1));
    act(() => controller.panelHandlers.onPointerEnter({ clientX: 0, clientY: 100 }));

    // Past where the original deadline would have fired: still open, and
    // leaving again starts a fresh delay rather than the old one firing late.
    act(() => vi.advanceTimersByTime(RETRACT_DELAY_MS));
    expect(controller.peeked).toBe(true);
  });

  it("holds block retraction at the deadline; releasing one retracts without another pointer event", () => {
    act(() => controller.edgeHandlers.onPointerEnter({ clientX: 0, clientY: 100 }));
    act(() => vi.advanceTimersByTime(REVEAL_DELAY_MS));

    act(() => controller.panelHandlers.onPointerLeave({ clientX: 0, clientY: 100 }));

    let release: () => void = () => {};
    act(() => {
      release = acquireSidebarPeekHold();
    });

    // Well past the deadline, but held: must still be open.
    act(() => vi.advanceTimersByTime(RETRACT_DELAY_MS * 3));
    expect(controller.peeked).toBe(true);

    // Releasing needs no further pointer event: the elapsed delay was
    // already there, just gated.
    act(() => release());
    expect(controller.peeked).toBe(false);
  });
});
