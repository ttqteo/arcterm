# Wider Plan Review Implementation Plan

**Effort:** effort:c840ce9b-71a5-449b-be87-3f2d8212500c
**Spec:** `docs/superpowers/specs/2026-10-14-wider-plan-review-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/orchestrate ./pkg/jarvis ./pkg/waveobj ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `go vet ./pkg/orchestrate ./pkg/jarvis ./pkg/waveobj ./pkg/wshrpc/... ./cmd/wsh/... && node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`
**Final:** `node scripts/cdp/final-verify.mjs model-picks plan-review-rounds new-run-window brief-profile surface-smoke`

**Goal:** Round 1 of the plan review runs today's full reviewer plus four lens reviewers in parallel, and the lead gets one merged, attributed findings list. Round 2 is one follow-up reviewer that confirms round 1's findings against the lead's diff. A new Light reviewers run setting names the route the lenses and the follow-up run on.

**Architecture:** `PlanReviewStage` gets a `Reviewers` list, one entry per session, each tended by the existing `tendStageSession`. One settle function judges the round once no reviewer is still reviewing, and it is the only place the round's event, wake and handoff come from. The checklist is defined once in Go, tagged by lens. The full, lens and follow-up prompts are all built from it. Round 2's inputs (merged findings, the round-1 doc text, round-1 picks) ride on `PlanReviewStage.Prior`. `StageSession` gains a route pin. The Light reviewers setting copies the Reviewers setting's plumbing through profile, create-run, run settings, run and group.

**Tech Stack:** Go (`pkg/orchestrate`, `pkg/jarvis`, `pkg/wshrpc`, `cmd/wsh`), React/TS (`frontend/app/view/*`), CDP scenarios (`scripts/cdp/scenarios.mjs`).

## Global Constraints

- Today's full reviewer prompt text does not change: `TestPlanReviewPromptUnchangedWithoutPicks` and its siblings keep passing as written.
- `MaxPlanReviewRounds = 2`, `MaxReviewNoteLen = 2000` per verdict, `MaxReviewRespawns = 1`, `ReviewTimeout`: unchanged. The merged list is never clipped.
- Lens keys and titles, exactly: `full` Full review, `spec` Spec coverage, `order` Task order and files, `tests` Tests and commands, `final` Final coverage, `followup` Round-2 follow-up. Reviewer states: `reviewing | passed | failed | lost`.
- A nil `LightReviewerRoute` means `LightPickRoute` (claude/sonnet) on every runtime.
- Every plan-review child keeps `StageRole = jarvis.UsageRole_PlanReviewer`.
- Exactly one `plan-reviewed` run event per settled round (plus the existing accept event).
- Never hand-edit generated files: change the Go types, then run `task generate`.
- Colors come from `@theme` tokens only; reuse existing chip/row classes (no new tokens).
- Go tests: `go test ./pkg/x -run '<names>'`; gofmt and prettier only the files you touch; never prettier `scripts/*.mjs`.

## Review Focus

- Two reviewers' verdicts arriving at the same moment: the round settles exactly once (one event, one wake). Task 3 tests two verdict RPCs on the last two reviewers back to back.
- A lens that sends `--pick`, or a verdict from a reviewer that was already replaced: refused, no state change. Task 3 tests both.
- A resubmit whose plan is byte-identical to round 1: the follow-up gets "no change" wording, not an empty diff block. Task 4 tests it.
- The app restarts mid-round, with some reviewers passed and some reviewing: the tick resumes tending only the reviewing ones and does not respawn the passed ones. Task 3 tests a stage loaded with mixed reviewer states.
- A run created before this change (no `lightreviewerroute` anywhere): its lenses run on claude sonnet, and the run sheet shows the default label. Task 2 and Task 5 test the nil path.

---

### Task 1: Types for reviewers and the Light reviewers route
**Depends on:** none
**Files:** `pkg/waveobj/wtype.go`, `pkg/wshrpc/wshrpctypes_runs.go`, `frontend/types/gotypes.d.ts`

Add the types the spec's "Stage state" and "Routes" sections define. Keep the old top-level `PlanReviewStage.RunID`, `StartedTs` and `Respawns` for now, commented `// legacy: replaced by Reviewers; removed once no reader is left`. Task 8 removes them, so every reader can move first.

- `waveobj.PlanReviewStage` gains `Reviewers []PlanReviewer` (`reviewers`), `PlanText` (`plantext`), `SpecText` (`spectext`) and `Prior *PlanReviewPrior` (`prior`), all omitempty.
- New `waveobj.PlanReviewer {Lens, State, Text, RunID, StartedTs, Respawns}`, `waveobj.PlanReviewPrior {Findings, PlanText, SpecText, Picks []PlanReviewPriorPick}`, and `waveobj.PlanReviewPriorPick {TaskId, Title, Model, Reason}`. Use the spec's json tags.
- `LightReviewerRoute *RoutePin` (`lightreviewerroute,omitempty`) on `Run`, `TaskGroup`, `JarvisProfile` and `ProfileOverride` (beside each `ReviewerRoute`, with a matching comment: nil = claude/sonnet), and on `wshrpc.CommandCreateRunData` and `wshrpc.CommandSetRunSettingsData` (applied always, like `ReviewerRoute`).
- Run `task generate` and commit what it changes. If it touches files beyond `gotypes.d.ts`, list them in your report.

Acceptance: `go build ./pkg/... ./cmd/...` and the Check line pass. `go test ./pkg/waveobj` passes. The generated `PlanReviewStage`, `PlanReviewer`, `PlanReviewPrior` and `PlanReviewPriorPick` and the `lightreviewerroute` fields show in `frontend/types/gotypes.d.ts`.

### Task 2: Light reviewers route on the server
**Depends on:** Task 1
**Files:** `pkg/jarvis/profile.go`, `pkg/jarvis/runsettings.go`, `pkg/wshrpc/wshserver/wshserver_runs.go`, `pkg/wshrpc/wshserver/wshserver_runsettings.go`, `pkg/jarvis/profile_reviewer_test.go`, `pkg/jarvis/runsettings_test.go`, `pkg/wshrpc/wshserver/wshserver_lightreviewer_test.go`

Copy every server path `ReviewerRoute` takes, for `LightReviewerRoute`:

- profile resolution (`profile.go`): an override's non-nil `LightReviewerRoute` replaces the global one, and it counts in the "override is empty" check;
- create-run (`wshserver_runs.go`): a nil request value takes the resolved profile's; validate with `validateRoute("lightReviewerRoute", …, true)`; set `run.LightReviewerRoute`;
- run settings (`runsettings.go` `RunSettings` plus its run/group apply, and `wshserver_runsettings.go`): always applied like `ReviewerRoute` (nil = default), validated the same way for the profile, the override and the run-settings payload.

The submit-time carry onto the group is in `wshserver_dag.go`, which Task 3 owns.

Acceptance, with tests: an override's Light reviewers route wins over the global one, and a nil one inherits (`TestProfileLightReviewerRoute*` in `profile_reviewer_test.go`). Applying run settings writes the route to run and group, and a nil clears both (`TestRunSettingsLightReviewerRoute*` in `runsettings_test.go`). In the new `wshserver_lightreviewer_test.go`: `TestCreateRunCarriesLightReviewerRoute` (a request route, and the profile's when the request has none, land on the run); `TestCreateRunRefusesABadLightReviewerRoute` (an unknown runtime is refused with `lightReviewerRoute` in the error); `TestSetRunSettingsAppliesLightReviewerRoute` (the run and its group get it, and a bad one is refused). Leave `leadORef` (called at `wshserver_runs.go:225`) where it is; Task 3 keeps a wshserver `leadORef` that delegates.
Run: `go test ./pkg/jarvis -run 'LightReviewerRoute'` and `go test ./pkg/wshrpc/wshserver -run 'LightReviewerRoute'`.

### Task 3: Round 1 with five reviewers, one settle
**Depends on:** Task 1
**Files:** `pkg/orchestrate/planreview.go`, `pkg/orchestrate/stagesession.go`, `pkg/orchestrate/verifier.go`, `pkg/orchestrate/mutation.go`, `pkg/orchestrate/queue.go`, `pkg/wshrpc/wshserver/wshserver_dag.go`, `cmd/wsh/cmd/wshcmd-jarvisdag.go`, `cmd/wsh/cmd/wshcmd-jarvisdag_test.go`, `pkg/wshrpc/wshserver/wshserver_dagplanreview_test.go`, `pkg/orchestrate/planreview_test.go`, `pkg/orchestrate/planreviewpicks_test.go`, `pkg/orchestrate/planreviewlens_test.go`, `pkg/orchestrate/stagesession_test.go`

Implement the spec's "Reviewers", "Routes" (engine side) and "Round 1" sections. Design decisions this task makes:

- **Checklist, single source.** Define the checklist items once in `planreview.go` as a slice of `{lens, text}`, holding today's exact sentences, the Prototype board item, and the spec-gap sentence. `planReviewPrompt(g, tree)` keeps its signature and its output byte for byte. New `planLensPrompt(g, tree, lens string) string` follows the spec's lens wording: own items only, the other titles named, the verdict command without `--pick`.
- **Constants.** `PlanReviewLens_Full|Spec|Order|Tests|Final|Followup` and `PlanReviewerState_Reviewing|Passed|Failed|Lost`. `PlanReviewLensTitle(lens string) string` is exported, because `cmd/wsh` reads it. `planRoundOneLenses = []string{full, spec, order, tests, final}` sets the merge order.
- **Session builder may fail.** `tendStageSession`'s `session` callback becomes `func() (StageSession, error)`; an error counts as a spawn failure (respawn budget, then "it could not start: …"). Update its callers (`planreview.go`, `verifier.go`, whose builder never fails) and `stagesession_test.go`. Task 4's follow-up prompt relies on this.
- **Routes.** `StageSession` gains `Route waveobj.RoutePin`, and a zero value means `reviewerRoute(owner, g)`. `spawnStageSession` resolves and validates the session's pin and records it on the child run. `lightReviewerRoute(g) waveobj.RoutePin` returns `g.LightReviewerRoute` when it names a runtime or model, else `LightPickRoute`. `stage-session-started` detail gains `lens`.
- **Tending.** `advancePlanReview`: on a round with no `Reviewers` (fresh, or stored in the old shape), capture `PlanText`/`SpecText` via `DocPath` in the landing tree, then create the round's reviewers. Round 1 gets the five above; Task 4 makes round 2 create `followup`. A read error is logged and leaves the text empty. Then call `tendStageSession` per reviewer still `reviewing`, with pointers into its fields. A non-empty reason marks it `lost`, with `Text` set to that reason. After tending, settle.
- **Verdict.** `RecordPlanReviewVerdict` finds the reviewer by run id among the `reviewing` ones and refuses anything else ("run %s is not reviewing this dag's plan"). A non-`full`/`followup` reviewer that sends `--pick` is refused with "only the full reviewer picks models; send the verdict without --pick". The full reviewer's picks validate and apply as today. Record the reviewer's state and text, then settle.
- **Settle.** `settlePlanReviewRound(ctx, g, pr, afterCommit)` is the only place a round ends. It does nothing while any reviewer is `reviewing`. Pass and fail rules, the merged-text format, the wakes (`planReviewFailedWake` with the merged list, or `planReviewLostWake` when no reviewer failed and only the required one was lost) and the event follow the spec exactly. The event is `{state, round, findings, reviewers: [{lens, state, text}], picks}`. `picks` holds the tasks with `ModelSource == reviewer`, in `wshrpc.DagModelPick` shape. On pass: set the quiet line, clear `PlanText`/`SpecText`/`Prior`, and hand off.
- **Handoff.** Add `orchestrate.LeadWorkerORef(run *waveobj.Run) string`, which holds today's `leadORef` body. wshserver's `leadORef` stays as a one-line delegate, so its callers (`wshserver_runs.go`, `postLeadHandoff`, the wshserver tests) are untouched and one copy of the logic is left. Add `handOffLead(ctx, g)` in orchestrate: load the owner run, and when `LeadWorkerORef` is non-empty call the seam `var postHandoffFn = PostHandoff`, which the orchestrate tests stub. Call it from the pass branch of settle and from `AcceptPlanReview`. `AcceptPlanReview` also clears the docs. Delete `handOffAfterPlanReview` and its call in the `planreview-*` action case. The submit-time `postLeadHandoff` for an unreviewed dag stays.
- **wshserver tests.** `wshserver_dagplanreview_test.go` reads `g.PlanReview.RunID` and tests the handoff through wshserver's `postHandoff` var. Rewrite it onto `g.PlanReview.Reviewers`: a helper that records a verdict for every reviewer of the round. `TestPlanReviewHandsOffOnlyOnceThePlanClears` keeps its assertions (no handoff on a fail or on a lone reviewer's pass, one handoff when the round passes), stubbing `orchestrate`'s seam through an exported test hook `orchestrate.SetPostHandoffForTest(fn) (restore func())`, defined in a non-test file since the test lives in another package.
- **Submit carry.** In `wshserver_dag.go`, set `proposed.LightReviewerRoute = run.LightReviewerRoute` beside `ReviewerRoute`. `ReplacePlanReviewProposal` keeps the group's value, as it keeps `ReviewerRoute`.
- **Readers.** `childRunIDs` adds every reviewer's `RunID`, and stops reading the legacy top-level one. `planReviewLine` in `wshcmd-jarvisdag.go` adds `reviewers: <title> <state> · …` while reviewing, and takes its age from the earliest reviewer `StartedTs`. The `planreview-pass` ack becomes "plan review pass recorded; the round passes once every reviewer has. Ending this session". The engine no longer writes the legacy top-level fields.

Acceptance: these tests pass. New ones go in `planreviewlens_test.go`; existing ones are updated in place wherever they assumed one reviewer.
- `TestPlanReviewRoundOneStartsFiveReviewers`: five child runs, all plan-reviewer, `full` on the reviewer route, the four lenses on claude/sonnet with a nil setting and on the set route otherwise; the docs are captured.
- `TestPlanReviewLensPromptsSplitTheChecklist`: each lens prompt holds its own items, no other lens's items, and no `--pick`. Together the four cover every non-pick item of the full prompt.
- `TestPlanReviewPassesOnlyWhenAllPass`: four passes keep the hold, and the fifth clears it with one event and one handoff.
- `TestPlanReviewLensFailMergesFindingsWhole`: two failing reviewers with 2000-char texts give a wake and event holding both, attributed and unclipped, plus the `Passed:` line.
- `TestPlanReviewLostLensIsDropped`: a lens that ended twice without a verdict is `lost`, and the round passes on the rest and names it.
- `TestPlanReviewLostFullFailsTheRound`: when every lens passed and full is lost, the lead gets the lost wake.
- `TestPlanReviewLensPickIsRefused` and `TestPlanReviewReplacedReviewerVerdictIsRefused`.
- `TestPlanReviewSettlesOnce`: two verdicts on the last two reviewers back to back give exactly one `plan-reviewed` event.
- `TestPlanReviewResumesMixedStates`: a stage stored with passed and reviewing reviewers respawns none of the passed ones.
- `TestPlanReviewOldShapeStartsReviewers`.
- `TestCancelStopsEveryPlanReviewer`.
- `TestAcceptPlanReviewClearsDocsAndHandsOff`: accept after a failed round clears `PlanText`/`SpecText`/`Prior` and hands off once.
- `TestDagSubmitCarriesLightReviewerRoute` (in `wshserver_dagplanreview_test.go`): a run with a Light reviewers route submits a plan, and the group holds the route, which survives a resubmit.
- `TestTendStageSessionCountsABuilderErrorAsASpawnFailure` (in `stagesession_test.go`).
- `TestPlanReviewLineListsReviewers` (in `cmd/wsh/cmd/wshcmd-jarvisdag_test.go`): a reviewing stage's line names each reviewer's title and state.

Run: `go test ./pkg/orchestrate -run 'PlanReview|StageSession|ReplaceProposal|ADagWithNoPlanReview|CancelStops|Verifier|FinalVerdicts'` `go test ./cmd/wsh/cmd -run 'TestPlanReviewLineListsReviewers'` and `go test ./pkg/wshrpc/wshserver -run 'PlanReview|LightReviewerRoute'`.

### Task 4: Round 2 follow-up reviewer
**Depends on:** Task 3
**Files:** `pkg/orchestrate/planreview.go`, `pkg/orchestrate/planreviewround2_test.go`, `pkg/orchestrate/planreview_test.go`

Implement the spec's "Round 2" section.

- `ReplacePlanReviewProposal` builds `Prior` before it replaces the tasks: the old stage's merged `Findings`, `PlanText` and `SpecText`, plus a `PlanReviewPriorPick` per old task with `ModelSource == reviewer`. Each pick holds the task id, its label, `sonnet` when its route equals `LightPickRoute` (else `lead`), and its `PickReason`. The new stage is `{reviewing, round+1, Prior}`, with no reviewers yet.
- When `advancePlanReview` opens a round with a `Prior`, it creates one reviewer, `followup`, on `lightReviewerRoute(g)`, after capturing the round's docs as in round 1.
- `docDiff(ctx, oldText, newText, name string) (string, error)` writes both texts to a temp dir as `round1/<name>` and `round2/<name>`, runs `git diff --no-index --no-color` there, treats exit 1 as "differs" and returns the output with the temp-dir prefixes stripped. Identical texts return "". Other exits return the error.
- `planFollowupPrompt(ctx, g, tree) (string, error)` follows the spec's bullets. The plan diff goes in a ```diff block, or "The plan did not change." when the texts match. The spec diff likewise, or "The spec did not change.". Then the checklist items (all of them, from Task 3's single slice) as the standard for changed lines. On a Reviewer picks run, the pick block with each task's round-1 pick and reason beside its line. A prompt error is returned from the session builder, which Task 3 made fallible, so it counts as a spawn failure.
- Settle, wakes and the last-round paths are Task 3's and do not change. The follow-up is the required reviewer for round 2, so `followup` lost fails the round.

Acceptance:
- `TestResubmitKeepsRoundOneFindingsDocsAndPicks`.
- `TestPlanReviewRoundTwoStartsOneFollowup`: one child on the Light reviewers route, role plan-reviewer.
- `TestFollowupPromptCarriesFindingsAndDiff`: it holds the merged findings, a diff with exactly the changed lines, "The spec did not change." for an unchanged spec, and round-1 picks beside their tasks.
- `TestFollowupPromptIdenticalPlanSaysNoChange`.
- `TestFollowupPassClearsTheHold`: one event, a handoff, and the docs cleared.
- `TestFollowupFailIsTheLastRound`: today's last-round wake, human and autonomous.
- `TestRoundTwoWithoutPriorDocsDiffsAgainstEmpty`.
- `TestDocDiff`.

Run: `go test ./pkg/orchestrate -run 'Resubmit|RoundTwo|Followup|DocDiff|PlanReview'`.

### Task 5: Light reviewers in the cockpit settings
**Depends on:** Task 1
**Files:** `frontend/app/view/agents/runconfig.ts`, `frontend/app/view/agents/runconfigstore.ts`, `frontend/app/view/agents/runlauncher.tsx`, `frontend/app/view/agents/runactions.ts`, `frontend/app/view/jarvis/newruncontrol.tsx`, `frontend/app/view/jarvis/newrun.ts`, `frontend/app/view/jarvis/briefsheet.tsx`, `frontend/app/view/jarvis/runsheetmodel.ts`, `frontend/app/view/jarvis/runsettings.ts`, `frontend/app/view/jarvis/briefrunsheet.tsx`, `frontend/app/view/jarvis/profilemodel.ts`, `frontend/app/view/jarvis/briefprofileview.tsx`, `frontend/app/view/agents/runconfig-reviewer.test.ts`, `frontend/app/view/jarvis/runsettings.test.ts`, `frontend/app/view/jarvis/profilemodel.test.ts`, `frontend/app/view/jarvis/newrun-reviewer.test.ts`, `frontend/app/view/jarvis/runsheetmodel.test.ts`, `scripts/cdp/scenarios.mjs`

Copy every path the `reviewerRoute` takes in the frontend, for `lightReviewerRoute`:

- create defaults (`runconfig.ts` from `profile.lightreviewerroute`) and their atom and setter (`runconfigstore.ts`, reset with the others);
- a `Light reviewers` model row beside `Reviewers` in `newruncontrol.tsx` and `runlauncher.tsx`, whose empty value reads "Sonnet (default)";
- the create options and payload: `newrun.ts` (the options `newruncontrol` builds), `briefsheet.tsx` (the goal row that launches `RunLauncher`'s config), and `runactions.ts` (orchestrator only, `lightreviewerroute`);
- run settings draft, diff and payload (`runsettings.ts`), the run sheet's edit row and summary (`briefrunsheet.tsx`, "light reviewers on <route>" when set), and the run-sheet summary line in `runsheetmodel.ts` (`light reviewers <route>` beside `reviewers <route>`);
- the profile's `Light reviewers route` row (`profilemodel.ts`, with a `lightReviewerRow` like `reviewerRow`; inherited label "Same as global" or "Sonnet (default)"; and `briefprofileview.tsx`).

Acceptance (vitest): the defaults read the profile's route and null without one; `newrun.ts`'s options carry it; the draft diff and payload carry it; the run-sheet summary names it; the profile row's inherited labels are right (`npx vitest run frontend/app/view/agents/runconfig-reviewer.test.ts frontend/app/view/jarvis/runsettings.test.ts frontend/app/view/jarvis/profilemodel.test.ts frontend/app/view/jarvis/newrun-reviewer.test.ts frontend/app/view/jarvis/runsheetmodel.test.ts`).

Visible steps in `scripts/cdp/scenarios.mjs`:
- `new-run-window`, step "Light reviewers row picks a route the created run carries" (`newruncontrol.tsx`): shows the row, picks a claude haiku route, creates the run, and asserts `run.lightreviewerroute`.
- `new-run-window`, step "the run sheet shows and edits the Light reviewers row" (`briefrunsheet.tsx`): on the run that step created, open its run sheet, assert the row and the summary text, change the route, and assert the run's `lightreviewerroute` changed.
- `new-run-window`, step "the brief sheet's launcher shows the Light reviewers row" (`runlauncher.tsx`): create a fixture channel with no run, open its brief sheet (a channel with no run shows `RunLauncher` there), and assert the row beside `Reviewers`. Tear the channel down with the scenario's other fixtures.
- `brief-profile`, step "profile shows the Light reviewers route row" (`briefprofileview.tsx`).

### Task 6: Five reviewers in the cockpit's plan-review views
**Depends on:** Task 1
**Files:** `frontend/app/view/orchestrate/taskroute.ts`, `frontend/app/view/orchestrate/daggraph.tsx`, `frontend/app/view/agents/runtimeline.ts`, `frontend/app/view/agents/runtimelineview.tsx`, `frontend/app/view/agents/agenttreemodel.ts`, `frontend/app/view/agents/agenttree.tsx`, `frontend/app/view/orchestrate/taskroute.test.ts`, `frontend/app/view/agents/runtimeline.test.ts`, `frontend/app/view/agents/runtimeline-picks.test.ts`, `frontend/app/view/agents/agenttreemodel.test.ts`

Implement the spec's "Cockpit" table for the frontend rows.

- `runtimeline.ts` exports the one lens map, `PLAN_REVIEW_LENS_TITLE: Record<string, string>` (the six titles), and `planReviewLensTitle(lens)`, which falls back to the key. It also exports `planReviewReviewers(detail): {lens, state, text}[]`, which reads the `plan-reviewed` detail and drops malformed entries like `planReviewPicks`. `eventTitle` for `stage-session-started` appends ` · <title>` when the detail has a `lens`.
- `runtimelineview.tsx`: under a `plan-reviewed` row, one sub-row per reviewer, `<title> · <state>` with `data-plan-review-reviewer="<lens>"`, then the pick sub-rows. Same classes as the pick sub-rows.
- `taskroute.ts` `StageEntry` gains `reviewers: {lens, title, state, model}[]`. The model is the short reviewer-route model for `full` and the short Light reviewers model for the others: `group.lightreviewerroute` or "sonnet". The entry text becomes `plan review · <state> · round <n>`. `daggraph.tsx` renders one chip per reviewer after the stage text, `<title> · <state> · <model>`, with `data-plan-reviewer="<lens>"` and `data-plan-reviewer-state="<state>"`, styled by tone like the stage text.
- `agenttreemodel.ts` `stageOutcome`, plan-reviewer case: find the reviewer in `dag.planreview.reviewers` with the agent's run id. `passed` → passed, `failed`/`lost` → failed, `reviewing` → undefined. When none matches, it reads failed when round > 1, as today. It no longer reads `planreview.runid`. `agenttree.tsx`: a plan-reviewer stage row's title adds ` · <lens title>` when the row's reviewer is found. Expose the lens from the model, so the view only renders.

Acceptance (vitest): stage entries list five reviewers with their states and models, with and without a Light reviewers route; the reviewer sub-rows parse and drop malformed entries; the started title names the lens; `stageOutcome` reads each reviewer's own state, and a round-1 reviewer reads failed in round 2 (`npx vitest run frontend/app/view/orchestrate/taskroute.test.ts frontend/app/view/agents/runtimeline.test.ts frontend/app/view/agents/runtimeline-picks.test.ts frontend/app/view/agents/agenttreemodel.test.ts`).

Task 7 adds the steps that show these views:
- `model-picks` "the graph's stage line shows five plan reviewers, each passed" (`daggraph.tsx` chips);
- `model-picks` "the timeline's Plan reviewed row lists five reviewers" (`runtimelineview.tsx` sub-rows);
- `plan-review-rounds` "the timeline names each reviewer's lens in its started row" (`eventTitle`);
- `plan-review-rounds` "the agent tree's plan-reviewer rows name their lens and verdict" (`agenttree.tsx`);
- `plan-review-rounds` "round 2 shows one follow-up chip".

### Task 7: CDP scenarios for the plan-review stage
**Depends on:** Task 2, Task 4, Task 5, Task 6
**Files:** `scripts/cdp/scenarios.mjs`

Use the real flow, as `model-picks` does today. The reviewer sessions are real; each verdict is recorded in its own reviewer's name with `dagaction`, read from `dagstatus` → `group.planreview.reviewers`.

- `model-picks`: create the run with `reviewerroute` and `lightreviewerroute` both `{runtime: "claude", model: "haiku"}`, so the five real sessions stay cheap. Wait for five reviewers with run ids. Record a pass from each lens, then the full reviewer's pass with `MODEL_PICKS`. Keep the existing steps. Add the step "the graph's stage line shows five plan reviewers, each passed": five `[data-plan-reviewer]` chips in the open graph, each `data-plan-reviewer-state="passed"`. Add the step "the timeline's Plan reviewed row lists five reviewers": five `[data-plan-review-reviewer]`.
- New `plan-review-rounds` (registered with the others, same arrange/teardown helpers and viewport pin as `model-picks`):
  1. Round 1: lenses `spec`, `order` and `final` pass, `tests` fails with a known finding, `full` passes. Step: five chips, four passed and `tests` failed. Step: the Plan reviewed row lists five reviewers and the dag's `planreview.findings` begins with `[Tests and commands]`.
     Step "the timeline names each reviewer's lens in its started row": five `Plan reviewer started · <title>` rows, one per lens title.
     Step "the agent tree's plan-reviewer rows name their lens and verdict": with the run's reviewer tabs in the tree, each plan-reviewer stage row's title holds its lens title and its subline holds its verdict (`tests` failed, the others passed). If the tabs were already reaped, the step fails and says so; it must not pass empty.
  2. Resubmit the same plan (`dagsubmit` again). Wait for one reviewer. Step "round 2 shows one follow-up chip": the stage line shows `round 2` and one `followup` chip, `reviewing`. Record its pass. Step: the chip reads passed.
  Each step shoots the graph.
- Keep the queries scoped to the graph modal or timeline container (`data-*` attributes), never document-wide.

Acceptance: `CDP_PORT=9222 task verify:ui -- model-picks plan-review-rounds` passes against a dev app built from the merged tasks. Final runs both.

### Task 8: Drop the legacy plan-review fields, update the guide
**Depends on:** Task 3, Task 4, Task 6, Task 7
**Chunk:** Build: wider round-1 plan review (reviewer + 4 Sonnet lenses, merged) and a slim round 2 (findings + diff)
**Files:** `pkg/waveobj/wtype.go`, `frontend/types/gotypes.d.ts`, `docs/orchestrator-guide.md`

- Remove `PlanReviewStage.RunID`, `StartedTs` and `Respawns`, then run `task generate`. Before removing, grep every reader (`planreview.runid`, `planreview?.runid`, `.PlanReview.RunID`, `pr.RunID`, `pr.StartedTs`, `pr.Respawns`) in Go, TS and `scripts/`. None may be left, and any that is gets fixed here.
- `docs/orchestrator-guide.md`: in "The plan review", describe round 1's five reviewers, the merged attributed findings, the lost-lens rule and round 2's follow-up. Add a **Light reviewers model** row to the settings table beside **Reviewers model**.

Acceptance: the Check line passes; `go test ./pkg/orchestrate -run 'PlanReview'` passes; `git grep -nE 'planreview\??\.runid|PlanReview\.RunID|pr\.(RunID|StartedTs|Respawns)' -- pkg cmd frontend scripts` finds nothing.
