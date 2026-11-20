import type { ContextMenuItem } from "@t3tools/contracts";
import type { SnoozePreset } from "@t3tools/client-runtime/state/thread-settled";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../i18n/messages";

export type ThreadActionMenuId =
  | "find"
  | "reveal-in-sidebar"
  | "new-thread-on-branch"
  | "filter-by-project"
  | "turn-into-project"
  | "project-settings"
  | "pin"
  | "unpin"
  | "move-pin-up"
  | "move-pin-down"
  | "settle"
  | "unsettle"
  | "auto-settle"
  | "auto-settle:enabled"
  | "auto-settle:disabled"
  | "snooze"
  | `snooze:${string}`
  | "snooze-for"
  | "unsnooze"
  | "rename"
  | "regenerate-title"
  | "mark-unread"
  | "mark-read"
  | "share-guest"
  | "copy"
  | "copy-path"
  | "copy-branch"
  | "copy-thread"
  | "copy-thread-id"
  | "export"
  | "export-markdown"
  | "export-html"
  | "export-pdf"
  | "export-share"
  | "archive"
  | "delete";

export type DraftActionMenuId =
  | "copy"
  | "copy-path"
  | "copy-branch"
  | "project-settings"
  | "discard";

export function buildDraftActionMenuItems(
  options: {
    readonly hasPath: boolean;
    readonly hasBranch: boolean;
    readonly hasProject: boolean;
  },
  resolve: MessageResolver = m,
): ReadonlyArray<ContextMenuItem<DraftActionMenuId>> {
  return [
    {
      id: "copy",
      label: resolve(msg("Copy", { $context: "submenu of things to copy" })),
      icon: "copy",
      disabled: !options.hasPath && !options.hasBranch,
      children: [
        ...(options.hasPath
          ? [
              {
                id: "copy-path" as const,
                label: resolve(msg("Path", { $context: "copy the file path" })),
                icon: "folder",
              },
            ]
          : []),
        ...(options.hasBranch
          ? [
              {
                id: "copy-branch" as const,
                label: resolve(msg("Branch", { $context: "copy the git branch name" })),
                icon: "git-branch",
              },
            ]
          : []),
      ],
    },
    ...(options.hasProject
      ? [
          {
            id: "project-settings" as const,
            label: resolve(msg("Project settings")),
            icon: "settings",
          },
        ]
      : []),
    {
      id: "discard",
      label: resolve(msg("Discard draft")),
      icon: "trash",
      destructive: true,
      separatorBefore: true,
    },
  ];
}

export interface ThreadActionMenuState {
  readonly canOperate: boolean;
  readonly canFind?: boolean;
  /** The chat header can scroll the sidebar to this thread; the sidebar row is already there. */
  readonly canRevealInSidebar?: boolean;
  /** The browser can hand a file to the system share sheet; adds Export → Share…. */
  readonly canShare: boolean;
  /** False where no inline title editor is rendered, such as sidebar search results. */
  readonly canRename?: boolean;
  readonly branch: string | null;
  readonly projectFilter: {
    readonly label: string;
    readonly isActive: boolean;
  } | null;
  readonly isPinned: boolean;
  readonly isSettled: boolean;
  readonly autoSettleEnabled: boolean;
  readonly isSnoozed: boolean;
  readonly canSnoozeNow: boolean;
  readonly isRegeneratingTitle: boolean;
  /** Thread currently reads as unread (manual mark or unseen completion), so
      the entry offers Mark read instead. Callers without read-state context
      omit it and get Mark unread. */
  readonly isUnread?: boolean;
  /** Pinned-block position, for Move up / Move down. Callers without the
      pinned order (the chat header menu) omit both and get no move items. */
  readonly canMovePinUp?: boolean;
  readonly canMovePinDown?: boolean;
  /** Archive rejects attached providers, so disable it while running. */
  readonly isRunning: boolean;
  readonly supports: {
    readonly settlement: boolean;
    readonly autoSettleOptOut: boolean;
    readonly snooze: boolean;
    readonly pinning: boolean;
    /** Server accepts thread.pin.reorder AND more than one pin is arrangeable
        — a lone pin has nowhere to move. */
    readonly pinReorder?: boolean;
    readonly titleRegeneration: boolean;
  };
  readonly snoozePresets: ReadonlyArray<SnoozePreset>;
  /** Guest links need their own grant, so the caller checks it instead of `canOperate`. */
  readonly canShareWithGuest?: boolean;
  /** A No project thread with its own folder, on a server that can promote it. */
  readonly canTurnIntoProject?: boolean;
}

/** Local navigation, read markers, copying, and exporting remain available to read-only clients. */
export function threadActionRequiresOperate(action: ThreadActionMenuId): boolean {
  return ![
    "find",
    "reveal-in-sidebar",
    "new-thread-on-branch",
    "project-settings",
    "mark-read",
    "mark-unread",
    "share-guest",
    "copy",
    "copy-path",
    "copy-branch",
    "copy-thread",
    "copy-thread-id",
    "export",
    "export-markdown",
    "export-html",
    "export-pdf",
    "export-share",
  ].includes(action);
}

export function buildThreadActionMenuItems(
  state: ThreadActionMenuState,
  resolve: MessageResolver = m,
): ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> {
  const items: ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> = [
    ...(state.canFind
      ? [{ id: "find" as const, label: resolve(msg("Find in thread")), icon: "text-search" }]
      : []),
    ...(state.canRevealInSidebar
      ? [
          {
            id: "reveal-in-sidebar" as const,
            label: resolve(msg("Reveal in sidebar")),
            icon: "folder-tree",
          },
        ]
      : []),
    ...(state.branch
      ? [
          {
            id: "new-thread-on-branch" as const,
            label: resolve(msg("New thread on {branch}", { branch: state.branch })),
            icon: "message-square-plus",
          },
        ]
      : []),
    ...(state.supports.pinning
      ? [
          state.isPinned
            ? { id: "unpin" as const, label: resolve(msg("Unpin thread")), icon: "pin-off" }
            : { id: "pin" as const, label: resolve(msg("Pin thread")), icon: "pin" },
        ]
      : []),
    // Menu equivalent of dragging a pinned card, same as mobile: one step per
    // click, disabled at the ends so the item's position still reads as
    // "where am I in the block".
    ...(state.isPinned && state.supports.pinReorder === true
      ? [
          {
            id: "move-pin-up" as const,
            label: resolve(msg("Move up", { $context: "pinned thread order" })),
            disabled: !state.canMovePinUp,
          },
          {
            id: "move-pin-down" as const,
            label: resolve(msg("Move down", { $context: "pinned thread order" })),
            disabled: !state.canMovePinDown,
          },
        ]
      : []),
    // Both lifecycle actions stay available on pinned threads: settling
    // clears the pin ("done" beats "keep on top"), and snoozing hides the
    // card until wake with the pin intact.
    ...(state.supports.settlement
      ? [
          state.isSettled
            ? {
                id: "unsettle" as const,
                label: resolve(msg("Un-settle thread")),
                icon: "circle-check",
              }
            : { id: "settle" as const, label: resolve(msg("Settle thread")), icon: "circle-check" },
        ]
      : []),
    ...(state.supports.snooze
      ? [
          state.isSnoozed
            ? { id: "unsnooze" as const, label: resolve(msg("Wake thread")), icon: "clock" }
            : {
                id: "snooze" as const,
                label: resolve(msg("Snooze", { $context: "verb, snooze the thread" })),
                icon: "clock",
                disabled: !state.canSnoozeNow,
                children: [
                  ...state.snoozePresets.map((preset) => ({
                    id: `snooze:${preset.id}` as const,
                    label: preset.label,
                    detail: preset.whenLabel,
                  })),
                  {
                    id: "snooze-for" as const,
                    label: resolve(msg("Until…", { $context: "custom snooze time" })),
                  },
                ],
              },
        ]
      : []),
    {
      id: "rename",
      label: resolve(msg("Rename thread")),
      icon: "pencil",
      disabled: state.canRename === false,
      separatorBefore: true,
    },
    ...(state.supports.titleRegeneration
      ? [
          {
            id: "regenerate-title" as const,
            label: state.isRegeneratingTitle
              ? resolve(msg("Regenerating…"))
              : resolve(msg("Regenerate title")),
            icon: "refresh-cw",
            disabled: state.isRegeneratingTitle,
          },
        ]
      : []),
    state.isUnread === true
      ? { id: "mark-read" as const, label: resolve(msg("Mark read")), icon: "mail-open" }
      : { id: "mark-unread" as const, label: resolve(msg("Mark unread")), icon: "mail-open" },
    ...(state.canShareWithGuest
      ? [{ id: "share-guest" as const, label: resolve(msg("Share with guest")), icon: "user-plus" }]
      : []),
    ...(state.projectFilter
      ? [
          {
            id: "filter-by-project" as const,
            label: state.projectFilter.isActive
              ? resolve(msg("Show all projects"))
              : resolve(msg("Filter by {project}", { project: state.projectFilter.label })),
            icon: "folder-tree",
          },
        ]
      : []),
    ...(state.canTurnIntoProject
      ? [
          {
            id: "turn-into-project" as const,
            label: resolve(msg("Turn into project")),
            icon: "folder-plus",
            disabled: state.isRunning,
          },
        ]
      : []),
    ...(state.supports.autoSettleOptOut
      ? [
          {
            id: "auto-settle" as const,
            label: resolve(msg("Auto-settle behavior")),
            icon: "timer",
            children: [
              {
                id: "auto-settle:enabled" as const,
                label: resolve(msg("Follow settings")),
                checked: state.autoSettleEnabled,
              },
              {
                id: "auto-settle:disabled" as const,
                label: resolve(msg("Never", { $context: "auto-settle never" })),
                checked: !state.autoSettleEnabled,
              },
            ],
          },
        ]
      : []),
    {
      id: "copy",
      label: resolve(msg("Copy", { $context: "submenu of things to copy" })),
      icon: "copy",
      separatorBefore: true,
      children: [
        {
          id: "copy-path",
          label: resolve(msg("Path", { $context: "copy the file path" })),
          icon: "folder",
        },
        ...(state.branch
          ? [
              {
                id: "copy-branch" as const,
                label: resolve(msg("Branch", { $context: "copy the git branch name" })),
                icon: "git-branch",
              },
            ]
          : []),
        {
          id: "copy-thread",
          label: resolve(msg("Thread", { $context: "copy the thread contents" })),
          icon: "message-square",
        },
        { id: "copy-thread-id", label: resolve(msg("Thread ID")), icon: "hash" },
      ],
    },
    {
      id: "export",
      label: resolve(msg("Export", { $context: "thread menu: export the thread" })),
      icon: "download",
      children: [
        { id: "export-markdown", label: resolve(msg("Markdown")) },
        { id: "export-html", label: resolve(msg("HTML")) },
        { id: "export-pdf", label: resolve(msg("PDF")) },
        ...(state.canShare ? [{ id: "export-share" as const, label: resolve(msg("Share…")) }] : []),
      ],
    },
    { id: "project-settings", label: resolve(msg("Project settings")), icon: "settings" },
    {
      id: "archive",
      label: resolve(msg("Archive thread")),
      icon: "archive",
      disabled: state.isRunning,
      separatorBefore: true,
    },
    {
      id: "delete",
      label: resolve(msg("Delete", { $context: "verb, delete the thread" })),
      destructive: true,
      icon: "trash",
    },
  ];
  return state.canOperate
    ? items
    : items.map((item) =>
        threadActionRequiresOperate(item.id)
          ? {
              ...item,
              disabled: true,
              ...(item.children
                ? { children: item.children.map((child) => ({ ...child, disabled: true })) }
                : {}),
            }
          : item,
      );
}
