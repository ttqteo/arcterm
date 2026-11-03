# Council UX pass: Pin, the Discussion as a list, a quieter Outdated

**Spec:** `docs/superpowers/specs/2026-11-03-council-ux-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/council/... ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `task check:ts && go vet ./pkg/council/... ./pkg/wshrpc/... ./cmd/wsh/...`
**Final:** `node scripts/cdp/final-verify.mjs council-tree council-discussion council-summary`
**Prototype:** .superpowers/design/council-ux/project/Discussion-list.dc.html

Read the spec first: every decision below is from it, and its "Calls made while planning" section settles what
the board and the spec disagreed on (the board's "best first" label and its Wild ideas fold are dropped; the
header button is Pin / Pinned). Go is the source of truth for the wire types: never hand-edit
`frontend/types/gotypes.d.ts`, `frontend/app/store/wshclientapi.ts` or `pkg/wshrpc/wshclient/wshclient.go`; change
the Go and run `task generate`. Go tests on Windows need `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"`
(Bash). The CDP scenarios' shared fixtures (`scripts/cdp/council/fixtures.mjs` and the `rail-apps-*.json` files)
belong to Task 7; the other tasks build any extra data their steps need inside their own scenario file.

### Task 1: Pin on the wire, and the Pin button
**Depends on:** none
**Files:** `pkg/council/types.go`, `pkg/council/runner.go`, `pkg/council/runner_test.go`, `pkg/council/types_test.go`, `pkg/wshrpc/wshrpctypes_council.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `cmd/wsh/cmd/wshcmd-council.go`, `frontend/app/view/agents/councilstore.ts`, `frontend/app/view/agents/councilclose.tsx`, `frontend/app/view/agents/councilpin.tsx`, `frontend/app/view/agents/councilmodel.ts`, `frontend/app/view/agents/councilhistory.ts`, `frontend/app/view/agents/councilhistory.test.ts`, `frontend/app/view/agents/agentsidebarmodel.ts`, `frontend/app/view/agents/agentsidebarmodel.test.ts`, `frontend/app/view/agents/agenttree.tsx`, `frontend/app/view/jarvis/briefcouncils.ts`, `frontend/app/view/jarvis/briefcouncils.test.ts`, `frontend/app/view/agents/councildiscussion.tsx`, `frontend/app/view/agents/councilsummary.tsx`, `scripts/cdp/council/tree.mjs`

The interface the other tasks build on: the Go wire swap, plus only the frontend edits without which `task
check:ts` fails once the generated types drop `closed` and `CouncilCloseCommand`.

- Go (`pkg/council/types.go:298`): replace `Closed` with `Pinned int64 \`json:"pinned,omitempty"\`` (ms, 0 = not
  pinned). Add `RanMs int64 \`json:"ranms,omitempty"\`` and `RunStarted int64 \`json:"runstarted,omitempty"\``
  (declared only; Task 3 fills them). An old file's `closed` is simply not read: no migration.
- `Runner.SetClosed` (`runner.go:2522`) becomes `SetPinned(id string, pinned bool)`, allowed on any council,
  running ones too, saving and publishing as today. Remove every place a new run clears `Closed`: a run never
  touches `Pinned`.
- wshrpc: `CouncilCloseCommand` / `CommandCouncilCloseData` become `CouncilPinCommand` /
  `CommandCouncilPinData{Id, Pinned bool}`; then `task generate`. `wsh council close <id>` / `close --reopen` become
  `wsh council pin <id>` / `pin --off`.
- Frontend, mechanical: `councilstore.ts` exports `setCouncilPinned(id, pinned)` in place of close / reopen.
  `isClosedCouncil` (`councilmodel.ts:228`) becomes `isPinnedCouncil(c)` (`(c.pinned ?? 0) > 0`).
  `councilhistory.ts`'s `closed` flag becomes `pinned`. `briefcouncils.ts:68` drops its `!c.closed` test.
  `councilRowsByProject` (`agentsidebarmodel.ts:446`) drops its closed filter (Task 6 writes the tree rule).
- The Pin button: delete `councilclose.tsx`; `councilpin.tsx` exports `CouncilPinButton({ c, className })`, a
  labelled button, lucide `Pin` + "Pin" when unpinned, `PinOff` + "Pinned" when pinned, DESIGN.md tokens. Swap it in
  at `councildiscussion.tsx:367` and `councilsummary.tsx:1360` (the import and the element only).
- The tree row's hover button (`agenttree.tsx:2754-2762`): "Close council" becomes Pin / Unpin through
  `setCouncilPinned`; a queued council keeps Remove from queue. Fix its comments (`:2736`) and the context menu if
  it offers Close / Reopen.
- Grep every remaining council `closed` / `CouncilClose` / `closeCouncil` / `isClosedCouncil` / "Reopen" reference
  in code and fix it.
- `scripts/cdp/council/tree.mjs`: a step that clicks Pin in the Report's tab bar and sees it read Pinned, and a
  step that hovers a council's tree row and sees Pin (Unpin on a pinned one) instead of Close council.

Acceptance: `go test ./pkg/council -run 'TestSetPinned|TestLoadIgnoresClosed'` (new: pin and unpin on an ended and
a running council; a file holding `"closed": 123` loads with `Pinned == 0`; a rerun leaves `Pinned` as it was);
`npx vitest run frontend/app/view/agents/councilhistory.test.ts frontend/app/view/jarvis/briefcouncils.test.ts
frontend/app/view/agents/agentsidebarmodel.test.ts`; the two council-tree steps above pass.

### Task 2: Pin in the Councils list, the guide and the changelog
**Depends on:** Task 1
**Files:** `frontend/app/view/agents/councilhistoryview.tsx`, `frontend/app/view/agents/councilhistory.ts`, `frontend/app/view/agents/councilhistory.test.ts`, `docs/guide/council.md`, `CHANGELOG.md`, `scripts/cdp/council/tree.mjs`

- `councilhistoryview.tsx`: a pin mark on pinned rows, and Pin / Unpin on every row (hover button and context
  menu, as the tree row has). Fix its header comment, which still speaks of Reopen.
- `docs/guide/council.md`: Pin where it says Close / Reopen (lines ~140 and ~165), in the guide's language.
- `CHANGELOG.md`: under `## Unreleased` (open one if the top section is dated), the user-facing lines for the whole
  pass: Pin replaces Close / Reopen and the tree keeps only live, pinned, unread or recent councils; a council
  synced in from another machine shows on its own; the Discussion is a list of ideas with a Chat row; the Report
  says Outdated only when an idea or a stance changed; the minutes count the time the council ran.
- `scripts/cdp/council/tree.mjs`: a step that opens Councils, sees the pin mark on a pinned row, and Unpins it
  from there.

Acceptance: `npx vitest run frontend/app/view/agents/councilhistory.test.ts`; the Councils-list step above passes.

### Task 3: `ranms` counts the time rounds ran
**Depends on:** Task 1 (uses the RanMs and RunStarted fields it adds)
**Files:** `pkg/council/runner.go`, `pkg/council/runner_test.go`

When a run begins (a round or a follow-up: Start, StartSaved, Reply, Continue, Summarize, Retry) the runner sets
`RunStarted` to now and saves; when it reaches a rest state (`finishLocked`, `runner.go:696`, and every other path
that ends a run: stop, failure) it adds `now - RunStarted` to `RanMs` and sets `RunStarted` to 0. `MarkStale` (a
run lost to a wavesrv restart) sets `RunStarted` to 0 and adds nothing. Use the runner's clock seam if it has one,
so the test is deterministic.

Acceptance: `go test ./pkg/council -run 'TestRanMs'` (new: two runs of known spans add up; a stopped run adds its
span; `RunStarted` is set while running and 0 after; a stale council adds nothing).

### Task 4: wavesrv watches the councils folder
**Depends on:** Task 1
**Files:** `pkg/council/watch.go`, `pkg/council/watch_test.go`, `pkg/wshrpc/wshserver/wshserver_council.go`

- `pkg/council/watch.go`: `Watch(ctx, dir string, publish func(id, project string, deleted bool)) error` with
  fsnotify (already in go.mod; see `pkg/wconfig/filewatcher.go` for the repo's pattern). A council file created,
  written or renamed in publishes `(id, project, false)`, reading the project from the file (a file that does not
  parse yet waits for its next event, never published half-written); a removed file publishes `(id, "", true)`.
  Debounce per file, about 300 ms, so a burst publishes once. Ignore files that are not council files. Errors are
  logged, never swallowed; a missing folder is created before watching.
- `StartCouncilRunner` (`wshserver_council.go:46`) starts the watch on `council.Dir()`, publishing
  `council:changed` with `CouncilChangedData{Id, Project, Deleted}` as `publishCouncilChanged` does.

Acceptance: `go test ./pkg/council -run 'TestWatch'` (new, on a temp dir: copying a council file in publishes
once with its id and project; three writes within the debounce publish once; deleting it publishes `deleted`; a
non-council file publishes nothing).

### Task 5: The persisted last-opened map
**Depends on:** none
**Files:** `frontend/app/view/agents/councilopened.ts`, `frontend/app/view/agents/councilopened.test.ts`, `frontend/app/view/agents/councilpane.tsx`

`councilopened.ts` holds when the person last opened each council (spec decisions 1 and 3, and the `seededAt`
call), with no list to seed it:

- Stored shape `{ seededAt: number, opened: Record<string, number> }` under localStorage key `council.opened`. The
  first read with nothing stored sets `seededAt` to now and persists it. Every read and write is in try/catch: a
  failure logs and the page works on an in-memory map.
- Pure helpers, tested: `openedAt(map, id)` (`opened[id] ?? seededAt`), `isUnreadCouncil(c, map)` (ended — not
  running, waiting on the person or queued — and its ended time, `summary.at` when there is one else `updated`, is
  after `openedAt`), `markOpened(map, id, now)`.
- A jotai atom `councilOpenedAtom` holding the map, and `markCouncilOpened(id)` that updates and persists it.
- `councilpane.tsx`: when the shown council changes or the pane unmounts, mark the council being left as opened
  now. Expose `councilOpenedAtom` on `__arcCouncil` in DEV so a scenario can read and set it.

Acceptance: `npx vitest run frontend/app/view/agents/councilopened.test.ts` (seededAt set once and kept; unread
when ended after opened, or never opened and ended after seededAt; not unread when running or ended before
seededAt; markOpened).

### Task 6: The tree keeps live, pinned, unread and recent councils, pinned on top
**Depends on:** Task 1, Task 2, Task 5 (uses isUnreadCouncil and councilOpenedAtom)
**Files:** `frontend/app/view/agents/agentsidebarmodel.ts`, `frontend/app/view/agents/agentsidebarmodel.test.ts`, `frontend/app/view/agents/agenttree.tsx`, `scripts/cdp/council/tree.mjs`

- A pure `councilInTree(c, opened, now)` in `agentsidebarmodel.ts`: true when the council is running, waiting on
  the person or queued; pinned; ended less than a day ago (ended time as in Task 5); or unread
  (`isUnreadCouncil`). `councilRowsByProject` filters with it, taking the opened map and `now` as arguments.
- Pinned councils sit at the top of their project folder, above the agents and terminals; the rest stay where the
  councils block is today. Unpin on an ended council older than a day drops it from the tree at once (it falls out
  of the rule, no special case).
- The caller (`agenttree.tsx:3302`) passes `councilOpenedAtom` and a `now` that moves (a minute tick is enough), so
  a council leaves the tree a day after it ended without a reload.
- `scripts/cdp/council/tree.mjs`: steps for a pinned council drawn at the top of its folder, an ended unpinned
  council older than a day (and opened) absent from the tree, and Unpin from its Report removing such a council
  from the tree.

Acceptance: `npx vitest run frontend/app/view/agents/agentsidebarmodel.test.ts -t council` (pinned, running,
unread, ended < 1 day, ended > 1 day and read, pinned-first order); the council-tree steps above pass.

### Task 7: The Discussion is a list of ideas
**Depends on:** Task 1, Task 5 (uses councilOpenedAtom for the New badges)
**Files:** `frontend/app/view/agents/councillistmodel.ts`, `frontend/app/view/agents/councillistmodel.test.ts`, `frontend/app/view/agents/councildiscussion.tsx`, `frontend/app/view/agents/councildiscussionmodel.ts`, `frontend/app/view/agents/councildiscussionmodel.test.ts`, `frontend/app/view/agents/councilchat.tsx`, `frontend/app/view/agents/councilchatmodel.ts`, `frontend/app/view/agents/councilchatmodel.test.ts`, `frontend/app/view/agents/councilchatnav.ts`, `frontend/app/view/agents/councilseats.tsx`, `frontend/app/view/agents/councilseen.ts`, `frontend/app/view/agents/councilseen.test.ts`, `scripts/cdp/council/discussion.mjs`, `scripts/cdp/council/fixtures.mjs`, `scripts/cdp/council/fixtures.test.mjs`, `scripts/cdp/council/rail-apps-round2.json`, `scripts/cdp/council/rail-apps-done.json`

Match the Prototype board, except what the spec's planning calls drop (the "best first" label: the header reads
`N ideas`; the "more ideas · Wild ideas kept aside" fold: every idea is a row and the list scrolls). Spec decision
3, all of it:

- `councillistmodel.ts` (pure, tested): the Chat row (replies tied to no idea: count, latest line, `N new` since
  `openedAt`, a Draft flag) and one row per idea (number, author, title, New when `ts` > `openedAt`, Agrees / Has
  doubts / Is against it counts from `latestStances`, reply count, Draft flag). Order fixed: arrival (`ts`) until
  there is a summary, then `matrixRows` (`councilmodel.ts:882`) order with uncited or post-summary ideas after, in
  arrival order. Never `rankedProposals`. With a seat chosen in the Seats chip (`councilOnlyAtom`), only the ideas
  that seat wrote or replied to, and the Chat row counts only that seat's lines.
- `councildiscussion.tsx` / `councilchat.tsx`: the list (40px rows, scrolls past the first screen) replaces the
  bubbles, round dividers, Sent / Seen, typing dots and skipped-turn lines. A click, or Enter on the j / k cursor,
  opens today's thread panel (the Chat row opens the unattached replies the same way); Escape closes it. Drafts
  keep Send / Edit / Drop in the thread panel. A failed seat and Retry all stay one line above the list. Before any
  idea exists, today's expert cards stay. The composer is unchanged. Update the Seats chip's label
  (`councilseats.tsx:74`) to say it shows that seat's ideas.
- Delete what nothing uses any more (`councilseen.ts` and its test if the thread panel no longer needs Sent / Seen;
  grep every import, `import type` included, before deleting), and the chat-model code only the bubbles used.
- `scripts/cdp/council/discussion.mjs`: update `council-discussion` to show the list with a Chat row carrying
  `N new` (set the opened map through `__arcCouncil` before the council opens), an idea row with stance counts and
  New, a thread open on an idea after a click, a Draft badge on a row, the Seats chip narrowing the rows to one
  seat, and the header's Pin button reading Pinned after a click; drop the steps for removed UI.

Acceptance: `npx vitest run frontend/app/view/agents/councillistmodel.test.ts
frontend/app/view/agents/councilchatmodel.test.ts frontend/app/view/agents/councildiscussionmodel.test.ts`
(Chat row, counts, New, Draft, seat filter, fixed order before and after a summary); the council-discussion steps
above pass.

### Task 8: Outdated only when the answer could change, and minutes that count the run
**Depends on:** Task 1, Task 7 (removes the bubble UI that council-summary's steps still drive; this task rewrites them)
**Files:** `frontend/app/view/agents/councilmodel.ts`, `frontend/app/view/agents/councilmodel.test.ts`, `frontend/app/view/agents/councilsummary.tsx`, `frontend/app/view/agents/councilsummarymodel.ts`, `frontend/app/view/agents/councilsummarymodel.test.ts`, `scripts/cdp/council/summary.mjs`

- `councilmodel.ts`: `outdatedChanges(c)` returns `{ ideas, revised, stances, replies }` after `summary.at` per spec
  decision 5 (a changed stance is a seat's latest stance on an idea differing from that seat's earlier stance on it;
  a first stance is no change; stances on post-summary ideas count only as the new idea). `outdatedCount(c)` keeps
  its name and returns `ideas + revised + stances`, so `councildiscussionmodel.ts:337` follows unedited.
- `outdatedLabel` (`councilsummarymodel.ts:386`) and the banner (`councilsummary.tsx:1241`): the amber banner with
  Summarize again shows only when `outdatedCount > 0`, reading `Outdated · 1 new idea, 2 changed stances` (non-zero
  parts only; `1 revised idea`); otherwise `replies > 0` appends ` · 3 replies since` to the "Written by the
  coordinator" line.
- `elapsedMs` (`councilmodel.ts:630`): `ranms + (runstarted > 0 ? now - runstarted : 0)` when the council has
  `ranms` or `runstarted`; today's figure otherwise. The Discussion header's live clock (`costLine`) follows.
- `scripts/cdp/council/summary.mjs`: rewrite the steps that drive the removed bubble UI (`:327-352`, the seat filter
  through `[data-council-channel] [data-council-idea]`, `data-council-reply-on`, `data-council-only`; `:837-850`,
  `data-council-idea='P5'` `data-open`) to drive Task 7's list rows and thread panel. Rewrite the Outdated step
  (`:581`, which asserts the old `Outdated · 1 reply since`): one step posts a new idea or a changed stance after the
  summary and sees the banner read the new wording; another posts one plain reply and sees no banner, only the
  quiet line.

Acceptance: `npx vitest run frontend/app/view/agents/councilmodel.test.ts
frontend/app/view/agents/councilsummarymodel.test.ts` (new idea, revised, changed stance, first stance quiet, the
person's reply quiet, the label wording, ranms with and without a live run, fallback without it); the
council-summary steps above pass.
