# Revamp Jarvis: the fix round

**Effort:** effort:0731d962-3fec-4591-91e5-009e744e9154
**Spec:** `docs/superpowers/specs/2026-11-05-jarvis-revamp-design.md`
**Check:** `task check:ts`

The run built the whole spec and its final stage passed. This round closes the three open issues the run left, each
in files no other task in the round touches, so all three run at once. Every task touches the frontend, so Check is
the typecheck (`task check:ts`, ~2 min: give it a longer timeout than 2 minutes). A round runs the run's own Verify
and Final, and that Final does not name `dag-lifecycle` or `brief-run-queue`, so Task 3's worker runs those two itself
and its report carries the PASS table.

## Decisions (the lead's calls)

- **Earlier gets its runs from the server, as Shipped does.** The spec puts "one 30px line per run that ended without
  shipping (failed, cancelled)" under `Earlier · 7 days`. No run reaches the Brief once it ends: `jarvisstate.ActiveWork`
  drops `done` and `cancelled`, and `Shipped` keeps only sealed `done` runs. No run status is `failed` (jarvis
  declares planning, awaiting-review, executing, blocked, done, cancelled), so "ended without shipping" is `cancelled`.
  A `done` run without sealed evidence stays out (YAGNI: nothing asks for it). The source is a sibling of `Shipped`:
  `jarvisstate.Ended(runs, windowStartMs)` over the same fetched runs and window, DAG workers and brainstorm sessions
  excluded as `ActiveWork` excludes them, newest first, carried per project beside `Shipped`.
- **The dead code goes.** Task 8 of the run left code with no caller; AGENTS.md's housekeeping rule is removal.
- **Scenarios that drove the removed Runs region are retargeted, not deleted.** They test live behaviour (a DAG run's
  sheet, the run queue) that still exists through Activity; a step whose UI the revamp removed is retired with a
  one-line comment naming the spec decision, not left failing.

### Task 1: Runs that ended without shipping reach Earlier
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/jarvisstate/jarvisstate.go`, `pkg/jarvisstate/jarvisstate_test.go`, `pkg/jarvisstate/fetch.go`, `pkg/wshrpc/wshrpctypes_jarvis.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `frontend/app/view/jarvis/briefingmodel.ts`, `frontend/app/view/jarvis/briefingmodel.test.ts`, `frontend/app/view/jarvis/briefsurface.tsx`, `scripts/cdp/scenarios-jarvis-activity.mjs`

Interface: `wshrpc.EndedItem{project, runoid, goal, status, mode, completedts}` (json lower-case, `mode` omitempty)
and `Ended []EndedItem json:"ended,omitempty"` on the per-project briefing struct that holds `Shipped`;
`jarvisstate.Ended(runs []*waveobj.Run, windowStartMs int64) []wshrpc.EndedItem`, called in `fetch.go` beside
`Shipped` with the same window and grouped by project the same way. Run `task generate` after the Go type change;
never hand-edit the generated files. `briefingmodel.ts` maps them into an `ended` list on the briefing (seven-day
window, as it windows Shipped). `briefsurface.tsx` feeds each as an `ActivityRunInput` with `status: "cancelled"`
(the item's status), `ts: completedts`, so `buildActivity`'s existing Earlier rule files it; a line opens the run sheet
on that run through the same handler a live run card uses, and the run sheet's Previous/Next steps through live runs
then Earlier (spec line 79) via `briefRunListAtom`.

Acceptance: `go test ./pkg/jarvisstate -run 'Ended'` (a cancelled run in the window is listed; a `done`, an in-flight,
a DAG worker and a run older than the window are not; newest first). `npx vitest run
frontend/app/view/jarvis/briefingmodel.test.ts` (ended runs mapped and windowed). Scenario `jarvis-brief-activity`
seeds, in addition to what it has, a fixture run it then cancels (`h.rpc("cancelrun", …)`, as `scenarios.mjs` does);
step "activity" asserts that run's `[data-jarvis-activity-line="run"]` under Earlier; a new step "open ended run"
clicks it and asserts the run sheet opens on it.

### Task 2: Delete the code the revamp left without a caller
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/jarvis/inlinetracker.ts`, `frontend/app/view/jarvis/inlinetracker.test.ts`, `frontend/app/view/jarvis/inlinetrackerview.tsx`, `frontend/app/view/jarvis/briefrowviews.tsx`

Remove, after grepping every importer (including `import type` and re-exports) to confirm none is left outside these
files: `trackerRows`, `trackerNavIds`, `expandableORef`, `isFlatPlan` in `inlinetracker.ts` with their tests (keep
`initiativeRows`, `chunkRowId` and whatever the sheet uses); `InitiativeDetail`'s `variant="inline"` path in
`inlinetrackerview.tsx` (the sheet's variant stays; fix the header comment that still names `chunksidebar.tsx`);
`RunRowView`, `QueuedRunRowView`, `CouncilRowView` in `briefrowviews.tsx`, and any helper only they used. Anything a
grep shows still in use stays, and the report says which and where.

Acceptance: `npx vitest run frontend/app/view/jarvis` passes; `task check:ts` is clean; no UI changes (no scenario).

### Task 3: Retarget the scenarios that drove the old Runs region
**Depends on:** none
**Model:** sonnet
**Files:** `scripts/cdp/scenarios.mjs`

`dag-lifecycle` (around `scenarios.mjs:13730`) finds its parent run by `[data-jarvis-brief-row="session"]` and expands
`[data-jarvis-brief-region="sessions"] [data-jarvis-brief-more]`; the revamp moved live runs into Activity
(`[data-jarvis-activity-card="run"]` in `[data-jarvis-brief-region="activity"]`). Find the run's card there and click
it to open the run sheet; the rest of the scenario (Open DAG) is unchanged. `brief-run-queue` (`BQ_ROWS`, around
`scenarios.mjs:52785`) reads queued runs as rows in the Runs region; the revamp shows them as one `Queued N` line in
Activity that opens the queue sheet, which steps through the queued plans with n / N and Previous/Next
(`briefqueuesheet.tsx`). Retarget each step to that: the count from the Queued line, the sheet from clicking it, the
plans through Next. A step whose UI is gone (a queued row's own cursor or Enter on the page) is retired with a comment
naming spec decision 5. Read `activityregion.tsx`, `briefqueuesheet.tsx` and `waitingstrip.tsx` for the hooks; add no
hook to them (outside this task's files): select by text where no hook exists, and say so in the report.

Acceptance: `CDP_PORT=<port> task verify:ui -- dag-lifecycle brief-run-queue` passes on a dev app
(`scripts/cdp/final-verify.mjs dag-lifecycle brief-run-queue` starts one), and each retained step still asserts what
it asserted before through the new UI.
