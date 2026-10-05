export type ThreadScrollTarget = "top" | "end";

const THREAD_SCROLL_EVENT = "t3:thread-scroll-request";

/** Asks the mounted ChatView to scroll its timeline; used by surfaces that lack its list ref. */
export function requestThreadScroll(target: ThreadScrollTarget): void {
  window.dispatchEvent(
    new CustomEvent<ThreadScrollTarget>(THREAD_SCROLL_EVENT, { detail: target }),
  );
}

export function subscribeToThreadScrollRequests(
  scroll: (target: ThreadScrollTarget) => void,
): () => void {
  // Timeline tests mount under react-test-renderer, which has no window.
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => scroll((event as CustomEvent<ThreadScrollTarget>).detail);
  window.addEventListener(THREAD_SCROLL_EVENT, listener);
  return () => window.removeEventListener(THREAD_SCROLL_EVENT, listener);
}
