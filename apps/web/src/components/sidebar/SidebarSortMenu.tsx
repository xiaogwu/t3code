import type { SidebarV2ThreadSortOrder } from "@t3tools/contracts";
import { ArrowUpDownIcon } from "lucide-react";

import { Menu, MenuGroup, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * "updated_at" is labelled by what it actually sorts on — the latest user
 * message — rather than by the record's `updatedAt` column, which would be a
 * misleading name for the behaviour. Matches the v1 menu wording.
 */
export const SIDEBAR_V2_THREAD_SORT_LABELS: Record<SidebarV2ThreadSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
};

/**
 * Thread-sort popover for Sidebar v2. v1's menu also carries project sort and
 * a visible-thread count; v2 has neither a per-project grouping nor a preview
 * cap, so it exposes thread order alone.
 */
export function SidebarSortMenu({
  threadSortOrder,
  onThreadSortOrderChange,
}: {
  threadSortOrder: SidebarV2ThreadSortOrder;
  onThreadSortOrderChange: (sortOrder: SidebarV2ThreadSortOrder) => void;
}) {
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger className="inline-flex h-6 min-w-6 cursor-pointer items-center justify-center rounded-md px-[calc(--spacing(1)-1px)] text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground" />
          }
          aria-label="Sort threads"
        >
          <ArrowUpDownIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Sort threads</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="bottom" className="min-w-52">
        <MenuGroup>
          <div className="px-2 py-1 font-medium text-muted-foreground sm:text-xs">Sort threads</div>
          <MenuRadioGroup
            value={threadSortOrder}
            onValueChange={(value) => {
              onThreadSortOrderChange(value as SidebarV2ThreadSortOrder);
            }}
          >
            {(
              Object.entries(SIDEBAR_V2_THREAD_SORT_LABELS) as Array<
                [SidebarV2ThreadSortOrder, string]
              >
            ).map(([value, label]) => (
              <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
                {label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}
