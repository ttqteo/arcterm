# Kael sync (2026-11-25, 1 of 3): the orchestrator fast track

Port the fork's fast track for small orchestrator runs (`kael` remote, tip `45edf22ed`). The fork's design is the design:
`git show kael/main:docs/superpowers/specs/2026-11-23-orchestrator-quick-track-design.md`. This spec only records what
`main` takes, what it does not and why, where each fork file lands on `main`, and the calls made for `main`'s shape.

As in the earlier syncs (`2026-11-19-kael-sync-agent-edits-and-fixes-design.md`), nothing merges: read a commit with
`git show <hash>`, a file at the fork tip with `git show kael/main:<path>`, and port the behaviour into `main`'s code.
`git cherry-pick -n` only where it applies cleanly (it will not for `pkg/orchestrate`, which drifted: see the
"Kael sync 11-13, owner decision" rows in `docs/open-issues.md`).

## What the fast track is (summary of the fork's design)

Every orchestrator run whose plan file has `jarvis.FastTrackMaxTasks` (4) tasks or fewer takes it, decided once at the
first plan-file submit and stored on the dag (`TaskGroup.FastTrack`). A dag submitted as JSON with no plan file never
takes it. On the fast track:

- **Light plan review.** One reviewer, lens `light` ("Light review"), on the Light reviewers route (on a Reviewer picks
  run: the reviewer route, and it picks models). Its brief is a pack code builds: the plan's commands, each task's
  text, the parsed Depends edges, the spec inline (or the prototype's path), and the contents of every file the tasks'
  Files lines name (1,000 lines a file, 5,000 in all). One round. A lost light reviewer is replaced in the same round
  up to `MaxLightReviewers` (3). On findings the lead's amended resubmit of ≤4 tasks dispatches with no second review
  (`PlanReviewStage.Amended`); a resubmit past 4 tasks clears `FastTrack` and gets the full review's round 1. Light
  rounds do not count toward `MaxPlanReviewRounds`.
- **No per-task review.** A worker that commits goes straight to done, fix-round tasks too. The review pass's duties
  move to the merge: the lead gets the quiet "t-N merged" line and one caveat line per Differs from plan / Not
  verified / Found not fixed (For later tasks only when no descendant reads it); outside git they post at done. Not
  verified still becomes a final-stage unverified reason; goalpost findings go into the end review's brief.
- **End review.** In the final stage, beside Check, Verify and Final, one reviewer on the reviewer route
  (`StageRole` `end-reviewer`) reads the whole merged diff against the spec, each task's goal and Files line, the
  lanes' unlisted paths, the workers' Differs/Not verified, and judges each goalpost finding by name. It gives its
  verdict with `wsh jarvis dag final pass|fail`, routed by `RecordFinalVerdict` when the caller is
  `EndReview.RunID`. The stage waits for it; a fail joins the stage's Detail as an `[End review] ` block so one fix
  round covers every failure; a pass's `--unverified` and a twice-lost reviewer become unverified reasons; settling
  records a `final-step` event with step `review`. Ending the stage by hand stops it; a rerun or fix round reruns it.
- **What the user sees.** The `fast track` label on the run sheet's settings line, on `wsh runs show`'s route line and
  on the run card; the Light review row and its reviewer chips on the DAG route line; the End review step in the final
  stage views; "amended by the lead" on the plan reviewer's Agent tree row and Sessions row, where `main` would read
  the light reviewer's own "failed" verdict (`main`'s word for a human's accept is "accepted"; see call 7).

## Taken, commit by commit, and where it lands on main

| Fork commit | What | Main files |
|---|---|---|
| `bc384462e` | keys, titles, wire shapes: `TaskGroup.FastTrack`, `PlanReviewStage.Amended`, `FinalStage.EndReview` / `FinalEndReview` (state also `stopped`, from `02cfa844d`), `jarvis.FastTrackMaxTasks`, `jarvis.UsageRole_EndReviewer`, `PlanReviewLens_Light`, `FinalStep_Review`; `childRunIDs` / `sessionRunIDs` list the end reviewer; frontend titles; resmon role (from `02cfa844d`) | `pkg/waveobj/wtype.go`, `pkg/jarvis/plan.go`, `pkg/jarvis/usage.go`, `pkg/orchestrate/{planreview,final,engine,mutation}.go`, `pkg/wshrpc/wshserver/wshserver_resmon.go`, `frontend/app/view/agents/{runlineage,runtimeline}.ts`, generated `frontend/types/gotypes.d.ts` |
| `fc47d4fae` | tasks skip review, report at merge | `pkg/orchestrate/{dag,engine,mergetask,reportsections,review}.go` |
| `02cfa844d` | end review | new `pkg/orchestrate/endreview.go`; `pkg/orchestrate/{final,verifier}.go`; `pkg/orchestrate/launchorigin.go` (a main-only role registry, call 8) |
| `4ce77d39d` | light plan review; the submit that sets the track; lead prompt's short-plan step; `dag status` plan review line; fixtures past 4 tasks for the tests and scenarios that pin the full review | `pkg/orchestrate/{planreview,queue,wake}.go`, `pkg/wshrpc/wshserver/wshserver_dag.go`, `cmd/wsh/cmd/wshcmd-jarvisdag.go`, `pkg/jarvis/leadprompt.go`, `scripts/cdp/fixtures/models-plan-full.md`, `scripts/cdp/scenarios.mjs` |
| `362cb4f36` | the label | `frontend/app/view/jarvis/briefrunsheet.tsx` (+ `runsheetmodel.ts`), `cmd/wsh/cmd/wshcmd-runs.go`, Chat's run card (`frontend/app/view/agents/chatbrainstorm.ts`, `chatruncard.tsx`) |
| `7a33c0722` | light reviewer chips on the DAG route line | `frontend/app/view/orchestrate/{taskroute.ts,daggraph.tsx}` |
| `b12cc4008` | End review step in the final stage views; "amended by the lead" | `frontend/app/view/agents/{finalstage.ts,finalstageviews.tsx,agenttreemodel.ts,agenttree.tsx,sessionsruns.ts}` (not `leadcardmodel.ts`: call 7) |
| `8cca96646` | lead prompt fixtures | `claude/arc-view-mod/testdata/lead-goal.txt`, `lead-goal-autonomous.txt` (main pins them in `pkg/orchestrate/viewmod_fixtures_test.go`; the fork's `lead-design*.txt` have no builder on main) |
| `61f744ad7` | guide text | `docs/guide/orchestrator.md`, written in its Vietnamese, in its own sections ("Review plan", "Review của một task", "Final stage", "Run sheet", "Merge và Verify") |

## Calls made for main

1. **The run card is Chat's run card.** The fork's "run card `wsh runs show` prints" is its Chat card for a
   `wsh runs show` call (`runscards.ts`, `wshcards-runs.tsx`), which `main` does not have; porting that card is out
   of scope. `main`'s run card is the one Chat draws for a run a conversation started (`chatruncard.tsx`, its words from
   `runCardView` in `chatbrainstorm.ts`): its head reads `Orchestrator run · fast track` for a fast-track dag. Why: the
   goal asks for the label on the run card, and this is the card `main` has. `wsh runs show` itself ends its route line
   with `  fast track`, as the fork's does.
2. **The run sheet chip** sits last on the settings line, after the approvals word, tinted as a mode with existing
   tokens only: the fork's `border-accent/40 bg-accentbg text-accent-soft` (all three are `@theme` tokens on `main`,
   and `text-accent-soft` is what the approvals word uses when autonomous).
3. **The submit that turns the track on lands last among the engine tasks.** The fork switched it on in the light
   review commit. Here it is its own task after the task-review, end-review and light-review tasks, so no merge in
   between runs a small plan-file dag half on the fast track, and that task owns every existing test and scenario that
   submits a plan file of 4 tasks or fewer and pins the full path. Those move to a 5-task fixture (the fork's choice for
   `plan-review-rounds` and `model-picks`): the change is what the goal asks for, not a pinned behaviour to keep.
4. **`leadAwaitedWake` (`pkg/orchestrate/wake.go`)** reads "the last round" off `pr.Round >= MaxPlanReviewRounds`, a
   site the fork's commit does not touch. It moves to `PlanReviewLastRound`, and a failed light round's replacement
   lead is told its amended resubmit dispatches (the `lightReviewFailedWake` wording). Same for `planReviewLine` in
   `wshcmd-jarvisdag.go` and `PlanReviewRoundsSpent`.
5. **Scenarios.** Two new CDP modules, registered in `scripts/cdp/scenarios.mjs` by the first task (empty), filled by
   the tasks that own each UI: `scenarios-kael1125-label.mjs` (`kael1125-fast-track-label`: run sheet chip, Chat run
   card head; `wsh runs show` is a Go unit test) and `scenarios-kael1125-views.mjs` (`kael1125-fast-track-views`: the
   DAG route line's Light review chip and its replacement, the tree row and Sessions row "amended by the lead", the End
   review step reviewing / failed / passed-unverified in the stage pane and tree row, the end reviewer as a stage member
   in the Sessions list, the "end review reviewing" headline of a stage that waits only on it, and a stage with no end
   review drawing as before). The dag is seeded as `scenarios-kael1113-final.mjs` seeds it (`kits.run.seedDag`): a seed shows how the
   cockpit draws a state, not what the engine does.
6. **Owner decisions.** Where porting a fork hunk would flip a behaviour a test on `main` pins, the task does not flip
   it and writes a `Not ported:` line in its worker report's For later tasks section. The engine hands every done
   ancestor's For later tasks to a task at dispatch, and the docs task depends on every other task, so it receives
   them all and writes each as an "(arcterm) Kael sync 11-25, owner decision" row in `docs/open-issues.md`. (A commit
   body would not reach it: the lane's squash message is only the task labels, `laneMergeMessage`, `lane.go:97`.)
7. **Plan review wording on main.** `main` has no "accepted by you": its tree row prints the stage outcome word
   (`stageSubline(verdict ?? outcome)`, `StageOutcome` in `agenttreemodel.ts`) and its Sessions row reads "accepted"
   (`STAGE_VERDICTS`, `sessionsruns.ts`). Both read a plan reviewer's own verdict before the review's state, so an
   amended light round would read "failed". The port adds an `amended` outcome / verdict, "amended by the lead", that
   outranks the reviewer's own verdict when `planreview.state === "accepted" && planreview.amended`; a human's accept
   keeps `main`'s current reading. `main`'s lead card has no plan review row (`leadcardmodel.ts`), so the fork's lead
   card hunk is not ported.
8. **`launchorigin.go`.** `main` places a session with no store record from its working directory and first prompt;
   a session in the final tree reads as the verifier. The end reviewer also runs in the final tree, so its opener
   ("You are the end reviewer for run ") joins `stageOpeners` with `jarvis.UsageRole_EndReviewer`, and the opener
   wins over the tree's guess as it does for the other stage roles.
9. **`codex-worker-route` stays on its 2-task plan.** It submits `fixtures/codex-route-plan.md` on Reviewer picks and
   passes round 1 by reading `pr.runid`, a field `main`'s `PlanReviewStage` no longer has, so it already fails on
   `main` before this port, and it is in no Final. The fast track does not touch what it checks (the harness and
   workers chips): with the track on, its round is one light reviewer on the reviewer route. Not moved, not fixed here;
   the docs task records it as an open issue.

## Not taken, and why

- The fork's `wsh runs show` Chat card (`runscards.ts`, `wshcards-runs.tsx`) and its `end-reviewer` role chip there:
  `main` has no such card (call 1).
- The fork's `docs/orchestrator-guide.md`: `main`'s guide is `docs/guide/orchestrator.md`.
- The fork's lead card "amended by the lead" sub-line: `main`'s lead card has no plan review row (call 7).
- `lead-design.txt` / `lead-design-prototype.txt` fixture refreshes: `main` has no builder for those prompts.
- An arc-view mod prompt card for the end reviewer's or the light reviewer's brief: the fork has none either. The light
  reviewer's brief opens "You are the plan reviewer for run …" and reads as a plan reviewer card already.
- The Timeline board's submit row ("Fast track: 3 tasks, …"): the fork's own design dropped it.

## Verification

- Go: the fork's tests, ported to `main`'s helpers: `fasttracktasks_test.go`, `endreview_test.go`,
  `planreviewlight_test.go`, the `verifier_test.go` cases, `wshcmd-runs_test.go` / `wshcmd-jarvisdag_test.go` cases,
  `wshserver_dagplanreview_test.go` (light round, amended resubmit, resubmit past 4 tasks), the resmon case, and
  `TestViewModFixtures` with the refreshed lead fixtures.
- Frontend unit tests beside each model: titles, route-line models, `finalStageView` with an end review, stage
  outcomes, the sessions row, the label words.
- CDP: `kael1125-fast-track-label`, `kael1125-fast-track-views`, `model-picks` and `plan-review-rounds` (now on the
  5-task fixture), and `kael1113-final-stage` (the final stage views without an end review still draw as before).
- In the run, the engine's claims are owned by Go tests, not a person: the fast-track flag at submit and the
  past-4 resubmit (Task 5's wshserver cases), no Reviewing state and the merge lines (`TestFastTrack*`), the light
  round and the amended resubmit (`Light*`, `AmendedResubmit*`, `ResubmitPastFastTrack*`), the end review and its
  findings joining the one fix round (`*EndReview*`). Final drives no real fast-track run: that would launch a real
  lead and workers only to stage screenshots of what seeded scenarios already show.
- Hand checks (`docs/hand-checks.md`, "(arcterm) Kael sync 11-25: …"), for the person after the land, since the goal
  asks for them and no test watches a real run's agents: a real run of ≤4 tasks taking the fast track
  end to end (one Light review, no Reviewing state, the merge lines on the lead, an End review in the final stage,
  the label on the run sheet, `wsh runs show` and Chat's run card); a light review that fails and the lead's amended
  resubmit dispatching; an end review that fails and its findings reaching the lead in the one fix round.
- `CHANGELOG.md`, Unreleased: an `Added` line for the fast track and a `Changed` line for where it shows, both marked
  "(from the kaeltran16 fork)". Not `<!-- big -->`: it is a change in how runs go, not a view to open.
