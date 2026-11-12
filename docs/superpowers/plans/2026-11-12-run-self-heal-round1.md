# Runs heal themselves — round 1 fixes

Spec: `docs/superpowers/specs/2026-11-12-run-self-heal-design.md` (decisions 1 and 6). Two defects task t-6's worker
found in the paths this run built and left unfixed.

**Verify:** `node scripts/verify.mjs ./pkg/orchestrate/... ./pkg/util/shellutil/... ./pkg/agentsleep/... ./pkg/agentobserve/... ./pkg/wshrpc/... ./pkg/runpause/... ./cmd/wsh/... ./cmd/server/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs run-row-stuck`

Rules for every task: TDD (failing test first), check only the files you touched with gofmt, never start a dev app,
commit with a pathspec.

### Task 1: A pause that lands during a hang stop or a lead launch does not hand the lead over
**Depends on:** none

**Files:** `pkg/orchestrate/wake.go`, `pkg/orchestrate/wake_test.go`

Spec decisions 1 and 6 meet here. `flushLocked` (`wake.go`, the `leadPaused` check) and `PokeWake` already hold wakes
and skip the relaunch while the run is under a pause, because the pause ends the lead's process on purpose and the
resume reopens it. Two settle paths still call `leadDiedLocked` with no pause check:

- `hungLeadStopped` (`wake.go:542`): a hang stop already in flight when a pause lands finds the lead not alive and
  hands it over, so an autonomous run gets a replacement lead while paused (the run 1cad2fd0 failure t-6 fixed).
- `leadLaunched` (`wake.go:632`): a launch that fails while the run is paused hands the lead's judgment to the person.

Steps:
1. Failing tests in `wake_test.go` (reuse `scriptHang`, `workingLead`, `heldClock` and t-6's pause helpers): a stop in
   flight, then the run is paused, then the stop settles with the lead not alive → no `leadDiedLocked` (no relaunch,
   no forwarded asks), the held lines stay queued, and after the resume the next flush delivers them to the reopened
   lead. Same for a failed launch under a pause: the launch lines go back on the queue and nothing is handed over.
2. In both functions, check `leadPaused(ctx, channelId, runId)` before `leadDiedLocked`; under a pause, keep the
   lines held, clear the hold clock and return, as `flushLocked` does.
3. A not-paused hang stop and a not-paused failed launch behave exactly as before (keep their existing tests green).

Commit `fix(orchestrate): a pause during a hang stop or a lead launch keeps the lead`.

### Task 2: A lead reopened in a new tab keeps its tab when its process exits
**Depends on:** none

**Files:** `pkg/orchestrate/interrupted.go`, `pkg/orchestrate/interrupted_test.go`

Spec decision 6. `resumeInNewTab` (`interrupted.go:231`) spawns the reopened worker with
`jarvis.RunWorkerOptions{RunId: run.ID}`, while the first spawn of an orchestrator lead passes `KeepOnExit: true`
(`pkg/jarvis/runexec.go:457`: its tab must outlive the lead process while the dag's children run). A lead reopened in
a new tab therefore gets a tab that closes when its process exits, for example at the next pause, so every
pause/resume after that makes yet another tab.

Steps:
1. Failing test: resuming an orchestrator run's lead whose tab was closed spawns it with `KeepOnExit` true; a quick
   (non-orchestrator) run's worker keeps `KeepOnExit` false. Capture the options by stubbing `jarvis.SpawnRunWorker`
   (a package var other tests already swap).
2. Pass `KeepOnExit: run.Mode == jarvis.RunMode_Orchestrator`, the same rule `runexec.go` uses.

Commit `fix(orchestrate): a lead reopened in a new tab keeps it after its process exits`.
