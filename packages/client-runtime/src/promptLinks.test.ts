import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type PullRequestLinkedThreadsResult,
  type RepositoryIdentity,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  findPromptLinkProjects,
  findPromptLinkPullRequestThread,
  pickPromptLinkPullRequestThread,
  pickPromptLinkSearchMatch,
  resolvePromptLinkExistingThread,
  resolvePromptLinkModelSelection,
} from "./promptLinks.ts";

const identity = (canonicalKey: string, origin?: string): RepositoryIdentity => ({
  canonicalKey,
  locator: { source: "git-remote", remoteName: "origin", remoteUrl: `https://${canonicalKey}` },
  ...(origin ? { origin: { canonicalKey: origin } } : {}),
});

describe("findPromptLinkProjects", () => {
  it("keeps exact matches in order and never a fork of the repository", () => {
    const projects = [
      {
        id: "fork",
        repositoryIdentity: identity("github.com/pingdotgg/t3code", "github.com/me/t3code"),
      },
      { id: "none", repositoryIdentity: null },
      { id: "recent", repositoryIdentity: identity("github.com/PingDotGG/T3Code") },
      { id: "older", repositoryIdentity: identity("github.com/pingdotgg/t3code") },
    ];
    const ids = (owner: string, name: string) =>
      findPromptLinkProjects(projects, { owner, name }).map((project) => project.id);
    expect(ids("pingdotgg", "t3code")).toEqual(["recent", "older"]);
    expect(ids("me", "t3code")).toEqual(["fork"]);
    expect(ids("gitlab", "x")).toEqual([]);
  });

  it("matches a checkout of the repository's GitCafe mirror", () => {
    const projects = [
      { id: "gitcafe", repositoryIdentity: identity("git.cafe/pingdotgg/t3code") },
      { id: "staging", repositoryIdentity: identity("staging.git.cafe/pingdotgg/t3code") },
      { id: "gitlab", repositoryIdentity: identity("gitlab.com/pingdotgg/t3code") },
    ];
    expect(
      findPromptLinkProjects(projects, { owner: "pingdotgg", name: "t3code" }).map(
        (project) => project.id,
      ),
    ).toEqual(["gitcafe", "staging"]);
  });
});

describe("enterprise hosts", () => {
  it("match only their own host's repository and links", () => {
    const projects = [
      { id: "github", repositoryIdentity: identity("github.com/acme/web") },
      { id: "mirror", repositoryIdentity: identity("git.cafe/acme/web") },
      { id: "prodgit", repositoryIdentity: identity("prodgit.apple.com/acme/web") },
    ];
    const ids = (host?: string) =>
      findPromptLinkProjects(projects, {
        ...(host === undefined ? {} : { host }),
        owner: "acme",
        name: "web",
      }).map((project) => project.id);
    expect(ids()).toEqual(["github", "mirror"]);
    expect(ids("prodgit.apple.com")).toEqual(["prodgit"]);
    expect(ids("github.pie.apple.com")).toEqual([]);
  });

  it("finds a thread linked on the same host only", () => {
    const link = (host: string): ThreadPullRequestLink => ({
      host,
      repository: "acme/web",
      number: 7,
      url: `https://${host}/acme/web/pull/7`,
      source: "manual",
      linkedAt: "2026-01-01T00:00:00.000Z",
      snapshot: null,
      stack: null,
    });
    const threads = [
      { id: "github", updatedAt: "2026-01-02T00:00:00.000Z", pullRequests: [link("github.com")] },
      {
        id: "prodgit",
        updatedAt: "2026-01-01T00:00:00.000Z",
        pullRequests: [link("prodgit.apple.com")],
      },
    ];
    const find = (host?: string) =>
      findPromptLinkPullRequestThread(threads, {
        ...(host === undefined ? {} : { host }),
        owner: "acme",
        name: "web",
        number: 7,
      })?.id;
    expect(find()).toBe("github");
    expect(find("prodgit.apple.com")).toBe("prodgit");
  });
});

describe("resolvePromptLinkExistingThread", () => {
  const search = (best?: string, pending = false) => ({ pending, best });
  it("prefers linked threads, then the best search match, and waits for answers", () => {
    expect(
      resolvePromptLinkExistingThread({ local: "a", linked: undefined, search: search() }),
    ).toBe("a");
    expect(
      resolvePromptLinkExistingThread({ local: undefined, linked: "b", search: search("s") }),
    ).toBe("b");
    expect(
      resolvePromptLinkExistingThread({ local: undefined, linked: undefined, search: search("s") }),
    ).toBeUndefined();
    expect(
      resolvePromptLinkExistingThread({
        local: undefined,
        linked: null,
        search: search("s", true),
      }),
    ).toBeUndefined();
    expect(
      resolvePromptLinkExistingThread({ local: undefined, linked: null, search: search("s") }),
    ).toBe("s");
    expect(
      resolvePromptLinkExistingThread({ local: undefined, linked: null, search: search() }),
    ).toBeNull();
  });

  it("takes only a search match that holds the URL as a whole word", () => {
    expect(
      pickPromptLinkSearchMatch([{ id: "pull-123", quality: 0.8 }, { id: "pull-12", quality: 1 }]),
    ).toEqual({ id: "pull-12", quality: 1 });
    expect(pickPromptLinkSearchMatch([{ id: "older-server" }, { id: "inside", quality: 0.3 }])).toBe(
      undefined,
    );
  });
});

describe("findPromptLinkPullRequestThread", () => {
  it("takes the newest linked thread, never a side chat that inherited the link", () => {
    const link: ThreadPullRequestLink = {
      host: "github.com",
      repository: "acme/web",
      number: 7,
      url: "https://github.com/acme/web/pull/7",
      source: "manual",
      linkedAt: "2026-01-01T00:00:00.000Z",
      snapshot: null,
      stack: null,
    };
    const thread = (id: string, updatedAt: string, sideChat?: boolean) => ({
      id,
      updatedAt,
      pullRequests: [link],
      ...(sideChat === undefined ? {} : { lineage: { sideChat } }),
    });
    const found = findPromptLinkPullRequestThread(
      [
        thread("old", "2026-01-01T00:00:00.000Z"),
        thread("parent", "2026-01-02T00:00:00.000Z", false),
        thread("side-chat", "2026-01-03T00:00:00.000Z", true),
      ],
      { owner: "acme", name: "web", number: 7 },
    );
    expect(found?.id).toBe("parent");
  });
});

describe("pickPromptLinkPullRequestThread", () => {
  it("takes the first open thread in order once every earlier lookup has answered", () => {
    const laptop = EnvironmentId.make("laptop");
    const server = EnvironmentId.make("server");
    const linked = (
      id: string,
      archivedAt: string | null = null,
    ): PullRequestLinkedThreadsResult => ({
      threads: [{ id: ThreadId.make(id), projectId: ProjectId.make("p"), title: id, archivedAt }],
    });
    const none: PullRequestLinkedThreadsResult = { threads: [] };
    const pick = (
      ...results: ReadonlyArray<AsyncResult.AsyncResult<PullRequestLinkedThreadsResult, unknown>>
    ) =>
      pickPromptLinkPullRequestThread(
        results.map((result, index) => ({ environmentId: index === 0 ? laptop : server, result })),
      );
    // A value shown while it refetches is not an answer yet.
    expect(pick(AsyncResult.success(none, { waiting: true }))).toBeUndefined();
    expect(pick(AsyncResult.success(none), AsyncResult.initial(true))).toBeUndefined();
    expect(pick(AsyncResult.initial(true), AsyncResult.success(linked("b")))).toBeUndefined();
    const laptopThread = { environmentId: laptop, id: ThreadId.make("a") };
    expect(pick(AsyncResult.success(linked("a")), AsyncResult.initial(true))).toEqual(laptopThread);
    expect(pick(AsyncResult.success(linked("a")), AsyncResult.success(linked("b")))).toEqual(
      laptopThread,
    );
    expect(pick(AsyncResult.success(none), AsyncResult.success(linked("old")))).toEqual({
      environmentId: server,
      id: ThreadId.make("old"),
    });
    expect(
      pick(
        AsyncResult.success(linked("archived", "2026-01-01T00:00:00.000Z")),
        AsyncResult.fail(1),
      ),
    ).toBeNull();
  });
});

describe("resolvePromptLinkModelSelection", () => {
  const provider = (
    instanceId: string,
    driver: string,
    status: "ready" | "warning" | "error" | "disabled" = "ready",
  ) => ({
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    status,
    models: [
      { slug: "small", name: "Small" },
      { slug: "big", name: "Big", aliases: ["opus"], isDefault: true },
    ],
  });

  it("maps the requested provider and model onto a usable instance", () => {
    const providers = [provider("broken", "claudeAgent", "error"), provider("work", "claudeAgent")];
    expect(
      resolvePromptLinkModelSelection(providers, { provider: "claude", model: "small" }),
    ).toEqual({
      selection: { instanceId: "work", model: "small" },
      exact: true,
    });
    expect(
      resolvePromptLinkModelSelection(providers, { provider: "claudeagent", model: "opus" }),
    ).toEqual({
      selection: { instanceId: "work", model: "big" },
      exact: true,
    });
  });

  it("uses the instance default for an unknown model, and nothing for a missing provider", () => {
    const providers = [provider("codex", "codex")];
    expect(
      resolvePromptLinkModelSelection(providers, { provider: "codex", model: "nope" }),
    ).toEqual({
      selection: { instanceId: "codex", model: "big" },
      exact: false,
    });
    expect(
      resolvePromptLinkModelSelection(providers, { provider: "cursor", model: null }),
    ).toBeNull();
  });
});
