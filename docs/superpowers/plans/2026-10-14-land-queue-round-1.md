# Land queue: fix round 1

**Goal:** close two gaps the land-queue run (plan `docs/superpowers/plans/2026-10-14-land-queue.md`, effort
`fd79f265`) left inside its own goal. First, the cockpit misreads the `land-resolver` stage sessions that Task 5 now
starts. Second, a resolver's own `wsh jarvis complete` is never run against the server path, so nothing shows that it
moves the land on.

### Task 1: The cockpit knows a land-resolver session

**Depends on:** none

**Files:** `frontend/app/view/agents/agenttreemodel.ts`, `frontend/app/view/agents/agenttreemodel.test.ts`, `frontend/app/view/agents/runlineage.ts`, `frontend/app/view/agents/runlineage.test.ts`, `frontend/app/view/agents/runtimeline.ts`, `frontend/app/view/agents/runtimeline.test.ts`, `frontend/app/view/agents/sessionsruns.ts`, `frontend/app/view/agents/sessionsruns.test.ts`, `scripts/cdp/scenarios.mjs`

Create `runtimeline.test.ts` if it does not exist.

Task 5 starts a stage session with role `land-resolver` (`jarvis.UsageRole_LandResolver`) in the run's landing tree.
`run.land.resolver` holds its run id while `run.land.state` is `resolving`. Four frontend lists know only
`plan-reviewer` and `verifier`:

- `agenttreemodel.ts` `stageOutcome` (line ~101) reads every role other than `plan-reviewer` against
  `dag.final.verifierrunid`. A resolver row therefore reads as "still judging" forever and counts toward the run's
  `busy`. When the final stage had a second round, it reads as `failed` instead.
  - Give `land-resolver` its own branch, read from `run.land`:
    - `undefined` (at work) while `land.state === "resolving"` and `land.resolver` is that session's run id;
    - `failed` once the land is `held` with `resolvertried`;
    - `passed` once the land has moved on, whether `queued`, `pending` or `landed`.
  - Use the existing `StageOutcome` values; add none.
  - A resolver row stays in the after-the-tasks group (`stageRank` 2), as a verifier's does.
- `runlineage.ts` `STAGE_LABELS` (line ~312): add `"land-resolver": "Conflict resolver"`, so `stageLabel` stops
  returning the raw role.
- `runtimeline.ts`:
  - `KIND_TITLE`: add `"land-queued": "Land in line"` and `"land-resolving": "Resolving conflicts with the base"`.
  - `KIND_TONE`: `land-queued` is `text-muted` and `land-resolving` is `text-asking`. These are existing tone classes,
    and neither event is a failure.
  - `STAGE_ROLE_TITLE`: add `"land-resolver": "Conflict resolver started"`.
- `sessionsruns.ts` `STAGE_ROLES` (line 18): add `"land-resolver"`, so its sessions group as a stage member instead of
  falling through to the lead.
  - `stageStatus` must not word a live resolver as "reviewing": a live one reads `resolving`.
  - A finished one reads from `run.land` the same way `stageOutcome` does, or the closest existing status when the
    member has only the dag. Say which in the report.

Add vitest cases for each list: the three resolver outcomes, the label, the two event titles and the stage-started
title, and the sessions grouping and status. Do not change how `plan-reviewer` or `verifier` read; the existing tests
must pass unchanged.

The `land-queue` CDP scenario seeds a `resolving` land. If its fixture already gives that land a resolver stage row in
the tree, add an assert to the scenario's step that the row reads `Conflict resolver` and is not counted as finished.
If it has no such row, do not seed a live session for it. Say in Not verified that the row is covered by vitest only.

### Task 2: A resolver's complete moves its land on

**Depends on:** none

**Files:** `pkg/wshrpc/wshserver/wshserver_runs.go`, `pkg/wshrpc/wshserver/wshserver_runs_test.go`, `pkg/orchestrate/landresolver.go`, `pkg/orchestrate/landresolver_test.go`

If another test file in `pkg/wshrpc/wshserver` already drives `advanceRun`, put the test there instead.

Task 5's tests fake the spawn and set the resolver run's status directly. Nothing runs the path a real resolver takes.
It ends with `wsh jarvis complete --report <file>`, which goes to `advanceRun` (`wshserver_runs.go:775`) for a stage
child run of a done dag. That run has no task and no `ParentLeadORef`, and its working directory is the run's landing
tree (`run.LandPath`), not a task worktree.

- Add a test in `pkg/wshrpc/wshserver` that seeds what Task 5's spawn leaves:
  - a done orchestrator run with a dag;
  - its land `resolving`, with `Resolver` set and the base merged into `wave/<id>` in a real landing tree (the git
    helpers the land tests already use);
  - the resolver's stage run, with `StageRole` `land-resolver` and `BaseCommit` as Task 5 sets it.
- Then call `advanceRun` with `RunAction_Complete` and a report, as the resolver would.
- Assert that:
  - the call returns no error;
  - the resolver run is `done`;
  - the owner run's land is not touched by the call itself;
  - a following `tendResolvingLands` pass (or the exported seam the tests use for it) moves the owner's land to
    `queued` or on to `landed`;
  - the resolver run is not itself sealed or landed as if it were an orchestrator run.
- Pay particular attention to these checks in `advanceRun`:
  - the `LandConflicts` refusal (`preRun.TaskId == ""` and not done) must not refuse or misjudge a resolver run;
  - the `ownsDag` head-commit default;
  - whatever `sealDue` triggers for a stage run.
- If any of these breaks the path, fix it in the smallest way that keeps `plan-reviewer` and `verifier` stage runs as
  they are, and name it in the report.
- If the path already works, the test is the deliverable.
