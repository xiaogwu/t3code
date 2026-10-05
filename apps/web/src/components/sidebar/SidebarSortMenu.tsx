import type { SidebarV2ThreadSortOrder } from "@t3tools/contracts";

/** Labels shared by the sidebar ordering preference in Settings. */
export const SIDEBAR_V2_THREAD_SORT_LABELS: Record<SidebarV2ThreadSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
};
