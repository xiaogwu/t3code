import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  acquireSidebarPeekHold,
  RETRACT_DELAY_MS,
  REVEAL_DELAY_MS,
  useSidebarPeekController,
  type SidebarPeekController,
} from "./Sidebar.autoHide";

// ── Controller (real timers) ───────────────────────────────────────────
//
// The reducer is exercised directly in Sidebar.autoHide.test.ts; this exercises the timer-driven
// hook itself, which is what actually has to retract the panel with no
// further pointer input — the part a pure-reducer test can't see, and where
// the self-rescheduling-timer regression lived.

let root: Root;
let container: HTMLDivElement;
let controller: SidebarPeekController;

function Probe({ enabled }: { enabled: boolean }) {
  const value = useSidebarPeekController(enabled);
  useLayoutEffect(() => {
    controller = value;
  });
  return null;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Probe enabled />);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
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
