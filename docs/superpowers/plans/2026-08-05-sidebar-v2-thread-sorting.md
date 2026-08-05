# Sidebar v2 Thread Sorting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users choose how Sidebar v2 orders threads — "Last user message" or "Created at" — on both web and mobile, matching the "Sort threads" control Sidebar v1 already has.

**Architecture:** Sidebar v2 currently hard-codes thread order to `createdAt` descending in one function per platform (`sortThreadsForSidebarV2` on web, `sortThreadsForListV2` on mobile). Both get a required `sortOrder` parameter and compute their timestamp via the already-shared `getThreadSortTimestamp` helper. Web reads the existing `sidebarThreadSortOrder` client setting and renders a new shared `SidebarSortMenu` component lifted out of `Sidebar.tsx`. Mobile already has a "Sort threads" submenu that is deliberately hidden when v2 is on; we un-hide it and thread the value through.

**Tech Stack:** TypeScript, React 19, Effect (`effect/Array`, `effect/Order`, `effect/Schema`), Base UI menu primitives, Tailwind, React Native / Expo + Hermes (mobile), `vite-plus` test runner (`vp test run`).

## Global Constraints

- **Scope is thread sorting only.** Do NOT add "Sort projects" or a "Visible threads" stepper to Sidebar v2. Sidebar v1 keeps all three of its controls exactly as they are today.
- **No changes to `packages/contracts`.** The `sidebarThreadSortOrder` setting already exists with type `SidebarThreadSortOrder = "updated_at" | "created_at"` and default `"updated_at"`. Reuse it. Adding a settings key would force churn in `apps/desktop/src/settings/DesktopClientSettings.test.ts`, which this plan must not touch.
- **`"updated_at"` means "Last user message", not "record updated".** This is intentional and pre-existing: `getThreadSortTimestamp` maps `"updated_at"` to the latest _user message_ timestamp. Never relabel it in the UI as anything but "Last user message".
- **Hermes has no `Array.prototype.toSorted`.** In `apps/mobile/**`, always use `[...arr].sort(...)`, never `.toSorted(...)`. Web may use `.toSorted(...)`.
- **Preserve the existing ascending id tie-break in v2.** Both v2 sort functions break timestamp ties with `left.id.localeCompare(right.id)` (ascending). The shared `sortThreads` helper in `threadSort.ts` uses _descending_ id. Do NOT swap v2 to `sortThreads`; keep each v2 function's own comparator and only replace how the timestamp is derived. An existing test asserts the ascending order `["a", "b"]`.
- **Do not modify** `sortSettledThreadsForSidebarV2` (web) or the settled/snoozed comparators (mobile). Settled threads sort by settlement time and snoozed by wake time; those are separate lifecycle orderings, not user-selectable sort.
- Run all commands from the repo root: `/Users/seanwu/.t3/custom-build/repo`.
- **Test command is `pnpm exec vp test run <paths>`.** Bare `vitest` and `pnpm exec vitest` both fail in this monorepo with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`.
- Node must be 24.19.0+. If `node -v` reports older, prepend to PATH: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`.

---

## Setup

- [ ] **Step 0: Create the topic branch**

The repo's `custom` branch is the integration branch and must not be committed to directly.

```bash
cd /Users/seanwu/.t3/custom-build/repo
git checkout -b ui/sidebar-v2-thread-sort v0.0.32-nightly.20260805.1006
```

Verify you are on a clean tree at the right base:

```bash
git status --porcelain   # expect no output
git rev-parse --short HEAD
```

---

## File Structure

| File                                                           | Responsibility                                                            | Action     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------- |
| `apps/web/src/components/Sidebar.logic.ts`                     | `sortThreadsForSidebarV2` — web v2 thread comparator                      | Modify     |
| `apps/web/src/components/Sidebar.logic.test.ts`                | Tests for the above                                                       | Modify     |
| `apps/web/src/components/sidebar/SidebarSortMenu.tsx`          | Shared "Sort threads" popover, usable by v1 and v2                        | **Create** |
| `apps/web/src/components/SidebarV2.tsx`                        | Reads the setting, renders the menu, passes `sortOrder` to the comparator | Modify     |
| `apps/mobile/src/features/threads/threadListV2.ts`             | `sortThreadsForListV2` + `buildThreadListV2Items`                         | Modify     |
| `apps/mobile/src/features/threads/threadListV2.test.ts`        | Tests for the above                                                       | Modify     |
| `apps/mobile/src/features/home/HomeScreen.tsx`                 | Passes `threadSortOrder` into the list builder                            | Modify     |
| `apps/mobile/src/features/threads/ThreadNavigationSidebar.tsx` | Same, plus un-gates the "Sort threads" submenu                            | Modify     |
| `apps/mobile/src/features/home/HomeHeader.tsx`                 | Un-gates the "Sort threads" submenu (Android + iOS)                       | Modify     |
| `apps/mobile/src/features/home/home-list-filter-menu.ts`       | iOS menu builder — split the sort gate                                    | Modify     |

Task order: web logic → web UI → mobile logic → mobile UI. Web and mobile are independent after their shared dependency (`getThreadSortTimestamp`) is confirmed unchanged, but doing web first gives you a working reference.

---

## Task 1: Web comparator accepts a sort order

**Files:**

- Modify: `apps/web/src/components/Sidebar.logic.ts:483-495`
- Test: `apps/web/src/components/Sidebar.logic.test.ts:715-740`

**Interfaces:**

- Consumes: `getThreadSortTimestamp(thread, sortOrder)` from `@t3tools/client-runtime/state/thread-sort`. Signature:
  ```ts
  export function getThreadSortTimestamp(
    thread: ThreadSortInput,
    sortOrder: SidebarThreadSortOrder | Exclude<SidebarProjectSortOrder, "manual">,
  ): number;
  ```
  where `ThreadSortInput` is:
  ```ts
  export interface ThreadSortInput {
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly latestUserMessageAt?: string | null;
    readonly messages?: ReadonlyArray<{ readonly createdAt: string; readonly role: string }>;
  }
  ```
- Produces: `sortThreadsForSidebarV2(threads, sortOrder)` — a **required** second parameter of type `SidebarThreadSortOrder` (`"updated_at" | "created_at"`). Task 2 calls this.

**Background:** the generic constraint widens from `{ id, createdAt }` to also require `updatedAt`, because `getThreadSortTimestamp` needs it. Every real caller passes `EnvironmentThreadShell`, which has `updatedAt`. Only the two existing unit tests construct bare objects, and Step 1 updates them.

- [ ] **Step 1: Update the existing tests and add a new one**

Open `apps/web/src/components/Sidebar.logic.test.ts`. Replace the entire `describe("sortThreadsForSidebarV2", ...)` block (starts at line 715, ends just before `describe("sortSettledThreadsForSidebarV2"`) with:

```ts
describe("sortThreadsForSidebarV2", () => {
  const sortable = (input: {
    id: string;
    createdAt: string;
    updatedAt?: string;
    latestUserMessageAt?: string | null;
  }) => ({
    id: input.id,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
    latestUserMessageAt: input.latestUserMessageAt ?? null,
  });

  it("orders by creation time, newest first, ignoring activity", () => {
    const sorted = sortThreadsForSidebarV2(
      [
        sortable({ id: "oldest", createdAt: "2026-03-09T08:00:00.000Z" }),
        sortable({ id: "newest", createdAt: "2026-03-09T12:00:00.000Z" }),
        sortable({ id: "middle", createdAt: "2026-03-09T10:00:00.000Z" }),
      ],
      "created_at",
    );

    expect(sorted.map((thread) => thread.id)).toEqual(["newest", "middle", "oldest"]);
  });

  it("breaks creation-time ties by id so the order is stable", () => {
    const sorted = sortThreadsForSidebarV2(
      [
        sortable({ id: "b", createdAt: "2026-03-09T10:00:00.000Z" }),
        sortable({ id: "a", createdAt: "2026-03-09T10:00:00.000Z" }),
      ],
      "created_at",
    );

    expect(sorted.map((thread) => thread.id)).toEqual(["a", "b"]);
  });

  it("orders by latest user message when the sort order is updated_at", () => {
    // Creation order is stale, chatty, quiet — latest-user-message order is
    // the reverse, which is what proves the sort order is actually applied.
    const threads = [
      sortable({
        id: "stale",
        createdAt: "2026-03-09T12:00:00.000Z",
        latestUserMessageAt: "2026-03-09T09:00:00.000Z",
      }),
      sortable({
        id: "chatty",
        createdAt: "2026-03-09T10:00:00.000Z",
        latestUserMessageAt: "2026-03-09T15:00:00.000Z",
      }),
      sortable({
        id: "quiet",
        createdAt: "2026-03-09T08:00:00.000Z",
        latestUserMessageAt: "2026-03-09T11:00:00.000Z",
      }),
    ];

    expect(sortThreadsForSidebarV2(threads, "updated_at").map((thread) => thread.id)).toEqual([
      "chatty",
      "quiet",
      "stale",
    ]);
    expect(sortThreadsForSidebarV2(threads, "created_at").map((thread) => thread.id)).toEqual([
      "stale",
      "chatty",
      "quiet",
    ]);
  });

  it("falls back to updatedAt when a thread has no user message", () => {
    const sorted = sortThreadsForSidebarV2(
      [
        sortable({
          id: "older-activity",
          createdAt: "2026-03-09T08:00:00.000Z",
          updatedAt: "2026-03-09T09:00:00.000Z",
        }),
        sortable({
          id: "newer-activity",
          createdAt: "2026-03-09T07:00:00.000Z",
          updatedAt: "2026-03-09T13:00:00.000Z",
        }),
      ],
      "updated_at",
    );

    expect(sorted.map((thread) => thread.id)).toEqual(["newer-activity", "older-activity"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm exec vp test run apps/web/src/components/Sidebar.logic.test.ts
```

Expected: FAIL. The two new tests fail because `sortThreadsForSidebarV2` ignores its second argument, and TypeScript reports "Expected 1 arguments, but got 2."

- [ ] **Step 3: Add the parameter to the comparator**

In `apps/web/src/components/Sidebar.logic.ts`, find this block at line 483:

```ts
// v2 sort: static creation order, newest thread on top. Activity NEVER
// reorders the list — a row holds its position from open until settled, so
// the screen only moves at lifecycle transitions. Status (including pending
// approval) is carried by each card's edge strip, not by position.
export function sortThreadsForSidebarV2<
  T extends { readonly id: string; readonly createdAt: string },
>(threads: readonly T[]): T[] {
  return [...threads].toSorted(
    (left, right) =>
      parseTimestampMs(right.createdAt) - parseTimestampMs(left.createdAt) ||
      left.id.localeCompare(right.id),
  );
}
```

Replace it with:

```ts
/**
 * v2 thread order. `"created_at"` is the original v2 behaviour: static
 * creation order, newest on top, where activity NEVER reorders the list, so a
 * row holds its position from open until settled and the screen only moves at
 * lifecycle transitions. `"updated_at"` opts into v1's "Last user message"
 * ordering for users who want the list to track recency instead.
 *
 * Status (including pending approval) is carried by each card's edge strip,
 * not by position, under either order.
 *
 * The id tie-break is ASCENDING, unlike the shared `sortThreads` helper. That
 * is deliberate: v2 has always tie-broken this way and the order is only
 * required to be stable, not to match v1.
 */
export function sortThreadsForSidebarV2<
  T extends {
    readonly id: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly latestUserMessageAt?: string | null;
  },
>(threads: readonly T[], sortOrder: SidebarThreadSortOrder): T[] {
  return [...threads].toSorted(
    (left, right) =>
      getThreadSortTimestamp(right, sortOrder) - getThreadSortTimestamp(left, sortOrder) ||
      left.id.localeCompare(right.id),
  );
}
```

Add the import for `getThreadSortTimestamp` at the top of the file, with the other `@t3tools/*` imports:

```ts
import { getThreadSortTimestamp } from "@t3tools/client-runtime/state/thread-sort";
```

Line 2 of the file is currently:

```ts
import type { ContextMenuItem } from "@t3tools/contracts";
```

Extend it rather than adding a second import statement:

```ts
import type { ContextMenuItem, SidebarThreadSortOrder } from "@t3tools/contracts";
```

Note: `parseTimestampMs` (defined at `Sidebar.logic.ts:452`) is still used elsewhere in the file. Do not delete it.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm exec vp test run apps/web/src/components/Sidebar.logic.test.ts
```

Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Sidebar.logic.ts apps/web/src/components/Sidebar.logic.test.ts
git commit -m "feat(web): let the sidebar v2 thread comparator take a sort order"
```

---

## Task 2: Shared sort menu and Sidebar v2 wiring

**Files:**

- Create: `apps/web/src/components/sidebar/SidebarSortMenu.tsx`
- Modify: `apps/web/src/components/SidebarV2.tsx`

**Interfaces:**

- Consumes: `sortThreadsForSidebarV2(threads, sortOrder)` from Task 1.
- Produces: `SidebarSortMenu`, `SIDEBAR_THREAD_SORT_LABELS` from the new file. Nothing later depends on these.

**Background:** `ProjectSortMenu` at `Sidebar.tsx:2569` is a private function containing all three v1 controls. Rather than lift and parameterize it (which risks regressing v1), create a new, smaller component with only the thread-sort group. **Leave `Sidebar.tsx` completely untouched in this task** — v1 keeps its own menu. This means `SIDEBAR_THREAD_SORT_LABELS` is briefly duplicated between `Sidebar.tsx:213` and the new file; that is an accepted, deliberate trade to keep v1 risk at zero.

- [ ] **Step 1: Create the shared menu component**

Create `apps/web/src/components/sidebar/SidebarSortMenu.tsx` with exactly this content:

```tsx
import type { SidebarThreadSortOrder } from "@t3tools/contracts";
import { ArrowUpDownIcon } from "lucide-react";

import { Menu, MenuGroup, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * "updated_at" is labelled by what it actually sorts on — the latest user
 * message — rather than by the record's `updatedAt` column, which would be a
 * misleading name for the behaviour. Matches the v1 menu wording.
 */
export const SIDEBAR_THREAD_SORT_LABELS: Record<SidebarThreadSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
};

/**
 * Thread-sort popover for Sidebar v2. v1's menu also carries project sort and
 * a visible-thread count; v2 has neither a per-project grouping nor a preview
 * cap, so it exposes thread order alone.
 */
export function SidebarSortMenu({
  threadSortOrder,
  onThreadSortOrderChange,
}: {
  threadSortOrder: SidebarThreadSortOrder;
  onThreadSortOrderChange: (sortOrder: SidebarThreadSortOrder) => void;
}) {
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger className="inline-flex h-6 min-w-6 cursor-pointer items-center justify-center rounded-md px-[calc(--spacing(1)-1px)] text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground" />
          }
          aria-label="Sort threads"
        >
          <ArrowUpDownIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Sort threads</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="bottom" className="min-w-52">
        <MenuGroup>
          <div className="px-2 py-1 sm:text-xs font-medium text-muted-foreground">Sort threads</div>
          <MenuRadioGroup
            value={threadSortOrder}
            onValueChange={(value) => {
              onThreadSortOrderChange(value as SidebarThreadSortOrder);
            }}
          >
            {(
              Object.entries(SIDEBAR_THREAD_SORT_LABELS) as Array<[SidebarThreadSortOrder, string]>
            ).map(([value, label]) => (
              <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
                {label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}
```

- [ ] **Step 2: Read the setting in SidebarV2**

In `apps/web/src/components/SidebarV2.tsx`, find the settings reads around line 1198-1201:

```tsx
const autoSettleAfterDays = useClientSettings((s) => s.sidebarAutoSettleAfterDays);
const confirmThreadDelete = useClientSettings((s) => s.confirmThreadDelete);
const sidebarProjectSortOrder = useClientSettings((s) => s.sidebarProjectSortOrder);
```

Add one line immediately after `sidebarProjectSortOrder`:

```tsx
const sidebarThreadSortOrder = useClientSettings((s) => s.sidebarThreadSortOrder);
```

- [ ] **Step 3: Pass the sort order to the comparator**

Find lines 1644-1645:

```tsx
        pinnedThreads: sortThreadsForSidebarV2(pinned),
        activeThreads: sortThreadsForSidebarV2(active),
```

Replace with:

```tsx
        pinnedThreads: sortThreadsForSidebarV2(pinned, sidebarThreadSortOrder),
        activeThreads: sortThreadsForSidebarV2(active, sidebarThreadSortOrder),
```

Leave line 1652 (`sortSettledThreadsForSidebarV2(settled)`) unchanged.

Now find the dependency array of the enclosing `useMemo`. It begins a few lines after line 1652 — scroll down to the `}, [` that closes this memo. Add `sidebarThreadSortOrder` to that array, keeping the existing alphabetical-ish grouping. If you miss this, the list will not re-sort when the user changes the setting; the lint rule `react-hooks/exhaustive-deps` should also flag it.

- [ ] **Step 4: Render the menu in the header**

Add the import near the other local component imports (there is already an import from `"./sidebar/SidebarChrome"` around line 162 — put this next to it):

```tsx
import { SidebarSortMenu } from "./sidebar/SidebarSortMenu";
```

Then find the header block. Around line 2707 there is a `<div className="shrink-0">` that wraps the "New thread" `Tooltip`. Insert a sibling `<div>` **immediately before** that `shrink-0` div:

```tsx
<div className="shrink-0">
  <SidebarSortMenu
    threadSortOrder={sidebarThreadSortOrder}
    onThreadSortOrderChange={(sidebarThreadSortOrder) => {
      updateSettings({ sidebarThreadSortOrder });
    }}
  />
</div>
```

`updateSettings` is already in scope — it is defined at line 1220 as `const updateSettings = useUpdateClientSettings();`.

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm typecheck
pnpm exec vp lint apps/web/src/components/SidebarV2.tsx apps/web/src/components/sidebar/SidebarSortMenu.tsx
```

Expected: typecheck exit 0. Lint reports 0 errors. Note there are **3 pre-existing warnings** elsewhere in the repo (`SidebarUpdatePill.tsx:48:57`, `CommandPalette.tsx:927`, `CommandPalette.tsx:951`) — those are not yours and must not be "fixed" as part of this work.

- [ ] **Step 6: Run the full web settings and sidebar test suites**

```bash
pnpm exec vp test run apps/web/src/components apps/web/src/lib
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/sidebar/SidebarSortMenu.tsx apps/web/src/components/SidebarV2.tsx
git commit -m "feat(web): add a thread sort control to sidebar v2"
```

---

## Task 3: Mobile comparator accepts a sort order

**Files:**

- Modify: `apps/mobile/src/features/threads/threadListV2.ts:166-176` and `:312-...` and `:415`, `:447`
- Test: `apps/mobile/src/features/threads/threadListV2.test.ts:250-259`

**Interfaces:**

- Consumes: `getThreadSortTimestamp` from `@t3tools/client-runtime/state/thread-sort` (same helper as Task 1; the mobile app already imports from `@t3tools/client-runtime/state/*`, so the path resolves).
- Produces:
  - `sortThreadsForListV2(threads, sortOrder)` — required second parameter, type `SidebarThreadSortOrder`.
  - `buildThreadListV2Items({ ..., threadSortOrder })` — a new **optional** field on the input object. Optional so the ~20 existing test call sites keep compiling. Task 4 passes it.

**Read this before writing any code — the default value is a trap.** `buildThreadListV2Items`'s `threadSortOrder` must default to the string literal `"created_at"`, NOT to `DEFAULT_SIDEBAR_THREAD_SORT_ORDER`. The contract default is `"updated_at"`, but v2's existing hard-coded behaviour is creation order. Defaulting to the contract value would silently change the order every existing test and every un-migrated caller sees. Task 4 passes the user's real choice explicitly at both production call sites, so this default only ever applies in tests.

- [ ] **Step 1: Update the existing test and add new ones**

In `apps/mobile/src/features/threads/threadListV2.test.ts`, replace the whole `describe("sortThreadsForListV2", ...)` block (lines 250-259) with:

```ts
describe("sortThreadsForListV2", () => {
  const sortable = (input: {
    id: string;
    createdAt: string;
    updatedAt?: string;
    latestUserMessageAt?: string | null;
  }) => ({
    id: input.id,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
    latestUserMessageAt: input.latestUserMessageAt ?? null,
  });

  it("orders by creation time, newest first, ignoring activity", () => {
    const sorted = sortThreadsForListV2(
      [
        sortable({ id: "oldest", createdAt: "2026-06-01T08:00:00.000Z" }),
        sortable({ id: "newest", createdAt: "2026-06-01T12:00:00.000Z" }),
        sortable({ id: "middle", createdAt: "2026-06-01T10:00:00.000Z" }),
      ],
      "created_at",
    );
    expect(sorted.map((thread) => thread.id)).toEqual(["newest", "middle", "oldest"]);
  });

  it("orders by latest user message when the sort order is updated_at", () => {
    const threads = [
      sortable({
        id: "stale",
        createdAt: "2026-06-01T12:00:00.000Z",
        latestUserMessageAt: "2026-06-01T09:00:00.000Z",
      }),
      sortable({
        id: "chatty",
        createdAt: "2026-06-01T10:00:00.000Z",
        latestUserMessageAt: "2026-06-01T15:00:00.000Z",
      }),
    ];
    expect(sortThreadsForListV2(threads, "updated_at").map((thread) => thread.id)).toEqual([
      "chatty",
      "stale",
    ]);
    expect(sortThreadsForListV2(threads, "created_at").map((thread) => thread.id)).toEqual([
      "stale",
      "chatty",
    ]);
  });

  it("breaks ties by id so the order is stable", () => {
    const sorted = sortThreadsForListV2(
      [
        sortable({ id: "b", createdAt: "2026-06-01T10:00:00.000Z" }),
        sortable({ id: "a", createdAt: "2026-06-01T10:00:00.000Z" }),
      ],
      "created_at",
    );
    expect(sorted.map((thread) => thread.id)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vp test run apps/mobile/src/features/threads/threadListV2.test.ts
```

Expected: FAIL — "Expected 1 arguments, but got 2" plus the `updated_at` assertion failing.

- [ ] **Step 3: Add the parameter to the mobile comparator**

In `apps/mobile/src/features/threads/threadListV2.ts`, find lines 161-176:

```ts
/**
 * v2 sort: static creation order, newest thread on top. Activity NEVER
 * reorders the list — a row holds its position from open until settled, so
 * the screen only moves at lifecycle transitions. Mirrors web's
 * sortThreadsForSidebarV2.
 */
export function sortThreadsForListV2<T extends { readonly id: string; readonly createdAt: string }>(
  threads: readonly T[],
): T[] {
  // .sort() on a copy, not .toSorted(): Hermes doesn't ship the ES2023
  // change-by-copy array methods.
  return [...threads].sort(
    (left, right) =>
      parseTimestampMs(right.createdAt) - parseTimestampMs(left.createdAt) ||
      left.id.localeCompare(right.id),
  );
}
```

Replace with:

```ts
/**
 * v2 thread order. `"created_at"` is the original v2 behaviour: static
 * creation order, newest on top, where activity NEVER reorders the list.
 * `"updated_at"` opts into "Last user message" ordering. Mirrors web's
 * sortThreadsForSidebarV2, including its ascending id tie-break.
 */
export function sortThreadsForListV2<
  T extends {
    readonly id: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly latestUserMessageAt?: string | null;
  },
>(threads: readonly T[], sortOrder: SidebarThreadSortOrder): T[] {
  // .sort() on a copy, not .toSorted(): Hermes doesn't ship the ES2023
  // change-by-copy array methods.
  return [...threads].sort(
    (left, right) =>
      getThreadSortTimestamp(right, sortOrder) - getThreadSortTimestamp(left, sortOrder) ||
      left.id.localeCompare(right.id),
  );
}
```

Add the value import next to the existing `@t3tools/client-runtime/state/thread-settled` import at the top of the file:

```ts
import { getThreadSortTimestamp } from "@t3tools/client-runtime/state/thread-sort";
```

Line 12 of the file is currently:

```ts
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
```

Extend it rather than adding a second import statement:

```ts
import type { EnvironmentId, ProjectId, SidebarThreadSortOrder } from "@t3tools/contracts";
```

Do NOT import `DEFAULT_SIDEBAR_THREAD_SORT_ORDER` here — see the trap note at the top of this task.

Do NOT delete `parseTimestampMs` — the snoozed comparator at line 416 still uses it.

- [ ] **Step 4: Thread the sort order through the list builder**

In the same file, find the `buildThreadListV2Items` input type starting at line 312. Add this field immediately after the `readonly autoSettleAfterDays?: number;` line:

```ts
  /** Thread order for the pinned and active blocks. Defaults to the contract
      default so existing callers and tests keep their behaviour. Settled and
      snoozed blocks are unaffected: they sort by settlement and wake time. */
  readonly threadSortOrder?: SidebarThreadSortOrder;
```

Inside the function body, add a local near the top where other `input.*` defaults are resolved (for example next to where `settledLimit` is derived around line 431):

```ts
// "created_at" — v2's original fixed order — NOT the contract default of
// "updated_at". See the trap note at the top of this task.
const threadSortOrder = input.threadSortOrder ?? "created_at";
```

Then update the two call sites:

Line 415:

```ts
const orderedActive = sortThreadsForListV2(active, threadSortOrder);
```

Line 447:

```ts
  for (const thread of sortThreadsForListV2(pinned, threadSortOrder)) {
```

Leave the snoozed sort (line 416) and the settled sort (line 429) exactly as they are.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm exec vp test run apps/mobile/src/features/threads/threadListV2.test.ts
```

Expected: PASS. All ~30 existing `buildThreadListV2Items` tests must still pass **without any edits**, because `threadSortOrder` is optional and defaults to `"created_at"`, reproducing the previous behaviour exactly.

If any existing `buildThreadListV2Items` test fails, you defaulted to the contract value instead of `"created_at"`. Go back and fix the default rather than editing the tests.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/features/threads/threadListV2.ts apps/mobile/src/features/threads/threadListV2.test.ts
git commit -m "feat(mobile): let the thread list v2 comparator take a sort order"
```

---

## Task 4: Mobile UI — pass the choice in and un-hide the menu

**Files:**

- Modify: `apps/mobile/src/features/home/HomeScreen.tsx:614`
- Modify: `apps/mobile/src/features/threads/ThreadNavigationSidebar.tsx:506`, `:650-671`
- Modify: `apps/mobile/src/features/home/HomeHeader.tsx:115-136`, `:305-308`
- Modify: `apps/mobile/src/features/home/home-list-filter-menu.ts:98-119`

**Interfaces:**

- Consumes: `buildThreadListV2Items({ ..., threadSortOrder })` from Task 3.
- Produces: nothing further.

**Background:** mobile already has a working "Sort threads" submenu wired to `options.threadSortOrder` (from `HomeListOptions`, `home-list-options.ts:27`). It is currently hidden whenever Thread List v2 is on, because v2 ignored the setting. Now that v2 honours it, un-hide **only** the thread-sort submenu. "Sort projects" stays hidden under v2 — v2 has no project-ordered sections for it to affect.

There are three separate menus to update: Android's `MenuAction[]` in `HomeHeader.tsx`, iOS's builder in `home-list-filter-menu.ts`, and the split-view sidebar's own `MenuAction[]` in `ThreadNavigationSidebar.tsx`.

- [ ] **Step 1: Pass the sort order at both list-builder call sites**

In `apps/mobile/src/features/home/HomeScreen.tsx`, find the `buildThreadListV2Items({` call at line 614. Add one field (put it just after `snoozeEnvironmentIds,`):

```tsx
      threadSortOrder: props.threadSortOrder,
```

`props.threadSortOrder` already exists — it is declared at line 92 of the same file. Then add `props.threadSortOrder` to the enclosing `useMemo` dependency array (the `}, [` that follows the call).

In `apps/mobile/src/features/threads/ThreadNavigationSidebar.tsx`, find the `buildThreadListV2Items({` call at line 506 and add:

```tsx
      threadSortOrder: options.threadSortOrder,
```

`options` comes from `useHomeListOptions(...)` at line 229. Add `options.threadSortOrder` to that memo's dependency array too.

- [ ] **Step 2: Un-hide the Android home menu's thread-sort submenu**

In `apps/mobile/src/features/home/HomeHeader.tsx`, inside `AndroidHomeHeader`, find this block (starts around line 115):

```tsx
      ...(threadListV2Enabled
        ? []
        : ([
            {
              id: "project-sort",
              title: "Sort projects",
              subactions: PROJECT_SORT_OPTIONS.map((option) => ({
                id: `project-sort:${option.value}`,
                title: option.label,
                state: checkedMenuState(props.projectSortOrder === option.value),
              })),
            },
            {
              id: "thread-sort",
              title: "Sort threads",
              subactions: THREAD_SORT_OPTIONS.map((option) => ({
                id: `thread-sort:${option.value}`,
                title: option.label,
                state: checkedMenuState(props.threadSortOrder === option.value),
              })),
            },
          ] satisfies MenuAction[])),
```

Replace it with:

```tsx
      // Project sort has no effect under v2 — it has no project-ordered
      // sections — but thread sort does, so only the former stays hidden.
      ...(threadListV2Enabled
        ? []
        : ([
            {
              id: "project-sort",
              title: "Sort projects",
              subactions: PROJECT_SORT_OPTIONS.map((option) => ({
                id: `project-sort:${option.value}`,
                title: option.label,
                state: checkedMenuState(props.projectSortOrder === option.value),
              })),
            },
          ] satisfies MenuAction[])),
      {
        id: "thread-sort",
        title: "Sort threads",
        subactions: THREAD_SORT_OPTIONS.map((option) => ({
          id: `thread-sort:${option.value}`,
          title: option.label,
          state: checkedMenuState(props.threadSortOrder === option.value),
        })),
      },
```

Also update `hasCustomListOptions` a few lines above (line 75). It currently reads:

```tsx
const hasCustomListOptions = threadListV2Enabled
  ? props.selectedEnvironmentId !== null || props.selectedProjectKey !== null
  : hasCustomHomeListOptions(props);
```

Change the v2 branch so a non-default thread sort also counts as "customized":

```tsx
const hasCustomListOptions = threadListV2Enabled
  ? props.selectedEnvironmentId !== null ||
    props.selectedProjectKey !== null ||
    props.threadSortOrder !== DEFAULT_SIDEBAR_THREAD_SORT_ORDER
  : hasCustomHomeListOptions(props);
```

Add the import at the top of the file if it is not already present:

```tsx
import { DEFAULT_SIDEBAR_THREAD_SORT_ORDER } from "@t3tools/contracts";
```

Note the comment above `threadListV2Enabled` at line 72-74 says the sort controls "would be silently ignored." Update it to say only project sort is ignored.

- [ ] **Step 3: Un-hide the iOS home menu's thread-sort submenu**

In `apps/mobile/src/features/home/home-list-filter-menu.ts`, find the `if (props.listOrganization !== false) {` block at line 98. It currently pushes both submenus. Restructure so thread sort is pushed unconditionally:

```ts
if (props.listOrganization !== false) {
  items.push({
    type: "submenu",
    title: "Sort projects",
    items: PROJECT_SORT_OPTIONS.map((option) => ({
      type: "action",
      title: option.label,
      state: props.projectSortOrder === option.value ? "on" : "off",
      onPress: () => props.onProjectSortOrderChange(option.value),
    })),
  });
}

// Thread sort applies under both list versions.
items.push({
  type: "submenu",
  title: "Sort threads",
  items: THREAD_SORT_OPTIONS.map((option) => ({
    type: "action",
    title: option.label,
    state: props.threadSortOrder === option.value ? "on" : "off",
    onPress: () => props.onThreadSortOrderChange(option.value),
  })),
});
```

Watch the types: the original used a multi-argument `items.push(a, b)` whose object literals were contextually typed. Splitting into two single-argument `push` calls preserves that, but if TypeScript complains about the `type:` or `state:` string literals widening, add `as const` to those fields or annotate the pushed object with the element type of `items`.

In `IosHomeHeader` (line 296-308 of `HomeHeader.tsx`), apply the same `hasCustomListOptions` change as Step 2. The `listOrganization: !threadListV2Enabled` line stays as-is — it now gates project sort only, which is correct.

- [ ] **Step 4: Un-hide the split-view sidebar's thread-sort submenu**

In `apps/mobile/src/features/threads/ThreadNavigationSidebar.tsx`, find the block at line 650 (it is the same shape as Step 2's) and apply the identical transformation: keep `project-sort` inside the `threadListV2Enabled ? [] : [...]` spread, and hoist `thread-sort` out to be unconditional. Use `options.projectSortOrder` / `options.threadSortOrder` (not `props.*`) — this file reads from `options`.

Then check `filterCustomized` at line 1093 and apply the same `!== DEFAULT_SIDEBAR_THREAD_SORT_ORDER` addition to its v2 branch.

Verify the action handler still works: `handleListMenuAction` (around line 675) already parses ids prefixed `thread-sort:` and looks the value up via `THREAD_SORT_OPTIONS.find(...)` at line 707. Since the ids are unchanged, no handler change is needed. Confirm by reading that function; do not assume.

- [ ] **Step 5: Typecheck, lint, and test**

```bash
pnpm typecheck
pnpm exec vp lint apps/mobile/src/features/home apps/mobile/src/features/threads
pnpm exec vp test run apps/mobile/src/features/threads apps/mobile/src/features/home
```

Expected: typecheck exit 0, lint 0 errors, tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src
git commit -m "feat(mobile): add a thread sort control to thread list v2"
```

---

## Task 5: Full verification

- [ ] **Step 1: Run the whole affected test surface**

```bash
pnpm exec vp test run apps/web/src apps/mobile/src packages/client-runtime/src packages/contracts/src
```

Expected: PASS, zero failures. If `packages/client-runtime` or `packages/contracts` tests fail, you changed something you should not have — neither package should be modified by this plan.

- [ ] **Step 2: Format and lint the whole repo**

```bash
pnpm exec vp fmt --check
pnpm exec vp lint
```

Expected: `fmt --check` clean. `vp lint` reports 0 errors and exactly the 3 pre-existing warnings named in the Global Constraints. If `fmt --check` fails, run `pnpm exec vp fmt` and amend your last commit.

- [ ] **Step 3: Confirm the diff touches only the intended files**

```bash
git diff --stat v0.0.32-nightly.20260805.1006..HEAD
```

Expected: exactly the 10 files in the File Structure table, no more. In particular `packages/contracts/src/settings.ts` and `apps/desktop/src/settings/DesktopClientSettings.test.ts` must NOT appear.

- [ ] **Step 4: Manual smoke test**

Sidebar v2 must be enabled in Settings → Beta for any of this to be visible.

Web:

1. Launch the app, enable Sidebar v2 if it is off.
2. Confirm an up/down arrow button appears in the sidebar header, left of the "New thread" pencil.
3. Open it. Confirm exactly one group, "Sort threads", with two radio items and no project-sort or visible-threads controls.
4. Select "Last user message". Confirm the thread list reorders so the most recently messaged thread is on top, and that pinned threads reorder within their own block.
5. Post a message in a thread lower in the list. Confirm it jumps to the top under "Last user message" and does NOT move under "Created at".
6. Reload the app. Confirm the choice persisted.
7. Confirm the settled and snoozed sections did not change order under either setting.

Mobile (iOS simulator or Android emulator):

1. Open the home thread list with Thread List v2 on.
2. Open the filter/options menu. Confirm "Sort threads" is present and "Sort projects" is absent.
3. Switch between the two options and confirm the active and pinned blocks reorder.
4. Repeat in the split-view sidebar (iPad or a wide layout) to cover `ThreadNavigationSidebar`.

- [ ] **Step 5: Report**

State plainly which of the above passed, and paste the actual output of the Step 1 test run and Step 3 diffstat. If any manual step could not be performed (for example no simulator available), say so explicitly rather than omitting it.

---

## Notes for the implementer

- **Do not "fix" Sidebar v1.** If you notice duplication between `SIDEBAR_THREAD_SORT_LABELS` in `Sidebar.tsx:213` and the new `SidebarSortMenu.tsx`, leave it. Deduplicating means editing v1, which is out of scope and carries regression risk for three controls this plan does not test.
- **The `"updated_at"` naming is a known wart, not a bug.** It is the contract's literal and appears in persisted user settings. Renaming it would be a migration.
- **If a step's line number does not match what you find,** the file has drifted. Search for the quoted code instead of trusting the number, and say so in your report.
- **If `getThreadSortTimestamp` produces `Number.NEGATIVE_INFINITY`** for a thread (it does when no candidate timestamp parses), that thread sorts to the bottom. That is the pre-existing behaviour of v1 and is correct here too.
