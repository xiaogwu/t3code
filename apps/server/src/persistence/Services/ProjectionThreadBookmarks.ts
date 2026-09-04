import {
  EnvironmentId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ThreadBookmarkId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

/**
 * Row shape flattens AssistantThreadBookmark's nested citation into columns
 * (see the `_ProjectionThreadBookmarks` migration): one row per bookmark, so
 * a single removal is a single-row DELETE rather than a thread-wide
 * read-modify-write of a blob column.
 */
export const ProjectionThreadBookmark = Schema.Struct({
  bookmarkId: ThreadBookmarkId,
  threadId: ThreadId,
  environmentId: EnvironmentId,
  messageId: MessageId,
  text: TrimmedNonEmptyString,
  comment: Schema.NullOr(TrimmedNonEmptyString),
  startOffset: NonNegativeInt,
  endOffset: NonNegativeInt,
  prefix: Schema.String,
  suffix: Schema.String,
  createdAt: IsoDateTime,
});
export type ProjectionThreadBookmark = typeof ProjectionThreadBookmark.Type;

export const ListProjectionThreadBookmarksInput = Schema.Struct({
  threadId: ThreadId,
});
export type ListProjectionThreadBookmarksInput = typeof ListProjectionThreadBookmarksInput.Type;

export const DeleteProjectionThreadBookmarkInput = Schema.Struct({
  threadId: ThreadId,
  bookmarkId: ThreadBookmarkId,
});
export type DeleteProjectionThreadBookmarkInput = typeof DeleteProjectionThreadBookmarkInput.Type;

export const DeleteProjectionThreadBookmarksByThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionThreadBookmarksByThreadInput =
  typeof DeleteProjectionThreadBookmarksByThreadInput.Type;

export interface ProjectionThreadBookmarkRepositoryShape {
  readonly upsert: (
    bookmark: ProjectionThreadBookmark,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listByThreadId: (
    input: ListProjectionThreadBookmarksInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionThreadBookmark>, ProjectionRepositoryError>;
  // Single-row removal: bookmarks are a list, not a per-thread blob, so
  // clearing one entry must not read-modify-write the whole thread.
  readonly deleteOne: (
    input: DeleteProjectionThreadBookmarkInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteByThreadId: (
    input: DeleteProjectionThreadBookmarksByThreadInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionThreadBookmarkRepository extends Context.Service<
  ProjectionThreadBookmarkRepository,
  ProjectionThreadBookmarkRepositoryShape
>()("t3/persistence/Services/ProjectionThreadBookmarks/ProjectionThreadBookmarkRepository") {}
