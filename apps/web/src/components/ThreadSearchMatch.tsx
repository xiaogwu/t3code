function foldAsciiCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function HighlightedSearchText(props: { text: string; query: string }) {
  const query = props.query.trim();
  if (query.length === 0) return props.text;

  const normalizedText = foldAsciiCase(props.text);
  const normalizedQuery = foldAsciiCase(query);
  const parts: Array<{
    readonly text: string;
    readonly highlighted: boolean;
    readonly start: number;
  }> = [];
  let cursor = 0;

  while (cursor < props.text.length) {
    const matchIndex = normalizedText.indexOf(normalizedQuery, cursor);
    if (matchIndex === -1) {
      parts.push({ text: props.text.slice(cursor), highlighted: false, start: cursor });
      break;
    }
    if (matchIndex > cursor) {
      parts.push({
        text: props.text.slice(cursor, matchIndex),
        highlighted: false,
        start: cursor,
      });
    }
    parts.push({
      text: props.text.slice(matchIndex, matchIndex + query.length),
      highlighted: true,
      start: matchIndex,
    });
    cursor = matchIndex + query.length;
  }

  return parts.map((part) =>
    part.highlighted ? (
      <mark className="bg-transparent font-semibold text-foreground" key={part.start}>
        {part.text}
      </mark>
    ) : (
      part.text
    ),
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
      <span className={isUser ? "text-blue-400" : "text-emerald-400"}>
        {isUser ? "You:" : "Agent:"}
      </span>{" "}
      <HighlightedSearchText text={props.match.snippet} query={props.match.query} />
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
