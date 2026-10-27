import {
  findSearchTokenRanges,
  splitSearchText,
  type SearchMatchHint,
  type SearchRange,
} from "@t3tools/shared/paletteSearch";

/** `text` with each range in semibold foreground. */
function HighlightedSearchText(props: { text: string; ranges: ReadonlyArray<SearchRange> }) {
  if (props.ranges.length === 0) return props.text;
  return splitSearchText(props.text, props.ranges).map((part) =>
    part.highlighted ? (
      <mark className="bg-transparent font-semibold text-foreground" key={part.start}>
        {part.text}
      </mark>
    ) : (
      part.text
    ),
  );
}

/** Why a row matched when its title does not show it: the field and its match. */
export function SearchMatchHintLine(props: { hint: SearchMatchHint }) {
  return (
    <span className="truncate text-xs text-muted-foreground/85">
      <span className="text-muted-foreground/70">{props.hint.label}:</span>{" "}
      <HighlightedSearchText text={props.hint.text} ranges={props.hint.ranges} />
    </span>
  );
}

export interface ThreadSearchMatch {
  readonly source: "user" | "assistant";
  readonly snippet: string;
  readonly query: string;
}

export const THREAD_SEARCH_MATCH_EXCERPT_CLASS = "truncate text-xs text-muted-foreground/85";

/**
 * The speaker label and highlighted snippet, without a wrapper. Callers that
 * need their own wrapper - the command palette wraps it to add an overflow
 * tooltip - render this directly instead of ThreadSearchMatchExcerpt.
 */
export function ThreadSearchMatchContent(props: { match: ThreadSearchMatch }) {
  const isUser = props.match.source === "user";
  return (
    <>
      <span className={isUser ? "text-info-foreground" : "text-success-foreground"}>
        {isUser ? "You:" : "Agent:"}
      </span>{" "}
      <HighlightedSearchText
        text={props.match.snippet}
        ranges={findSearchTokenRanges(props.match.snippet, props.match.query)}
      />
    </>
  );
}

export function ThreadSearchMatchExcerpt(props: { match: ThreadSearchMatch }) {
  return (
    <span className={THREAD_SEARCH_MATCH_EXCERPT_CLASS}>
      <ThreadSearchMatchContent match={props.match} />
    </span>
  );
}
