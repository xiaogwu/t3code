import { describe, expect, it } from "vite-plus/test";
import { ProviderInstanceId, type ThreadId, type TurnId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import {
  coalesceThreadActivitySoundCues,
  reconcileThreadActivitySoundObservations,
  shouldPlayThreadActivitySound,
} from "./ThreadActivitySoundCoordinator.logic";

const NOW = "2026-08-07T20:00:00.000Z";

function thread(overrides: Record<string, unknown> = {}): EnvironmentThreadShell {
  return {
    environmentId: "env-1",
    id: "thread-1" as ThreadId,
    projectId: "project-1",
    title: "Audio alerts",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    titleRegeneration: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  } as EnvironmentThreadShell;
}

describe("thread activity sounds", () => {
  it("seeds initial state silently and sounds when a thread completes", () => {
    const initial = reconcileThreadActivitySoundObservations({
      previous: new Map(),
      threads: [thread({ session: { status: "running" } })],
      emit: false,
    });
    expect(initial.cues).toEqual([]);

    const completed = reconcileThreadActivitySoundObservations({
      previous: initial.next,
      threads: [
        thread({
          latestTurn: {
            turnId: "turn-1" as TurnId,
            state: "completed",
            requestedAt: NOW,
            startedAt: NOW,
            completedAt: NOW,
            assistantMessageId: null,
          },
        }),
      ],
      emit: true,
    });
    expect(completed.cues).toEqual(["completed"]);
  });

  it("does not replay a waiting state but signals a new terminal turn", () => {
    const waiting = reconcileThreadActivitySoundObservations({
      previous: new Map(),
      threads: [thread({ hasPendingApprovals: true })],
      emit: false,
    });
    const unchanged = reconcileThreadActivitySoundObservations({
      previous: waiting.next,
      threads: [thread({ hasPendingApprovals: true, updatedAt: "2026-08-07T20:01:00.000Z" })],
      emit: true,
    });
    expect(unchanged.cues).toEqual([]);

    const firstCompletion = reconcileThreadActivitySoundObservations({
      previous: unchanged.next,
      threads: [
        thread({
          latestTurn: {
            turnId: "turn-1" as TurnId,
            state: "completed",
            requestedAt: NOW,
            startedAt: NOW,
            completedAt: NOW,
            assistantMessageId: null,
          },
        }),
      ],
      emit: true,
    });
    const secondCompletion = reconcileThreadActivitySoundObservations({
      previous: firstCompletion.next,
      threads: [
        thread({
          latestTurn: {
            turnId: "turn-2" as TurnId,
            state: "completed",
            requestedAt: NOW,
            startedAt: NOW,
            completedAt: NOW,
            assistantMessageId: null,
          },
        }),
      ],
      emit: true,
    });
    expect(secondCompletion.cues).toEqual(["completed"]);
  });

  it("coalesces simultaneous signals by urgency", () => {
    expect(coalesceThreadActivitySoundCues(["completed", "attention", "failed"])).toBe("failed");
  });

  it("respects the configured visibility mode", () => {
    expect(
      shouldPlayThreadActivitySound({
        mode: "unfocused",
        visibilityState: "visible",
        hasFocus: true,
      }),
    ).toBe(false);
    expect(
      shouldPlayThreadActivitySound({
        mode: "unfocused",
        visibilityState: "hidden",
        hasFocus: false,
      }),
    ).toBe(true);
    expect(
      shouldPlayThreadActivitySound({ mode: "always", visibilityState: "visible", hasFocus: true }),
    ).toBe(true);
  });
});
