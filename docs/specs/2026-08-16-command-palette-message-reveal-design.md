# Reveal the matched message when opening a command palette search hit

Date: 2026-08-16
Status: proposed, awaiting review
Surfaces: web (desktop inherits). Mobile explicitly out of scope, see "Not in scope".

## Problem

`mod+k` opens the command palette. Typing a query runs a server-side search over
thread message text alongside the normal thread/project/action matches. Each hit
renders as a thread row with a snippet prefixed `You:` or `Agent:`
(`apps/web/src/components/CommandPaletteResults.tsx:68`).

Pressing Enter on that row calls `runThread`
(`apps/web/src/components/CommandPalette.tsx:1003`), which navigates to
`/$environmentId/$threadId` and nothing more. The thread opens at the live edge.
On a long thread the user lands nowhere near the text they searched for, and has
to scroll and re-read to find it.

The search result also carries no message identity, so the client has nothing to
scroll to even if it wanted to.

## Goal

Pressing Enter on a content match opens the thread and scrolls the matched
message into view near the top of the viewport, with a brief pulse so it is
obvious which message matched.

Pressing Enter on a thread row with no content match (a title-only match, a
recent-thread row) keeps today's behavior exactly: open at the live edge.

## What already exists (build on this, do not invent)

Two mechanisms already in the tree do most of the work.

**1. The timeline anchor.** `ChatView` can already pin an arbitrary message near
the top of the virtualized list. `timelineAnchor` state at
`apps/web/src/components/ChatView.tsx:1506` feeds `anchorMessageId` into
`MessagesTimeline` (`ChatView.tsx:5887`). `MessagesTimeline` resolves that id to
a row index via `resolveChatListAnchoredEndSpace`
(`packages/shared/src/chatList.ts:12`, called at
`apps/web/src/components/chat/MessagesTimeline.tsx:350`) and fires `onAnchorReady`,
which drives `list.scrollToIndex({ viewPosition: 0, viewOffset: CHAT_LIST_ANCHOR_OFFSET })`
at `ChatView.tsx:3679`.

Today only the send flow uses it (`ChatView.tsx:4790` and `ChatView.tsx:5233`),
to pin a just-sent user message. It is not send-specific. Reuse it.

**2. The reveal-request pattern.** `rightPanelStore.ts` reveals a line in a file
with a `revealLine` + monotonic `revealRequestId` pair
(`apps/web/src/rightPanelStore.ts:34-38`, bumped in `openFile` at
`rightPanelStore.ts:262`). The consumer acts when the id changes and records the
id it handled (`apps/web/src/components/files/FilePreviewPanel.tsx:794`). Mirror
that shape.

The monotonic id is what makes repeat requests work: searching for the same
message twice in a row, or searching within the thread you are already viewing,
produces no route change and no state diff other than the id.

**3. The pulse.** Settings search already has a scroll-target pulse:
`@keyframes settings-search-target-pulse` at `apps/web/src/index.css:377`,
applied in `apps/web/src/components/settings/settingsLayout.tsx:54-60`. Mirror
the animation, not the imperative `classList` plumbing.

Messages are not paginated. `threadDetail` returns every message for the thread
(`packages/client-runtime/src/state/threadDetail.ts:120`), so any matched message
is guaranteed to exist in the row list once the thread detail loads. No fetch
window work is needed.

## Design

Four changes, back to front.

### 1. Contract: carry the matched message id

`packages/contracts/src/orchestration.ts:1453`, add to
`OrchestrationThreadSearchMatch`:

```ts
messageId: MessageId,
```

`MessageId` is already exported from `packages/contracts/src/baseSchemas.ts:65`.
Add it as a required field, not optional. The server is the only producer and it
always has the id, and an optional field would push a `null` check into every
consumer for no gain.

### 2. Server: select the id that is already in the query

`apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`:

- Add `messageId: MessageId` to `ProjectionThreadSearchRow` (line 116).
- In the `ranked` CTE (line 733), add `messages.message_id AS message_id` to the
  inner `SELECT`, and `message_id AS "messageId"` to the outer `SELECT` at line 780.
- Add `messageId: row.messageId` to the mapped match at line 1890.

The CTE already reads `messages.message_id` in its `ROW_NUMBER()` tiebreaker
(line 756), so no new column access and no new index. Cost is one extra column
in the result set.

Note the existing `WHERE thread_match_rank = 1` (line 787): the query returns at
most **one** match per thread, ranked user-messages-first then newest-first. So
the revealed message is that single best match. This is not a find-next/find-prev
feature and this spec does not make it one.

### 3. Web: a reveal request store

New file `apps/web/src/threadMessageRevealStore.ts`, zustand, following the shape
of `apps/web/src/diffPanelStore.ts` (the smaller of the two precedents).

```ts
interface ThreadMessageRevealRequest {
  readonly threadKey: string; // scopedThreadKey(ref)
  readonly messageId: MessageId;
  readonly requestId: number; // monotonic, bumped on every request
}
```

Store holds a single nullable `request` plus:

- `requestReveal(ref: ScopedThreadRef, messageId: MessageId): void` — sets the
  request with `requestId: previous.requestId + 1`.
- `clearReveal(requestId: number): void` — clears only if the stored request
  still has that id, so a newer request is never clobbered by a late consumer.

Do **not** persist this store. A reveal is a one-shot intent, and a persisted one
would fire on the next app launch.

Do not use a TanStack Router search param. Enter on a match for the thread you
are already viewing produces no navigation, so a URL-driven design would silently
do nothing in that case, which is a common way to hit this feature.

### 4. Web: request the reveal from the palette

`apps/web/src/components/CommandPalette.tsx`, in the `runThread` callback at line 1003. `threadContentMatchByKey` (built at line 582) is already in scope; extend
what it stores so `messageId` is reachable there, or look the match up the same
way `getContentMatch` does at line 988.

```ts
runThread: async (thread) => {
  const ref = scopeThreadRef(thread.environmentId, thread.id);
  const match = threadContentMatchByKey.get(threadSearchMatchKey(ref));
  await navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  if (match) {
    useThreadMessageRevealStore.getState().requestReveal(ref, match.messageId);
  }
},
```

Request the reveal **after** `navigate` resolves. Requesting before means a
thread switch is in flight, and `ChatView`'s thread-change reset effect
(`ChatView.tsx:3819`) would wipe the anchor refs out from under it.

### 5. Web: consume it in ChatView

Add one effect in `apps/web/src/components/ChatView.tsx`. **Declare it after the
thread-change reset effect at line 3819.** React runs effects in declaration
order within a commit; when a reveal and a thread switch land together, an
earlier declaration would have its anchor immediately cleared by the reset.

The effect keys on `[revealRequest?.requestId, activeThreadKey]` and, when the
request's `threadKey` matches `activeThreadKey`:

```ts
anchorUserScrollGenerationRef.current += 1;
timelineScrollModeRef.current = "free-scrolling";
liveFollowUserScrollGenerationRef.current = null;
isAtEndRef.current = false;
pendingTimelineAnchorRef.current = request.messageId;
activeTimelineAnchorIndexRef.current = null;
showScrollDebouncer.current.cancel();
setShowScrollToBottom(false);
setTimelineAnchor({ threadKey: activeThreadKey, messageId: request.messageId });
setHighlightedMessageId(request.messageId);
useThreadMessageRevealStore.getState().clearReveal(request.requestId);
```

Every line there matters, and the reason is the live-follow effect at
`ChatView.tsx:3755`:

- `anchorUserScrollGenerationRef.current += 1` with
  `liveFollowUserScrollGenerationRef.current = null` makes that effect bail at its
  first guard (line 3758). Without it, the branch at line 3796 sees
  `timelineScrollModeRef.current === "following-end"` and calls `scrollToEnd`,
  which cancels the reveal a frame after it lands.
- `timelineScrollModeRef.current = "free-scrolling"` is the correct mode. Do
  **not** use `"anchoring-new-turn"`: that mode has turn-metrics behavior at line
  3782 meant for a streaming response, and there is no incoming turn here.
- `pendingTimelineAnchorRef.current` set before the anchor is what the guard at
  line 3768 reads while the row is still being measured.

This mirrors the send flow at `ChatView.tsx:4788-4799` with the mode changed and
the optimistic-message work dropped.

Reuse `onTimelineAnchorReady` (line ~3640) and `onTimelineAnchorSizeChanged`
unchanged. A historical message does not grow, so the size-changed re-pin path is
inert for reveals.

**Guard against a stale anchor.** If the message id is not in the thread (deleted
or compacted away between search and Enter), `resolveChatListAnchoredEndSpace`
returns `undefined`, `onAnchorReady` never fires, and
`pendingTimelineAnchorRef.current` stays set. That permanently suppresses
live-follow for the thread, which reads as "the chat stopped auto-scrolling".
Clear the pending anchor and the highlight on a timer (5s is generous; the row
resolves in one or two frames when it exists) and drop back to
`timelineScrollModeRef.current = "following-end"`.

### 6. Web: the pulse

Pass `highlightedMessageId: MessageId | null` into `MessagesTimeline` alongside
`anchorMessageId`. In the row wrapper at
`apps/web/src/components/chat/MessagesTimeline.tsx:853` (which already emits
`data-message-id`), add the pulse class when the row's message id matches.

Add to `apps/web/src/index.css`, next to the settings pulse at line 377:

```css
@keyframes chat-message-reveal-pulse {
  /* box-shadow ring, mirror line 377 */
}
.chat-message-reveal-pulse {
  animation: chat-message-reveal-pulse 650ms ease-in-out 2;
}
@media (prefers-reduced-motion: reduce) {
  .chat-message-reveal-pulse {
    animation: none;
  }
}
```

A `box-shadow`-only ring that runs twice and stops, exactly like the settings
pulse. AGENTS.md is explicit that continuously repainting animations peg the GPU
on high-refresh displays, so this must be finite and must not animate layout
properties. Follow the reduced-motion precedent at `index.css:1582`.

Clear `highlightedMessageId` after ~1.5s (two 650ms cycles plus slack) so a later
unrelated re-render cannot re-trigger the animation.

## Tests

Match the repo's split: pure logic gets a colocated `*.test.ts`, server behavior
gets a focused Effect test. Do not run repo-wide checks (AGENTS.md).

**Server** — `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.test.ts`,
extend the existing search test at line 1779: assert the returned match's
`messageId` equals the seeded `message_id`, for a user hit and an assistant hit.
The seed rows are already there.

**Client runtime** — `packages/client-runtime/src/state/threadSearch.test.ts:60`
fixture needs `messageId` added. It will fail to typecheck otherwise; that is the
signal, not a surprise.

**Store** — new `apps/web/src/threadMessageRevealStore.test.ts`:

- `requestId` increments across consecutive `requestReveal` calls for the same
  thread and message (the repeat-search case).
- `clearReveal(staleId)` does not clear a newer request.

**Palette logic** — `apps/web/src/components/CommandPalette.logic.test.ts`
already exercises `buildThreadActionItems` with a content match at line 250. If
`runThread`'s signature or the match shape changes, extend that test to assert a
reveal is requested for a content match and **not** requested for a thread row
without one. That second half is the regression that matters: it is what keeps
ordinary thread opens landing at the live edge.

**Anchor resolution** — `resolveChatListAnchoredEndSpace` already has coverage.
Add a case for an anchor id absent from the item list returning `undefined`, since
step 5's timeout guard depends on that being the behavior.

No test drives the real scroll. The scroll lives in LegendList and is verified by
a manual pass.

## Manual verification

Ask before launching a client (AGENTS.md). Then, on a thread with several hundred
messages:

1. `mod+k`, type text from an early user message, Enter. Thread opens, that
   message sits near the top, pulses twice, stops.
2. Same for an early agent message.
3. Enter on a thread row with no snippet. Opens at the live edge, no pulse.
4. Search within the thread you are already viewing. Still scrolls (this is the
   case a URL param would have broken).
5. Repeat the same search twice. Scrolls both times.
6. After a reveal, send a message. Live-follow resumes and the new turn scrolls
   normally. This is the one that catches a leaked `pendingTimelineAnchorRef`.
7. Reveal a message, then scroll away by hand. No fight, no snap-back.
8. Reduced motion on: it scrolls, it does not pulse.

## Not in scope

- **Mobile.** `apps/mobile` renders search matches at
  `apps/mobile/src/features/threads/thread-search-match.tsx` with its own
  navigation and its own list. The contract change is additive, so mobile keeps
  compiling and keeps today's behavior. Wiring reveal there is a separate change
  against a different list implementation. Flagging it because AGENTS.md asks for
  a per-surface decision: the decision here is "web now, mobile follow-up."
- **Find-next / find-prev.** The server returns one match per thread by design
  (`thread_match_rank = 1`). Cycling matches means changing the query shape and
  the palette's result model.
- **The sidebar thread search** (`SidebarV2.tsx:1666`) is title-only and unrelated.
- Highlighting the matched substring inside the revealed message body.

## Risks

- **The live-follow interaction is the whole risk.** `ChatView`'s scroll state is
  five refs and three modes. Getting step 5's ordering wrong produces a reveal
  that visibly works then snaps to the bottom, or a thread that silently stops
  auto-scrolling. Manual checks 6 and 7 exist for exactly this. Do not skip them.
- Effect declaration order relative to `ChatView.tsx:3819` is load-bearing and
  invisible. Leave a short comment at the new effect saying why it sits there.
- Adding a required contract field breaks any hand-written fixture. Only one
  exists today (`threadSearch.test.ts:60`); typecheck will find any other.
