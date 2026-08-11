export type ThreadActivitySoundCue = "attention" | "completed" | "failed";

export interface ThreadActivitySoundPlayer {
  prime(): void;
  play(cue: ThreadActivitySoundCue): void;
}

type Tone = readonly [frequency: number, delaySeconds: number, durationSeconds: number];

const CUES: Readonly<Record<ThreadActivitySoundCue, ReadonlyArray<Tone>>> = {
  attention: [
    [660, 0, 0.09],
    [880, 0.12, 0.12],
  ],
  completed: [
    [523.25, 0, 0.1],
    [659.25, 0.1, 0.16],
  ],
  failed: [
    [440, 0, 0.1],
    [330, 0.11, 0.16],
  ],
};

function audioContextConstructor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ??
    (window as Window & { readonly webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null
  );
}

/**
 * Tiny renderer-only sound player shared by web and Electron. Synthesizing the
 * cues avoids network loading, licensing, and desktop packaging of audio assets.
 */
export function createThreadActivitySoundPlayer(): ThreadActivitySoundPlayer {
  let context: AudioContext | null = null;

  const getContext = (): AudioContext | null => {
    if (context !== null) return context;
    const AudioContextConstructor = audioContextConstructor();
    if (AudioContextConstructor === null) return null;
    context = new AudioContextConstructor();
    return context;
  };

  const resume = (nextContext: AudioContext) =>
    nextContext.state === "running"
      ? Promise.resolve()
      : nextContext.resume().catch(() => undefined);

  const scheduleCue = (nextContext: AudioContext, cue: ThreadActivitySoundCue) => {
    if (nextContext.state !== "running") return;
    const now = nextContext.currentTime;
    for (const [frequency, delay, duration] of CUES[cue]) {
      const oscillator = nextContext.createOscillator();
      const gain = nextContext.createGain();
      const startsAt = now + delay;
      const endsAt = startsAt + duration;
      oscillator.type = cue === "failed" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(frequency, startsAt);
      gain.gain.setValueAtTime(0.0001, startsAt);
      gain.gain.exponentialRampToValueAtTime(0.09, startsAt + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, endsAt);
      oscillator.connect(gain);
      gain.connect(nextContext.destination);
      oscillator.start(startsAt);
      oscillator.stop(endsAt + 0.02);
    }
  };

  return {
    prime() {
      const nextContext = getContext();
      if (nextContext !== null) void resume(nextContext);
    },
    play(cue) {
      const nextContext = getContext();
      if (nextContext === null) return;
      void resume(nextContext).then(() => scheduleCue(nextContext, cue));
    },
  };
}

export const threadActivitySoundPlayer = createThreadActivitySoundPlayer();
