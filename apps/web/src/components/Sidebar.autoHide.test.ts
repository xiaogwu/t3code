import { describe, expect, it } from "vite-plus/test";
import {
  acquireSidebarPeekHold,
  getSidebarPeekHoldCount,
  INITIAL_SIDEBAR_PEEK_STATE,
  reduceSidebarPeekState,
  RETRACT_DELAY_MS,
  REVEAL_DELAY_MS,
  subscribeSidebarPeekHold,
  withSidebarPeekHold,
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
