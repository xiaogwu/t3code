import { type ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { shortcutLabelForCommand } from "../keybindings";
import {
  type CommandPaletteActionItem,
  type CommandPaletteGroup,
  type CommandPaletteSubmenuItem,
} from "./CommandPalette.logic";
import {
  CommandCollection,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "./ui/command";
import { THREAD_SEARCH_MATCH_EXCERPT_CLASS, ThreadSearchMatchContent } from "./ThreadSearchMatch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function isCommandPaletteTextOverflowing(
  element: Pick<HTMLElement, "clientWidth" | "scrollWidth">,
): boolean {
  return element.scrollWidth > element.clientWidth;
}

export function commandPaletteOverflowTooltip(
  tooltip: string | undefined,
  isOverflowing: boolean,
): string | undefined {
  return tooltip && isOverflowing ? tooltip : undefined;
}

function OverflowTooltipText(props: {
  children: ReactNode;
  className: string;
  tooltip?: string | undefined;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !props.tooltip) return;
    const update = () => setIsOverflowing(isCommandPaletteTextOverflowing(element));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.tooltip]);

  const overflowTooltip = commandPaletteOverflowTooltip(props.tooltip, isOverflowing);
  // No native title attribute: the styled Tooltip below is the only tooltip
  // (lint rule t3code/no-native-title-tooltip).
  const content = (
    <span ref={ref} className={props.className}>
      {props.children}
    </span>
  );
  if (!overflowTooltip) return content;
  return (
    <Tooltip>
      <TooltipTrigger render={content} />
      <TooltipPopup side="top" className="max-w-96">
        {overflowTooltip}
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * The palette's variant of the shared search excerpt: same content, wrapped so a
 * snippet truncated by the row width gets an overflow tooltip.
 */
function ThreadContentMatch(props: {
  match: NonNullable<CommandPaletteActionItem["threadContentMatch"]>;
  tooltip?: string | undefined;
}) {
  return (
    <OverflowTooltipText className={THREAD_SEARCH_MATCH_EXCERPT_CLASS} tooltip={props.tooltip}>
      <ThreadSearchMatchContent match={props.match} />
    </OverflowTooltipText>
  );
}

interface CommandPaletteResultsProps {
  emptyStateMessage?: string;
  groups: ReadonlyArray<CommandPaletteGroup>;
  highlightedItemValue?: string | null;
  isActionsOnly: boolean;
  keybindings: ResolvedKeybindingsConfig;
  onExecuteItem: (item: CommandPaletteActionItem | CommandPaletteSubmenuItem) => void;
}

export function CommandPaletteResults(props: CommandPaletteResultsProps) {
  if (props.groups.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        {props.emptyStateMessage ??
          (props.isActionsOnly
            ? "No matching actions."
            : "No matching commands, projects, or threads.")}
      </div>
    );
  }

  return (
    <CommandList>
      {props.groups.map((group) => (
        <CommandGroup items={group.items} key={group.value}>
          <CommandGroupLabel>{group.label}</CommandGroupLabel>
          <CommandCollection>
            {(item) =>
              item.disabled ? (
                <DisabledCommandPaletteResultRow item={item} key={item.value} />
              ) : (
                <CommandPaletteResultRow
                  item={item}
                  key={item.value}
                  keybindings={props.keybindings}
                  isActive={props.highlightedItemValue === item.value}
                  onExecuteItem={props.onExecuteItem}
                />
              )
            }
          </CommandCollection>
        </CommandGroup>
      ))}
    </CommandList>
  );
}

function DisabledCommandPaletteResultRow(props: {
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem;
}) {
  return (
    <div className="flex min-h-8 select-none items-center gap-2 rounded-sm px-2 py-1.5 text-base opacity-64 sm:min-h-7 sm:text-sm">
      {props.item.icon}
      {props.item.description || props.item.threadContentMatch ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
            {props.item.titleLeadingContent}
            <OverflowTooltipText className="truncate" tooltip={props.item.titleTooltip}>
              {props.item.title}
            </OverflowTooltipText>
          </span>
          {props.item.threadContentMatch ? (
            <ThreadContentMatch
              match={props.item.threadContentMatch}
              tooltip={props.item.contentTooltip}
            />
          ) : null}
          {props.item.description ? (
            <OverflowTooltipText
              className="min-w-0 truncate text-muted-foreground/70 text-xs"
              tooltip={props.item.descriptionTooltip}
            >
              {props.item.description}
            </OverflowTooltipText>
          ) : null}
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-foreground">
          {props.item.titleLeadingContent}
          <OverflowTooltipText className="truncate" tooltip={props.item.titleTooltip}>
            {props.item.title}
          </OverflowTooltipText>
        </span>
      )}
      {props.item.titleTrailingContent}
    </div>
  );
}

function CommandPaletteResultRow(props: {
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem;
  isActive: boolean;
  keybindings: ResolvedKeybindingsConfig;
  onExecuteItem: (item: CommandPaletteActionItem | CommandPaletteSubmenuItem) => void;
}) {
  const shortcutLabel = props.item.shortcutCommand
    ? shortcutLabelForCommand(props.keybindings, props.item.shortcutCommand)
    : null;

  return (
    <CommandItem
      value={props.item.value}
      active={props.isActive}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onExecuteItem(props.item);
      }}
    >
      {props.item.icon}
      {props.item.description || props.item.threadContentMatch ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
            {props.item.titleLeadingContent}
            <OverflowTooltipText className="truncate" tooltip={props.item.titleTooltip}>
              {props.item.title}
            </OverflowTooltipText>
          </span>
          {props.item.threadContentMatch ? (
            <ThreadContentMatch
              match={props.item.threadContentMatch}
              tooltip={props.item.contentTooltip}
            />
          ) : null}
          {props.item.description ? (
            <OverflowTooltipText
              className="min-w-0 truncate text-muted-foreground/70 text-xs"
              tooltip={props.item.descriptionTooltip}
            >
              {props.item.description}
            </OverflowTooltipText>
          ) : null}
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-foreground">
          {props.item.titleLeadingContent}
          <OverflowTooltipText className="truncate" tooltip={props.item.titleTooltip}>
            {props.item.title}
          </OverflowTooltipText>
        </span>
      )}
      {props.item.titleTrailingContent}
      {props.item.timestamp ? (
        <span className="min-w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground/70">
          {props.item.timestamp}
        </span>
      ) : null}
      {shortcutLabel ? <CommandShortcut>{shortcutLabel}</CommandShortcut> : null}
      {props.item.kind === "submenu" ? (
        <ChevronRightIcon className="-me-0.5 ms-auto size-4 shrink-0 text-muted-foreground/70" />
      ) : null}
    </CommandItem>
  );
}
