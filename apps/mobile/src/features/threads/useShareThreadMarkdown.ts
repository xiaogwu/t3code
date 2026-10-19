import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useCallback } from "react";
import { Alert, Share } from "react-native";

import { orchestrationEnvironment } from "../../state/orchestration";
import { useAtomCommand } from "../../state/use-atom-command";

/**
 * Shares the whole thread, as the server renders it, through the system share
 * sheet. There is no PDF on mobile.
 */
export function useShareThreadMarkdown() {
  const exportThread = useAtomCommand(orchestrationEnvironment.exportThread, {
    reportFailure: false,
  });

  return useCallback(
    async (target: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId }) => {
      const result = await exportThread({
        environmentId: target.environmentId,
        input: { threadId: target.threadId },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          Alert.alert(
            "Could not export thread",
            error instanceof Error ? error.message : "An error occurred.",
          );
        }
        return;
      }
      await Share.share({ title: result.value.title, message: result.value.markdown });
    },
    [exportThread],
  );
}
