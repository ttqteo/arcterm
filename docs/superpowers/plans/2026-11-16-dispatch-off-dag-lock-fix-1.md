# Dispatch off the dag lock, round 1 fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Effort:** effort:39803de1-7419-4f4d-8a18-a0c32e3a8199
**Verify:** `node scripts/verify.mjs ./pkg/orchestrate ./pkg/wshrpc/wshserver ./cmd/wsh/cmd`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs dag-preparing`

**Goal:** Close two gaps the prepare-off-the-lock work (`pkg/orchestrate/treeprep.go`) left, both reported under
Task 3's "Found not fixed": a skip of a retried task that is `preparing` can rewind its lane while the prepare is still
checking the tree out or running Setup in it, and a cancelled dag's `preparing` registry entries stay in memory until a
pass that may never come.

**Architecture:** Before the dag lock moved off dispatch, a skip queued on the lock until the dispatch's checkout and
Setup were done, so its rewind never met a half-made tree. Now a skip (`applyAction`, `mutation.go:261`) decides under
the lock, runs its rewind (`dropSkippedAttempt`, `rewind.go:59`) with no lock, and records under the lock again, while
the prepare runs with no lock too. The prepare cannot hold `treeRemovals` through Setup (a Setup stub that calls
`Cancel` would deadlock: `TestCancelDuringSetupSpawnsNothing`). Two things must hold for a skip of a `preparing` task:

1. its rewind waits for the prepare in flight to return, and
2. no locked pass settles, spawns or re-claims that task between the skip's first locked half and its second. Without
   this, a tick that runs once the prepare returns spawns a worker into the tree the rewind is about to remove, and
   `checkUnmoved` then refuses the skip after the rewind already ran.

So the skip's first locked half marks the task as being skipped (in memory, keyed by dag and task, cleared when
`applyAction` returns), `settlePreparing` leaves a marked task alone as it does a prepare not yet done, and the rewind
waits for the prepare's in-flight signal, which outlives its registry entry, before it takes `treeRemovals`. A lead's
skip detaches from its caller (`ActForCaller`), so a wait of a Setup's length is what a skip under the old lock cost
too. An equivalent mechanism is fine if the tests below hold.

**Tech Stack:** Go (`pkg/orchestrate`).

---

### Task 1: A skip of a preparing task waits for its prepare; a cancel drops the dag's prepares

**Files:** `pkg/orchestrate/treeprep.go`, `pkg/orchestrate/rewind.go`, `pkg/orchestrate/mutation.go`, `pkg/orchestrate/treeprep_test.go`

- [ ] **Step 1: Write the failing tests** in `treeprep_test.go`, beside `TestSkipDuringSetupSpawnsNothing`:
  - `TestASkipOfARetriedTaskWaitsForItsPrepare`: a task with an earlier attempt (so `taskStartBase` is non-empty and
    its lane head is past it: commit on the lane branch, as the package's existing rewind tests do) is claimed and its
    Setup stub blocks on a channel. From another goroutine, skip it (`ApplyAction(..., "skip", ...)`). While Setup is
    blocked, assert the skip has not returned and the lane branch has not moved. Release Setup, then drive a
    `Schedule` pass before the skip records: hold the skip after its rewind with a test seam (a package var hook) and
    call `Schedule` while it is held. Then let the skip finish and assert: it returns nil, the task is `skipped`, no
    worker spawned, the branch is back at the task's first start, the recovery patch exists, and the registry holds
    no entry for the task.
  - `TestCancelDropsTheDagsPrepares`: claim a task, block its Setup, `Cancel` the dag from another goroutine, and
    assert `treePrepCount(dagID) == 0` once `Cancel` returns, with no further `Schedule` call. Release Setup after
    and assert the prepared tree is removed.
  Run both with `go test ./pkg/orchestrate -run 'TestASkipOfARetriedTaskWaitsForItsPrepare|TestCancelDropsTheDagsPrepares' -count=1`
  (Windows: `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"`) and see them fail.

- [ ] **Step 2: Mark each prepare in flight** in `treeprep.go`: a second map beside `treePreps.byKey` (under the same
  mutex), keyed by `treePrepKey`, holding a channel that `prepareTaskTree` creates when it starts and closes when it
  returns (a `defer`, so an early return or panic still closes it). It is not part of the registry entry, because a
  skip's or cancel's pass drops the entry while the prepare still runs. Add
  `waitTreePrep(ctx, dagID, taskID string, limit time.Duration) error`. It returns at once when no prepare of that task
  is in flight. Otherwise it waits for the channel, `ctx` or `limit`, and on a timeout returns an error that names the
  task. The call site passes `worktreePrepTimeout + SetupTimeout`, which already bound the prepare.

- [ ] **Step 3: Hold a skipped preparing task still** in `treeprep.go` and `mutation.go`:
  - The skip's first locked half (`prepareActionLocked`, `case "skip"`) marks a `preparing` task as being skipped, and
    `applyAction` clears the mark when it returns (a `defer`, set only once the first half succeeded).
  - `settlePreparing` skips a marked task as it does `!p.done`, and so does the claim (it is `preparing`, so it is not
    claimable anyway; check that `held` or the scheduler's ready list cannot pick it).
  - The registry entry of a skipped task is dropped by the next pass, as now (its state is no longer `preparing`).

- [ ] **Step 4: Wait in the skip's rewind** in `rewind.go` `dropSkippedAttempt`: after the early returns that find
  nothing to rewind (`base == ""`, `head == base`), and before `treeRemovals.Lock`, call `waitTreePrep`. On its error,
  return it, so the skip reports that the rewind did not run and can be repeated. Then read the lane head again
  (`WorktreeHeadCommit`), since the prepare may have checked the lane out at another commit. Keep the wait after those
  early returns: `TestSkipDuringSetupSpawnsNothing` skips from inside the Setup stub with no earlier attempt, and a
  wait there would wait on itself. Update the function's doc comment to say it waits for a prepare in flight, and why.

- [ ] **Step 5: Drop the prepares in the cancel** in `mutation.go`: once `cancelLocked`'s transaction has committed a
  cancel (`gCopy != nil`), call `dropTreePreps(dagID, nil)`. A prepare still running then finds its entry gone
  (`finishTreePrep` returns false) and removes its tree, as `prepareTaskTree` already does for a cancelled dag. Update
  the comments in `treeprep.go` that say a cancel's pass drops the entries.

- [ ] **Step 6: Run the tests**: the two new tests, then the treeprep, skip and cancel tests with
  `go test ./pkg/orchestrate -run 'Prepar|Skip|Cancel|Setup' -count=1`. All pass.

- [ ] **Step 7: Commit** `pkg/orchestrate/treeprep.go pkg/orchestrate/rewind.go pkg/orchestrate/mutation.go
  pkg/orchestrate/treeprep_test.go` with a pathspec, ending the message with the run's `Arc-Run:` trailer.
