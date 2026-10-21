import { describe, expect, it } from "vite-plus/test";

import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  canOperate: true,
  branch: null,
  projectFilter: null,
  isPinned: false,
  isSettled: false,
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
  },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

function ids(state: ThreadActionMenuState): string[] {
  return buildThreadActionMenuItems(state).map((item) => item.id);
}

describe("buildThreadActionMenuItems", () => {
  it.each([false, true])(
    "disables both lifecycle directions without permission (reversed: %s)",
    (reversed) => {
      const items = buildThreadActionMenuItems({
        ...baseState,
        canOperate: false,
        isPinned: reversed,
        isSettled: reversed,
        isSnoozed: reversed,
      });
      const expected = reversed
        ? [
            "unpin",
            "unsettle",
            "unsnooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ]
        : [
            "pin",
            "settle",
            "snooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ];
      expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(expected);
      expect(
        items.find((item) => item.id === "snooze")?.children?.every((child) => child.disabled) ??
          true,
      ).toBe(true);
    },
  );

  it("disables archive while the thread is running", () => {
    const archiveItem = buildThreadActionMenuItems({ ...baseState, isRunning: true }).find(
      (item) => item.id === "archive",
    );
    expect(archiveItem?.disabled).toBe(true);
  });

  it("offers Mark read instead of Mark unread once a thread reads as unread", () => {
    expect(
      buildThreadActionMenuItems({ ...baseState, isUnread: true }).find(
        (item) => item.id === "mark-read",
      ),
    ).toMatchObject({ label: "Mark read", icon: "mail-open" });
    expect(ids({ ...baseState, isUnread: true })).not.toContain("mark-unread");
    expect(ids(baseState)).toContain("mark-unread");
  });

  it("offers pinned move items only for a pinned thread on a reorder-capable server", () => {
    const pinnedState: ThreadActionMenuState = {
      ...baseState,
      isPinned: true,
      canMovePinUp: true,
      canMovePinDown: true,
      supports: { ...baseState.supports, pinReorder: true },
    };
    expect(ids(pinnedState)).toEqual(expect.arrayContaining(["move-pin-up", "move-pin-down"]));
    // Unpinned, or a server without the capability: no move items at all.
    expect(ids({ ...pinnedState, isPinned: false })).not.toContain("move-pin-up");
    expect(
      ids({ ...pinnedState, supports: { ...pinnedState.supports, pinReorder: false } }),
    ).not.toContain("move-pin-up");
    expect(ids({ ...baseState, isPinned: true })).not.toContain("move-pin-down");
  });

  it("disables the move item at each end of the pinned block", () => {
    const items = buildThreadActionMenuItems({
      ...baseState,
      isPinned: true,
      canMovePinUp: false,
      canMovePinDown: true,
      supports: { ...baseState.supports, pinReorder: true },
    });
    expect(items.find((item) => item.id === "move-pin-up")?.disabled).toBe(true);
    expect(items.find((item) => item.id === "move-pin-down")?.disabled).toBe(false);
  });

  it("offers the Until… custom snooze after the presets", () => {
    const snooze = buildThreadActionMenuItems({ ...baseState, canSnoozeNow: false }).find(
      (item) => item.id === "snooze",
    );
    expect(snooze?.children?.map((child) => child.id)).toEqual(["snooze:hour", "snooze-for"]);
    expect(snooze?.children?.at(-1)?.label).toBe("Until…");
  });
});
