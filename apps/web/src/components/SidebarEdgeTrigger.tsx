import { useSidebar } from "./ui/sidebar";

/**
 * Dia's "thin strip at the leading edge" — the only affordance for revealing
 * an auto-hidden, unpinned sidebar. Hidden on touch/coarse pointers, which
 * keep the toggle button as their way in; hover-intent has no equivalent
 * there.
 *
 * Self-gated: renders nothing unless auto-hide is on and the sidebar is
 * unpinned, so `AppSidebarLayout` can mount it unconditionally alongside the
 * sidebar itself.
 */
export function SidebarEdgeTrigger() {
  const { autoHide, open, peekEdgeHandlers } = useSidebar();
  if (!autoHide || open) return null;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-y-0 left-0 z-20 hidden w-2 [@media(hover:hover)_and_(pointer:fine)]:block"
      data-slot="sidebar-edge-trigger"
      onDragEnter={peekEdgeHandlers.onDragEnter}
      onPointerEnter={peekEdgeHandlers.onPointerEnter}
      onPointerLeave={peekEdgeHandlers.onPointerLeave}
      onPointerMove={peekEdgeHandlers.onPointerMove}
    />
  );
}
