# Autonomous runs: round 1 fixes

Two defects the final stage and Task 9 found on the merged result. Spec: `docs/superpowers/specs/2026-10-13-autonomous-runs-design.md`; boards in `.superpowers/design/autonomous-runs/project/` (RunSheet.dc.html is the one that matters here).

### Task 1: Saved notice shows only while the draft equals what was saved
**Depends on:** none
**Files:** `frontend/app/view/jarvis/briefrunsheet.tsx`, `scripts/cdp/scenarios.mjs`

On the RunSheet board the saved line shows only while the draft equals what was saved: picking a segment clears it (`saved = justSaved && !dirty`). In the tree, after an ON save, picking Ask me shows "Saved. The run is autonomous from now on." beside "The lead asks you again from its next decision. Calls it already made stand." The final verifier recorded both lines together in `autonomous-runs` run-sheet step 4 (`backToAsk`).

- In `briefrunsheet.tsx`, render the notice (the `notice != null` branch, near the Save settings button) only when the draft is not dirty, so any change to any dial hides it and returning the draft to the saved values does not bring back a stale line. Keep the existing `setNotice` calls; do not add a second piece of state.
- In `scripts/cdp/scenarios.mjs`, `autonomous-runs` run-sheet step 4: assert that no saved line is shown after picking Ask me and before the Ask me save, then that the turn-off saved line ("Saved. The lead asks you from its next decision.") shows after it. Run `task verify:ui -- autonomous-runs` against a dev app (or `node scripts/cdp/final-verify.mjs autonomous-runs`) and report the result.

### Task 2: A stored width of 0 no longer blocks the Approvals save
**Depends on:** Task 1
**Files:** `frontend/app/view/jarvis/runsettings.ts`, `frontend/app/view/jarvis/runsettings.test.ts`, `frontend/app/view/jarvis/briefrunsheet.tsx`, `frontend/app/cockpit/actions/run.ts`, `frontend/app/view/agents/leadcardactions.ts`

An orchestrator run created without a width (`wsh runs start` or `createrun` with no parallelism and a profile without one, before the engine picks a width at submit) stores `parallelism: 0`. Decision 8 says the dials never block each other, but today:
- the palette's Go autonomous / Ask me again toggle sends `settingsChangePayload(...)`, which always carries the stored width, and `SetRunSettingsCommand` refuses 0 through `validateParallelism(0, false)`, so the toggle silently changes nothing;
- the run sheet's draft is invalid ("Enter a whole number from 1 through 8...") so Save settings stays disabled, even when only Approvals changed.

The server already leaves an omitted width alone (`CommandSetRunSettingsData.Parallelism` is `*int`). Fix it on that rule, the same one `autonomous` follows:
- `settingsChangePayload` sends `parallelism` only when the change sets it (the lead card's width control in `leadcardactions.ts` sets it and must keep working).
- `settingsPayload` sends `parallelism` only when the draft's width differs from the saved one. Change its last parameter from `savedAutonomous: boolean` to the saved draft (`saved: RunSettingsDraft`) and update the one caller in `briefrunsheet.tsx`.
- In `briefrunsheet.tsx`, the width is invalid only when the user changed it: an untouched stored 0 does not disable Save settings or show the width error. "Use for new runs" keeps its current rule (it copies the width into the profile, so a 0 there stays refused).
- Tests in `runsettings.test.ts`: the palette change `{ autonomous: true }` over a run with parallelism 0 has no `parallelism` key; a sheet save that changes only Approvals over a stored 0 has no `parallelism` key; a save that changes the width sends it; the lead card change `{ parallelism: 3 }` sends 3. Update existing expectations that assumed the width is always sent, and say which in the report.
