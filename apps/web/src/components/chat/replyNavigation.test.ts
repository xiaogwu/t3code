import { MessageId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { replyTargetElementId } from "./replyNavigation";

describe("reply navigation", () => {
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
});
