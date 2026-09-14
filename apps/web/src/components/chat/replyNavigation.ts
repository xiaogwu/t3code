import type { MessageId, MessageReplyReference } from "@t3tools/contracts";

const REPLY_NAVIGATION_EVENT = "t3:reply-target-navigation";

export interface ReplyNavigationTarget {
  messageId: MessageId;
  replyTo?: MessageReplyReference | null;
}

export function requestReplyTargetNavigation(target: ReplyNavigationTarget): boolean {
  return !window.dispatchEvent(
    new CustomEvent<ReplyNavigationTarget>(REPLY_NAVIGATION_EVENT, {
      detail: target,
      cancelable: true,
    }),
  );
}

export function subscribeToReplyTargetNavigation(
  navigate: (target: ReplyNavigationTarget) => boolean,
): () => void {
  // Timeline tests mount the component under react-test-renderer, which has no
  // DOM. Skip the subscription there rather than at each call site: without a
  // window nothing can dispatch the event, so there is nothing to hear.
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const navigationEvent = event as CustomEvent<ReplyNavigationTarget>;
    if (navigate(navigationEvent.detail)) navigationEvent.preventDefault();
  };
  window.addEventListener(REPLY_NAVIGATION_EVENT, listener);
  return () => window.removeEventListener(REPLY_NAVIGATION_EVENT, listener);
}

export function replyTargetElementId(
  messageId: MessageId,
  replyTo?: MessageReplyReference | null,
): string {
  return `message-block-${messageId}-${replyTo?.blockId ?? "whole"}`;
}

export function scrollToReplyTarget(input: ReplyNavigationTarget): boolean {
  const target = document.getElementById(replyTargetElementId(input.messageId, input.replyTo));
  if (!target) return false;

  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.animate(
    [
      { backgroundColor: "transparent" },
      { backgroundColor: "var(--accent)" },
      { backgroundColor: "transparent" },
    ],
    { duration: 1_400 },
  );
  return true;
}

export function scrollToReplyTargetWhenAvailable(
  input: ReplyNavigationTarget,
  remainingFrames = 12,
): void {
  if (scrollToReplyTarget(input) || remainingFrames <= 0) return;
  requestAnimationFrame(() => {
    scrollToReplyTargetWhenAvailable(input, remainingFrames - 1);
  });
}
