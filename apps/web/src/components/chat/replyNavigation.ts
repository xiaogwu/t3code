import type { MessageId, MessageReplyReference } from "@t3tools/contracts";

export function replyTargetElementId(
  messageId: MessageId,
  replyTo?: MessageReplyReference | null,
): string {
  return `message-block-${messageId}-${replyTo?.blockId ?? "whole"}`;
}

export function scrollToReplyTarget(input: {
  messageId: MessageId;
  replyTo?: MessageReplyReference | null;
}): boolean {
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
