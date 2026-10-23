import { assert, describe, it, vi } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { expandTitleTemplate } from "../textGeneration/TitlePolicy.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as ThreadTitleRegeneration from "./ThreadTitleRegenerationService.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

const projectId = ProjectId.make("project:title-regeneration");
const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.1-codex",
} as const;

const adapter = {
  instanceId: modelSelection.instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("provider execution is disabled in title regeneration tests"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

function makeHarness(
  options: {
    readonly generateTitle?: TextGeneration.TextGeneration["Service"]["generateThreadTitle"];
    readonly settings?: Parameters<typeof ServerSettings.layerTest>[0];
  } = {},
) {
  const layerDatabase = SqlitePersistence.layerMemory;
  const layerRegistry = ProviderAdapterRegistry.layerFromAdapters([adapter]);
  const layerOrchestrator = ProviderReplayHarness.layerWithRegistry(
    { name: "thread-title-regeneration" },
    layerRegistry,
    { databaseLayer: layerDatabase, runEffectWorker: false },
  );
  const layerServerSettings = ServerSettings.layerTest(options.settings ?? {});
  const layerThreadManagement = ThreadManagement.layer.pipe(
    Layer.provide(layerOrchestrator),
    Layer.provide(layerServerSettings),
    Layer.provide(CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase))),
  );
  const layerOutbox = EffectOutbox.layer.pipe(Layer.provide(layerDatabase));
  const generateThreadTitle = vi.fn(
    options.generateTitle ?? (() => Effect.succeed({ title: "Generated title" })),
  );
  const layerProjectedProjects = Layer.mock(ProjectStore.ProjectStoreV2)({
    get: (requestedProjectId) =>
      Effect.succeed(
        requestedProjectId === projectId
          ? Option.some({
              projectId,
              title: "Project",
              workspaceRoot: "/repo",
              defaultModelSelection: modelSelection,
              defaultThreadEnvMode: null,
              autoPull: false,
              faviconPath: null,
              projectIcon: null,
              scripts: [],
              createdAt: "2026-06-20T00:00:00.000Z",
              updatedAt: "2026-06-20T00:00:00.000Z",
              deletedAt: null,
            })
          : Option.none(),
      ),
  });
  const layerTitleRegeneration = ThreadTitleRegeneration.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        layerThreadManagement,
        layerProjectedProjects,
        Layer.mock(TextGeneration.TextGeneration)({ generateThreadTitle }),
        layerServerSettings,
      ),
    ),
  );
  return {
    layer: Layer.mergeAll(
      layerThreadManagement,
      layerTitleRegeneration,
      layerOutbox,
      layerDatabase,
    ),
    generateThreadTitle,
  };
}

function createThread(input: { readonly command: string; readonly thread: string }) {
  return Effect.gen(function* () {
    const threads = yield* ThreadManagement.ThreadManagementService;
    const threadId = ThreadId.make(input.thread);
    yield* threads.dispatch({
      type: "thread.create",
      commandId: CommandId.make(input.command),
      threadId,
      projectId,
      title: "Seed title",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
    });
    return threadId;
  });
}

function dispatchUserMessage(input: {
  readonly command: string;
  readonly threadId: ThreadId;
  readonly text: string;
}) {
  return Effect.gen(function* () {
    const threads = yield* ThreadManagement.ThreadManagementService;
    yield* threads.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(input.command),
      threadId: input.threadId,
      messageId: MessageId.make(`${input.command}:message`),
      text: input.text,
      attachments: [],
      modelSelection,
      dispatchMode: { type: "defer_start" },
      createdBy: "user",
      creationSource: "web",
    });
  });
}

function armRegeneration(input: { readonly command: string; readonly threadId: ThreadId }) {
  return Effect.gen(function* () {
    const threads = yield* ThreadManagement.ThreadManagementService;
    const requestId = CommandId.make(input.command);
    yield* threads.dispatch({
      type: "thread.metadata.update",
      commandId: requestId,
      threadId: input.threadId,
      regenerateTitle: true,
    });
    return requestId;
  });
}

describe("formatThreadTitleContext", () => {
  it("pins the first user message ahead of the retained tail once content stops fitting", () => {
    const context = ThreadTitleRegeneration.formatThreadTitleContext([
      { role: "user", text: `Ancient context that anchors the topic ${"x".repeat(600)}` },
      { role: "assistant", text: "y".repeat(6_000) },
      { role: "user", text: "z".repeat(1_500) },
    ]);
    assert.isTrue(context.message.includes("USER:\nAncient context that anchors the topic"));
    assert.isTrue(context.message.includes("[Earlier content truncated]\n\n"));
    assert.isTrue(context.message.includes("y".repeat(100)));
  });
});

describe("ThreadTitleRegenerationService", () => {
  it.effect("arms and clears the regeneration marker through metadata commands", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      yield* Effect.gen(function* () {
        const threads = yield* ThreadManagement.ThreadManagementService;
        const outbox = yield* EffectOutbox.EffectOutboxV2;
        const threadId = yield* createThread({
          command: "command:title:arm:create",
          thread: "thread:title:arm",
        });

        const firstRequest = yield* armRegeneration({ command: "command:title:arm:1", threadId });
        const armed = yield* threads.getThreadProjection(threadId);
        assert.equal(armed.thread.titleRegeneration?.requestId, firstRequest);
        assert.deepEqual(
          (yield* outbox.listByCommandId(firstRequest)).map((effect) => effect.request),
          [{ type: "thread-title.generate", kind: { type: "regenerate" } }],
        );

        yield* threads.dispatch({
          type: "thread.metadata.update",
          commandId: CommandId.make("command:title:arm:abandon"),
          threadId,
          regenerateTitle: false,
        });
        const abandoned = yield* threads.getThreadProjection(threadId);
        assert.isNotOk(abandoned.thread.titleRegeneration);

        yield* armRegeneration({ command: "command:title:arm:2", threadId });
        yield* threads.dispatch({
          type: "thread.metadata.update",
          commandId: CommandId.make("command:title:arm:rename"),
          threadId,
          title: "Manual title",
        });
        const renamed = yield* threads.getThreadProjection(threadId);
        assert.equal(renamed.thread.title, "Manual title");
        assert.isNotOk(renamed.thread.titleRegeneration);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("skips execution when the marker was superseded by a newer request", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      yield* Effect.gen(function* () {
        const threads = yield* ThreadManagement.ThreadManagementService;
        const titleRegeneration = yield* ThreadTitleRegeneration.ThreadTitleRegenerationService;
        const threadId = yield* createThread({
          command: "command:title:stale:create",
          thread: "thread:title:stale",
        });
        const staleRequest = yield* armRegeneration({ command: "command:title:stale:1", threadId });
        const currentRequest = yield* armRegeneration({
          command: "command:title:stale:2",
          threadId,
        });

        yield* titleRegeneration.execute({
          threadId,
          requestId: staleRequest,
          kind: { type: "regenerate" },
        });

        assert.equal(harness.generateThreadTitle.mock.calls.length, 0);
        const projection = yield* threads.getThreadProjection(threadId);
        assert.equal(projection.thread.title, "Seed title");
        assert.equal(projection.thread.titleRegeneration?.requestId, currentRequest);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("lands the regenerated title from the conversation digest", () =>
    Effect.gen(function* () {
      const harness = makeHarness({
        generateTitle: () => Effect.succeed({ title: "Fresh title" }),
      });
      yield* Effect.gen(function* () {
        const threads = yield* ThreadManagement.ThreadManagementService;
        const titleRegeneration = yield* ThreadTitleRegeneration.ThreadTitleRegenerationService;
        const threadId = yield* createThread({
          command: "command:title:landing:create",
          thread: "thread:title:landing",
        });
        yield* dispatchUserMessage({
          command: "command:title:landing:message",
          threadId,
          text: "Investigate the flaky login test",
        });
        const requestId = yield* armRegeneration({ command: "command:title:landing:1", threadId });

        yield* titleRegeneration.execute({ threadId, requestId, kind: { type: "regenerate" } });

        const call = harness.generateThreadTitle.mock.calls[0]?.[0];
        assert.equal(call?.previousTitle, "Seed title");
        assert.equal(call?.cwd, "/repo");
        assert.include(call?.message, "USER:\nInvestigate the flaky login test");
        const projection = yield* threads.getThreadProjection(threadId);
        assert.equal(projection.thread.title, "Fresh title");
        assert.isNotOk(projection.thread.titleRegeneration);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("clears the marker and keeps the title when generation fails", () =>
    Effect.gen(function* () {
      const harness = makeHarness({
        generateTitle: () => Effect.die(new Error("model unavailable")),
      });
      yield* Effect.gen(function* () {
        const threads = yield* ThreadManagement.ThreadManagementService;
        const titleRegeneration = yield* ThreadTitleRegeneration.ThreadTitleRegenerationService;
        const threadId = yield* createThread({
          command: "command:title:failure:create",
          thread: "thread:title:failure",
        });
        yield* dispatchUserMessage({
          command: "command:title:failure:message",
          threadId,
          text: "Some conversation",
        });
        const requestId = yield* armRegeneration({ command: "command:title:failure:1", threadId });

        yield* titleRegeneration.execute({ threadId, requestId, kind: { type: "regenerate" } });

        assert.equal(harness.generateThreadTitle.mock.calls.length, 1);
        const projection = yield* threads.getThreadProjection(threadId);
        assert.equal(projection.thread.title, "Seed title");
        assert.isNotOk(projection.thread.titleRegeneration);
      }).pipe(Effect.provide(harness.layer));
    }),
  );
});

describe("title policy", () => {
  const PR_URL = "https://github.com/acme/app/pull/4821";

  const titleState = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const threads = yield* ThreadManagement.ThreadManagementService;
      const { thread } = yield* threads.getThreadProjection(threadId);
      return { title: thread.title, provenance: thread.titleProvenance };
    });

  it.effect("puts a matched rule's prefix in front of the generated title", () =>
    Effect.gen(function* () {
      // The model repeating the prefix must not double it.
      const harness = makeHarness({
        generateTitle: () => Effect.succeed({ title: "PR#4821: Prevent sidebar scroll resets" }),
      });
      yield* Effect.gen(function* () {
        const service = yield* ThreadTitleRegeneration.ThreadTitleRegenerationService;
        const threadId = yield* createThread({ command: "pr:create", thread: "thread:pr" });
        yield* dispatchUserMessage({
          command: "pr:message",
          threadId,
          text: `Please review ${PR_URL} for sidebar regressions`,
        });
        const requestId = yield* armRegeneration({ command: "pr:title", threadId });

        yield* service.execute({
          threadId,
          requestId,
          kind: { type: "initial", messageId: MessageId.make("pr:message:message") },
        });

        const instructions = harness.generateThreadTitle.mock.calls[0]?.[0]?.instructions;
        assert.include(instructions, '"PR#4821:"');
        assert.deepEqual(yield* titleState(threadId), {
          title: "PR#4821: Prevent sidebar scroll resets",
          provenance: "automatic",
        });
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("titles a templated command from the thread's creation time, with no model", () =>
    Effect.gen(function* () {
      const harness = makeHarness({
        settings: {
          titlePolicy: {
            rules: [
              {
                name: "Oliver",
                when: { initialCommand: "/oliver" },
                prefix: "Oliver",
                placement: "start",
                priority: 200,
                titleTemplate: "Oliver {today:MM/DD/YYYY} {now:HH:mm}",
              },
            ],
          },
        },
      });
      yield* Effect.gen(function* () {
        const threads = yield* ThreadManagement.ThreadManagementService;
        const service = yield* ThreadTitleRegeneration.ThreadTitleRegenerationService;
        const threadId = yield* createThread({ command: "oliver:create", thread: "thread:oliver" });
        yield* dispatchUserMessage({ command: "oliver:message", threadId, text: "/oliver today" });
        const requestId = yield* armRegeneration({ command: "oliver:title", threadId });
        // Generated later in the day, the title still reads the thread's start.
        yield* TestClock.adjust("3 hours");

        yield* service.execute({
          threadId,
          requestId,
          kind: { type: "initial", messageId: MessageId.make("oliver:message:message") },
        });

        const { thread } = yield* threads.getThreadProjection(threadId);
        assert.equal(
          thread.title,
          expandTitleTemplate(
            "Oliver {today:MM/DD/YYYY} {now:HH:mm}",
            DateTime.toEpochMillis(thread.createdAt),
          ),
        );
        assert.equal(harness.generateThreadTitle.mock.calls.length, 0);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("marks renames manual and hands a regenerated title back to the policy", () =>
    Effect.gen(function* () {
      const harness = makeHarness({ generateTitle: () => Effect.succeed({ title: "Fresh" }) });
      yield* Effect.gen(function* () {
        const threads = yield* ThreadManagement.ThreadManagementService;
        const service = yield* ThreadTitleRegeneration.ThreadTitleRegenerationService;
        const threadId = yield* createThread({ command: "who:create", thread: "thread:who" });
        yield* dispatchUserMessage({ command: "who:message", threadId, text: "Fix login" });
        yield* threads.dispatch({
          type: "thread.metadata.update",
          commandId: CommandId.make("who:rename"),
          threadId,
          title: "My name",
        });
        assert.deepEqual(yield* titleState(threadId), { title: "My name", provenance: "manual" });

        const requestId = yield* armRegeneration({ command: "who:regenerate", threadId });
        yield* service.execute({ threadId, requestId, kind: { type: "regenerate" } });
        assert.deepEqual(yield* titleState(threadId), { title: "Fresh", provenance: "automatic" });
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("refreshes every Nth run, at once for a missing prefix, and never over a rename", () =>
    Effect.gen(function* () {
      let next = "Login test flake";
      const harness = makeHarness({ generateTitle: () => Effect.succeed({ title: next }) });
      yield* Effect.gen(function* () {
        const threads = yield* ThreadManagement.ThreadManagementService;
        const service = yield* ThreadTitleRegeneration.ThreadTitleRegenerationService;
        const threadId = yield* createThread({ command: "cadence:create", thread: "thread:cad" });
        yield* dispatchUserMessage({ command: "cadence:m1", threadId, text: "Fix the login test" });
        const afterRun = (runOrdinal: number) =>
          service.execute({
            threadId,
            requestId: CommandId.make(`cadence:policy:${runOrdinal}`),
            kind: { type: "policy", runOrdinal },
          });

        yield* afterRun(3);
        assert.equal(harness.generateThreadTitle.mock.calls.length, 0);
        assert.equal((yield* titleState(threadId)).title, "Seed title");

        yield* afterRun(4);
        assert.equal(harness.generateThreadTitle.mock.calls[0]?.[0]?.previousTitle, "Seed title");
        assert.deepEqual(yield* titleState(threadId), {
          title: "Login test flake",
          provenance: "automatic",
        });

        // A PR link showing up mid-thread re-titles on the next run, not the 8th.
        next = "Fix login test";
        yield* dispatchUserMessage({ command: "cadence:m2", threadId, text: `Now ${PR_URL}` });
        yield* afterRun(5);
        assert.equal((yield* titleState(threadId)).title, "PR#4821: Fix login test");
        yield* afterRun(6);
        assert.equal(harness.generateThreadTitle.mock.calls.length, 2);

        yield* threads.dispatch({
          type: "thread.metadata.update",
          commandId: CommandId.make("cadence:rename"),
          threadId,
          title: "Mine",
        });
        yield* afterRun(8);
        assert.equal(harness.generateThreadTitle.mock.calls.length, 2);
        assert.deepEqual(yield* titleState(threadId), { title: "Mine", provenance: "manual" });
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("drops a policy title once the title it replaced has changed", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      yield* Effect.gen(function* () {
        const threads = yield* ThreadManagement.ThreadManagementService;
        const threadId = yield* createThread({ command: "race:create", thread: "thread:race" });
        const apply = (id: string, expectedTitle: string, preserveManualTitle: boolean) =>
          threads.dispatch({
            type: "thread.title.policy.apply",
            commandId: CommandId.make(id),
            threadId,
            expectedTitle,
            title: "Policy title",
            preserveManualTitle,
          });

        yield* apply("race:stale", "Some older title", false);
        assert.equal((yield* titleState(threadId)).title, "Seed title");

        yield* threads.dispatch({
          type: "thread.metadata.update",
          commandId: CommandId.make("race:rename"),
          threadId,
          title: "Seed title",
        });
        yield* apply("race:manual", "Seed title", true);
        assert.deepEqual(yield* titleState(threadId), {
          title: "Seed title",
          provenance: "manual",
        });
        // With manual titles unprotected, the policy may take it back.
        yield* apply("race:unprotected", "Seed title", false);
        assert.deepEqual(yield* titleState(threadId), {
          title: "Policy title",
          provenance: "automatic",
        });
      }).pipe(Effect.provide(harness.layer));
    }),
  );
});
