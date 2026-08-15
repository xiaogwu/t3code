import { MessageId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { replyTargetElementId, scrollToReplyTargetWhenAvailable } from "./replyNavigation";

describe("reply navigation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("targets an exact response block", () => {
    expect(
      replyTargetElementId(MessageId.make("assistant-1"), {
        messageId: MessageId.make("assistant-1"),
        blockId: "12-34",
        quote: "Specific paragraph",
      }),
    ).toBe("message-block-assistant-1-12-34");
  });

  it("targets the whole response when no block reference is present", () => {
    expect(replyTargetElementId(MessageId.make("assistant-1"))).toBe(
      "message-block-assistant-1-whole",
    );
  });

  it("retries until a virtualized reply target mounts", () => {
    const target = {
      scrollIntoView: vi.fn(),
      animate: vi.fn(),
    };
    const getElementById = vi
      .fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValue(target);
    vi.stubGlobal("document", { getElementById });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    scrollToReplyTargetWhenAvailable({ messageId: MessageId.make("assistant-1") });

    expect(getElementById).toHaveBeenCalledTimes(3);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(target.animate).toHaveBeenCalledOnce();
  });
});
