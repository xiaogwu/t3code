import type { OrchestrationMessageContext } from "@t3tools/contracts";
import { expandAssistantCitationsForProvider } from "@t3tools/shared/assistantCitations";
import { projectComposerContextForProvider } from "@t3tools/shared/composerContextReferences";

/**
 * The prompt a provider reads for a user message. Composer chips become the
 * context envelope, and assistant quotes (Cite, block replies) become readable
 * quote data; the persisted message keeps its clickable links. Every adapter
 * receives this same text, for turn starts and steers alike.
 */
export function providerMessageText(message: {
  readonly text: string;
  readonly context?: OrchestrationMessageContext | undefined;
}): string {
  return expandAssistantCitationsForProvider(
    projectComposerContextForProvider({
      text: message.text,
      records: message.context?.records ?? [],
    }),
  );
}
