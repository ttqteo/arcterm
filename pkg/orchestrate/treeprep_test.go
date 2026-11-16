// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// setupOnly runs fn for the plan's Setup command and nothing else the engine runs through the plan-command seam.
func setupOnly(fn func(ctx context.Context, dir string) error) func(context.Context, string, string) error {
	return func(ctx context.Context, dir, command string) error {
		if command != setupCmd {
			return nil
		}
		return fn(ctx, dir)
	}
}

func taskStateOf(t *testing.T, f *mergeFixture, taskID string) waveobj.TaskNode {
	t.Helper()
	return *taskByID(f.dag(t), taskID)
}

// a tick made a claimed task's tree and ran its Setup under the dag lock: 845 of 928 s of slow holds, up to 65 s each
func TestDispatchRunsSetupOutsideTheDagLock(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setPlanCommands(t, "", setupCmd)
	var spawned []string
	stubSpawn(t, &spawned)
	ran := false
	calls := stubPlanCommand(t, setupOnly(func(context.Context, string) error {
		var err error
		ran, err = TryWithDagMutation(f.dagID, func() error { return nil })
		return err
	}))

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if got := len(calls.list()); got != 1 {
		t.Fatalf("want Setup once, got %d calls", got)
	}
	if !ran {
		t.Fatal("the dag lock was held while Setup ran")
	}
	if len(spawned) != 1 {
		t.Fatalf("want one spawn, got %d", len(spawned))
	}
	if task := taskStateOf(t, f, "t-0"); task.State != TaskState_Running {
		t.Fatalf("want running, got %s", task.State)
	}
}

func TestATaskIsPreparingWhileItsSetupRuns(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setPlanCommands(t, "", setupCmd)
	stubSpawn(t, new([]string))
	var during string
	stubPlanCommand(t, setupOnly(func(ctx context.Context, _ string) error {
		g, err := wstore.GetDag(ctx, f.dagID)
		if err != nil {
			return err
		}
		during = g.Tasks[0].State
		return nil
	}))

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if during != TaskState_Preparing {
		t.Fatalf("while Setup ran the task read %q, want %q", during, TaskState_Preparing)
	}
}

// a worker exit or an rpc pokes Schedule while a task's tree is made: the second tick leaves the prepare alone
func TestAPreparingTaskIsPreparedOnce(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setPlanCommands(t, "", setupCmd)
	var spawned []string
	stubSpawn(t, &spawned)
	nested := false
	calls := stubPlanCommand(t, setupOnly(func(context.Context, string) error {
		if nested {
			return nil
		}
		nested = true
		return Schedule(f.ctx, f.dagID)
	}))

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if got := len(calls.list()); got != 1 {
		t.Fatalf("want Setup once, got %d", got)
	}
	if len(spawned) != 1 {
		t.Fatalf("want one worker, got %d", len(spawned))
	}
	if task := taskStateOf(t, f, "t-0"); task.State != TaskState_Running {
		t.Fatalf("want running, got %s", task.State)
	}
}

// EnsureRunWorktree rebuilds a tree whose status is not clean, so a spawn pass that checked the tree again would drop
// what Setup wrote and run Setup a second time
func TestASetupThatLeavesUntrackedFilesRunsOnce(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setPlanCommands(t, "", setupCmd)
	allowWorkerHarnessForTest(t)
	var cwds []string
	old := spawnWorker
	spawnWorker = func(_ context.Context, _ runroute.Capability, _, _, cwd, _ string, _ jarvis.RunWorkerOptions) (string, error) {
		cwds = append(cwds, cwd)
		return "tab:worker", nil
	}
	restoreAfterStages(t, func() { spawnWorker = old })
	calls := stubPlanCommand(t, setupOnly(func(_ context.Context, dir string) error {
		return os.WriteFile(filepath.Join(dir, "setup-output.txt"), []byte("built"), 0o644)
	}))

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if got := len(calls.list()); got != 1 {
		t.Fatalf("want Setup once, got %d", got)
	}
	if len(cwds) != 1 {
		t.Fatalf("want one spawn, got %d", len(cwds))
	}
	if _, err := os.Stat(filepath.Join(cwds[0], "setup-output.txt")); err != nil {
		t.Fatalf("what Setup wrote is gone from the worker's tree: %v", err)
	}
	if task := taskStateOf(t, f, "t-0"); task.State != TaskState_Running {
		t.Fatalf("want running, got %s", task.State)
	}
}

// the retry of a dispatch failure waits for the next Schedule call, though the tree is already made
func TestADispatchFailedAfterItsPrepareWaitsForTheNextTick(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setPlanCommands(t, "", setupCmd)
	allowWorkerHarnessForTest(t)
	spawns := stubFlakySpawn(t, 1)
	calls := stubPlanCommand(t, setupOnly(func(context.Context, string) error { return nil }))

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if task := taskStateOf(t, f, "t-0"); task.State != TaskState_Pending || task.Attempts != 1 || task.RunID != "" {
		t.Fatalf("want pending after one attempt, got %s (attempts %d, run %q)", task.State, task.Attempts, task.RunID)
	}
	if got := len(calls.list()); got != 1 || *spawns != 1 {
		t.Fatalf("want one Setup and one spawn so far, got %d and %d", got, *spawns)
	}
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if task := taskStateOf(t, f, "t-0"); task.State != TaskState_Running {
		t.Fatalf("want running after the second call, got %s", task.State)
	}
}

// Cancel takes the dag lock, which a prepare no longer holds; the tree a cancel's removal found is gone, and one it
// found before the tree existed is the prepare's to remove
func TestCancelDuringSetupSpawnsNothing(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setPlanCommands(t, "", setupCmd)
	var spawned []string
	stubSpawn(t, &spawned)
	stubStopRunWorkers(t)
	var cancelErr error
	stubPlanCommand(t, setupOnly(func(context.Context, string) error {
		done := make(chan error, 1)
		go func() { done <- Cancel(f.ctx, f.dagID) }()
		select {
		case cancelErr = <-done:
		case <-time.After(10 * time.Second):
			t.Error("the cancel waited for Setup: the dag lock is held")
		}
		return nil
	}))

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if cancelErr != nil {
		t.Fatal(cancelErr)
	}
	if len(spawned) != 0 {
		t.Fatalf("a worker spawned for a cancelled dag: %d", len(spawned))
	}
	if task := taskStateOf(t, f, "t-0"); task.State != TaskState_Cancelled {
		t.Fatalf("want cancelled, got %s", task.State)
	}
	if n := treePrepCount(f.dagID); n != 0 {
		t.Fatalf("the registry holds %d prepares of a cancelled dag", n)
	}
	if _, err := os.Stat(worktreeDir(f.project, TaskWorktreeKey(f.ownerID, "t-0"))); !os.IsNotExist(err) {
		t.Fatalf("the prepared tree of a cancelled dag stays; stat err = %v", err)
	}
}

// a cancel whose removal ran before the tree existed leaves it to the prepare: it removes the tree it just made
func TestAPrepareThatFinishesAfterACancelRemovesItsTree(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setPlanCommands(t, "", setupCmd)
	stubSpawn(t, new([]string))
	stubStopRunWorkers(t)
	stubPlanCommand(t, setupOnly(func(ctx context.Context, _ string) error {
		// the dag is cancelled with no removal at all: only the state is written
		return wstore.UpdateDag(ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
			CancelGroup(cur)
			return nil
		})
	}))

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(worktreeDir(f.project, TaskWorktreeKey(f.ownerID, "t-0"))); !os.IsNotExist(err) {
		t.Fatalf("the tree prepared for a cancelled dag stays; stat err = %v", err)
	}
	if n := treePrepCount(f.dagID); n != 0 {
		t.Fatalf("the registry holds %d prepares of a cancelled dag", n)
	}
}

func TestSkipDuringSetupSpawnsNothing(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setPlanCommands(t, "", setupCmd)
	var spawned []string
	stubSpawn(t, &spawned)
	var skipErr error
	skipped := false
	stubPlanCommand(t, setupOnly(func(context.Context, string) error {
		// once: with its only task skipped the dag reaches its final stage, whose own Setup runs this stub again
		if skipped {
			return nil
		}
		skipped = true
		skipErr = ApplyAction(f.ctx, f.dagID, "t-0", "skip", waveobj.RoutePin{})
		return nil
	}))

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if skipErr != nil {
		t.Fatal(skipErr)
	}
	if len(spawned) != 0 {
		t.Fatalf("a worker spawned for a skipped task: %d", len(spawned))
	}
	if task := taskStateOf(t, f, "t-0"); task.State != TaskState_Skipped {
		t.Fatalf("want skipped, got %s", task.State)
	}
	if n := treePrepCount(f.dagID); n != 0 {
		t.Fatalf("the registry holds %d prepares of a skipped task", n)
	}
}

// the pause cuts Setup off: the task goes back to pending as if it had not been claimed, and nothing is counted
func TestPauseDuringSetupSendsTheTaskBackUntried(t *testing.T) {
	lead := newFakeLead(t)
	timedEventsReachTheFakeLead(t)
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setPlanCommands(t, "", setupCmd)
	var spawned []string
	stubSpawn(t, &spawned)
	stubSuspend(t, nil)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	t.Cleanup(func() { once.Do(func() { close(release) }) })
	stubPlanCommand(t, setupOnly(func(ctx context.Context, _ string) error {
		close(entered)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-release:
			return nil
		}
	}))
	ticked := make(chan error, 1)
	go func() { ticked <- Schedule(f.ctx, f.dagID) }()
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("Setup never started")
	}
	paused := make(chan error, 1)
	go func() {
		_, err := PauseDag(f.ctx, f.dagID, f.ownerID)
		paused <- err
	}()
	select {
	case err := <-paused:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the pause waited for Setup instead of cutting it off")
	}
	if err := <-ticked; err != nil {
		t.Fatal(err)
	}

	g := f.dag(t)
	if g.PausedTs == 0 {
		t.Fatal("the dag is not paused")
	}
	if task := g.Tasks[0]; task.State != TaskState_Pending || task.Attempts != 0 || task.RunID != "" {
		t.Fatalf("a Setup the pause cut off left the task %q (attempts %d, run %q), want pending and untried", task.State, task.Attempts, task.RunID)
	}
	if len(spawned) != 0 {
		t.Fatalf("a worker was spawned after its Setup was cut off: %d", len(spawned))
	}
	if n := treePrepCount(f.dagID); n != 0 {
		t.Fatalf("the registry holds %d prepares of a paused dag's untried task", n)
	}
	if n := lead.countKind(waveobj.RunEventKindTaskFailed); n != 0 {
		t.Fatalf("a pause cut Setup off and the task was reported failed (%d task-failed events)", n)
	}
}

// the wait for a heavy-job slot ran out: the task and every one claimed with it go back untried, and the tick does not
// queue the same Setup again
func TestASetupSlotWaitOverSendsTheTaskBackUntried(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setPlanCommands(t, "", setupCmd)
	var spawned []string
	stubSpawn(t, &spawned)
	calls := stubPlanCommand(t, setupOnly(func(context.Context, string) error { return errSlotWaitOver }))

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if got := len(calls.list()); got != 1 {
		t.Fatalf("Setup ran %d times in the call, want once", got)
	}
	if task := taskStateOf(t, f, "t-0"); task.State != TaskState_Pending || task.Attempts != 0 || task.RunID != "" {
		t.Fatalf("want pending and untried, got %s (attempts %d, run %q)", task.State, task.Attempts, task.RunID)
	}
	if len(spawned) != 0 {
		t.Fatalf("a worker spawned with its Setup never run: %d", len(spawned))
	}
	if n := treePrepCount(f.dagID); n != 0 {
		t.Fatalf("the registry holds %d prepares of an untried task", n)
	}
}

// wavesrv restarted while a tree was made: the stored state says preparing and nothing is preparing it
func TestAPreparingTaskLostToARestartIsPreparedAgain(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setPlanCommands(t, "", setupCmd)
	var spawned []string
	stubSpawn(t, &spawned)
	calls := stubPlanCommand(t, setupOnly(func(context.Context, string) error { return nil }))
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.Tasks[0].State = TaskState_Preparing
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if got := len(calls.list()); got != 1 {
		t.Fatalf("want Setup once, got %d", got)
	}
	if len(spawned) != 1 {
		t.Fatalf("want one worker, got %d", len(spawned))
	}
	if task := taskStateOf(t, f, "t-0"); task.State != TaskState_Running {
		t.Fatalf("want running, got %s", task.State)
	}
}

// the spawn pass reports what the prepare measured: the tree and Setup took their time off the lock, and the spawn pass
// has none of it to measure
func TestSpawnedEventCarriesThePrepareTimings(t *testing.T) {
	lead := newFakeLead(t)
	timedEventsReachTheFakeLead(t)
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setPlanCommands(t, "", setupCmd)
	stubSpawn(t, new([]string))
	stubPlanCommand(t, setupOnly(func(context.Context, string) error {
		time.Sleep(50 * time.Millisecond)
		return nil
	}))

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	var spawnedRow map[string]any
	for _, row := range lead.rows {
		if row["eventkind"] == waveobj.RunEventKindTaskSpawned {
			spawnedRow = row
		}
	}
	if spawnedRow == nil {
		t.Fatalf("no task-spawned event, got %+v", lead.rows)
	}
	if ms, _ := spawnedRow["setupms"].(int64); ms < 50 {
		t.Fatalf("setupms = %v, want at least the 50 ms Setup took", spawnedRow["setupms"])
	}
	if _, ok := spawnedRow["worktreems"].(int64); !ok {
		t.Fatalf("worktreems = %v, want the checkout's time", spawnedRow["worktreems"])
	}
}

// the removal that reached a prepared tree between the passes: the spawn pass makes it again, under the dag lock, as
// every tree was made before prepares moved off it
func TestAPreparedTreeThatVanishedIsMadeAgainInTheSpawnPass(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setPlanCommands(t, "", setupCmd)
	var spawned []string
	stubSpawn(t, &spawned)
	var calls int
	var lockFreeAtSecond []bool
	stubPlanCommand(t, setupOnly(func(ctx context.Context, dir string) error {
		calls++
		if calls == 1 {
			return removeWorktreeDir(ctx, f.project, dir)
		}
		ran, err := TryWithDagMutation(f.dagID, func() error { return nil })
		lockFreeAtSecond = append(lockFreeAtSecond, ran)
		return err
	}))

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatalf("want Setup twice (the prepare, then the spawn pass's fallback), got %d", calls)
	}
	if len(lockFreeAtSecond) != 1 || lockFreeAtSecond[0] {
		t.Fatalf("the fallback runs under the dag lock, but the lock was free during it: %v", lockFreeAtSecond)
	}
	if len(spawned) != 1 {
		t.Fatalf("want one worker, got %d", len(spawned))
	}
	if task := taskStateOf(t, f, "t-0"); task.State != TaskState_Running {
		t.Fatalf("want running, got %s", task.State)
	}
}
