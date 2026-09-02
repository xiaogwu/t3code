import { SearchIcon, XIcon } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { type PromptHistoryEntry } from "../../promptHistoryStore";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Command, CommandGroup, CommandItem, CommandList } from "../ui/command";
import { Input } from "../ui/input";
import { cn } from "~/lib/utils";
import { ComposerBanner } from "./ComposerBanner";
import { searchPromptHistoryEntries } from "./promptHistorySearch";

const SNIPPET_MAX_CHARS = 180;

function historyEntrySnippet(text: string): string {
  const compact = text.trim().replace(/\s+/g, " ");
  return compact.length > SNIPPET_MAX_CHARS ? `${compact.slice(0, SNIPPET_MAX_CHARS)}…` : compact;
}

export function scrollPromptHistoryEntryIntoView(entry: HTMLElement | null | undefined): void {
  entry?.scrollIntoView({ block: "nearest" });
}

export const ComposerPromptHistorySearch = memo(function ComposerPromptHistorySearch(props: {
  entries: ReadonlyArray<PromptHistoryEntry>;
  onSelect: (entry: PromptHistoryEntry) => void;
  onClose: () => void;
}) {
  const { entries, onClose, onSelect } = props;
  const drawerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [query, setQuery] = useState("");
  const matches = useMemo(() => searchPromptHistoryEntries(entries, query), [entries, query]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const highlightedEntry = matches[highlightedIndex] ?? matches[0];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query]);

  useEffect(() => {
    if (highlightedIndex >= matches.length) setHighlightedIndex(Math.max(0, matches.length - 1));
  }, [highlightedIndex, matches.length]);

  useEffect(() => {
    scrollPromptHistoryEntryIntoView(itemRefs.current[highlightedIndex]);
  }, [highlightedIndex]);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const drawer = drawerRef.current;
      if (drawer && event.composedPath().includes(drawer)) return;
      onClose();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [onClose]);

  const moveHighlight = (offset: -1 | 1) => {
    if (matches.length === 0) return;
    setHighlightedIndex((current) => Math.max(0, Math.min(matches.length - 1, current + offset)));
  };

  return (
    <Command autoHighlight={false} mode="none">
      <ComposerBanner.Surface
        ref={drawerRef}
        className="w-full overflow-hidden bg-(--chat-composer-attached-surface)! pb-(--chat-composer-attachment-overlap)"
        data-composer-prompt-history-search="true"
      >
        <div className="flex items-center gap-2 border-b border-border/60 p-2">
          <SearchIcon className="ml-1 size-3.5 shrink-0 text-secondary-label" />
          <Input
            ref={inputRef}
            nativeInput
            type="search"
            size="compact"
            className="flex-1 border-0 bg-transparent shadow-none ring-0 before:hidden"
            value={query}
            placeholder="Search prompt history"
            aria-label="Search prompt history"
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                moveHighlight(event.key === "ArrowDown" ? 1 : -1);
                return;
              }
              if (event.key.toLowerCase() === "r" && event.ctrlKey && !event.metaKey) {
                event.preventDefault();
                moveHighlight(1);
                return;
              }
              if (event.key === "Enter" && highlightedEntry) {
                event.preventDefault();
                onSelect(highlightedEntry);
              }
            }}
          />
          <span className="shrink-0 text-[10px] text-secondary-label">Ctrl+R</span>
          <Button
            variant="ghost-muted"
            size="icon-micro"
            aria-label="Close prompt history search"
            onClick={onClose}
          >
            <XIcon className="size-3" />
          </Button>
        </div>
        <CommandList className="max-h-72 scroll-pb-6">
          <CommandGroup>
            {matches.length === 0 ? (
              <p className="px-3 py-3 text-secondary-label text-xs">
                {entries.length === 0
                  ? "No prompts have been recorded yet."
                  : "No prompts match your search."}
              </p>
            ) : (
              matches.map((entry, index) => (
                <CommandItem
                  ref={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  key={`${entry.createdAt}:${entry.text}`}
                  value={`${entry.createdAt}:${entry.text}`}
                  className={cn(
                    "cursor-pointer select-none gap-3 rounded-lg px-3 py-2! hover:bg-transparent hover:text-inherit data-highlighted:bg-transparent data-highlighted:text-inherit",
                    index === highlightedIndex && "bg-accent! text-accent-foreground!",
                  )}
                  onMouseMove={() => setHighlightedIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSelect(entry)}
                >
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {historyEntrySnippet(entry.text)}
                  </span>
                  <span className="shrink-0 text-[10px] text-secondary-label max-sm:hidden">
                    {formatRelativeTimeLabel(entry.createdAt)}
                  </span>
                </CommandItem>
              ))
            )}
          </CommandGroup>
        </CommandList>
      </ComposerBanner.Surface>
    </Command>
  );
});
