import { resolveThreadAwarenessPhase } from "@t3tools/shared/agentAwareness";
import type { ThreadActivitySoundMode } from "@t3tools/contracts/settings";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { threadKey } from "@t3tools/client-runtime/state/entities";

import type { ThreadActivitySoundCue } from "../audio/threadActivitySounds";

export interface ThreadActivitySoundObservation {
  readonly phase: "waiting_for_approval" | "waiting_for_input" | "completed" | "failed" | null;
  readonly identity: string | null;
}

function isNotifiablePhase(
  phase: ReturnType<typeof resolveThreadAwarenessPhase>,
): phase is NonNullable<ThreadActivitySoundObservation["phase"]> {
  return (
    phase === "waiting_for_approval" ||
    phase === "waiting_for_input" ||
    phase === "completed" ||
    phase === "failed"
  );
}

function observationForThread(thread: EnvironmentThreadShell): ThreadActivitySoundObservation {
  const phase = resolveThreadAwarenessPhase(thread);
  if (!isNotifiablePhase(phase)) {
    return { phase: null, identity: null };
  }
  const terminalIdentity =
    thread.latestTurn?.turnId ?? thread.session?.updatedAt ?? thread.updatedAt;
  return {
    phase,
    identity: phase === "completed" || phase === "failed" ? `${phase}:${terminalIdentity}` : phase,
  };
}

function cueForPhase(
  phase: NonNullable<ThreadActivitySoundObservation["phase"]>,
): ThreadActivitySoundCue {
  switch (phase) {
    case "waiting_for_approval":
    case "waiting_for_input":
      return "attention";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
  }
}

export function reconcileThreadActivitySoundObservations(input: {
  readonly previous: ReadonlyMap<string, ThreadActivitySoundObservation>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly emit: boolean;
}): {
  readonly next: Map<string, ThreadActivitySoundObservation>;
  readonly cues: ReadonlyArray<ThreadActivitySoundCue>;
} {
  const next = new Map<string, ThreadActivitySoundObservation>();
  const cues: ThreadActivitySoundCue[] = [];
  for (const thread of input.threads) {
    const key = threadKey({ environmentId: thread.environmentId, threadId: thread.id });
    const observation = observationForThread(thread);
    const previous = input.previous.get(key);
    next.set(key, observation);
    if (
      input.emit &&
      observation.phase !== null &&
      (previous === undefined || previous.identity !== observation.identity)
    ) {
      cues.push(cueForPhase(observation.phase));
    }
  }
  return { next, cues };
}

const CUE_PRIORITY: Readonly<Record<ThreadActivitySoundCue, number>> = {
  completed: 1,
  attention: 2,
  failed: 3,
};

export function coalesceThreadActivitySoundCues(
  cues: ReadonlyArray<ThreadActivitySoundCue>,
): ThreadActivitySoundCue | null {
  return cues.reduce<ThreadActivitySoundCue | null>(
    (highest, cue) =>
      highest === null || CUE_PRIORITY[cue] > CUE_PRIORITY[highest] ? cue : highest,
    null,
  );
}

export function shouldPlayThreadActivitySound(input: {
  readonly mode: ThreadActivitySoundMode;
  readonly visibilityState: DocumentVisibilityState;
  readonly hasFocus: boolean;
}): boolean {
  if (input.mode === "off") return false;
  if (input.mode === "always") return true;
  return input.visibilityState !== "visible" || !input.hasFocus;
}
