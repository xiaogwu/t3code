import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionThreadBookmarkInput,
  DeleteProjectionThreadBookmarksByThreadInput,
  ListProjectionThreadBookmarksInput,
  ProjectionThreadBookmark,
  ProjectionThreadBookmarkRepository,
  type ProjectionThreadBookmarkRepositoryShape,
} from "../Services/ProjectionThreadBookmarks.ts";

const makeProjectionThreadBookmarkRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionThreadBookmarkRow = SqlSchema.void({
    Request: ProjectionThreadBookmark,
    execute: (row) => sql`
      INSERT INTO projection_thread_bookmarks (
        bookmark_id,
        thread_id,
        environment_id,
        message_id,
        text,
        comment,
        start_offset,
        end_offset,
        prefix,
        suffix,
        created_at
      )
      VALUES (
        ${row.bookmarkId},
        ${row.threadId},
        ${row.environmentId},
        ${row.messageId},
        ${row.text},
        ${row.comment},
        ${row.startOffset},
        ${row.endOffset},
        ${row.prefix},
        ${row.suffix},
        ${row.createdAt}
      )
      ON CONFLICT (bookmark_id)
      DO UPDATE SET
        thread_id = excluded.thread_id,
        environment_id = excluded.environment_id,
        message_id = excluded.message_id,
        text = excluded.text,
        comment = excluded.comment,
        start_offset = excluded.start_offset,
        end_offset = excluded.end_offset,
        prefix = excluded.prefix,
        suffix = excluded.suffix,
        created_at = excluded.created_at
    `,
  });

  const listProjectionThreadBookmarkRows = SqlSchema.findAll({
    Request: ListProjectionThreadBookmarksInput,
    Result: ProjectionThreadBookmark,
    execute: ({ threadId }) => sql`
      SELECT
        bookmark_id AS "bookmarkId",
        thread_id AS "threadId",
        environment_id AS "environmentId",
        message_id AS "messageId",
        text AS "text",
        comment AS "comment",
        start_offset AS "startOffset",
        end_offset AS "endOffset",
        prefix AS "prefix",
        suffix AS "suffix",
        created_at AS "createdAt"
      FROM projection_thread_bookmarks
      WHERE thread_id = ${threadId}
      ORDER BY created_at ASC, bookmark_id ASC
    `,
  });

  const deleteProjectionThreadBookmarkRow = SqlSchema.void({
    Request: DeleteProjectionThreadBookmarkInput,
    execute: ({ threadId, bookmarkId }) => sql`
      DELETE FROM projection_thread_bookmarks
      WHERE thread_id = ${threadId} AND bookmark_id = ${bookmarkId}
    `,
  });

  const deleteProjectionThreadBookmarkRows = SqlSchema.void({
    Request: DeleteProjectionThreadBookmarksByThreadInput,
    execute: ({ threadId }) => sql`
      DELETE FROM projection_thread_bookmarks
      WHERE thread_id = ${threadId}
    `,
  });

  const upsert: ProjectionThreadBookmarkRepositoryShape["upsert"] = (row) =>
    upsertProjectionThreadBookmarkRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadBookmarkRepository.upsert:query")),
    );

  const listByThreadId: ProjectionThreadBookmarkRepositoryShape["listByThreadId"] = (input) =>
    listProjectionThreadBookmarkRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadBookmarkRepository.listByThreadId:query"),
      ),
    );

  const deleteOne: ProjectionThreadBookmarkRepositoryShape["deleteOne"] = (input) =>
    deleteProjectionThreadBookmarkRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadBookmarkRepository.deleteOne:query")),
    );

  const deleteByThreadId: ProjectionThreadBookmarkRepositoryShape["deleteByThreadId"] = (input) =>
    deleteProjectionThreadBookmarkRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadBookmarkRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    listByThreadId,
    deleteOne,
    deleteByThreadId,
  } satisfies ProjectionThreadBookmarkRepositoryShape;
});

export const ProjectionThreadBookmarkRepositoryLive = Layer.effect(
  ProjectionThreadBookmarkRepository,
  makeProjectionThreadBookmarkRepository,
);
