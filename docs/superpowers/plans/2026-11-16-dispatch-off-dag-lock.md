# Dispatch off the dag lock (port of the fork's cead8a6fb) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Effort:** effort:39803de1-7419-4f4d-8a18-a0c32e3a8199
**Verify:** `node scripts/verify.mjs ./pkg/orchestrate ./pkg/wshrpc/wshserver ./cmd/wsh/cmd`
**Check:** `task check:ts`

**Goal:** A tick makes a task's lane tree and runs its Setup outside the dag lock, so the lock is held for the spawn
alone; the lead's task actions survive a client timeout and say so; and two small lock and progress fixes.

**Architecture:** Dispatch becomes two locked passes with the slow work between them, as the kaeltran16 fork did in
`cead8a6fb` ("Dispatch off the dag lock", 2026-11-13, merged from `f80ac1ac2`; its plan is
`git show bfd04e1aa:docs/superpowers/plans/2026-11-13-dispatch-off-dag-lock.md`). The first pass moves each task it
claims to a new persisted state, `preparing`, and returns a prepare job; `runTick` runs the jobs once the lock is
released; the next locked pass spawns the prepared tasks into their warm trees. The prepare's outcome waits in an
in-memory registry between the passes. A `preparing` task with no registry entry (wavesrv restarted mid-prepare) goes
back to `pending`. This is a port, not a cherry-pick: the fork's worker admission is a `memgate.Claim` carried across
the passes (`bindToBlock`, `ReleaseIfUnbound`, `WithGateAdmitted`), which ours does not have. Ours admits by count
(`claimWorkers` / `releaseWorkerClaim`, `pkg/orchestrate/workerslots.go:122`), and a committed `preparing` task counts
toward the live-worker cap through `busyTaskIDs` (`inFlight`), so the registry carries no claim.

**Tech Stack:** Go (`pkg/orchestrate`, `pkg/wshrpc/wshserver`, `cmd/wsh/cmd`); one frontend constant
(`frontend/app/view/agents/runlineage.ts`).

**Evidence:** `waveapp.log` (packaged, `%LOCALAPPDATA%\dev.arc.app\data\`), 2026-11-14 15:21 to 2026-11-16 17:39: 100
slow-lock lines, 928 s held in all, 845 s (91%) of it with `dispatch` as the slowest phase (56 holds, longest 65.3 s);
`liveness` 42 s (longest 3.5 s), `mergeBatch` 27 s. Each long dispatch hold made `HandleChildOutcome` and the next
tick wait (for example 13:38:55, two outcomes waited 7-8 s). The fork measured the same on its own runs (91% `git
worktree add` plus Setup). This settles the 2026-11-26 re-measure of the dag lock's phases in `docs/open-issues.md`.

---

## Global constraints

- Every dag write still happens under the dag lock (`withDagMutation`). The off-lock prepare writes only the
  filesystem and the in-memory registry; what it learns that belongs on the dag (a failure, leftover trees, a requeue)
  is recorded in the registry entry and written by the next locked pass.
- One `Schedule` call still returns with a ready task running (or failed). `runTick` loops until no prepare job is
  left. Existing tests that call `Schedule` once and assert a spawn must keep passing unchanged.
- A dispatch failure still waits for the next `Schedule`: a task that `failDispatch` reset to `pending`, or that a
  prepare sent back to `pending` (slot wait over, pause), is not claimed again by a later pass of the same call.
  `TestDispatchFailureIsRetriedOnTheNextTick` (`engine_test.go:1614`) pins one retry per tick.
- Ours' Setup behaviour stays: the bounded wait for a heavy-job slot (`withSlotWait(…, SetupSlotWait)`, which returns
  `errSlotWaitOver`), the pause and cancel cut-off (`dagSetupCtx` / `setupCut` / `stopDagSetup`, `pause.go:52-90`), the
  jobqueue source label (`taskStepLabel("Setup", …)`), `withRunCmdOwner(…, PlanCmd_Setup, "")`, and the
  `treeSetUp` / `markTreeSetUp` marker. They move with the code, unchanged.
- No new dependency, no SQL migration (task state is a string on `TaskNode`). The only frontend change is
  `TASK_IN_FLIGHT` gaining `"preparing"`; every other view shows the new state by its raw word.
- Comments say why, lower case, only where needed. No `Co-Authored-By` trailer. Each commit body names the fork hash
  it ports, where it ports one.

## Review focus

1. **A prepare cut short by a wavesrv restart.** The task is stored `preparing` with no registry entry. The next tick
   puts it back to `pending` and prepares it again; it never holds a slot forever.
2. **Cancel while Setup runs.** No worker spawns, the task reads `cancelled`, the registry holds nothing for the dag,
   and the prepared tree is removed (Cancel's own removal can run before the tree exists).
3. **Pause while Setup runs, and a Setup whose slot wait runs out.** Both send the task back to `pending` untried
   (no attempt counted, no wake), as today's `break` does; the jobs of the same tick that did not run go back too.
4. **A second tick while a task is preparing** (a worker exit or an RPC pokes `Schedule`). Setup runs once and one
   worker spawns.
5. **A skip while the task is preparing.** The task reads `skipped`, no worker spawns, the registry drops its entry.
6. **A Setup that leaves untracked files in the tree.** `EnsureRunWorktree` rebuilds a tree whose
   `git status --porcelain` is non-empty, so the spawn pass must reuse the prepared tree and never call it again.
7. **A spawn that fails after its prepare.** The task is `pending` with one attempt after that `Schedule`, and the
   retry waits for the next call.

---

### Task 1: The `preparing` task state

**Depends on:** none
**Chunk:** A dag merge --continue waited 2m37s on the dag lock behind ticks held up by slow git worktree calls (fork 6231b6970, its run 65ce3ef3); the request now survives it, the lock hold itself is unexplained

**Files:**
- Modify: `pkg/orchestrate/dag.go` (constants at :18-29, `taskStateClass` at :35, `taskStates` at :51, `slotsInUse` at :91)
- Modify: `pkg/orchestrate/scheduler.go` (`skippable` at :225)
- Test: `pkg/orchestrate/scheduler_test.go`, `pkg/orchestrate/dag_test.go` (`TestEveryTaskStateIsClassified` at :491)
- Modify: `frontend/app/view/agents/runlineage.ts:651`, test `frontend/app/view/agents/runlineage.test.ts`
- Modify: `docs/guide/orchestrator.md:680` (the `dag skip` row, Vietnamese)

- [ ] **Step 1: Write the failing tests** in `scheduler_test.go`, with `groupWith` (`scheduler_test.go:10`):

```go
// a preparing task's tree and Setup are being made for its worker: it holds the slot the worker will use
func TestNextToSpawnPreparingHoldsSlot(t *testing.T) {
	g := groupWith(TaskState_Done, TaskState_Preparing)
	g.Parallelism = 1
	if got := NextToSpawn(g); len(got) != 0 {
		t.Fatalf("a preparing task must hold its slot, got %v", got)
	}
}

func TestCancelGroupCancelsAPreparingTask(t *testing.T) {
	g := groupWith(TaskState_Done, TaskState_Preparing)
	CancelGroup(g)
	if g.Tasks[1].State != TaskState_Cancelled {
		t.Fatalf("cancel: preparing -> %s, want cancelled", g.Tasks[1].State)
	}
}

func TestSkipTaskFromPreparing(t *testing.T) {
	g := groupWith(TaskState_Done, TaskState_Preparing)
	if err := SkipTask(g, "t-1"); err != nil || g.Tasks[1].State != TaskState_Skipped {
		t.Fatalf("skip from preparing: err=%v state=%s", err, g.Tasks[1].State)
	}
}
```

Add `TestNextToSpawnPreparingHoldsItsLane` beside `TestNextToSpawnReviewingHoldsItsLane`, mirroring it: the same
two-task lane, `g.Tasks[1].State = TaskState_Preparing`, t-0 `pending`; `NextToSpawn` returns nothing. If
`TestEveryTaskStateIsClassified` lists the states by hand, add `TaskState_Preparing` there. In `runlineage.test.ts`'s
`describe("runEngineBusy")`, add `"preparing"` to the states the existing loop asserts busy.

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./pkg/orchestrate -run '^(TestNextToSpawnPreparing|TestCancelGroupCancelsAPreparingTask|TestSkipTaskFromPreparing|TestEveryTaskStateIsClassified)'`
(Bash on Windows: prefix `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"`) and
`npx vitest run frontend/app/view/agents/runlineage.test.ts`.
Expected: Go compile error `undefined: TaskState_Preparing`; the vitest `preparing` case fails.

- [ ] **Step 3: Implement**
  - `dag.go`: `TaskState_Preparing = "preparing" // claimed for dispatch; its lane tree and Setup are being made outside the dag lock`.
  - Add a `slot bool` column to `taskStateClass`: "holds one of the run's parallelism slots (slotsInUse)", and move
    that clause out of `active`'s comment. `slot` is true for Running, Stalled and Preparing only.
  - `slotsInUse` reads `taskStates[s].slot` instead of `taskActive`.
  - Preparing row: active false (no process, so no exit event), inFlight true, slot true, review/landing/settled/
    terminal false, cancelTo `TaskState_Cancelled`.
  - `scheduler.go`: `skippable` accepts `TaskState_Preparing`; its comment says the prepare is dropped by the next
    locked pass (Task 2).
  - `runlineage.ts`: `TASK_IN_FLIGHT` gains `"preparing"` (a prepare takes 15-60 s and the lead is idle through it).
  - `docs/guide/orchestrator.md:680`: the list of states `skip` accepts gains `preparing`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `go test ./pkg/orchestrate -run '^(TestNextToSpawn|TestCancelGroup|TestSkipTask|TestEveryTaskStateIsClassified)'` and `npx vitest run frontend/app/view/agents/runlineage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pkg/orchestrate/dag.go pkg/orchestrate/scheduler.go pkg/orchestrate/scheduler_test.go pkg/orchestrate/dag_test.go docs/guide/orchestrator.md frontend/app/view/agents/runlineage.ts frontend/app/view/agents/runlineage.test.ts
git commit -m "feat(orchestrate): a preparing task state that holds its slot and lane" -m "Ports the fork's f80ac1ac2 (part of cead8a6fb). Dispatch is moving its tree and Setup out of the dag lock; the task needs a stored state for that span so the cap, its lane, cancel, skip and the cockpit's busy read all see it."
```

### Task 2: Prepare the tree outside the lock, spawn in the next pass

**Depends on:** Task 1 (`TaskState_Preparing`)
**Chunk:** A dag merge --continue waited 2m37s on the dag lock behind ticks held up by slow git worktree calls (fork 6231b6970, its run 65ce3ef3); the request now survives it, the lock hold itself is unexplained

**Files:**
- Create: `pkg/orchestrate/treeprep.go`, `pkg/orchestrate/treeprep_test.go`
- Modify: `pkg/orchestrate/engine.go` (`scheduleTickTimeout` :133, `runTick` :457, `scheduleLocked` :479, the dispatch block :787-953)
- Modify (comments only): `pkg/orchestrate/mutation.go` (`WithDagMutation`, `TryWithDagMutation` :172, `cancelDag` :783), `pkg/orchestrate/pause.go:40` (`dagSetups`' comment: Setup no longer runs under the dag lock, except the fallback below)
- Modify: `docs/open-issues.md` (the two dag-lock rows, see Step 7)

- [ ] **Step 1: Write the failing tests** in `treeprep_test.go`, with `newMergeFixture` (`mergetask_test.go:34`),
  `f.setPlanCommands(t, "", setupCmd)` (`setup_test.go:91`), `stubPlanCommand` (`setup_test.go:59`), `stubSpawn`
  (`mergetask_test.go:220`), `stubFlakySpawn` and `allowWorkerHarnessForTest` (`engine_test.go:1597`, `:391`). Each
  test calls `Schedule(f.ctx, f.dagID)` once unless it says otherwise. The Setup stub does the probing, because it
  runs where the prepare runs.
  - `TestDispatchRunsSetupOutsideTheDagLock`: the stub records `TryWithDagMutation(f.dagID, func() error { return nil })`'s
    `ran`. After: one Setup call, `ran == true`, one spawn, task `running`.
  - `TestATaskIsPreparingWhileItsSetupRuns`: the stub reads `wstore.GetDag` and records `Tasks[0].State`; want `preparing`.
  - `TestAPreparingTaskIsPreparedOnce`: the stub calls `Schedule(f.ctx, f.dagID)` itself the first time it runs.
    After: Setup ran once, one spawn, task running.
  - `TestASetupThatLeavesUntrackedFilesRunsOnce`: the stub writes an untracked, non-ignored `setup-output.txt` in its
    dir. After: Setup ran once, one spawn, task running, and the file still exists in the spawned worker's cwd.
  - `TestADispatchFailedAfterItsPrepareWaitsForTheNextTick`: Setup succeeds; `stubFlakySpawn(t, 1)`. After the first
    `Schedule`: task `pending`, `Attempts == 1`, Setup ran once. After a second: running.
  - `TestCancelDuringSetupSpawnsNothing`: the stub calls `Cancel(f.ctx, f.dagID)` from a goroutine and waits for it
    (Cancel takes the dag lock, which must be free now). After: no spawn, task `cancelled`,
    `treePrepCount(f.dagID) == 0`, and `worktreeDir(f.project, TaskWorktreeKey(f.ownerID, "t-0"))` does not exist.
  - `TestSkipDuringSetupSpawnsNothing`: the stub calls `ApplyAction(f.ctx, f.dagID, "t-0", "skip", waveobj.RoutePin{})`.
    After: no spawn, task `skipped`, `treePrepCount(f.dagID) == 0`.
  - `TestPauseDuringSetupSendsTheTaskBackUntried`: the stub returns an error wrapping its ctx's cause after cancelling
    through `stopDagSetup(f.dagID)` (call the returned func before returning). After: no spawn, task `pending`,
    `Attempts == 0`, no task-failed event.
  - `TestASetupSlotWaitOverSendsTheTaskBackUntried`: the stub returns `errSlotWaitOver`. After: task `pending`,
    `Attempts == 0`, no spawn, and Setup ran once in that `Schedule` (not looped).
  - `TestAPreparingTaskLostToARestartIsPreparedAgain`: before `Schedule`, store `Tasks[0].State = TaskState_Preparing`
    with no registry entry. After: Setup ran once, one spawn, running.
  - `TestSpawnedEventCarriesThePrepareTimings`: the stub sleeps 50 ms; the run's `task-spawned` event has
    `setupms >= 50` (read it as existing event tests do: grep `RunEventKindTaskSpawned` in `*_test.go`).

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./pkg/orchestrate -run '^(TestDispatchRunsSetupOutsideTheDagLock|TestATaskIsPreparingWhileItsSetupRuns|TestAPreparingTaskIsPreparedOnce|TestASetupThatLeavesUntrackedFilesRunsOnce|TestADispatchFailedAfterItsPrepareWaitsForTheNextTick|TestCancelDuringSetupSpawnsNothing|TestSkipDuringSetupSpawnsNothing|TestPauseDuringSetupSendsTheTaskBackUntried|TestASetupSlotWaitOverSendsTheTaskBackUntried|TestAPreparingTaskLostToARestartIsPreparedAgain|TestSpawnedEventCarriesThePrepareTimings)$'`
Expected: compile error (`treePrepCount` undefined); once it compiles, the lock and state tests fail.

- [ ] **Step 3: Implement `treeprep.go`**

```go
// worktreePrepTimeout bounds one lane tree's checkout off the lock. Large checkouts took 15-55 s on the fork's runs,
// past the spawn budget that bounded them under the lock; this only stops a hung git.
const worktreePrepTimeout = 5 * time.Minute

// treePrep is one task's tree preparation, from the pass that claims the task to the pass that spawns or fails it
type treePrep struct {
	done       bool
	requeue    bool   // Setup never ran to an answer (its slot wait ran out, or a pause or cancel cut it): back to pending, untried
	failKind   string // FailureKindWorktree or FailureKindSetup, set with err
	err        error
	wt, head   string   // the prepared tree and its head, which the spawn pass uses while wt exists
	leftovers  []string // laneLeftovers' result, written to the task's CleanupError by the spawn pass
	worktreeMs int64
	setupMs    int64
	notLinked  []string
}

type treePrepJob struct {
	dagID, taskID, ownerID, projectPath, key, spawnBase, setup, setupLabel string
}

func registerTreePrep(dagID, taskID string)
func treePrepFor(dagID, taskID string) (treePrep, bool)         // a copy, under the registry mutex
func finishTreePrep(dagID, taskID string, outcome treePrep) bool // sets done and the outcome; false (a no-op) when the entry is gone
func takeTreePrep(dagID, taskID string) *treePrep                // removes it; nil when none
func dropTreePreps(dagID string, keep func(taskID string) bool)  // removes every entry of the dag keep refuses (nil keeps none)
func treePrepCount(dagID string) int                             // for tests
func prepareTaskTree(ctx context.Context, job treePrepJob)       // off the lock
```

The registry is a package-level map keyed `dagID + "/" + taskID` behind a `sync.Mutex`. `prepareTaskTree` moves the
git branch of today's dispatch block (`engine.go:814-871`, from `EnsureRunWorktree` to `markTreeSetUp`) out of the
lock, unchanged except:
  - `EnsureRunWorktree` and `laneLeftovers` run on `context.WithTimeout(context.WithoutCancel(ctx), worktreePrepTimeout)`
    instead of a spawn budget.
  - Setup keeps today's context chain exactly (`jobqueue.WithSource` with `job.setupLabel`, `dagSetupCtx(withSlotWait(…,
    SetupSlotWait), dagID)`, `withRunCmdOwner(…, ownerID, PlanCmd_Setup, "")`), and the condition
    `setup == "" || !treeSetUp(ctx, wt)`.
  - `errSlotWaitOver`, or a Setup error with `setupCut(setupCtx)`, records `requeue` (after removing the tree on the
    cut, as today). Any other Setup error removes the tree and records `failKind: FailureKindSetup`. A worktree error
    records `failKind: FailureKindWorktree`. Every outcome goes through one `finishTreePrep` call, never the dag.
  - The entry can vanish while the prepare runs (a skip or cancel's pass calls `dropTreePreps`): `finishTreePrep`
    returns false and the prepare stops there.
  - Afterwards, if `wstore.GetDag` reads the dag `DagStatus_Cancelled`, remove the tree (`removeWorktreeDir`):
    Cancel's own removal may have run before the tree existed.

- [ ] **Step 4: Rework `engine.go`**
  - `runTick` owns `held := map[string]bool{}` (the tasks this `Schedule` call sent back to pending: dispatch failures
    and requeues) and passes it to every pass. `scheduleLocked` gains `held map[string]bool` and `jobs *[]treePrepJob`.
    On a cancelled dag it calls `dropTreePreps(dagID, nil)` before returning.
  - Before `NextToSpawn` (after `clock.enter("dispatch")`), a new `settlePreparing(ctx, g, held, &afterCommit) (ready []string, preps map[string]*treePrep)`
    runs over each `preparing` task:
    - no entry: back to `TaskState_Pending`, with a log line;
    - not done: left alone;
    - `requeue`: take the entry, back to `pending` untried (no attempt, no event), add to `held`;
    - failed: take the entry; for `FailureKindWorktree` set `CleanupError`/`CleanupAttempts` as the block does today;
      then `failDispatch` and add to `held`;
    - done: take the entry into `ready`/`preps`; a non-empty `leftovers` sets `CleanupError`/`CleanupAttempts` as today.

    Then `dropTreePreps(g.OID, keep)`, where `keep` accepts only tasks still `preparing`.
  - Spawn `ready` first. The spawn loop (the old block from `reportPath` on, `engine.go:876-952`) becomes a function both
    paths call. For a ready task whose prep `wt` still exists it uses the prep's `wt` and `head`
    (`attemptBase(spawnCtx, g, taskID, wt, head)`, branch `"wave/" + key`), `worktreeMs`, `setupMs` and `notLinked`, and
    never calls `EnsureRunWorktree`, `laneLeftovers` or Setup. Only when the prep's `wt` has vanished does the old
    under-lock tree + Setup path run, as the fallback (keep it as one function shared with nothing else). The route and
    harness checks run for ready tasks too. Every task whose spawn `failDispatch`es is added to `held`.
  - Then `NextToSpawn`, with `held` and the tasks just spawned filtered out, then `claimWorkers` as today. In a git
    project, after the route and harness checks, set the task `TaskState_Preparing`, `registerTreePrep`, and append a
    `treePrepJob` to `jobs`. A non-git project has no tree, so its tasks spawn in the same pass, as today.
    `releaseWorkerClaim`'s defer stays: once the pass commits, `busyTaskIDs` counts the preparing tasks.
  - `runTick`: after the lock, run `prepareTaskTree` for each job, in order. When a job's outcome is `requeue`, finish
    every later job of this tick as `requeue` without running it (one slot wait or pause holds them all, as today's
    `break` does). Loop when any job ran or any stalled task was retried, as the stall loop does.
  - `scheduleTickTimeout`: `MaxParallelism*(worktreePrepTimeout+SetupSlotWait+SetupTimeout+jarvis.RunWorkerSpawnTimeout) + 10*time.Minute`,
    with its comment rewritten: each task spends up to `worktreePrepTimeout` on its tree and `SetupSlotWait` plus
    `SetupTimeout` on Setup off the lock, then a spawn budget in the spawn pass.
  - Comments that say Setup runs under the dag lock now lie: the "no progress sink" comment (drop it unless a reason
    remains), `WithDagMutation`'s "(a Setup aside)", `TryWithDagMutation`'s "Setup command holds this lock for up to
    SetupTimeout", `cancelDag`'s "held for minutes (Setup)" and "a Setup holds that lock while it waits for a heavy-job
    slot", and `dagSetups`' comment in `pause.go`. Each keeps the fallback in mind: a vanished prepared tree is the one
    case Setup still runs under the lock.

- [ ] **Step 5: Run the new tests and the dispatch tests they border**

Run: `go test ./pkg/orchestrate -run '^(TestDispatch|TestSetup|TestNoSetupLineRunsNothing|TestATaskIsPreparing|TestAPreparingTask|TestASetupThatLeaves|TestASetupSlotWait|TestADispatchFailedAfterItsPrepare|TestCancelDuringSetup|TestSkipDuringSetup|TestPauseDuringSetup|TestSpawnedEventCarries|TestKickHeldRunsTicksDag|TestTaskActionsStop|TestPause)'`
Expected: PASS, the existing Setup, pause and dispatch-retry tests unchanged. Then the whole package once:
`git diff --name-only main > /tmp/changed.txt && ARC_VERIFY_CHANGED=/tmp/changed.txt node scripts/verify.mjs ./pkg/orchestrate`.

- [ ] **Step 6: Commit**

```bash
git add pkg/orchestrate/treeprep.go pkg/orchestrate/treeprep_test.go pkg/orchestrate/engine.go pkg/orchestrate/mutation.go pkg/orchestrate/pause.go
git commit -m "perf(orchestrate): make a task's tree and Setup outside the dag lock" -m "Ports the fork's cead8a6fb, fitted to ours' count-based worker admission (no claim crosses the passes) and ours' Setup slot wait and pause cut. From 11-14 to 11-16, 845 of 928 s of slow dag-lock holds were dispatch, up to 65 s each; worker exits, merges and actions queued behind them. The claim pass now marks the task preparing and runTick prepares its tree after the lock; the next pass spawns into the warm tree."
```

- [ ] **Step 7: Docs.** In `docs/open-issues.md`, the row "Re-measure the dag lock's slow phases on 2026-11-26" and the
  row "Kael sync 11-13: a tick holds the dag lock through slow worktree creation": replace both with one row saying the
  re-measure was read early (the evidence above), dispatch moved off the lock in this commit, and what to watch next
  (the `liveness` phase, longest 3.5 s). Add a `CHANGELOG.md` line under `Fixed`: "A run no longer freezes its other
  workers, merges and your actions for up to a minute while it checks out a task's tree and runs its Setup." Commit
  both with `docs(orchestrate): …`.

### Task 3: A task action ticks the dag even when the stopped worker's tab will not close

**Depends on:** none
**Chunk:** Engine: when a stopped worker's tab fails to close, ApplyAction returns before Schedule, so turned-away ticks wait for the watchdog

**Files:**
- Modify: `pkg/orchestrate/mutation.go:249-284` (`ApplyActionBy`, `applyAction`)
- Test: `pkg/orchestrate/mutation_test.go` (or the file that holds `TestTaskActionsStop*`; grep it)

- [ ] **Step 1: Write the failing test** `TestAnActionWhoseTabWillNotCloseStillTicks`: a dag whose t-0 is running with a
  worker; stub the tab close (`closeWorkerTab` reaches a var; grep `closeWorkerTab` in `mutation.go:328` for the seam,
  and add a var seam if there is none) to return an error; count `Schedule` passes (stub `runTick` is not needed:
  assert the effect, a ready t-1 that the action unblocks is spawned by the same `ApplyAction` call). Expect the
  action's error to name the tab, and t-1 to be `running` (or `preparing` after Task 2 merges: assert "not pending").
- [ ] **Step 2: Run it to see it fail:** `go test ./pkg/orchestrate -run '^TestAnActionWhoseTabWillNotCloseStillTicks$'`.
- [ ] **Step 3: Implement.** `applyAction` returns `(recorded bool, err error)`: `recorded` is true once the second
  `withDagMutation` committed. `ApplyActionBy`:

```go
	recorded, err := applyAction(ctx, dagID, taskID, action, by, target)
	if !recorded {
		return err
	}
	// the action is recorded even when its stopped worker's tab would not close: tick for the ticks it turned away
	return errors.Join(err, Schedule(ctx, dagID))
```

- [ ] **Step 4: Run it and `-run '^TestTaskActions'` to see them pass.**
- [ ] **Step 5: Commit** `fix(orchestrate): a recorded task action ticks the dag even when the worker's tab will not close`.

### Task 4: A lead's task action survives its caller's timeout and says so

**Depends on:** none
**Chunk:** dag retry/approve/amend answer EC-TIME while a merge verifies; outcome unknown, amend notes may be lost (run dc8d9cc7)

**Files:**
- Modify: `pkg/wshrpc/wshserver/wshserver_dag.go:637-725` (`DagActionCommand`: the `amend` and `sendback` cases and the
  default `ApplyActionBy` call)
- Modify: `pkg/orchestrate/mergetask.go:80` (`landForCaller`: generalize, or add a sibling `actForCaller` beside it)
- Modify: `cmd/wsh/cmd/wshcmd-jarvisdag.go` (`dagActionWithin` :740, `dagNoteCmd` :1311), test `cmd/wsh/cmd/wshcmd-jarvisdag_test.go`

Today a lead action waits on the dag lock on the RPC's context, with a 10 s client budget (`dagRpcTimeoutMs`, :646): a
long tick turns it into a bare EC-TIME, and its first read under the lock can then fail on the expired context, so the
lead cannot tell whether a retry happened or an amend note was kept. The merge already solved this (`landForCaller`,
the fork's `6231b6970`).

- [ ] **Step 1: Write the failing tests.**
  - Go, `pkg/orchestrate`: `TestAnActionWhoseCallerLeftStillLands`: hold the dag lock from the test
    (`withDagMutation` in a goroutine that waits on a channel), call `AmendTaskForCaller` (or the name you pick) with a
    context cancelled before the lock frees, free the lock, and assert the note is on the task.
  - wsh: `TestDagActionTimeoutSaysItStillLands`: stand in for wavesrv through `dagActionRpc` (:725) returning a timeout
    error (`wshutil` timeout, as `submitOutcomeUnknown` reads), and assert the error says the request still finishes
    once the engine frees the dag, wakes the lead if it fails, and to check `wsh jarvis dag status <task>` rather than
    re-running it.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** Server: run `ApplyActionBy`, `AmendTask` and `SendBack` on a context of their own,
  `context.WithTimeout(context.WithoutCancel(ctx), scheduleTickTimeout)`, through one helper beside `landForCaller` that
  posts a wake (`PostWake` with a line like `landFailedWake`'s) when the action fails after `ctx.Err() != nil`. Not
  `tell`: it types into a live terminal, and a late tell is worse than none. wsh: in `dagActionWithin` and
  `dagNoteCmd`, when `submitOutcomeUnknown(err)`, return
  `fmt.Errorf("dag %s %s got no reply within %s (%v); wavesrv finishes a request it received once the engine frees the dag, and wakes you if it fails: check with `+"`wsh jarvis dag status %s`"+` rather than re-running it", action, taskID, compactDur(timeoutMs), err, taskID)`.
- [ ] **Step 4: Run the tests** (`go test ./pkg/orchestrate -run '^TestAnActionWhoseCallerLeftStillLands$'`,
  `go test ./cmd/wsh/cmd -run '^TestDagActionTimeout'`) **to see them pass.**
- [ ] **Step 5: Commit** `fix(orchestrate): a lead's task action lands after its caller times out, and wsh says so`.

### Task 5: The progress check runs no git in a project without a tree

**Depends on:** none
**Chunk:** Engine runTick holds a dag lock 10-19 s when a task's progress check runs git status in a non-git cwd (dag-lifecycle temp project): find why

**Files:**
- Modify: `pkg/orchestrate/progress.go:290-306` (`checkProgress`)
- Test: `pkg/orchestrate/progress_test.go`

A task in a non-git project has no lane tree (dispatch leaves the child run's `Branch` empty, `engine.go:811`), so
`worktreeFingerprint`'s `git status` there can only fail, once a minute per task, under the dag lock. The 10-19 s holds
the chunk names did not recur from 2026-11-14 to 2026-11-16 (`liveness` longest 3.5 s), so this removes the cost
rather than explaining it.

- [ ] **Step 1: Write the failing test** `TestProgressCheckSkipsATaskWithNoTree`: a running task whose run has a
  `ProjectPath` and an empty `Branch`; swap `progressFingerprint` (:47) for a stub that counts calls; call
  `checkProgress` past `progressCheckEvery`; want zero calls and no flag.
- [ ] **Step 2: Run it to see it fail:** `go test ./pkg/orchestrate -run '^TestProgressCheckSkipsATaskWithNoTree$'`.
- [ ] **Step 3: Implement:** in `checkProgress`, return early when `run.Branch == ""`, with the comment "no lane tree
  (a project that is not a git repo): nothing to fingerprint, and git status there only fails".
- [ ] **Step 4: Run it and `-run '^TestProgress|^TestCheckProgress'` to see them pass.**
- [ ] **Step 5: Commit** `fix(orchestrate): no progress git status for a task with no lane tree`.
