import type {
  EnvironmentId,
  SidebarProjectGroupingMode,
  SidebarV2ThreadSortOrder,
} from "@t3tools/contracts";
import {
  DEFAULT_SIDEBAR_PROJECT_SORT_ORDER,
  DEFAULT_SIDEBAR_V2_THREAD_SORT_ORDER,
} from "@t3tools/contracts";
import { useAtomSet } from "@effect/atom-react";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { ThreadListFilters } from "../../persistence/mobile-preferences";
import { updateMobilePreferencesAtom } from "../../state/preferences";
import type { HomeProjectSortOrder } from "./homeThreadList";

export interface HomeListOptions {
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectKey: string | null;
  readonly projectSortOrder: HomeProjectSortOrder;
  /** The list's thread order (the fork's Sidebar v2 thread sort). v2 starts
      in creation order; "Last user message" opts into activity ordering. */
  readonly v2ThreadSortOrder: SidebarV2ThreadSortOrder;
}

export interface ResolvedHomeListOptions extends HomeListOptions {
  readonly projectGroupingMode: SidebarProjectGroupingMode;
}

// Lives with the menu builder, which must stay free of app-runtime imports.
export { THREAD_SORT_OPTIONS } from "./home-list-filter-menu";

function defaultHomeListOptions(filters?: ThreadListFilters): HomeListOptions {
  return {
    selectedEnvironmentId: filters?.environmentId ?? null,
    selectedProjectKey: filters?.projectKey ?? null,
    projectSortOrder:
      DEFAULT_SIDEBAR_PROJECT_SORT_ORDER === "manual"
        ? "updated_at"
        : DEFAULT_SIDEBAR_PROJECT_SORT_ORDER,
    v2ThreadSortOrder: DEFAULT_SIDEBAR_V2_THREAD_SORT_ORDER,
  };
}

interface HomeListOptionsContextValue {
  readonly options: HomeListOptions;
  readonly setOptions: Dispatch<SetStateAction<HomeListOptions>>;
  readonly projectGroupingMode: SidebarProjectGroupingMode;
}

const HomeListOptionsContext = createContext<HomeListOptionsContextValue | null>(null);

export function HomeListOptionsProvider({
  children,
  projectGroupingMode,
  savedFilters,
}: PropsWithChildren<{
  readonly projectGroupingMode: SidebarProjectGroupingMode;
  readonly savedFilters?: ThreadListFilters | undefined;
}>) {
  const [options, setOptions] = useState(() => defaultHomeListOptions(savedFilters));
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const saved = useRef(savedFilters);
  const { selectedEnvironmentId: environmentId, selectedProjectKey: projectKey } = options;
  useEffect(() => {
    if (
      (saved.current?.environmentId ?? null) === environmentId &&
      (saved.current?.projectKey ?? null) === projectKey
    )
      return;
    saved.current = { environmentId, projectKey };
    savePreferences({ threadListFilters: saved.current });
  }, [environmentId, projectKey, savePreferences]);
  const value = { options, setOptions, projectGroupingMode };
  return createElement(HomeListOptionsContext, { value }, children);
}

/** Whether the filter icon should show its "customized" state: any scope
    filter, or a thread order other than v2's creation-order default. */
export function hasCustomHomeListOptions(
  options: Pick<
    HomeListOptions,
    "selectedEnvironmentId" | "selectedProjectKey" | "v2ThreadSortOrder"
  >,
): boolean {
  return (
    options.selectedEnvironmentId !== null ||
    options.selectedProjectKey !== null ||
    options.v2ThreadSortOrder !== DEFAULT_SIDEBAR_V2_THREAD_SORT_ORDER
  );
}

export function useHomeListOptions(availableEnvironmentIds: ReadonlySet<EnvironmentId>) {
  const shared = useContext(HomeListOptionsContext);
  const [localOptions, setLocalOptions] = useState<HomeListOptions>(defaultHomeListOptions);
  const options = shared?.options ?? localOptions;
  const setOptions = shared?.setOptions ?? setLocalOptions;
  const selectedEnvironmentId =
    options.selectedEnvironmentId !== null &&
    availableEnvironmentIds.has(options.selectedEnvironmentId)
      ? options.selectedEnvironmentId
      : null;
  const availableOptions =
    selectedEnvironmentId === options.selectedEnvironmentId
      ? options
      : { ...options, selectedEnvironmentId };
  const resolvedOptions: ResolvedHomeListOptions = {
    ...availableOptions,
    projectGroupingMode: shared?.projectGroupingMode ?? "repository",
  };

  const setSelectedEnvironmentId = (value: EnvironmentId | null) => {
    setOptions((current) => ({ ...current, selectedEnvironmentId: value }));
  };
  const setSelectedProjectKey = (value: string | null) => {
    setOptions((current) => ({ ...current, selectedProjectKey: value }));
  };
  const setProjectSortOrder = (value: HomeProjectSortOrder) => {
    setOptions((current) => ({ ...current, projectSortOrder: value }));
  };
  const setV2ThreadSortOrder = (value: SidebarV2ThreadSortOrder) => {
    setOptions((current) => ({ ...current, v2ThreadSortOrder: value }));
  };
  return {
    options: resolvedOptions,
    setSelectedEnvironmentId,
    setSelectedProjectKey,
    setProjectSortOrder,
    setV2ThreadSortOrder,
  } as const;
}
