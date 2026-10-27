import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { findForMessageMatch, openThreadFindOnQuery } from "./chat/threadFindStore";
import {
  claimThreadOpen,
  nextShownOrder,
  threadSearchMatchKey,
  type EnvironmentThreadSearchMatch,
  type ShownOrder,
} from "@t3tools/client-runtime/state/thread-search";
import {
  foldSearchQuery,
  PALETTE_MESSAGE_LIMIT,
  pickedQuery,
  rankMessageMatches,
} from "@t3tools/shared/paletteSearch";
import type {
  EnvironmentId,
  OrchestrationThreadSearchScope,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { MessageSquareIcon } from "lucide-react";
import { useState } from "react";

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
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadRouteParams } from "../threadRoutes";
import { useThreadMessageRevealStore } from "../threadMessageRevealStore";
import { formatRelativeTimeLabel } from "../timestampFormat";
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

function useConnectedThreadSearch(query: string, scope: OrchestrationThreadSearchScope) {
  const { environments } = useEnvironments();
  const { projectEnvironmentLocationById } = useEnvironmentLookups();
  const environmentIds: ReadonlyArray<EnvironmentId> = environments
    .filter((environment) => environment.connection.phase === "connected")
    .map((environment) => environment.environmentId);
  // The palette matches environment names when there are several; older rows must match the same.
  const environmentLabels =
    environments.length > 1
      ? Object.fromEntries(
          environmentIds.flatMap((environmentId) => {
            const label = projectEnvironmentLocationById.get(environmentId)?.label;
            return label === undefined || label === null ? [] : [[environmentId, label]];
          }),
        )
      : undefined;
  const threadSearch = useThreadSearch(environmentIds, query, {
    ...(environmentLabels === undefined ? {} : { environmentLabels }),
    ...(scope === "archived" ? { threads: "archived" as const } : {}),
  });
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
 * Every visible thread as a palette item, plus, for a non-empty
 * `threadSearchQuery`, the threads whose messages match, best first.
 * `scope: "archived"` searches archived threads instead; the caller builds those items
 * from `contentMatchByKey` because archived shells are not in the client's shell list.
 */
export function useCommandPaletteThreadItems(input: {
  readonly activeThread: { readonly environmentId: EnvironmentId; readonly id: ThreadId } | null;
  readonly threadSearchQuery: string;
  readonly scope: OrchestrationThreadSearchScope;
}) {
  const { activeThread, threadSearchQuery, scope } = input;
  const navigate = useNavigate();
  const threads = useThreadShells();
  const { projectEnvironmentLocationById } = useEnvironmentLookups();
  const providerEntryByEnvironmentAndInstanceId = useProviderEntryByEnvironmentAndInstanceId();
  const {
    environmentIds,
    threadSearch: messageSearch,
    contentMatchByKey,
  } = useConnectedThreadSearch(threadSearchQuery, scope);
  const { projectByKey } = useProjectLookups();
  const visitThread = useAtomCommand(threadEnvironment.visit, { reportFailure: false });
  // Ranking is relative to when the palette opened, so rows do not reorder as time passes.
  const [now] = useState(() => Date.now());
  const threadLastVisitedAtById = useUiStateStore((store) => store.threadLastVisitedAtById);
  // Called after navigating to an unarchived thread: its content hit scrolls to the
  // message it matched. Requesting before navigation resolves would be cleared by
  // the thread switch. Active message rows open find at the message instead.
  const requestContentMatchReveal = (ref: ScopedThreadRef) => {
    const messageId = contentMatchByKey.get(threadSearchMatchKey(ref))?.messageId;
    if (messageId !== undefined) {
      useThreadMessageRevealStore.getState().requestReveal(ref, messageId);
    }
  };

  const { environments } = useEnvironments();
  const threadItems = buildThreadActionItems({
    threads,
    ...(environments.length > 1
      ? {
          environmentLabelOf: (thread: (typeof threads)[number]) =>
            projectEnvironmentLocationById.get(thread.environmentId)?.label ?? null,
        }
      : {}),
    ...(activeThread ? { activeThread } : {}),
    projectByKey,
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
          isCurrent={
            thread.id === activeThread?.id && thread.environmentId === activeThread.environmentId
          }
          driverKind={providerEntry?.driverKind ?? null}
          providerDisplayName={
            thread.runtime?.providerName ?? providerEntry?.displayName ?? modelInstanceId
          }
          acpRegistryAgentId={providerEntry?.acpRegistryAgentId}
          acpRegistryIconUrl={providerEntry?.acpRegistryIconUrl}
        />
      );
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
      // A pick sends its open with the query, always, so the server records
      // it; the thread view then skips its own open. The open thread is no pick.
      const isOpen =
        activeThread?.environmentId === thread.environmentId && activeThread.id === thread.id;
      if (threadSearchQuery.trim().length > 0 && !threadSearchQuery.startsWith(">") && !isOpen) {
        // oxlint-disable-next-line react/purity -- runs in an event handler (oxc#27309)
        claimThreadOpen(thread.environmentId, thread.id, Date.now());
      }
      if (
        threadSearchQuery.trim().length > 0 &&
        !threadSearchQuery.startsWith(">") &&
        thread.lastVisitedAt !== undefined &&
        !isOpen
      ) {
        void visitThread({
          environmentId: thread.environmentId,
          input: {
            threadId: thread.id,
            visitedAt: thread.updatedAt,
            opened: true,
            searchQuery: pickedQuery(threadSearchQuery),
          },
        });
      }
      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
      });
    },
  });

  const itemByValue = new Map(threadItems.map((item) => [item.value, item]));
  const itemForMatch = (match: EnvironmentThreadSearchMatch) =>
    itemByValue.get(`thread:${match.environmentId}:${match.threadId}`);
  const rankedMessageItems = rankMessageMatches(
    messageSearch.matches,
    (match) => itemForMatch(match)?.threadSearch,
    foldSearchQuery(threadSearchQuery),
    now,
    { withoutTitleMatches: true },
  ).flatMap((match) => {
    const item = itemForMatch(match);
    if (!item) return [];
    // The snippet replaces the project line, so a message row is as tall as a title row.
    const { description: _description, ...rest } = item;
    return [
      {
        ...rest,
        // When the matching message was written, not when the thread last moved.
        ...(match.messageCreatedAt
          ? { timestamp: formatRelativeTimeLabel(match.messageCreatedAt) }
          : {}),
        threadContentMatch: {
          source: match.source,
          snippet: match.snippet,
          query: messageSearch.query,
        },
        // Opens the thread with find on the word at the matched message, so it is in view.
        run: async () => {
          await item.run();
          openThreadFindOnQuery(
            scopedThreadKey(scopeThreadRef(match.environmentId, match.threadId)),
            findForMessageMatch(match, messageSearch.query),
          );
        },
      },
    ];
  });

  // Rows already shown keep their places when a slower environment answers.
  const [shownOrder, setShownOrder] = useState<ShownOrder | null>(null);
  const order = nextShownOrder(
    shownOrder,
    messageSearch.query,
    rankedMessageItems.map((item) => item.value),
    PALETTE_MESSAGE_LIMIT,
  );
  if (order !== shownOrder) setShownOrder(order);
  const messageItemByValue = new Map(rankedMessageItems.map((item) => [item.value, item]));
  const threadMessageItems = order.keys
    .slice(0, order.shown)
    .flatMap((value) => messageItemByValue.get(value) ?? []);

  return {
    threadItems,
    threadMessageItems,
    now,
    isSearchPending: messageSearch.isPending,
    environmentIds,
    contentMatchByKey,
    searchedQuery: messageSearch.query,
    requestContentMatchReveal,
  };
}
