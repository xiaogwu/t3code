import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { threadSearchMatchKey } from "@t3tools/client-runtime/state/thread-search";
import type {
  EnvironmentId,
  OrchestrationThreadSearchScope,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { MessageSquareIcon } from "lucide-react";

import { useClientSettings } from "../hooks/useSettings";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../providerInstances";
import { useThreadShells } from "../state/entities";
import {
  useEnvironmentProviders,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "../state/environments";
import { useThreadSearch } from "../state/queries";
import { primaryServerProvidersAtom } from "../state/server";
import { buildThreadRouteParams } from "../threadRoutes";
import { useThreadMessageRevealStore } from "../threadMessageRevealStore";
import { useUiStateStore } from "../uiStateStore";
import { buildThreadActionItems, ITEM_ICON_CLASS } from "./CommandPalette.logic";
import { useEnvironmentLookups, useProjectLookups } from "./CommandPaletteLookups";
import { hasUnseenCompletion } from "./Sidebar.logic";
import { ThreadCommandSubtitle } from "./ThreadCommandSubtitle";
import {
  ThreadRowLeadingStatus,
  ThreadRowTrailingStatus,
  ThreadSearchPullRequestNumber,
} from "./ThreadStatusIndicators";

function useProviderEntryByEnvironmentAndInstanceId() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const providersByEnvironment = useEnvironmentProviders();
  return new Map<string, ProviderInstanceEntry>(
    environments.flatMap((environment) => {
      const serverConfig = environment.serverConfig;
      const derived = deriveProviderInstanceEntries(
        providersByEnvironment.get(environment.environmentId) ??
          (environment.environmentId === primaryEnvironmentId ? providers : []),
      );
      const entries = serverConfig
        ? applyProviderInstanceSettings(derived, serverConfig.settings, null)
        : derived;
      return entries.map(
        (entry) => [`${environment.environmentId}:${entry.instanceId}`, entry] as const,
      );
    }),
  );
}

function useThreadSearchWithContentMatches(query: string, scope: OrchestrationThreadSearchScope) {
  const { environments } = useEnvironments();
  const environmentIds: ReadonlyArray<EnvironmentId> = environments
    .filter((environment) => environment.connection.phase === "connected")
    .map((environment) => environment.environmentId);
  const threadSearch = useThreadSearch(environmentIds, query, scope);
  const contentMatchByKey = new Map(
    threadSearch.matches.flatMap((match) =>
      match.source === "user" || match.source === "assistant"
        ? [[threadSearchMatchKey(match), match] as const]
        : [],
    ),
  );
  return { environmentIds, threadSearch, contentMatchByKey };
}

/**
 * Every thread as a palette item, with message matches for a non-empty `threadSearchQuery`.
 * `scope: "archived"` searches archived threads instead; the caller builds those items
 * from the returned matches because archived shells are not in the client's shell list.
 */
export function useCommandPaletteThreadItems(input: {
  readonly activeThreadId: ThreadId | undefined;
  readonly threadSearchQuery: string;
  readonly scope: OrchestrationThreadSearchScope;
}) {
  const { activeThreadId, threadSearchQuery, scope } = input;
  const navigate = useNavigate();
  const threads = useThreadShells();
  const sidebarThreadSortOrder = useClientSettings((settings) => settings.sidebarThreadSortOrder);
  const { projectEnvironmentLocationById } = useEnvironmentLookups();
  const providerEntryByEnvironmentAndInstanceId = useProviderEntryByEnvironmentAndInstanceId();
  const { environmentIds, threadSearch, contentMatchByKey } = useThreadSearchWithContentMatches(
    threadSearchQuery,
    scope,
  );
  const { projectByKey, projectTitleById } = useProjectLookups();
  const threadLastVisitedAtById = useUiStateStore((store) => store.threadLastVisitedAtById);
  // Called after navigating to a thread: a content hit scrolls to the message it
  // matched. Requesting before navigation resolves would be cleared by the
  // thread switch.
  const requestContentMatchReveal = (ref: ScopedThreadRef) => {
    const messageId = contentMatchByKey.get(threadSearchMatchKey(ref))?.messageId;
    if (messageId !== undefined) {
      useThreadMessageRevealStore.getState().requestReveal(ref, messageId);
    }
  };

  const threadItems = buildThreadActionItems({
    threads,
    ...(activeThreadId ? { activeThreadId } : {}),
    projectTitleById,
    sortOrder: sidebarThreadSortOrder,
    icon: <MessageSquareIcon className={ITEM_ICON_CLASS} />,
    renderLeadingContent: (thread) => <ThreadRowLeadingStatus thread={thread} />,
    renderTrailingContent: (thread) => (
      <>
        <ThreadSearchPullRequestNumber
          thread={thread}
          query={threadSearchQuery}
          settled={thread.settledOverride === "settled"}
        />
        <ThreadRowTrailingStatus thread={thread} />
      </>
    ),
    renderDescription: (thread, { projectTitle }) => {
      const modelInstanceId =
        thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;
      const providerEntry =
        providerEntryByEnvironmentAndInstanceId.get(`${thread.environmentId}:${modelInstanceId}`) ??
        null;
      return (
        <ThreadCommandSubtitle
          project={projectByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? null}
          projectTitle={projectTitle ?? null}
          environmentLabel={
            projectEnvironmentLocationById.get(thread.environmentId)?.label ?? "Remote"
          }
          branch={thread.branch}
          worktreePath={thread.worktreePath}
          isCurrent={thread.id === activeThreadId}
          driverKind={providerEntry?.driverKind ?? null}
          providerDisplayName={
            thread.runtime?.providerName ?? providerEntry?.displayName ?? modelInstanceId
          }
          acpRegistryAgentId={providerEntry?.acpRegistryAgentId}
          acpRegistryIconUrl={providerEntry?.acpRegistryIconUrl}
        />
      );
    },
    getContentMatch: (thread) => {
      const match = contentMatchByKey.get(
        threadSearchMatchKey({
          environmentId: thread.environmentId,
          threadId: thread.id,
        }),
      );
      return match && (match.source === "user" || match.source === "assistant")
        ? {
            source: match.source,
            snippet: match.snippet,
            query: threadSearch.query,
          }
        : undefined;
    },
    getThreadState: (thread) => {
      const lastVisitedAt =
        threadLastVisitedAtById[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))];
      return {
        completed: thread.latestRun?.status === "completed",
        unread: hasUnseenCompletion({ ...thread, lastVisitedAt }),
      };
    },
    runThread: async (thread) => {
      const ref = scopeThreadRef(thread.environmentId, thread.id);
      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(ref),
      });
      requestContentMatchReveal(ref);
    },
  });

  return {
    threadItems,
    isSearchPending: threadSearch.isPending,
    environmentIds,
    contentMatchByKey,
    searchedQuery: threadSearch.query,
    requestContentMatchReveal,
  };
}
