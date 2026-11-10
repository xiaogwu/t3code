import type { ResolvedKeybindingsConfig, ScopedThreadRef } from "@t3tools/contracts";
import { FileDownIcon } from "lucide-react";
import { useRef } from "react";

import { useThreadExport } from "../../hooks/useThreadExport";
import { shortcutLabelForCommand } from "../../keybindings";
import { cn } from "../../lib/utils";
import { canShareThreadFile } from "../../threadExport";
import { Menu, MenuItem, MenuItemLabel, MenuPopup, MenuShortcut, MenuTrigger } from "../ui/menu";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "./threadDetailsPanelStyles";

/** Thread details panel row that exports the whole thread as Markdown, HTML, or PDF. */
export function ThreadExportControl(props: {
  threadRef: ScopedThreadRef;
  keybindings: ResolvedKeybindingsConfig;
}) {
  const exportThread = useThreadExport();
  const anchorRef = useRef<HTMLButtonElement | null>(null);

  return (
    <Menu>
      <MenuTrigger
        render={
          <ThreadDetailsControl
            ref={anchorRef}
            size="sm"
            variant="ghost"
            part="select"
            aria-label="Export thread"
          />
        }
      >
        <FileDownIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} />
        <span className={cn("min-w-0 flex-1 truncate", THREAD_DETAILS_PANEL_LABEL_CLASS)}>
          Export
        </span>
      </MenuTrigger>
      <MenuPopup align="end" anchor={anchorRef} className="w-(--anchor-width)">
        <MenuItem onClick={() => void exportThread(props.threadRef, "markdown")}>
          <MenuItemLabel>Markdown</MenuItemLabel>
          <MenuShortcut>
            {shortcutLabelForCommand(props.keybindings, "thread.exportMarkdown")}
          </MenuShortcut>
        </MenuItem>
        <MenuItem onClick={() => void exportThread(props.threadRef, "html")}>
          <MenuItemLabel>HTML</MenuItemLabel>
        </MenuItem>
        <MenuItem onClick={() => void exportThread(props.threadRef, "pdf")}>
          <MenuItemLabel>PDF</MenuItemLabel>
          <MenuShortcut>
            {shortcutLabelForCommand(props.keybindings, "thread.exportPdf")}
          </MenuShortcut>
        </MenuItem>
        {canShareThreadFile() ? (
          <MenuItem onClick={() => void exportThread(props.threadRef, "share")}>
            <MenuItemLabel>Share…</MenuItemLabel>
          </MenuItem>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
