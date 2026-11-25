# Kael sync 11-25 (1 of 3): the orchestrator fast track

**Spec:** `docs/superpowers/specs/2026-11-25-kael-sync-fast-track-design.md` (the port's calls and the fork-to-main file map; the design itself is `git show kael/main:docs/superpowers/specs/2026-11-23-orchestrator-quick-track-design.md`)
**Verify:** `node scripts/verify.mjs ./pkg/orchestrate ./pkg/jarvis ./pkg/waveobj ./pkg/wshrpc/... ./cmd/wsh/cmd ./claude/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs kael1125-fast-track-label kael1125-fast-track-views model-picks plan-review-rounds kael1113-final-stage`

Shape of the work: Task 1 lands the names every later task builds on (wire fields, keys, titles, empty scenario
modules). Then five tasks run side by side: Task 2 (tasks skip review, report at merge), Task 3 (the end review),
Task 4 (the light plan review), Task 6 (the fast track label) and Task 7 (the run views). Task 5 turns the track on
at submit once 2, 3 and 4 have landed, so no merge in between runs a small plan-file dag half on the fast track.
Task 8 writes the docs last.

Rules for every task:

- Principles: simple and direct, KISS, YAGNI, DRY, one source of truth; measure before optimizing; no abstraction for
  a single implementation; handle errors at the boundaries and never swallow one silently (a failed read logs and
  says what it lost, as the fork's code does).
- **How to port.** The fork is the `kael` remote (fetched; tip `45edf22ed`). Read the commit named in your task with
  `git show <hash>` and a file at the fork tip with `git show kael/main:<path>`, then port the behaviour into `main`'s
  shape; `git cherry-pick -n` only where it applies cleanly. Port the fork's tests with the behaviour, adapted to
  `main`'s helpers. Nothing merges from `kael`.
- **Do not flip a pinned behaviour.** Where a fork hunk would reverse what a test on `main` pins (see the
  "Kael sync 11-13, owner decision" rows in `docs/open-issues.md` for the kind), leave `main`'s behaviour and test as
  they are and write a `Not ported: <hunk>: <why, naming the test>` line in your worker report's **For later tasks**
  section (not only the commit body: the lane's squash message is only the task labels, `laneMergeMessage`,
  `lane.go:97`). Task 8 depends on every task, so the engine hands it each of those sections at dispatch, and it turns
  them into open-issues rows.
- Never hand-edit generated files (`frontend/types/gotypes.d.ts`, `frontend/app/store/wshclientapi.ts`,
  `pkg/wshrpc/wshclient/wshclient.go`): edit the Go types and run `task generate`.
- Frontend: testable logic in the pure `.ts` beside its test, the `.tsx` thin; colors from `@theme` tokens only; read
  `DESIGN.md` before styling. Lint and format only the paths you touched (`npx eslint <paths>`,
  `npx prettier --check <paths>`); never run prettier on `scripts/*.mjs`.
- Run only the focused tests your task names (Go: `go test ./pkg/x -run '<names>'`, with
  `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` on Windows; vitest: `npx vitest run <file>`), never a whole
  package or the suite: Verify runs those at merge.
- Commits carry no attribution trailer.

### Task 1: Fast-track names, titles, wire shapes and empty scenario modules
**Depends on:** none
**Files:** `pkg/waveobj/wtype.go`, `pkg/jarvis/plan.go`, `pkg/jarvis/usage.go`, `pkg/orchestrate/planreview.go`, `pkg/orchestrate/final.go`, `pkg/orchestrate/engine.go`, `pkg/orchestrate/mutation.go`, `pkg/orchestrate/verifier_test.go`, `pkg/wshrpc/wshserver/wshserver_resmon.go`, `pkg/wshrpc/wshserver/wshserver_resmon_test.go`, `frontend/types/gotypes.d.ts`, `frontend/app/view/agents/runlineage.ts`, `frontend/app/view/agents/runlineage.test.ts`, `frontend/app/view/agents/runtimeline.ts`, `frontend/app/view/agents/runtimeline.test.ts`, `scripts/cdp/scenarios.mjs`, `scripts/cdp/scenarios-kael1125-label.mjs`, `scripts/cdp/scenarios-kael1125-views.mjs`

Port fork commit `bc384462e` with no behaviour change, plus the two name-only hunks of `02cfa844d` (the
`stopped` state in `FinalEndReview`'s comment, the resmon role).

Interface other tasks rely on (exact names):
- `waveobj.TaskGroup.FastTrack bool` (`json:"fasttrack,omitempty"`); `waveobj.PlanReviewStage.Amended bool`
  (`json:"amended,omitempty"`); `waveobj.FinalStage.EndReview *FinalEndReview` (`json:"endreview,omitempty"`);
  `waveobj.FinalEndReview{State, RunID, StartedTs, Respawns, Text, Unverified, Waiting, Judged}` with the fork's json
  tags (`state`, `runid`, `startedts`, `respawns`, `text`, `unverified`, `waiting`, `judged`); State is
  `reviewing | passed | failed | lost | stopped`.
- `jarvis.FastTrackMaxTasks = 4` (`pkg/jarvis/plan.go`), `jarvis.UsageRole_EndReviewer = "end-reviewer"`.
- `orchestrate.PlanReviewLens_Light = "light"`, titled "Light review" in `planReviewLensTitles`;
  `orchestrate.FinalStep_Review = "review"` (a final-step event's step, never `FinalStage.Step`).
- `childRunIDs` and `sessionRunIDs` list `Final.EndReview.RunID` after the verifier's when it is set.
- resmon names a session with StageRole `end-reviewer` "End reviewer".
- Frontend titles: `stageLabel("end-reviewer")` = "End review" (`runlineage.ts`); `eventTitle` of a started
  `end-reviewer` = "End reviewer started", `planReviewLensTitle("light")` = "Light review", final step `review` =
  "End review" (`runtimeline.ts`).
- Run `task generate` for `gotypes.d.ts`.
- Create `scripts/cdp/scenarios-kael1125-label.mjs` and `scripts/cdp/scenarios-kael1125-views.mjs`, each a module of
  the `scenarios-kael1113-final.mjs` shape (`export default function (kits) { return []; }` with a header comment
  naming the scenario it will hold: `kael1125-fast-track-label`, `kael1125-fast-track-views`), and register both in
  `scripts/cdp/scenarios.mjs` beside the kael1113 modules with `{ ...KAEL_KITS, run: RUN_KIT }`. Tasks 6 and 7 fill them.

Acceptance: `go test ./pkg/orchestrate -run 'TestJudgingSessionListsIncludeTheEndReviewer|TestPlanReviewLensTitleNamesTheLightReview|TestChildRunIDsIncludesTheVerifier'`,
`go test ./pkg/wshrpc/wshserver -run 'TestResMon'` (the resmon role case), `npx vitest run frontend/app/view/agents/runlineage.test.ts frontend/app/view/agents/runtimeline.test.ts`
pass; `node -e "import('./scripts/cdp/scenarios.mjs')"` loads the registry without error.

### Task 2: Fast-track tasks skip review and report at merge
**Depends on:** Task 1
**Files:** `pkg/orchestrate/dag.go`, `pkg/orchestrate/engine.go`, `pkg/orchestrate/mergetask.go`, `pkg/orchestrate/reportsections.go`, `pkg/orchestrate/review.go`, `pkg/orchestrate/fasttracktasks_test.go`

Port fork commit `fc47d4fae`. Decisions it fixes:
- `workerCommitted(t, r)` (dag.go) is the one test of "a finished worker with a commit to judge";
  `DeriveTaskStates` enters review only when `!g.FastTrack`. A fast-track worker that commits goes straight to done,
  fix-round tasks included.
- On done (`main` has no `recordTaskTransitions`: the done accounting is inline in `scheduleLocked`, engine.go
  ~L707-735, under `clock.enter("accounting")`, where `noCommitLine` is called): a task that committed nothing keeps `noCommitLine`; a fast-track task
  that committed gets no no-commit line; outside git (`!g.MergeRequired`) it posts its landed lines at done.
- On merge (`FinishMergedTask`, mergetask.go): read the lane before the stamp (`fastTrackLanded`), then post for each
  committed task the merge lands the quiet `t-N merged` line and a caveat line per non-empty Differs from plan / Not
  verified / Found not fixed (`landedLines`, `postLanded` in reportsections.go); For later tasks goes to the lead only
  when `forLaterHasReader` (review.go) finds no descendant that reads it at dispatch. Nothing is typed to a running
  worker. A failed read logs and loses only the lines, never the stamp.
- Non-fast-track dags behave exactly as before.

Acceptance: the fork's `fasttracktasks_test.go` ported, passing:
`go test ./pkg/orchestrate -run 'TestFastTrack'` (worker with a commit skips review; committed task gets no
no-commit line; no-merge dag posts lines at done; Not verified is a final caveat; merge posts the task's lines; a lane
merge posts every task it lands; For later reaches the lead only with no task after it), plus the existing
`go test ./pkg/orchestrate -run 'TestDeriveTaskStates|TestNoCommit'` still passing.

### Task 3: End review in a fast-track final stage
**Depends on:** Task 1
**Files:** `pkg/orchestrate/endreview.go`, `pkg/orchestrate/endreview_test.go`, `pkg/orchestrate/final.go`, `pkg/orchestrate/verifier.go`, `pkg/orchestrate/launchorigin.go`, `pkg/orchestrate/launchorigin_test.go`

Port fork commit `02cfa844d` (its wtype and resmon hunks landed in Task 1). Decisions it fixes:
- New `endreview.go` (`git show 02cfa844d:pkg/orchestrate/endreview.go`): `startEndReview`, `tendEndReview`
  (through `main`'s `tendStageSession`, role `jarvis.UsageRole_EndReviewer`, label `end reviewer`, reviewer route),
  `awaitEndReview`, `applyEndReview`, `stopEndReview`, `recordEndReviewStep`, `recordEndReviewVerdictLocked`,
  `endReviewPrompt`. The prefixes `[End review] `, `end review: ` and `the end review did not finish: ` are exact:
  Task 7's frontend reads them.
- final.go: the end review starts as soon as the stage has its tree (at once with no commands; else in the renamed
  `takeFinalTreeLocked`, before Check and Verify), runs beside every step, and the stage waits on it
  (`finishFinal` → `awaitEndReview` or `applyEndReview` + `endFinal`). A command failure stops a verifier alongside
  but not the end review. `EndFinalStage` stops it (state `stopped`) and its outcome overrides any verdict; a rerun or
  fix round starts a fresh one. `settleFinalLocked` drops its unused `owner` parameter (callers only in final.go and
  verifier.go).
- verifier.go: `writeFixRoundTasks` is shared by both briefs; `RecordFinalVerdict` routes a caller whose run id is
  `Final.EndReview.RunID` to `recordEndReviewVerdictLocked`, and refuses a verifier verdict on a stage already waiting
  on its end review; the verifier's brief words an amended light review (`g.FastTrack && pr.Amended`) as the lead's
  amendment, not the human's accept.
- launchorigin.go (main-only, spec call 8): add `endReviewerOpener = "You are the end reviewer for run "` (the exact
  opening of `endReviewPrompt`) to `stageOpeners` with `jarvis.UsageRole_EndReviewer`, so an end reviewer's session in
  the final tree is placed as the end reviewer, not the verifier. Test it beside `TestLaunchOriginReadsAStagePromptBack`
  (a case whose name matches `TestLaunchOrigin`).
- A dag without `FastTrack` gets no end review and its final stage behaves exactly as before.

Acceptance: `go test ./pkg/orchestrate -run 'TestLaunchOrigin'` passes; the fork's `endreview_test.go` ported, passing: `go test ./pkg/orchestrate -run 'EndReview|TheVerifierBriefTellsAnAmendedPlan'`
(keep the fork's test names, which the pattern matches, and name new cases to match it; starts beside the commands and at once with none; the stage waits on it; a fail joins Detail after the command's; a pass's
unverified and a twice-lost reviewer become reasons; the review step event; End final stage stops it; a rerun starts a
fresh one; the verdict is routed by run id and survives a restart; the brief lists unlisted lane paths, Differs/Not
verified and goalposts by name), plus `go test ./pkg/orchestrate -run 'TestFinal|TestTheVerifier|TestAVerdict|TestViewModFixtures'`
still passing (the `verifier` view-mod fixture must not change for a non-fast-track dag).

### Task 4: Light plan review for fast-track plans
**Depends on:** Task 1
**Files:** `pkg/orchestrate/planreview.go`, `pkg/orchestrate/queue.go`, `pkg/orchestrate/wake.go`, `pkg/orchestrate/planreviewlight_test.go`

Port the `pkg/orchestrate` half of fork commit `4ce77d39d` (`planreview.go`, `queue.go`); the submit, wsh and lead
prompt halves are Task 5's. Decisions it fixes:
- A dag with `FastTrack` opens round 1 with one `PlanReviewLens_Light` reviewer. `planLightPrompt` builds the pack in
  code (commands; each task's text; `main`'s `writeDependsEdges`; the spec inline, the prototype path, or none; each
  Files-line file from the tree, capped `lightPackFileLines = 1000` and `lightPackLines = 5000`, new paths marked
  `(new: it does not exist yet)`), leaves out the plan's path and header, and uses `planLightChecklist`. Moving the
  full checklist's items into named constants must not change one byte of the full or second-pass briefs
  (`TestPlanReviewPromptUnchangedWithoutPicks` and the `plan-reviewer*` view-mod fixtures pin them).
- Route: Light reviewers route; on a Reviewer picks run the reviewer route, and its verdict carries the picks
  (`planReviewerPicks` includes the light lens).
- A lost light reviewer is replaced in the same round up to `MaxLightReviewers = 3` (`replaceLostLightReviewer`);
  then the lead gets `lightReviewLostWake`. A failed light round wakes the lead with `lightReviewFailedWake`.
- Exported for Task 5: `PlanReviewRoundLight(pr) bool`, `PlanReviewLastRound(pr) bool` (light rounds do not count
  toward `MaxPlanReviewRounds`). Every `pr.Round >= MaxPlanReviewRounds` site in `pkg/orchestrate` uses
  `PlanReviewLastRound`: `settlePlanReviewRound`, `PlanReviewRoundsSpent`, and `leadAwaitedWake` in wake.go (a site the
  fork did not touch: a replacement lead of a failed light round is told its amended resubmit dispatches).
- `ReplacePlanReviewProposal`: a resubmit of ≤4 tasks after a failed light round dispatches as the lead's amendment
  (`amendPastLightReview`: state accepted, `Amended` set, a `plan-reviewed` event with `amended: true`, `handOffLead`);
  after a lost light round it opens a fresh light round; past 4 tasks it clears `FastTrack` and opens the full
  review's round 1 with no prior. `planreview accept` leaves `Amended` unset.
- A dag without `FastTrack` gets the two-round review exactly as before.

Acceptance: the fork's `planreviewlight_test.go` ported, passing: `go test ./pkg/orchestrate -run 'Light|AmendedResubmit|ResubmitPastFastTrack|PlanReviewLastRound'`
(keep the fork's test names, which the pattern matches, and name new cases to match it; one light reviewer; the pack's parts, caps and new-file marker; no plan path in the brief; routes with and without
Reviewer picks; a lost reviewer replaced up to 3 then the lost wake; the failed wake; amended resubmit dispatches;
lost-round resubmit opens a fresh light round; resubmit past 4 tasks gets the full round 1; light rounds don't count;
`leadAwaitedWake` on a failed light round), plus `go test ./pkg/orchestrate -run 'TestPlanReview|TestViewModFixtures'`
still passing.

### Task 5: The submit decides the track; lead prompt and dag status lines
**Depends on:** Task 2 (a fast-track dag must skip task review before the submit turns the track on), Task 3 (a fast-track dag must get its end review before the submit turns the track on), Task 4 (uses `PlanReviewRoundLight`/`PlanReviewLastRound` and the light round)
**Files:** `pkg/wshrpc/wshserver/wshserver_dag.go`, `pkg/wshrpc/wshserver/wshserver_dagplanreview_test.go`, `pkg/wshrpc/wshserver/wshserver_landing_test.go`, `pkg/wshrpc/wshserver/wshserver_dag_test.go`, `pkg/wshrpc/wshserver/wshserver_dagplan_test.go`, `pkg/wshrpc/wshserver/wshserver_dag_models_test.go`, `pkg/wshrpc/wshserver/wshserver_autonomous_test.go`, `pkg/wshrpc/wshserver/wshserver_runsettings_test.go`, `pkg/wshrpc/wshserver/wshserver_planstart_test.go`, `pkg/wshrpc/wshserver/wshserver_runstart_test.go`, `pkg/wshrpc/wshserver/wshserver_runqueue_test.go`, `pkg/wshrpc/wshserver/wshserver_originnotify_test.go`, `cmd/wsh/cmd/wshcmd-jarvisdag.go`, `cmd/wsh/cmd/wshcmd-jarvisdag_test.go`, `pkg/jarvis/leadprompt.go`, `pkg/jarvis/leadprompt_test.go`, `claude/arc-view-mod/testdata/lead-goal.txt`, `claude/arc-view-mod/testdata/lead-goal-autonomous.txt`, `frontend/app/view/agents/chatmodel.test.ts`, `claude/arc-view-mod/hooks/prompt-core.test.ts`, `scripts/cdp/fixtures/models-plan-full.md`, `scripts/cdp/scenarios.mjs`

Port the rest of fork commit `4ce77d39d` and fork commit `8cca96646`. Decisions it fixes:
- `DagSubmitCommand` (wshserver_dag.go): a plan-file submit sets `proposed.FastTrack = len(proposed.Tasks) <= jarvis.FastTrackMaxTasks`,
  once; a JSON dag never sets it; a resubmit only keeps or clears it (Task 4's `ReplacePlanReviewProposal`).
- `wshcmd-jarvisdag.go`: `dagSubmitLanded` counts an amended resubmit as landed; `planReviewLine` words a failed light
  round ("the light review; waiting on the lead's amended submit, which dispatches"), the last full round via
  `orchestrate.PlanReviewLastRound`, and an amended accept ("the light review failed, then the lead amended the plan
  and it dispatched").
- Lead prompt (leadprompt.go): the fork's `planShortStep` (a plan of `FastTrackMaxTasks` tasks or fewer is written
  short inside the same format: each task keeps its goal, Files, Depends and acceptance with scenario steps; the plan
  keeps Setup, Verify, Final and Spec; what the fast track does) joins `main`'s plan step: `writePlanAndSubmit`
  (leadprompt.go, used at its two call sites ~L127 and ~L137; `main` has no plan-skill variants), after
  `planCallersStep`. Refresh `lead-goal.txt` and
  `lead-goal-autonomous.txt` from `TestViewModFixtures`'s output; the mod's prompt-core and Chat's chatmodel tests must
  parse them unchanged (edit those tests only if they pin the changed sentence).
- Every existing test or scenario that submits a plan file of ≤4 tasks and pins the full path (two round-1 reviewers,
  Second pass, round 2, per-task review, no end review) moves to a plan of 5 tasks: grep the wshserver tests listed
  and the CDP scenarios; the fork moved `plan-review-rounds` and `model-picks` to `scripts/cdp/fixtures/models-plan-full.md`
  (`git show 4ce77d39d -- scripts/cdp/fixtures/models-plan-full.md`; on `main` the scenarios read `MODELS_PLAN` at
  `scenarios.mjs` `model-picks` and `plan-review-rounds`). `new-run-window` and `launcher` only type the path and stay
  on `models-plan.md`. `codex-worker-route` stays on its 2-task `codex-route-plan.md` and is not edited (spec call 9:
  it already fails on `main` by reading `pr.runid`, is in no Final, and the track does not touch what it checks).
  A test file in the Files line that needs no change stays untouched.
- Add the fork's wshserver cases: a plan-file submit of ≤4 tasks sets `fasttrack` and opens a light round; 5 tasks
  does not; a JSON dag does not; a light-fail resubmit dispatches with `amended`; a resubmit past 4 clears it.

Acceptance: `go test ./pkg/wshrpc/wshserver -run 'TestDagSubmit|TestPlanReview|TestVerdictEndsTheSessionsOwnRun|TestLeadCompletingABranchRunRecordsTheLandingTip|TestSetRunSettings|TestCreateRunFromPlanPath|TestRunQueue|TestNotifyOrigins|TestCreateRunSpecPath'`,
`go test ./cmd/wsh/cmd -run 'TestPlanReviewLine|TestDagSubmitTimeout|TestDagStatus'`, `go test ./pkg/jarvis -run 'TestEveryPlanningPromptListsCallersOfChangedSignatures|TestEngineLaunchPrompt|TestLeadPrompt'`
(name the new cases so these patterns match them, as the fork's `TestPlanReviewLineTellsTheLightReview` does),
`go test ./pkg/orchestrate -run 'TestViewModFixtures'`, `npx vitest run frontend/app/view/agents/chatmodel.test.ts claude/arc-view-mod/hooks/prompt-core.test.ts`
pass; Final's `model-picks` and `plan-review-rounds` steps pass on the 5-task fixture.

### Task 6: The fast track label on the run sheet, wsh runs show and Chat's run card
**Depends on:** Task 1
**Files:** `frontend/app/view/jarvis/briefrunsheet.tsx`, `frontend/app/view/jarvis/runsheetmodel.ts`, `frontend/app/view/jarvis/runsheetmodel.test.ts`, `cmd/wsh/cmd/wshcmd-runs.go`, `cmd/wsh/cmd/wshcmd-runs_test.go`, `frontend/app/view/agents/chatbrainstorm.ts`, `frontend/app/view/agents/chatbrainstorm.test.ts`, `frontend/app/view/agents/chatruncard.tsx`, `frontend/app/view/agents/chatbrainstormrun.tsx`, `scripts/cdp/scenarios-kael1125-label.mjs`

Port fork commit `362cb4f36` into `main`'s surfaces (spec, calls 1 and 2). Decisions it fixes:
- Run sheet (`LoadedConfig` in briefrunsheet.tsx): a dag with `fasttrack` shows a `fast track` chip,
  `data-jarvis-brief-sheet-fasttrack`, last on the settings line after the approvals word (before Adjust), classes
  `rounded-[5px] border border-accent/40 bg-accentbg px-1.5 text-accent-soft`; a full-track dag shows none. Any word
  logic goes in runsheetmodel.ts with its test.
- `wsh runs show` (`runsShowLines`): the route line ends `  fast track` when the digest's group has `FastTrack`.
- Chat's run card: `runCardView` gives a fast-track orchestrator run's head as `Orchestrator run · fast track` (read
  `info.dag?.fasttrack`; a quick run and a full-track run read as before), drawn by chatruncard.tsx and
  chatbrainstormrun.tsx wherever they draw the kind.
- Scenario `kael1125-fast-track-label` in `scripts/cdp/scenarios-kael1125-label.mjs` (seeded dag through
  `kits.run.seedDag`, as `scenarios-kael1113-final.mjs` does): step 1, a fast-track dag's run sheet shows the chip
  last before Adjust and right after the approvals word, with a screenshot; step 2, the same run with `fasttrack`
  cleared shows no chip; step 3, a Chat run card for the fast-track run reads `Orchestrator run · fast track`, and
  for the full-track one `Orchestrator run`. Teardown removes the fixture run.

Acceptance: `go test ./cmd/wsh/cmd -run 'TestRunsShow'` (the fork's fast-track route line case plus the existing
ones), `npx vitest run frontend/app/view/jarvis/runsheetmodel.test.ts frontend/app/view/agents/chatbrainstorm.test.ts`
pass; Final's `kael1125-fast-track-label` steps 1–3 pass.

### Task 7: Run views: light reviewer chips, End review step, amended wording
**Depends on:** Task 1
**Files:** `frontend/app/view/orchestrate/taskroute.ts`, `frontend/app/view/orchestrate/taskroute.test.ts`, `frontend/app/view/orchestrate/daggraph.tsx`, `frontend/app/view/agents/finalstage.ts`, `frontend/app/view/agents/finalstage.test.ts`, `frontend/app/view/agents/finalstageviews.tsx`, `frontend/app/view/agents/agenttreemodel.ts`, `frontend/app/view/agents/agenttreemodel.test.ts`, `frontend/app/view/agents/agenttree.tsx`, `frontend/app/view/agents/sessionsruns.ts`, `frontend/app/view/agents/sessionsruns.test.ts`, `scripts/cdp/scenarios-kael1125-views.mjs`

Port fork commits `7a33c0722` and `b12cc4008`. Decisions it fixes:
- DAG route line (`stageEntries` in taskroute.ts; `main` has no `RouteLine`: the chips are inline in daggraph.tsx
  ~L434-450): a light reviewer shows on the Light reviewers model, or the reviewer
  model on a Reviewer picks run (mirroring Task 4's `planReviewSession`); chips key on lens and index, since a lost
  light reviewer's replacement shares its lens.
- Final stage (`finalstage.ts`): a stage carrying `endreview` gets an `review` step ("End review", "reviews the whole
  run's diff") before the Verifier; its state from `endreview.state` (reviewing → running, lost → failed, stopped →
  stopped, a pass with unverified → unverified); the other steps read from the stage with the `[End review] ` Detail
  block and the `end review: ` / `the end review did not finish: ` reasons taken out, so a failure only the end
  review's leaves the commands and Verifier unfailed; the subline and activity say `· end review alongside` /
  `· verifier and end review alongside`, the headline `end review reviewing` while the stage waits only on it; its
  parallel time stays out of the round total. finalstageviews.tsx widens the label column when an End review row is
  shown. A stage without `endreview` draws exactly as before.
- Stage outcomes (spec call 7; `main`'s words differ from the fork's: the tree row prints the outcome word through
  `stageSubline(verdict ?? outcome)`, the Sessions row reads `STAGE_VERDICTS`, and a human's accept reads "accepted"):
  an `end-reviewer` session reads its outcome from `endreview` (agenttreemodel.ts `stageOutcome`: passed, failed,
  lost to failed, stopped to unverified, a pass with unverified to unverified) and is a stage member of the Sessions
  list (sessionsruns.ts, beside the plan reviewer and verifier; `stageStatus` reads `endreview.state`, reviewing while
  its session is live). A plan review with `state === "accepted" && amended` gives every plan reviewer session of that
  round the new `amended` outcome, which **outranks the reviewer's own verdict** in both `stageOutcome` and
  `stageStatus` (today both return the verdict first, so an amended light round would read "failed"); the tree row
  reads `amended by the lead`, the Sessions row `amended by the lead` (muted), and agenttree.tsx gives `amended` the
  muted dot. A human's accept keeps exactly `main`'s current reading. The fork's lead card hunk is not ported: `main`'s
  lead card has no plan review row.
- Where `main` drifted from the fork (agenttreemodel.ts did, a lot), keep `main`'s structure and add only these
  behaviours; don't flip what a `main` test pins (see the open-issues row on `endedPlanReviewers`).
- Scenario `kael1125-fast-track-views` in `scripts/cdp/scenarios-kael1125-views.mjs`, a fixture orchestrator run with
  seeded dag states (`kits.run.seedDag`, as `scenarios-kael1113-final.mjs`): step 1, a light round reviewing with one
  lost light reviewer and its replacement: the DAG route line shows two Light review chips on the light reviewers'
  model; step 2, an accepted `amended` plan review: the Agent tree's plan review row reads `amended by the lead`;
  step 3, a final stage at Verify with an end review reviewing: the stage pane lists Check, Verify, End review,
  Verifier and the subline says end review alongside; step 4, a failed stage whose Detail is only the end review's:
  End review failed, Check and Verify passed, the tree's final row failed; step 5, a pass with an unverified note:
  End review unverified; step 6, a stage with no `endreview`: no End review row; step 7, the run's Sessions list
  shows the end reviewer as a stage member reading `reviewing` while its seeded session is live and its verdict word
  once the stage records one, and the plan reviewer of the amended round reading `amended by the lead`; step 8, a stage
  whose commands and verifier are done and that waits only on its end review (`endreview.waiting`): the run's final
  row and the stage headline read `end review reviewing`. A screenshot per step.

Acceptance: `npx vitest run frontend/app/view/orchestrate/taskroute.test.ts frontend/app/view/agents/finalstage.test.ts frontend/app/view/agents/agenttreemodel.test.ts frontend/app/view/agents/sessionsruns.test.ts`
(the fork's cases ported, the existing ones unchanged) pass; Final's `kael1125-fast-track-views` steps 1–8 pass and
`kael1113-final-stage` still passes.

### Task 8: Guide, changelog, hand checks and owner decisions
**Depends on:** Task 5 (documents the submit and lead behaviour it lands; through it the For later tasks of Tasks 1-5 reach this task), Task 6 (documents the label, and its For later tasks carry its Not ported lines), Task 7 (documents the views, and its For later tasks carry its Not ported lines)
**Files:** `docs/guide/orchestrator.md`, `CHANGELOG.md`, `docs/hand-checks.md`, `docs/open-issues.md`

- Guide: port fork commit `61f744ad7`'s text (`git show 61f744ad7`) into `docs/guide/orchestrator.md`, in its
  Vietnamese and into its own sections: "Review plan" (which review a plan gets, a new "Review nhẹ" subsection for the
  light review, picks, lost reviewer, findings and amended resubmit), "Run sheet" / "DAG view" (the label, the Light
  review rows, no Reviewing state, the End review step), "Merge và Verify" (merge lines on the fast track), "Review của
  một task" (no per-task review on the fast track and where its duties go), "Final stage" (the end review as a step,
  when it starts and ends), and the fix-round sentence. Name `main`'s run card (Chat's), not the fork's.
- `CHANGELOG.md`, top Unreleased section: under `Added`, one line for the fast track (small runs of 4 tasks or fewer
  get one light plan review, no per-task review and one end review of the whole merged diff); under `Changed`, one
  line for where it shows (`fast track` on the run sheet, `wsh runs show` and Chat's run card; End review in the final
  stage; Light review in the plan review rows). Both end "(from the kaeltran16 fork)" as the earlier fork lines do;
  neither is `<!-- big -->`.
- `docs/hand-checks.md` (the goal asks for these; they are for the person after the land, since no test watches a
  real run's agents, and in the run the Go tests named in the spec's Verification own each engine claim):
  `- [ ] (arcterm) Kael sync 11-25: …` lines for a real run of ≤4 tasks taking the fast track
  end to end (one Light review, no Reviewing state, merge lines reaching the lead, End review in the final stage, the
  label on the run sheet, `wsh runs show` and Chat's run card); a light review that fails and the lead's amended
  resubmit dispatching; an end review that fails and its findings reaching the lead in one fix round.
- `docs/open-issues.md`: take every `Not ported:` line from the For later tasks sections the engine handed you at
  dispatch, and write each as an `(arcterm) Kael sync 11-25, owner decision: …` row in the table that holds the 11-13 rows, in their
  shape (what was not ported, the test that pins ours, what to decide; type `decision`, size `S`, where). None found:
  add no such row. Also add one `(arcterm)` row for `codex-worker-route` (spec call 9): it reads `pr.runid`, which
  `PlanReviewStage` no longer has, so it fails before its first step; it should read the round's reviewer from
  `pr.reviewers`, and with the fast track on, its 2-task plan gets one light reviewer on the reviewer route.

Acceptance: `npx vitest run frontend/app/cockpit/whatsnew.test.ts` passes
with the new lines.
