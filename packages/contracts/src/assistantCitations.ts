import * as Schema from "effect/Schema";
import {
  EnvironmentId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ThreadBookmarkId,
  ThreadId,
} from "./baseSchemas.ts";

export const ASSISTANT_CITATION_MAX_TEXT_LENGTH = 8_000;
export const ASSISTANT_CITATION_MAX_COMMENT_LENGTH = 8_000;
export const ASSISTANT_CITATION_CONTEXT_LENGTH = 32;
// Provider message IDs nest and re-encode their thread and turn IDs, so they outgrow a few hundred characters.
export const ASSISTANT_CITATION_MAX_ID_LENGTH = 4_096;

/** Positions are UTF-16 offsets, not Markdown offsets. */
export const AssistantCitation = Schema.Struct({
  version: Schema.Literal(1),
  environmentId: EnvironmentId.check(Schema.isMaxLength(ASSISTANT_CITATION_MAX_ID_LENGTH)),
  threadId: ThreadId.check(Schema.isMaxLength(ASSISTANT_CITATION_MAX_ID_LENGTH)),
  messageId: MessageId.check(Schema.isMaxLength(ASSISTANT_CITATION_MAX_ID_LENGTH)),
  text: Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(ASSISTANT_CITATION_MAX_TEXT_LENGTH),
  ),
  comment: Schema.optional(
    Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_MAX_COMMENT_LENGTH)),
  ),
  start: NonNegativeInt.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
  end: NonNegativeInt.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
  prefix: Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_CONTEXT_LENGTH)),
  suffix: Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_CONTEXT_LENGTH)),
}).check(
  Schema.makeFilter((citation) => citation.end > citation.start && citation.text.trim().length > 0),
);
export type AssistantCitation = typeof AssistantCitation.Type;

/**
 * A saved, cross-device bookmark of an assistant text range. Reuses
 * AssistantCitation verbatim for the anchor rather than inventing a second
 * anchoring format.
 */
export const AssistantThreadBookmark = Schema.Struct({
  id: ThreadBookmarkId,
  citation: AssistantCitation,
  createdAt: IsoDateTime,
});
export type AssistantThreadBookmark = typeof AssistantThreadBookmark.Type;
