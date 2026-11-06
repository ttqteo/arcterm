# Revamp Jarvis

**Effort:** effort:0731d962-3fec-4591-91e5-009e744e9154
**Spec:** `docs/superpowers/specs/2026-11-05-jarvis-revamp-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/jarvis ./pkg/jarvisstate ./pkg/effortstore ./pkg/wavevault ./pkg/wshrpc/... ./cmd/wsh/cmd`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs brief-surface brief-layout brief-inline-tracker brief-chunk-panel jarvis-tour jarvis-brief-cards jarvis-brief-activity jarvis-initiative-sheet jarvis-chunk-sheet jarvis-council-sheet surface-smoke`
**Prototype:** D:\src\arcterm\.superpowers\design\jarvis-page-redesign\project\Main.dc.html

Builds the whole spec: the Brief page (Waiting strip, pinned initiative cards, the compact list, Activity in the side
column), the initiative in the right sheet, pins stored on the effort, the council report in the sheet, and the chunk
inside the initiative sheet. The canvas folder holds four boards, all absolute paths because `.superpowers/` is
gitignored and a run's worktree has no copy: `Main.dc.html` (the Brief), `Sheet.dc.html` (an initiative in the sheet),
`Council.dc.html` (a council report in the sheet), `Chunk.dc.html` (a chunk in the sheet, status menu open), all under
`D:\src\arcterm\.superpowers\design\jarvis-page-redesign\project\`. Read the board your task draws before styling
it; DESIGN.md's tokens and rules apply (colors from `@theme` tokens only, never raw hex).

Verify names Go packages because Tasks 1 and 2 change Go; at a merge `scripts/verify.mjs` tests only what the merge
changed (vitest files included), and in the final stage everything plus the frontend typecheck. Every task touches the
frontend, so Check is the typecheck (`task check:ts`, ~2 min: give it a longer timeout than 2 minutes).

## Decisions beyond the spec (the lead's calls)

- **One run builds all three waves.** The spec splits the work into three runs; this run builds them together because
  nobody is at the cockpit to start runs 2 and 3, and the council sheet (wave 2) shares nothing with the Brief page, so
  it runs beside wave 1 from the start. The effort's chunks are marked by Task 9, the last task, once all three land
  (the Wave 2 chunk by Task 3, which finishes it alone).
- **Pins are a dedicated command, not an effort op.** `EffortPinCommand(CommandEffortPinData{effortoid, pin bool,
  replaceoldest bool}) -> CommandEffortPinRtnData{pinned bool, capreached bool, oldest *EffortPinRef{oid, title}}` in
  `pkg/wshrpc/wshrpctypes_effort.go`. The field is `PinnedTs int64 json:"pinnedts,omitempty"` on `waveobj.Effort` and
  on `wshrpc.EffortSummary` (0 = not pinned). The cap is the Go constant `jarvis.MaxPinnedEfforts = 6`. Pinning a
  seventh without `replaceoldest` changes nothing and answers `capreached: true` with the oldest pin (smallest
  `PinnedTs`); with `replaceoldest` it unpins that one and pins the new one in one call. Pinning an already-pinned
  effort keeps its time. Archiving clears the pin; a deleted effort is gone. A structured answer, so no caller parses
  wording.
- **A pin is a view preference: it writes no effort event or note and keeps `UpdatedTs`** (so it neither reorders
  "most recent" nor shows in Since you looked, nor changes a card's "updated <age>"). `effortstore` gets a variant of
  `Update` that bumps `Version` but keeps `UpdatedTs` (`UpdateKeepTs`, or an option on `Update`; the worker's call).
- **Pins survive other machines.** `pkg/wavevault/effortmerge.go` `MergeEffort` merges `PinnedTs` three-way: a side
  that changed it from base wins; when both changed it, the larger wins (a pin beats an unpin, the later pin beats the
  earlier). It cannot follow the "newer by `UpdatedTs`" rule the other fields use, since a pin keeps `UpdatedTs`.
- **One pin flow in the frontend.** `togglePin(oref)` in `effortstore.ts` pins or unpins; on `capreached` it pushes a
  toast (`pushToast` with `action`) that says the cap ("6 initiatives are pinned") and offers "Unpin <oldest title>",
  whose action re-calls with `replaceoldest`. RPC failures surface as an error toast, never swallowed. Every pin control
  (card menu, list row, sheet head, the `p` key) calls it; the card and list components take it as a prop.
- **One segment bar.** The existing `SegmentBar` in `briefrowviews.tsx` (`segments: ChunkTone[]`, also used by
  `agents/initiativepopover.tsx`) is the bar the cards, the list and the sheet draw. Task 4 brings its colours to the
  board (done `success/45`, active full `success`, the rest `edge-strong`) and adds a size prop if the card needs a
  taller bar; no second bar component.
- **Cards model** (`briefcards.ts`): `pinnedCards(cards, ordered)` returns the card set: when any live initiative has
  `pinnedTs > 0`, the pinned ones sorted by `pinnedTs` ascending (pin order), else the first six of the already-ordered
  list (`orderInitiatives`). `listAfterCards(nested, cardOrefs)` drops every card from the list (fallback cards
  included); a sub-initiative whose parent is a card is drawn at depth 0 with `↳ <parent title>` in its meta, so no
  child is indented under a row that is not there. `pinnedHeading(pinnedCount, liveCount)` gives `Pinned N of M`, M
  counting live non-idea initiatives. Archived initiatives never count or show.
- **Activity model** (`briefactivity.ts`): input is the run lines the Brief already builds (`sessionLine`, shipped
  rows) and the council lines (`councilLines`). Output: `live` (live runs plus councils whose state is running,
  `awaiting-you` or `queued`, newest first), `earlier` (finished councils plus runs that ended failed or cancelled,
  within 7 days, newest first, shipped runs never), and the counts each tab shows. The filter is
  `ActivityFilter = "all" | "orchestrator" | "quick" | "councils"`; `orchestrator`/`quick` keep runs of that kind,
  `councils` keeps councils only, and the same filter narrows Shipped (under `councils` Shipped shows today's no-match
  sentence). `RunKindFilter` in `briefrows.ts` stays for the run sheet; Activity's filter maps onto it.
- **The initiative sheet's state** lives in a new `initiativesheetstore.ts`: `initiativeSheetAtom` holding
  `{ view: "plan" | "activity"; chunk: string | null }`, reset when the sheet opens another initiative, and a separate
  `chunkNotesOnlyAtom: boolean` that is NOT reset: the spec keeps Notes only per viewer, so it holds across chunks and
  initiatives for the session. `view: "activity"` draws today's `EffortDetailView` in the sheet body with a back link
  (what **Activity ↗** and `openref` `view: "activity"` open). `chunk` is the open chunk (Task 7 draws it).
  `openInitiativeChunk(oref, chunk)` in the same store opens the sheet on that chunk; the run sheet's ↳ reaches it
  through `briefRevealChunkAtom`, which the Brief publishes (Task 8). The sheet face in `briefsheetmodel.ts` stays
  `{ kind: "effort"; effortId }`.
- **Sheet heads.** `SheetShell` (`briefrunsheet.tsx`) gets a `head` slot that replaces its default header row; the run
  sheet keeps the default. Task 3 adds it (the council head needs it first); Task 6 uses it.
- **Page order for the sheet's Previous/Next** is `briefInitiativeListAtom: string[]` (effort orefs, cards then list)
  in `jarvisstore.ts` (added by Task 6), published by the Brief (Task 8) as it publishes `briefRunListAtom`.
- **The council sheet** is a separate atom `councilSheetAtom: string | null` (council id) in a new
  `councilsheetstore.ts` with `openCouncilSheet(id)`, mirroring the queue sheet (`briefQueueSheetAtom`): not a subject;
  opening it clears the subject and the queue sheet, and opening a subject or the queue sheet clears it. Face
  `{ kind: "council"; councilId }` in `briefsheetmodel.ts`.
- **Work on from a council opens the agent half of the New dialog.** `openLauncher` forces the run half whenever a
  prefill is passed, so Task 3 adds `openAgentLauncher(model, { project, task })` to `agents/launcherstore.ts`: opens
  the agent kind with the project selected (unset when it has no path) and `launcherTaskAtom` set. It never spawns.
- **Plan editing moves into one hook.** `useInitiativeEdits(oref)` in a new `initiativeedits.ts` builds today's
  `TrackerEdits` (the callbacks `briefsurface.tsx` builds now) plus the mutate error and the selected chunk. The sheet
  uses it; Task 8 deletes the Brief's in-place copy, so the end state has one builder.
- **Keys.** All the sheet's keys are defined by Task 6 in one `buildInitiativeSheetBindings(handlers)` in
  `bindings.ts` with their `when` predicates in `whenstate.ts` (predicate atoms `initiativeSheetOpen`, `chunkViewOpen`,
  kept complete for `store.test.ts`'s PREDICATE_ATOMS check): `j`/`k` step chunks (the plan view moves the chunk
  cursor; the chunk view steps to the neighbouring chunk), `s` opens the status menu, `1`–`6` choose (pending, active,
  blocked, deferred, skipped, done, in that order) in the chunk view, Esc in a chunk view goes back to the initiative.
  The views activate them with `useKeybindings` (Task 7 passes the chunk view's handlers; it does not edit
  `bindings.ts`). The page's own `j`/`k` must yield while the initiative or council sheet is open (Task 8, in
  `briefsurface.tsx`'s list nav). `p` pins/unpins the initiative under the page cursor (`jarvis:pin-initiative`, Task
  8). The in-place tracker's `noteChunkAtom`, `jarvis:close-notes` and `chunkMoveAtom` are retired by Task 8 with the
  in-place tracker; Task 6's chunk stepping replaces their job.
- **Scenario modules.** New scenarios go in their own module files, each a default-export factory taking a kit, as
  `scenarios-monitor-tasks.mjs` does: `scenarios-jarvis-cards.mjs` (Task 4), `scenarios-jarvis-activity.mjs` (Task 5),
  `scenarios-jarvis-sheet.mjs` (Tasks 6 and 7). Task 1 creates them empty and wires them into `scenarios.mjs` with a
  `JARVIS_KIT` of the helpers today's brief scenarios use (seeding goes through `h.rpc`, e.g.
  `h.rpc('effortpin', …)`); the council sheet's scenario goes in the existing `councilscenarios.mjs`. `scenarios.mjs`
  is edited by Task 1 (imports), Task 8 (the existing brief scenarios) and Task 9 (`brief-chunk-panel`).
- **The chunk view reuses `sidebarnotes.ts`** (the pure note helpers `chunksidebar.tsx` uses); `chunksidebar.tsx`'s
  private pieces (`NoteRun`…) are rewritten in `chunkview.tsx`, not imported. Task 8 deletes `chunksidebar.tsx` with
  its only caller; `sidebarnotes.ts` stays, used by `chunkview.tsx`.
- **CHANGELOG lines are written once, by Task 9**, for the whole revamp: parallel tasks may not share the file.

### Task 1: Pin types and the scenario scaffolding
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/waveobj/wtype.go`, `pkg/wshrpc/wshrpctypes_effort.go`, `pkg/wshrpc/wshserver/wshserver_effort.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `frontend/app/view/jarvis/effortmodel.ts`, `frontend/app/view/jarvis/effortmodel.test.ts`, `scripts/cdp/scenarios.mjs`, `scripts/cdp/scenarios-jarvis-cards.mjs`, `scripts/cdp/scenarios-jarvis-activity.mjs`, `scripts/cdp/scenarios-jarvis-sheet.mjs`

The interface the other tasks build on, small on purpose.
- `PinnedTs` on `waveobj.Effort` and `wshrpc.EffortSummary`; `CommandEffortPinData`, `CommandEffortPinRtnData`,
  `EffortPinRef` and `EffortPinCommand` on `EffortCommands` (header decision). The server method in
  `wshserver_effort.go` is a stub returning an error ("effort pin is not built yet") that Task 2 replaces, so the
  interface compiles. `task generate`; never hand-edit the generated files.
- `pinnedTs` on `EffortCardModel` (`buildEffortCard`).
- The three empty scenario modules (`export default function (kit) { return []; }`), imported and spread into
  `SCENARIOS` in `scenarios.mjs` with a `JARVIS_KIT` exposing the helpers the existing `brief-surface` /
  `brief-inline-tracker` / `brief-chunk-panel` scenarios use to seed initiatives, councils and runs and to open Jarvis
  (lift them to module-level functions if they are inline; behaviour unchanged).

Acceptance: `go build ./...` passes; `npx vitest run frontend/app/view/jarvis/effortmodel.test.ts` (the card carries
`pinnedTs`, 0 when absent); `node -e "import('./scripts/cdp/scenarios.mjs').then(m => console.log(m.SCENARIOS.length))"`
prints the same count as before without throwing. No view changes, so no scenario step.

### Task 2: Pins: the command, merge, CLI and the pin flow
**Depends on:** Task 1
**Model:** sonnet
**Files:** `pkg/jarvis/effortpin.go`, `pkg/jarvis/effortpin_test.go`, `pkg/jarvis/effortops.go`, `pkg/jarvis/effortops_test.go`, `pkg/effortstore/effortstore.go`, `pkg/effortstore/effortstore_test.go`, `pkg/wavevault/effortmerge.go`, `pkg/wavevault/effortmerge_test.go`, `pkg/wshrpc/wshserver/wshserver_effort.go`, `pkg/jarvisstate/jarvisstate.go`, `pkg/jarvisstate/jarvisstate_test.go`, `cmd/wsh/cmd/wshcmd-effort.go`, `cmd/wsh/cmd/wshcmd-effort_test.go`, `frontend/app/view/jarvis/effortstore.ts`, `frontend/app/view/jarvis/effortstore.test.ts`, `skills/initiatives/SKILL.md`

Decision 6, per the header's pin decisions.
- The pure choice in `pkg/jarvis/effortpin.go`: `PlanPin(all []*waveobj.Effort, targetOID string, pin, replaceOldest
  bool, now int64) (PinPlan, error)`: which efforts to stamp or clear and whether the cap was hit, ignoring archived
  efforts. The handler replaces Task 1's stub: loads the efforts, applies the plan through the keep-`UpdatedTs` store
  update, and fires the change event an effort mutate fires so the cockpit reloads.
- Archiving clears `PinnedTs` (`effortops.go`). `MergeEffort` merges `PinnedTs` three-way (header). The summary in
  `jarvisstate.go` copies `PinnedTs`.
- `wsh effort pin <effort> [--replace-oldest]` and `wsh effort unpin <effort>`; on the cap without the flag it prints
  the cap and the oldest pin's title and exits nonzero. Both in `skills/initiatives/SKILL.md`.
- `togglePin(oref)` in `effortstore.ts` (header).

Acceptance: `go test ./pkg/jarvis -run 'Pin|Archive'` (cap reached returns the oldest and changes nothing;
replace-oldest unpins the smallest `PinnedTs`; re-pin keeps its time; unpin clears; archived efforts neither count nor
get pinned; archive clears the pin), `go test ./pkg/effortstore -run 'KeepTs'` (Version bumps, UpdatedTs kept),
`go test ./pkg/wavevault -run 'MergeEffort'` (each side's pin change survives; both changed → larger),
`go test ./cmd/wsh/cmd -run 'EffortPin'`, `go test ./pkg/jarvisstate -run 'Summary'` (summary carries `pinnedts`),
`npx vitest run frontend/app/view/jarvis/effortstore.test.ts` (the cap path pushes one toast whose action re-calls with
`replaceoldest`; an RPC failure pushes an error toast). The pin is shown by Task 6's `jarvis-initiative-sheet` step
"pin" and Task 8's `brief-surface` step "pin key".

### Task 3: The council report in the sheet
**Depends on:** none
**Model:** sonnet
**Chunk:** Wave 2: council report in the sheet
**Files:** `frontend/app/view/jarvis/councilsheetstore.ts`, `frontend/app/view/jarvis/councilsheetmodel.ts`, `frontend/app/view/jarvis/councilsheetmodel.test.ts`, `frontend/app/view/jarvis/councilsheet.tsx`, `frontend/app/view/jarvis/briefsheetmodel.ts`, `frontend/app/view/jarvis/briefsheetmodel.test.ts`, `frontend/app/view/jarvis/briefsheet.tsx`, `frontend/app/view/jarvis/briefrunsheet.tsx`, `frontend/app/view/jarvis/briefqueuestore.ts`, `frontend/app/view/agents/launcherstore.ts`, `scripts/cdp/councilscenarios.mjs`

Decision 8, board `Council.dc.html`. `councilSheetAtom` and `openCouncilSheet(id)` per the header (Task 8 wires the
Activity line to it; export it); opening the queue sheet (`briefqueuestore.ts`) clears it. `SheetShell`'s `head` slot
(header decision). The content model is pure in `councilsheetmodel.ts`, built on
`frontend/app/view/agents/councilsummarymodel.ts` (`answerParts`, `directionRows`, `outcomeLabel`, `keptRows`,
`docPathLabel`…) — reuse it, do not re-derive: head (mode chip, question in two lines, `project · N experts · <age>`,
×), the verdict block (bold one-line verdict, summary clamped to three lines; a running council shows its round and
the live discussion link instead; a failed or stopped one says so with what finished), ranked directions (number,
title, outcome `✓ Agreed` or the challenged wording, First step in two lines, the proposal ids it came from), Ask next,
the folded `Also raised N · Matrix · N proposals` line that opens in place, and the foot (Open chat → today's
`showCouncil` Discussion; Full report ↗ → the saved `docs/council/…` file, path in `muted`).
- **Work on** calls `openAgentLauncher` (header decision; add it to `launcherstore.ts`) with the council's project and
  the direction's title plus its first step. It never spawns.
- **Add to initiative…** opens the existing `InitiativePicker`; the picked initiative gets the first step as a chunk.
- **Ask in chat** opens the council's chat with the question drafted (`councilChatDraftAtom` in
  `agents/councilstore.ts`).
- The `council` face in `briefsheetmodel.ts`, rendered by `briefsheet.tsx` in the 640px sheet; Esc and the backdrop
  close it as today.

Acceptance: `npx vitest run frontend/app/view/jarvis/councilsheetmodel.test.ts
frontend/app/view/jarvis/briefsheetmodel.test.ts` (directions ranked, outcome words, verdict for done/running/failed,
the launcher input with and without a project path, the council face routing and clearing both ways). New scenario
`jarvis-council-sheet` in `councilscenarios.mjs` (use only the helpers `makeCouncilScenarios` already receives, or
define what you need inside the module): seeds a finished council, opens it with `openCouncilSheet` through the page;
step "council sheet open" shots the sheet and asserts the verdict block, the directions with First step and both
actions, Ask next and the foot; step "work on prefills" clicks Work on and asserts the New dialog's agent half shows
the direction in its task box and no agent was spawned; step "running council" shows the round instead of the verdict.

### Task 4: Pinned cards and the compact list
**Depends on:** Task 1 (uses `pinnedTs` and the cards scenario module)
**Model:** sonnet
**Files:** `frontend/app/view/jarvis/briefcards.ts`, `frontend/app/view/jarvis/briefcards.test.ts`, `frontend/app/view/jarvis/initiativecards.tsx`, `frontend/app/view/jarvis/initiativelist.tsx`, `frontend/app/view/jarvis/briefrowviews.tsx`, `scripts/cdp/scenarios-jarvis-cards.mjs`

Decisions 3 and 4, board `Main.dc.html`. The pure model per the header (`pinnedCards`, `listAfterCards`,
`pinnedHeading`, plus the card's face: `done/total`, percent, status cell — `● agent open` success, `● blocked` amber,
`idle 2w` faint, else the date — and `Next`/`Blocked on` with that chunk). `SegmentBar` colours and size per the
header. Components, presentational, every action a prop (`onOpen`, `onWork`, `onMenu`, `onPin`, `onPeek`) so
`briefsurface.tsx` (Task 8) wires them:
- `InitiativeCards`: the heading `Initiatives · Pinned N of M` with a `review` slot at its right end, the 3 × 2 grid
  (two columns below ~1280px; DESIGN.md card-grid rules; `bg-surface-raised border-edge-mid`, radius 10px), each card
  as specified (title 14px semibold in two lines + pin glyph, `project · updated <age>`, the large count, the bar,
  Next/Blocked on in two lines, **Work on**/**Go to agent** and `⋯`), the quiet "Pin an initiative" slot when 1–5 are
  pinned, a `cursor` prop for the page cursor and an `opened` prop for the accent outline under the sheet.
  `data-jarvis-card="<oref>"`, `data-jarvis-cards-heading`.
- `InitiativeList`: `All initiatives` with a `tabs` slot (today's project tabs), 36px rows (title · project, small bar
  with `done/total`, `Next` and its chunk on one line, the date, a pin button shown on hover or cursor), sub-initiative
  indent, six rows then `+N more`. `data-jarvis-initiative-row="<oref>"`.

Acceptance: `npx vitest run frontend/app/view/jarvis/briefcards.test.ts` (no pins → first six of the ordered list;
pins → pins only in pin order; archived pins drop out; cards never repeat in the list, fallback cards included; a
card's child sits at depth 0 with its parent named; M excludes ideas and archived; status cell per state). Scenario
`jarvis-brief-cards` in `scenarios-jarvis-cards.mjs` (it passes once Task 8 mounts the components): seed nine
initiatives, two pinned (`h.rpc('effortpin', …)`); step "pinned cards" shots the Initiatives region and asserts two
cards in pin order, the "Pin an initiative" slot and `Pinned 2 of 9`; step "list" asserts six of the other seven rows
with `+1 more` and no card repeated; step "no pins" unpins both through `h.rpc('effortpin', {pin: false, …})` and
asserts six fallback cards; step "narrow" sets the window to 1200px and asserts two columns.

### Task 5: Activity in the side column
**Depends on:** Task 1 (uses the activity scenario module and the kit)
**Model:** sonnet
**Files:** `frontend/app/view/jarvis/briefactivity.ts`, `frontend/app/view/jarvis/briefactivity.test.ts`, `frontend/app/view/jarvis/activityregion.tsx`, `scripts/cdp/scenarios-jarvis-activity.mjs`

Decision 5, board `Main.dc.html`. The pure merge per the header in `briefactivity.ts` (live, earlier within 7 days,
shipped excluded, filter tabs including `councils`, counts, the window of five then `+N more`, the `+N runs older than
7 days` toggle's count). `ActivityRegion`, presentational: head `Activity` with `N live`, the tabs, an `ack` slot
(Accept N unverified) and the region-only button slot; live cards (kind, stage word in its status colour, title in two
lines, `runtime · project · age`); a `Queued N` line under them (`onOpenQueue`); `Earlier · 7 days`, 30px lines (kind
chip, title, age), five then `+N more`, then the older-than-7-days toggle. Every open is a prop (`onOpenRun`,
`onOpenCouncil`) so `briefsurface.tsx` (Task 8) wires the run sheet and `openCouncilSheet`. `data-jarvis-activity-card`,
`data-jarvis-activity-line`.

Acceptance: `npx vitest run frontend/app/view/jarvis/briefactivity.test.ts` (merge order; an `awaiting-you` and a
`queued` council are live cards; shipped never in Earlier, failed/cancelled runs are; the 7-day cut; each tab's filter;
Shipped narrowed by the tab). Scenario `jarvis-brief-activity` in `scenarios-jarvis-activity.mjs` (passes once Task 8
mounts it): seed a live run, a running council, a finished council and a failed run; step "activity" shots the side
column top and asserts two live cards and two Earlier lines; step "councils tab" asserts only councils show and
Shipped narrows; step "open council line" clicks the finished council's line and asserts the council sheet opens.

### Task 6: The initiative in the sheet
**Depends on:** Task 2 (uses `togglePin` for the head's Pin), Task 3
**Model:** sonnet
**Files:** `frontend/app/view/jarvis/initiativesheet.tsx`, `frontend/app/view/jarvis/initiativesheetstore.ts`, `frontend/app/view/jarvis/initiativeedits.ts`, `frontend/app/view/jarvis/initiativeedits.test.ts`, `frontend/app/view/jarvis/inlinetrackerview.tsx`, `frontend/app/view/jarvis/inlinetracker.ts`, `frontend/app/view/jarvis/inlinetracker.test.ts`, `frontend/app/view/jarvis/briefsheet.tsx`, `frontend/app/view/jarvis/briefrunsheet.tsx`, `frontend/app/view/jarvis/briefsheetmodel.ts`, `frontend/app/view/jarvis/briefsheetmodel.test.ts`, `frontend/app/view/jarvis/jarvisstore.ts`, `frontend/app/view/jarvis/openref.ts`, `frontend/app/view/jarvis/openref.test.ts`, `frontend/app/view/jarvis/effortdetailview.tsx`, `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `frontend/app/store/keybindings/whenstate.ts`, `frontend/app/store/keybindings/store.test.ts`, `docs/keyboard-shortcuts.md`, `scripts/cdp/scenarios-jarvis-sheet.mjs`

Decision 7, board `Sheet.dc.html`. The effort face of `briefsheet.tsx` draws `InitiativeSheet` instead of
`EffortDetailView`, through `SheetShell`'s `head` slot:
- Head: title (17px), `project · status · updated <age>`, **Pinned**/**Pin** (`togglePin`), Previous/Next over
  `briefInitiativeListAtom` (new in `jarvisstore.ts`), ×; the large `done/total`, percent and `SegmentBar`;
  **Work on**/**Go to agent** (`w`, `initiativework.ts`), the agent state, **Activity ↗** (sets
  `initiativeSheetAtom.view` to `activity`: `EffortDetailView` with a back link), `⋯` (rename, details, pause,
  archive, delete — today's initiative menu actions).
- Body: the chunk list with plan editing, from `InitiativeDetail` and `useInitiativeEdits` (header): stage headers that
  fold, rename/delete a stage, Move to stage, `+ Add chunk` per stage, double-click rename, move up/down, remove,
  proposed accept/drop. Rows restyled: status glyph, label in two lines, note count, status word; the next chunk marked
  with an accent `→` and a raised row. The `10 rows, then +N more` cap applies only to a folded stage's preview;
  unfolded stages show every chunk and the body scrolls. Then sub-initiatives and linked ideas (`LinkedInitiatives`).
- Export `InitiativeSheetHead` and `InitiativeChunkList` as components the review pass (Task 8) draws in place, and
  `openInitiativeChunk` (header). Picking a chunk sets `initiativeSheetAtom.chunk` (Task 7 draws it).
- `openref.ts` `selectEffort` always opens the sheet (the proposed-chunks route to the in-place expansion goes; the
  sheet keeps accept/drop). `briefOpenInitiativeAtom` stays defined until Task 8 removes its last reader.
- Keys: every sheet key in `buildInitiativeSheetBindings` with its predicates (header decision); the plan view
  activates `j`/`k`. `docs/keyboard-shortcuts.md` lists all of them, the chunk view's included.
- Keep `InitiativeDetail`'s props backward compatible: `briefsurface.tsx` still draws it in place until Task 8.

Acceptance: `npx vitest run frontend/app/view/jarvis/initiativeedits.test.ts
frontend/app/view/jarvis/inlinetracker.test.ts frontend/app/view/jarvis/briefsheetmodel.test.ts
frontend/app/view/jarvis/openref.test.ts frontend/app/store/keybindings/store.test.ts
frontend/app/store/keybindings/bindings.test.ts` (folded-stage preview cap vs unfolded full list, next-chunk marker,
a proposed effort opens the sheet, Previous/Next positions, the predicate atoms complete). Scenario
`jarvis-initiative-sheet` in `scenarios-jarvis-sheet.mjs`: seed an initiative with two stages, a proposed chunk and a
sub-initiative, open it through `openref`; step "sheet open" shots the sheet and asserts head, count, bar, next-chunk
`→` and both stages; step "edit plan" adds a chunk with `+ Add chunk` and renames one by double-click; step "pin"
clicks Pin and asserts Pinned; step "activity" clicks Activity ↗, asserts the feed, then goes back; step "chunk keys"
presses `j` twice and asserts the cursor moved two chunks.

### Task 7: The chunk inside the initiative sheet
**Depends on:** Task 6
**Model:** sonnet
**Files:** `frontend/app/view/jarvis/chunktrail.ts`, `frontend/app/view/jarvis/chunktrail.test.ts`, `frontend/app/view/jarvis/chunkview.tsx`, `frontend/app/view/jarvis/initiativesheet.tsx`, `frontend/app/view/jarvis/initiativesheetstore.ts`, `frontend/app/view/jarvis/sidebarnotes.ts`, `frontend/app/view/jarvis/sidebarnotes.test.ts`, `scripts/cdp/scenarios-jarvis-sheet.mjs`

Decision 9, board `Chunk.dc.html`. With `initiativeSheetAtom.chunk` set, the sheet body is `ChunkView`:
- Head (42px): `← <initiative title>` back, `chunk n / total`, ↑/↓ (`k`/`j`), copy the `wsh effort note …` command, ×.
  The label (15px semibold).
- Status: one button (glyph, status word, `▾`, key `s`) opening a menu of the six statuses with keys `1`–`6`;
  `blocked` asks for a one-line reason written as the change's note. The one-move button beside it and its targets as
  the spec says (pending → Start `active`; active → Done, which is `advanceChunk` when it is the active chunk, else
  `done`; done → Reopen `reopenChunk`; blocked → Unblock `active`; deferred/skipped → Reopen `pending`). Work on / Go
  to agent stays in the head when an agent can take it.
- Trail, newest first, split in pure `chunktrail.ts` (on top of `sidebarnotes.ts`): a note (text, any author, a status
  change with text included) is a block — who (you `accent-soft`, agent `success`), time, `→ <status>` tag when it
  changed the status, text clamped to four lines with Show all, Open agent session ↗ / Open run ↗, Edit/Delete on the
  person's own; a bare status change (empty note) is a thin 30px line. **Notes only** (`chunkNotesOnlyAtom`) hides
  the thin lines.
- Foot: Add a note… (Ctrl+Enter adds, Esc clears), as `chunksidebar.tsx` does today — read it for the behaviour, do
  not import it (Task 8 deletes it).
- Keys: activate Task 6's `buildInitiativeSheetBindings` chunk-view handlers (`j`/`k`, `s`, `1`–`6`, Esc back) with
  `useKeybindings`; do not edit `bindings.ts`.

Acceptance: `npx vitest run frontend/app/view/jarvis/chunktrail.test.ts frontend/app/view/jarvis/sidebarnotes.test.ts`
(bare vs note entries, newest first, a status change with text is a block with its tag, the notes-only filter, the
one-move button's target per status). Scenario `jarvis-chunk-sheet` in `scenarios-jarvis-sheet.mjs`: open an
initiative in the sheet, click a chunk with three notes and two bare status changes; step "chunk open" shots it and
asserts the head, the blocks and the thin lines; step "status menu" presses `s` and shots the open menu (the board's
state); step "blocked reason" picks blocked, types a reason and asserts the new block tagged `→ blocked`; step "notes
only" toggles it and asserts the thin lines are gone, then opens another chunk and asserts it is still on; step "back"
presses Esc and asserts the initiative view.

### Task 8: The Brief page: strip, cards, list, Activity, review pass, tour
**Depends on:** Task 3 (wires `openCouncilSheet`), Task 4 (mounts `InitiativeCards` and `InitiativeList`), Task 5 (mounts `ActivityRegion`), Task 6
**Model:** opus
**Files:** `frontend/app/view/jarvis/briefsurface.tsx`, `frontend/app/view/jarvis/waitingstrip.tsx`, `frontend/app/view/jarvis/briefqueuesheet.tsx`, `frontend/app/view/jarvis/briefingmodel.ts`, `frontend/app/view/jarvis/briefingmodel.test.ts`, `frontend/app/view/jarvis/briefnav.ts`, `frontend/app/view/jarvis/briefnav.test.ts`, `frontend/app/view/jarvis/chunksidebar.tsx`, `frontend/app/view/jarvis/jarvisstore.ts`, `frontend/app/view/jarvis/openref.ts`, `frontend/app/view/jarvis/openref.test.ts`, `frontend/app/view/jarvis/jarvistour.ts`, `frontend/app/view/jarvis/jarvistour.test.ts`, `frontend/app/view/jarvis/jarvistourcontent.ts`, `frontend/app/view/jarvis/jarvistouractions.ts`, `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `frontend/app/store/keybindings/whenstate.ts`, `frontend/app/store/keybindings/store.test.ts`, `docs/keyboard-shortcuts.md`, `scripts/cdp/scenarios.mjs`

Decisions 1, 2, 3–5 wiring, 10, keyboard and narrow windows, board `Main.dc.html`. `briefsurface.tsx` is ~3000 lines:
read it by region (`grep -n` the `Region` and `data-jarvis-brief-region` marks), not whole.
- Main column: the Waiting strip (`WaitingStrip` in the new `waitingstrip.tsx`: 44px, faint `asking` edge, `● Waiting
  on you N`, the most urgent item's kind chip, title, its own action, **Show all N ▾** opening today's queue rows in
  place; not drawn with nothing waiting; order from `briefqueue.ts`), then `InitiativeCards` and `InitiativeList`
  (Task 4) with **Review · N** in the cards heading and today's project tabs on the list (tabs narrow the list only).
  The `⋯` menu is today's `showInitiativeMenu` plus Pin/Unpin (`togglePin`).
- Initiatives no longer expand in place: Enter or a click on a card or row opens the sheet; the opened one keeps the
  accent outline. Delete the in-place expansion, the `ChunkSidebar` aside and `chunksidebar.tsx` (grep every import
  first; `sidebarnotes.ts` stays), `briefOpenInitiativeAtom` (and its uses in `openref.ts` / `openref.test.ts`), the
  Brief's own `TrackerEdits` builder, and `noteChunkAtom` / `jarvis:close-notes` / `chunkMoveAtom` with their
  bindings and predicates. Publish `briefInitiativeListAtom` (cards then list). Publish `briefRevealChunkAtom` as
  `openInitiativeChunk`, so the run sheet's ↳ opens the initiative sheet on that chunk.
- Side column: `ActivityRegion` (Task 5) on top (Runs and Councils leave the main column; their tabs, Accept N
  unverified, Queued N, the older-than-7-days toggle and the region-only button move into it; drop the dead `after`
  slot), then Since you looked, Shipped (filtered by the Activity tab), Ideas. The run sheet's Previous/Next steps
  live then Earlier from Activity, or Shipped from Shipped (`briefRunListAtom`). A council line calls
  `openCouncilSheet`. Below ~1280px the side column drops under the main column and the cards go two columns.
- Review pass: takes the Initiatives region over as today, cursor `j`/`k`/Enter kept; its open initiative draws Task
  6's `InitiativeSheetHead` and `InitiativeChunkList` in place. Peek on a card or row peeks as today.
- Keyboard: page `j`/`k` order strip item → cards row by row → list rows → Activity → Since you looked → Shipped →
  Ideas (`briefnav.ts`), yielding while the initiative or council sheet is open; Enter opens, `w` works on, `p` pins
  (`jarvis:pin-initiative` in `bindings.ts` and `docs/keyboard-shortcuts.md`).
- Tour: rewrite the stops (`jarvistourcontent.ts`, `jarvistour.ts`) to the strip, the cards, the list and Activity,
  and `jarvistouractions.ts`' prepare steps that expanded an initiative card in place to open the sheet instead.
- Scenarios (`scenarios.mjs`): update `brief-surface`, `brief-layout`, `brief-inline-tracker` (plan editing now in the
  sheet) and `jarvis-tour`. Run `jarvis-brief-cards` and `jarvis-brief-activity` and fix what fails on your side.

Acceptance: `npx vitest run frontend/app/view/jarvis/briefnav.test.ts frontend/app/view/jarvis/briefingmodel.test.ts
frontend/app/view/jarvis/jarvistour.test.ts frontend/app/view/jarvis/openref.test.ts
frontend/app/store/keybindings/store.test.ts frontend/app/store/keybindings/bindings.test.ts` (cursor order across
strip, cards, list, Activity; tour stops resolve; predicates complete). Scenario steps: `brief-layout` step "page
order" shots the whole Brief and asserts the strip above the cards above the list, and Activity first in the side
column; `brief-layout` step "narrow" at 1200px asserts two card columns and the side column under the main;
`brief-surface` step "strip show all" clicks Show all and asserts the queue rows open under the strip; `brief-surface`
step "open card" presses Enter on a card and asserts the sheet with the card outlined; `brief-surface` step "step
initiatives" clicks the sheet's Next and asserts the next initiative in page order; `brief-surface` step "pin key"
presses `p` on a list row and asserts it becomes a card; `brief-surface` step "review pass" starts Review and asserts
the in-place head and chunk list; `brief-inline-tracker` passes against the sheet; `jarvis-tour` walks every new stop;
`jarvis-brief-cards` and `jarvis-brief-activity` pass; `surface-smoke` passes.

### Task 9: Chunk scenarios, the run row's ↳, and the CHANGELOG
**Depends on:** Task 7 (shows its chunk view), Task 8
**Model:** sonnet
**Chunk:** Wave 1: Brief page + initiative sheet
**Chunk:** Wave 3: Waiting queue, peek, chunk panel, review pass
**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

The small last task, so the Brief rewrite runs beside the chunk view.
- Retarget `brief-chunk-panel` to the chunk inside the sheet: step "chunk in sheet" opens an initiative from a card,
  clicks a chunk and asserts `ChunkView` (no 460px aside anywhere); step "run row reveal" opens a run sheet whose run
  is attached to a chunk, clicks its ↳ and asserts the initiative sheet opens on that chunk.
- `CHANGELOG.md`: the user-facing lines for the whole revamp under `Unreleased` (pins and `wsh effort pin|unpin`, the
  cards and list, Activity, the initiative sheet, the chunk view, the council sheet), `<!-- try: … -->` where a
  global binding opens it, `<!-- big -->` on the pinned-cards Brief.

Acceptance: `brief-chunk-panel` and `jarvis-chunk-sheet` pass (`task verify:ui -- brief-chunk-panel
jarvis-chunk-sheet`).
