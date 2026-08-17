import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { MessageId, ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

interface ThreadMessageRevealRequest {
  readonly threadKey: string;
  readonly messageId: MessageId;
  readonly requestId: number;
}

interface ThreadMessageRevealStoreState {
  request: ThreadMessageRevealRequest | null;
  requestReveal: (ref: ScopedThreadRef, messageId: MessageId) => void;
  clearReveal: (requestId: number) => void;
}

// Not persisted: a reveal is a one-shot intent, not durable UI state.
export const useThreadMessageRevealStore = create<ThreadMessageRevealStoreState>()((set) => ({
  request: null,
  requestReveal: (ref, messageId) =>
    set((state) => ({
      request: {
        threadKey: scopedThreadKey(ref),
        messageId,
        requestId: (state.request?.requestId ?? 0) + 1,
      },
    })),
  clearReveal: (requestId) =>
    set((state) => (state.request?.requestId === requestId ? { request: null } : state)),
}));
