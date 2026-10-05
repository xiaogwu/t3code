import { describe, expect, it } from "vite-plus/test";

import { CHAT_LIST_ANCHOR_OFFSET, resolveChatListAnchoredEndSpace } from "./chatList.js";

interface Row {
  readonly id: string;
  readonly anchorable: boolean;
}

const rows: ReadonlyArray<Row> = [
  { id: "first", anchorable: true },
  { id: "ignored", anchorable: false },
  { id: "latest", anchorable: true },
];

const getAnchorId = (row: Row) => (row.anchorable ? row.id : null);

describe("resolveChatListAnchoredEndSpace", () => {
  it("anchors only the first eligible row", () => {
    expect(resolveChatListAnchoredEndSpace(rows, "first", getAnchorId)).toEqual({
      anchorIndex: 0,
      anchorOffset: CHAT_LIST_ANCHOR_OFFSET,
    });
  });

  it("allows a surface to keep the anchor below its own header", () => {
    expect(
      resolveChatListAnchoredEndSpace(rows, "first", getAnchorId, {
        anchorOffset: 132,
      }),
    ).toEqual({
      anchorIndex: 0,
      anchorOffset: 132,
    });
  });

  it("does not reserve end space for later eligible rows", () => {
    expect(resolveChatListAnchoredEndSpace(rows, "latest", getAnchorId)).toBeUndefined();
  });

  it("skips ineligible rows before the first anchor", () => {
    expect(resolveChatListAnchoredEndSpace(rows.slice(1), "latest", getAnchorId)).toEqual({
      anchorIndex: 1,
      anchorOffset: CHAT_LIST_ANCHOR_OFFSET,
    });
  });

  it("ignores ineligible rows and missing anchors", () => {
    expect(resolveChatListAnchoredEndSpace(rows, "ignored", getAnchorId)).toBeUndefined();
    expect(resolveChatListAnchoredEndSpace(rows, "missing", getAnchorId)).toBeUndefined();
    expect(resolveChatListAnchoredEndSpace(rows, null, getAnchorId)).toBeUndefined();
  });
});

describe('resolveChatListAnchoredEndSpace with match: "latest"', () => {
  const latest = { match: "latest" } as const;

  it("anchors an eligible row that later rows follow", () => {
    expect(resolveChatListAnchoredEndSpace(rows, "latest", getAnchorId, latest)).toEqual({
      anchorIndex: 2,
      anchorOffset: CHAT_LIST_ANCHOR_OFFSET,
    });
  });

  it("still anchors the opening row", () => {
    expect(resolveChatListAnchoredEndSpace(rows, "first", getAnchorId, latest)).toEqual({
      anchorIndex: 0,
      anchorOffset: CHAT_LIST_ANCHOR_OFFSET,
    });
  });

  it("matches the last row carrying the anchor id when it repeats", () => {
    const repeated: ReadonlyArray<Row> = [
      { id: "dupe", anchorable: true },
      { id: "other", anchorable: true },
      { id: "dupe", anchorable: true },
    ];

    expect(resolveChatListAnchoredEndSpace(repeated, "dupe", getAnchorId, latest)).toEqual({
      anchorIndex: 2,
      anchorOffset: CHAT_LIST_ANCHOR_OFFSET,
    });
  });

  it("keeps honouring the caller's offset", () => {
    expect(
      resolveChatListAnchoredEndSpace(rows, "latest", getAnchorId, {
        ...latest,
        anchorOffset: 132,
      }),
    ).toEqual({ anchorIndex: 2, anchorOffset: 132 });
  });

  it("ignores ineligible rows and missing anchors", () => {
    expect(resolveChatListAnchoredEndSpace(rows, "ignored", getAnchorId, latest)).toBeUndefined();
    expect(resolveChatListAnchoredEndSpace(rows, "missing", getAnchorId, latest)).toBeUndefined();
    expect(resolveChatListAnchoredEndSpace(rows, null, getAnchorId, latest)).toBeUndefined();
  });
});
