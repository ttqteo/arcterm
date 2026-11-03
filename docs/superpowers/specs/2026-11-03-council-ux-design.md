# Council UX pass: Pin, the Discussion as a list, a quieter Outdated

Date: 2026-11-03. Brainstorm: `.superpowers/brainstorm/council-ux/brainstorm.json`.
Prototype: `.superpowers/design/council-ux/project/Discussion-list.dc.html`.

## Why

Two parts of the council hurt: finding and reopening a council, and the Discussion. A closed council
came back only after Summarize again, because its Reopen is a bare ↺ at the end of the Report's tab
bar that reads as reload. The Discussion shows too much detail: one bubble per message, round dividers,
Sent/Seen, typing dots. The Report also asks to Summarize again after a single question and answer.
Setup, the running view and the rest of the Report are out of scope.

## What the code does today

- Close sets `closed` (ms) on an ended council (`Runner.SetClosed`, `pkg/council/runner.go:2522`); the
  tree drops it (`councilRowsByProject`, `frontend/app/view/agents/agentsidebarmodel.ts:446`) and
  Councils (`councilhistory.ts`) still lists it. Reopen clears it, and so does any new run (Summarize
  again, Retry). `CouncilCloseButton` (`councilclose.tsx`) draws X or ↺ in the Discussion header and
  at the right of the Report's tab bar.
- The council list atom loads over `CouncilListCommand`, which reads the folder from disk
  (`council.List`, `pkg/council/store.go:313`), but it is fetched again only on `council:changed`
  (`councilstore.ts:57`). A council file copied in from another machine stays hidden.
- `outdatedCount` (`councilmodel.ts:795`) counts every sent reply after `summary.at`, the person's own
  included; `councilsummary.tsx:1241` draws it as a full-width amber banner with Summarize again.
- The minutes figure is `elapsedMs` (`councilmodel.ts:630`): from `started` to `summary.at` or
  `updated`, wall clock, so a council started yesterday and chatted in today shows 1112 min.
- The Report's last section, Every expert on every idea (`councilsummary.tsx:484`), is a table with one
  row per idea and each seat's stance.
- Ideas are `CouncilProposal` records with `ts` (`pkg/council/types.go:130`); a reply carries `Stance`
  (`accept` / `challenge` / `oppose`, shown as Agrees / Has doubts / Is against it) and `Revised`
  (`types.go:162`); `latestStances` (`councilmodel.ts:237`) already folds them per idea.

## Decisions

### 1. Pin replaces Close / Reopen

- A labelled button, **Pin** / **Pinned** (lucide `Pin` / `PinOff` icon plus the word), replaces the X
  and ↺ icons in the Discussion header and in the Report's tab bar. It works on any council, running
  ones too.
- The tree lists a council of a registered project when it is any of: running, waiting on the person,
  queued; pinned; ended less than a day ago; ended and not yet opened by the person (unread). An ended,
  unpinned council older than a day leaves the tree on its own. Councils still lists every council and
  shows a pin on each pinned row, with Pin / Unpin from there.
- Unpin on an ended council older than a day takes it off the tree at once.
- "Unread" comes from the persisted last-opened map of decision 3, not `councilUnreadAtom` (Agent's
  call, builder question 2): an ended council is unread when it ended after it was last opened, or was
  never opened. On the first load with an empty map, every council already in the list is seeded as
  opened at that moment, so only councils that end or arrive (a sync) afterwards count as unread.
  Opening a council marks it read. `councilUnreadAtom` keeps its notification job.
- Pinned councils sit at the top of their project folder, above the agents and terminals.
- In Go, a `pinned` field (ms, 0 = not pinned) replaces `closed`; `CouncilCloseCommand` becomes a pin
  command (`task generate` after the wshrpc change). Councils closed before this start unpinned; the
  old `closed` value is ignored on read. "Ended" time is the council's `updated` when it reached a rest
  state (Agent's call: use `summary.at` when there is one, else `updated`).
- The tree rule is a pure function in `agentsidebarmodel.ts` with its own tests, taking `now` as an
  argument.

### 2. Synced council files show up on their own

wavesrv watches the councils folder (`council.Dir()`) and publishes `council:changed` for a file that
appears, changes or goes away from outside the runner, so a council copied in from another machine
shows without waiting for an unrelated change. No Reload button.

### 3. The Discussion is a list of ideas

> **Superseded 2026-11-03.** The person had read this as a side rail, not a list in place of the chat. The channel of
> messages is back as the Discussion's main view, and the ideas sit in a quiet rail beside it, shaped like the brainstorm's
> Decided so far (number, author, title, a line of replies and stances; a click scrolls the channel to the idea; it folds).
> An idea's thread opens on the rail's second tab. Boards: `.superpowers/design/council-discussion/project/A-decided-rail.dc.html`
> and `A2-decided-rail-thread.dc.html`. The order, the numbers, New and the seat filter below still hold for the rail.

As the board draws it:

- A **Chat** row on top holds the person's own messages and the seats' answers to them (the replies
  tied to no idea). It shows an `N new` badge, the latest line and the message count; a click opens it
  in the side panel like a thread.
- Under it the ideas, one 40px row each: number, the author's avatar, the title, a **New** badge when
  the idea came since the person last opened this council, then the counts of Agrees / Has doubts / Is
  against it (from `latestStances`) and the reply count. Ideas past the first screen scroll.
- Row order is fixed, never re-sorted on a stance (Agent's call, builder question 1): arrival order
  (`ts`) until there is a summary, then the Report's order (`matrixRows`, `councilmodel.ts:882`); ideas
  no direction cites, or that came after `summary.at`, follow in arrival order. `rankedProposals` is not
  used, so rows never jump under the j / k cursor or the open thread.
- A click, or Enter on the keyboard cursor, opens today's thread panel on the right: the idea, its
  replies with their stance pills, and the reply box that names who answers. j / k / Enter / Escape keep
  working on the rows.
- The composer stays at the bottom, unchanged (`@` seats, files and live chats, images).
- Gone from the main view: bubbles, round dividers, Sent / Seen, typing dots, skipped-turn lines.
- Drafts waiting for the person: an amber **Draft** badge on the row they belong to (an idea row, or the
  Chat row); Send / Edit / Drop stay in the thread panel. (Agent's call)
- A failed seat and Retry all: one line above the list, as the Retry all bar is today. (Agent's call)
- While the seats first read and propose, the Discussion keeps today's expert cards; the list takes
  over once ideas exist. (Agent's call)
- "Since the person last opened this council": the time the person last opened it, kept per council
  id in a persisted per-browser map (localStorage, wrapped in try/catch), updated on leaving the
  council. (Agent's call)
- The derivation (rows, counts, badges, Chat row) is a pure model beside `councilchatmodel.ts` with
  tests; the view is thin.

### 4. Report and Discussion stay two tabs

The Report keeps its layout, its Every expert on every idea table included.

### 5. Outdated only when the answer could change

The Report calls its summary out of date only when, after `summary.at`, a seat posted a new sent idea,
revised one (`Revised`), or changed its latest stance on an idea (compare `latestStances` before and
after `summary.at`). Then the amber banner with Summarize again shows, naming what changed
(`Outdated · 1 new idea, 1 changed stance`). Any other reply, the person's own included, adds only a
quiet `N replies since` to the "Written by the coordinator" line. Plain comparison, no model call.

A changed stance is only a seat's latest stance on an idea that differs from that same seat's earlier
stance on it; a seat's first stance on an idea is not a change, so a follow-up `@seat` answer that
takes a stance for the first time stays quiet. Stances on ideas posted after `summary.at` fold into
"new idea" and are not counted again. (Agent's call, builder question 3)

### 6. Minutes count the time the council ran

The minutes figure is the time rounds actually ran, not the clock since `started`. The council stores
no per-round times today: the runner adds a `ranms` total, adding each run's span (start of a round or
follow-up to its rest state) when it ends. A council with no `ranms` (older files) falls back to
today's figure.

## Verification

- Vitest: the tree rule (pinned, running, unread, ended < 1 day, ended > 1 day), the list model (Chat
  row, counts, New, Draft), the Outdated rule, the minutes fallback.
- Go: the pin command, the `closed` → `pinned` read, the folder watch publishing `council:changed`,
  `ranms` accumulation.
- CDP: update `council-discussion` (the list, the Chat row with New, a thread open on an idea, a Draft
  badge) and `council-tree` (Pin from the Report, a pinned council on top, an old ended council off the
  tree); add an Outdated step that sends one plain reply and sees no banner.

## Calls made while planning

- Pin is the person's alone: a new run (Summarize again, Retry, a follow-up) no longer touches it, as it
  cleared `closed`. `wsh council close` / `close --reopen` become `wsh council pin <id>` / `pin --off`, and
  `docs/guide/council.md` says Pin where it said Close / Reopen. (Agent's call)
- `outdatedCount(c)` keeps its name and now counts only what decision 5 calls a change (new ideas, revised
  ideas, changed stances), so its other reader, the Discussion's status line (`councildiscussionmodel.ts:337`),
  follows the new rule without an edit. (Agent's call)
- Outdated wording: the banner reads `Outdated · 1 new idea, 2 changed stances` (only the non-zero
  parts, revisions as `1 revised idea`); the quiet line appends ` · 3 replies since` to "Written by the
  coordinator". (Agent's call)
- The tree row's hover button, "Close council" today, becomes Pin / Unpin; a queued council keeps Remove from
  queue. (Asked after plan review: the person chose Pin / Unpin.)
- The board's "best first" header label and its "16 more ideas · Wild ideas kept aside" fold are dropped: the
  header reads `24 ideas`, every idea is a row in the fixed order of decision 3, and the list scrolls. (Asked after
  plan review: the person chose the spec over the board.)
- The Seats chip's "show one seat alone" filter (`councilOnlyAtom`) filters the list: only the ideas that seat
  wrote or replied to show, and the Chat row counts only that seat's lines. (Asked after plan review: the person
  chose filtering the rows.)
- The last-opened map needs no list to seed it: it stores `seededAt` (the first time it is read, persisted) beside
  the per-council times, and a council never opened counts as opened at `seededAt`. Same behaviour as seeding
  every listed council, with no call site to wire. (Agent's call)
- The minutes figure runs live: the council also stores `runstarted` (ms, 0 when no run is going), set when a
  run starts and cleared when it adds its span to `ranms`. While a run goes the figure is `ranms + now -
  runstarted`. A run lost to a wavesrv restart clears `runstarted` and adds nothing. (Agent's call)
- The folder watch debounces per file (about 300 ms), so a sync tool writing many files publishes one
  `council:changed` per council, and a file the runner just wrote publishes at most once more. (Agent's call)

## Left to the builder

Nothing beyond the code-level choices of each task.
