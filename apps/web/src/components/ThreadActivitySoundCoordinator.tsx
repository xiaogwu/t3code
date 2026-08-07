import { useEffect, useRef } from "react";

import { threadActivitySoundPlayer } from "../audio/threadActivitySounds";
import { useClientSettings, useClientSettingsHydrated } from "../hooks/useSettings";
import { useAllEnvironmentShellsBootstrapped, useThreadShells } from "../state/entities";
import {
  coalesceThreadActivitySoundCues,
  reconcileThreadActivitySoundObservations,
  shouldPlayThreadActivitySound,
  type ThreadActivitySoundObservation,
} from "./ThreadActivitySoundCoordinator.logic";

/** Watches every connected environment's shell stream and plays local cues. */
export function ThreadActivitySoundCoordinator() {
  const threads = useThreadShells();
  const shellsBootstrapped = useAllEnvironmentShellsBootstrapped();
  const hydrated = useClientSettingsHydrated();
  const mode = useClientSettings((settings) => settings.threadActivitySoundMode);
  const observationsRef = useRef(new Map<string, ThreadActivitySoundObservation>());
  const initializedRef = useRef(false);
  const queuedCueRef = useRef<ReturnType<typeof coalesceThreadActivitySoundCues>>(null);
  const flushQueuedCueRef = useRef(false);

  useEffect(() => {
    const { next, cues } = reconcileThreadActivitySoundObservations({
      previous: observationsRef.current,
      threads,
      // The initial and pre-hydration snapshots establish a baseline only.
      emit: initializedRef.current && shellsBootstrapped && hydrated && mode !== "off",
    });
    observationsRef.current = next;
    initializedRef.current = true;

    if (
      !hydrated ||
      !shouldPlayThreadActivitySound({
        mode,
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
      })
    ) {
      return;
    }
    const cue = coalesceThreadActivitySoundCues(cues);
    if (cue === null) return;
    const queuedCue = queuedCueRef.current;
    queuedCueRef.current = coalesceThreadActivitySoundCues(
      queuedCue === null ? [cue] : [queuedCue, cue],
    );
    if (flushQueuedCueRef.current) return;
    flushQueuedCueRef.current = true;
    queueMicrotask(() => {
      flushQueuedCueRef.current = false;
      const nextCue = queuedCueRef.current;
      queuedCueRef.current = null;
      if (nextCue !== null) threadActivitySoundPlayer.play(nextCue);
    });
  }, [hydrated, mode, shellsBootstrapped, threads]);

  useEffect(() => {
    if (!hydrated || mode === "off") return;
    const prime = () => threadActivitySoundPlayer.prime();
    window.addEventListener("pointerdown", prime, { capture: true, once: true });
    window.addEventListener("keydown", prime, { capture: true, once: true });
    return () => {
      window.removeEventListener("pointerdown", prime, { capture: true });
      window.removeEventListener("keydown", prime, { capture: true });
    };
  }, [hydrated, mode]);

  return null;
}
