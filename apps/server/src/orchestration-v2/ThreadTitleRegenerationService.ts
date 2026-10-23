import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import {
  CommandId,
  type ChatAttachment,
  type MessageId,
  type ServerSettingsError,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { finishTitle, planTitle, titleInstructions } from "../textGeneration/TitlePolicy.ts";
import type { OrchestratorV2Error } from "./Orchestrator.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

import { formatThreadTitleContext } from "@t3tools/provider-core/server/threadTitleContext";
export { formatThreadTitleContext } from "@t3tools/provider-core/server/threadTitleContext";

export class ThreadTitleRegenerationService extends Context.Service<
  ThreadTitleRegenerationService,
  {
    /**
     * `initial` titles a thread from its first message and `regenerate` from
     * its history, each completing the in-flight marker `requestId` armed.
     * `policy` is the title policy's look after a completed run: it re-titles
     * every `refreshEveryTurns`th run, or as soon as a rule's prefix or
     * template no longer matches the title, and never arms a marker.
     */
    readonly execute: (input: {
      readonly threadId: ThreadId;
      readonly requestId: CommandId;
      readonly kind:
        | { readonly type: "initial"; readonly messageId: MessageId }
        | { readonly type: "regenerate" }
        | { readonly type: "policy"; readonly runOrdinal: number };
    }) => Effect.Effect<
      void,
      | OrchestratorV2Error
      | ProjectStore.ProjectStoreV2Error
      | ServerSettingsError
      | ThreadManagementService.ThreadManagementProviderInstanceDisabledError
    >;
  }
>()("t3/orchestration-v2/ThreadTitleRegenerationService") {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;

  type Outcome =
    | { readonly type: "stale" }
    | { readonly type: "complete"; readonly title?: string }
    | {
        readonly type: "policy";
        readonly expectedTitle: string;
        readonly title: string;
        readonly preserveManualTitle: boolean;
      };

  const execute: ThreadTitleRegenerationService["Service"]["execute"] = Effect.fn(
    "ThreadTitleRegenerationService.execute",
  )(function* (input) {
    const kind = input.kind;
    const outcome: Outcome = yield* Effect.gen(function* () {
      const projection = yield* threads.getThreadRecords(
        input.threadId,
        ["messages"],
        kind.type === "initial"
          ? { messageIds: [kind.messageId] }
          : { messageRoles: ["user", "assistant"] },
      );
      const thread = projection.thread;
      // The policy never races a requested title: that one lands on its own.
      if (
        kind.type === "policy"
          ? thread.titleRegeneration != null || thread.archivedAt !== null
          : thread.titleRegeneration?.requestId !== input.requestId
      ) {
        return { type: "stale" as const };
      }

      const project = yield* projects.get(thread.projectId);
      if (Option.isNone(project)) {
        return kind.type === "policy" ? { type: "stale" as const } : { type: "complete" as const };
      }

      const settings = resolveProjectSettings(
        yield* serverSettings.getSettings,
        thread.projectId,
      ).settings;
      const policy = settings.titlePolicy;
      if (
        kind.type === "policy" &&
        (!policy.enabled ||
          (policy.defaults.preserveManualTitles && thread.titleProvenance === "manual"))
      ) {
        return { type: "stale" as const };
      }

      let context: {
        readonly message: string;
        readonly attachments: ReadonlyArray<ChatAttachment>;
      };
      // What the policy's rules match against: always a USER:/ASSISTANT: transcript.
      let policyContext: string;
      if (kind.type === "initial") {
        const messageId = kind.messageId;
        const message = projection.messages.find(
          (candidate) => candidate.id === messageId && !candidate.streaming,
        );
        context =
          message === undefined
            ? { message: "", attachments: [] }
            : { message: message.text, attachments: message.attachments };
        policyContext = `USER:\n${context.message}`;
      } else {
        context = formatThreadTitleContext(
          projection.messages.filter((message) => !message.streaming),
        );
        policyContext = context.message;
      }
      if (context.message.length === 0 && context.attachments.length === 0) {
        return kind.type === "policy" ? { type: "stale" as const } : { type: "complete" as const };
      }

      const currentTitle = thread.title.trim();
      const plan = planTitle(policy, policyContext, DateTime.toEpochMillis(thread.createdAt));
      if (kind.type === "policy") {
        const due = kind.runOrdinal % policy.defaults.refreshEveryTurns === 0;
        const titleMissesRule =
          plan.type === "template"
            ? plan.title !== currentTitle
            : plan.prefix !== null && !currentTitle.startsWith(plan.prefix);
        if (!due && !titleMissesRule) return { type: "stale" as const };
      }

      let title: string;
      if (plan.type === "template") {
        title = plan.title;
      } else {
        const result = yield* textGeneration.generateThreadTitle({
          cwd: thread.worktreePath ?? project.value.workspaceRoot,
          message: context.message,
          attachments: context.attachments,
          ...(kind.type === "initial" ? {} : { previousTitle: thread.title }),
          instructions: titleInstructions(settings.threadTitleInstructions, plan.instructions),
          modelSelection: settings.textGenerationModelSelection,
          fallbackModelSelections: settings.textGenerationFallbackModelSelections,
        });
        const generated = result.title.trim();
        if (generated === "New thread") {
          return kind.type === "policy"
            ? { type: "stale" as const }
            : { type: "complete" as const };
        }
        title = finishTitle(plan, generated);
      }
      if (kind.type !== "initial" && title === currentTitle) {
        return kind.type === "policy" ? { type: "stale" as const } : { type: "complete" as const };
      }
      return kind.type === "policy"
        ? {
            type: "policy" as const,
            expectedTitle: thread.title,
            title,
            preserveManualTitle: policy.defaults.preserveManualTitles,
          }
        : { type: "complete" as const, title };
    }).pipe(
      Effect.retry({
        times: kind.type === "initial" ? 2 : 0,
        schedule: Schedule.exponential("2 seconds"),
      }),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning("Thread title generation failed", {
              threadId: input.threadId,
              requestId: input.requestId,
              cause,
            }).pipe(
              Effect.as(
                kind.type === "policy"
                  ? ({ type: "stale" } as const)
                  : ({ type: "complete" } as const),
              ),
            ),
      ),
    );

    switch (outcome.type) {
      case "stale":
        return;
      case "policy":
        yield* threads.dispatch({
          type: "thread.title.policy.apply",
          commandId: CommandId.make(`${input.requestId}:title-policy`),
          threadId: input.threadId,
          expectedTitle: outcome.expectedTitle,
          title: outcome.title,
          preserveManualTitle: outcome.preserveManualTitle,
        });
        return;
      case "complete":
        yield* threads.dispatch({
          type: "thread.title.regeneration.complete",
          commandId: CommandId.make(`${input.requestId}:title-complete`),
          threadId: input.threadId,
          requestId: input.requestId,
          ...(outcome.title === undefined ? {} : { title: outcome.title }),
        });
        return;
    }
  });

  return ThreadTitleRegenerationService.of({ execute });
});

export const layer = Layer.effect(ThreadTitleRegenerationService, make);
