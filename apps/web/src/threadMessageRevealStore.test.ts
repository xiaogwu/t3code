import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useThreadMessageRevealStore } from "./threadMessageRevealStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const messageA = MessageId.make("message-A");

beforeEach(() => {
  useThreadMessageRevealStore.setState({ request: null });
});

describe("threadMessageRevealStore", () => {
  it("increments requestId across consecutive requests for the same thread and message", () => {
    useThreadMessageRevealStore.getState().requestReveal(refA, messageA);
    const first = useThreadMessageRevealStore.getState().request?.requestId;
    useThreadMessageRevealStore.getState().requestReveal(refA, messageA);
    const second = useThreadMessageRevealStore.getState().request?.requestId;

    expect(first).toBe(1);
    expect(second).toBe(2);
  });

  it("does not clear a newer request with a stale requestId", () => {
    useThreadMessageRevealStore.getState().requestReveal(refA, messageA);
    const staleId = useThreadMessageRevealStore.getState().request?.requestId;
    useThreadMessageRevealStore.getState().requestReveal(refA, messageA);

    useThreadMessageRevealStore.getState().clearReveal(staleId!);

    expect(useThreadMessageRevealStore.getState().request).not.toBeNull();
  });

  it("clears the request when the requestId matches", () => {
    useThreadMessageRevealStore.getState().requestReveal(refA, messageA);
    const requestId = useThreadMessageRevealStore.getState().request?.requestId;

    useThreadMessageRevealStore.getState().clearReveal(requestId!);

    expect(useThreadMessageRevealStore.getState().request).toBeNull();
  });
});
