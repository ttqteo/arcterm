// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func newCleanupGroup(t *testing.T, ch *waveobj.Channel) *waveobj.TaskGroup {
	t.Helper()
	g, err := NewTaskGroup("run-1", ch.OID, "cleanup group", 2, false, []waveobj.TaskNode{
		// independent tasks: each is a lane of its own, so each cleanup keys its own tree
		{ID: "t-0", Label: "zero"},
		{ID: "t-1", Label: "one"},
		{ID: "t-2", Label: "two"},
		{ID: "t-3", Label: "three"},
		{ID: "t-4", Label: "four"},
	}, time.Now().UnixMilli(), nil)
	if err != nil {
		t.Fatal(err)
	}
	return &g
}

func stubCleanupRemover(t *testing.T, fn func(context.Context, string, string) error) {
	t.Helper()
	old := RemoveTaskWorktree
	RemoveTaskWorktree = fn
	restoreAfterStages(t, func() { RemoveTaskWorktree = old })
}

func TestCleanupTaskWorktreeIdempotent(t *testing.T) {
	projectDir := newGitRepo(t)
	ch, err := wstore.CreateChannel(context.Background(), "cleanup-idem", projectDir)
	if err != nil {
		t.Fatal(err)
	}
	g := newCleanupGroup(t, ch)
	g.Tasks[0].State = TaskState_Done
	g.Tasks[0].Merged = true
	g.Tasks[0].CleanupPending = true

	// no worktree exists: the real remover must treat repeated cleanup as success.
	if err := CleanupTaskWorktree(context.Background(), g, "t-0"); err != nil {
		t.Fatalf("first cleanup: %v", err)
	}
	if err := CleanupTaskWorktree(context.Background(), g, "t-0"); err != nil {
		t.Fatalf("second cleanup: %v", err)
	}
	if g.Tasks[0].CleanupPending {
		t.Fatal("cleanup pending must be cleared")
	}
	if g.Tasks[0].CleanupError != "" {
		t.Fatalf("cleanup error must be cleared, got %q", g.Tasks[0].CleanupError)
	}
}

func TestCleanupTaskWorktreeAllowsUnmergedOnlyAfterCancellation(t *testing.T) {
	ch, err := wstore.CreateChannel(context.Background(), "cleanup-cancelled", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	g := newCleanupGroup(t, ch)
	g.Tasks[0].CleanupPending = true
	calls := 0
	stubCleanupRemover(t, func(context.Context, string, string) error {
		calls++
		return nil
	})

	// an unmerged task's tree is its lane's: only directories its removals left behind go
	if err := CleanupTaskWorktree(context.Background(), g, "t-0"); err != nil || calls != 0 {
		t.Fatalf("active unmerged task's cleanup removed its tree %d times, err %v", calls, err)
	}
	g.Status = DagStatus_Cancelled
	if err := CleanupTaskWorktree(context.Background(), g, "t-0"); err != nil {
		t.Fatalf("cancelled task cleanup: %v", err)
	}
	if calls != 1 {
		t.Fatalf("removal calls = %d, want 1", calls)
	}
}

func TestCleanupTaskWorktreeBoundedError(t *testing.T) {
	ch, err := wstore.CreateChannel(context.Background(), "cleanup-bounded", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	g := newCleanupGroup(t, ch)
	g.Tasks[0].State = TaskState_Done
	g.Tasks[0].Merged = true
	g.Tasks[0].CleanupPending = true
	longErr := "windows dir lock: " + strings.Repeat("x", 300)
	stubCleanupRemover(t, func(context.Context, string, string) error {
		return errors.New(longErr)
	})

	if err := CleanupTaskWorktree(context.Background(), g, "t-0"); err == nil {
		t.Fatal("cleanup must surface the removal error")
	}
	if len(g.Tasks[0].CleanupError) > MaxCleanupErrorLen {
		t.Fatalf("cleanup error must be bounded, got %d chars", len(g.Tasks[0].CleanupError))
	}
	if g.Tasks[0].CleanupError == "" {
		t.Fatal("cleanup error must be recorded on the task")
	}
	if g.Tasks[0].State != TaskState_Done {
		t.Fatalf("failure must not disturb task state, got %s", g.Tasks[0].State)
	}
	if !g.Tasks[0].Merged {
		t.Fatal("failure must not disturb merge identity")
	}
	if g.Tasks[0].CleanupPending {
		t.Fatal("cleanup pending must be cleared after an attempted cleanup")
	}
}

func TestCleanupTaskWorktreeCountsAttempts(t *testing.T) {
	ch, err := wstore.CreateChannel(context.Background(), "cleanup-attempts", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	g := newCleanupGroup(t, ch)
	g.Tasks[0].State = TaskState_Done
	g.Tasks[0].Merged = true
	fail := true
	stubCleanupRemover(t, func(context.Context, string, string) error {
		if fail {
			return errors.New("being used by another process")
		}
		return nil
	})

	for want := 1; want <= 3; want++ {
		if err := CleanupTaskWorktree(context.Background(), g, "t-0"); err == nil {
			t.Fatal("stubbed removal must fail")
		}
		if g.Tasks[0].CleanupAttempts != want {
			t.Fatalf("attempts = %d, want %d", g.Tasks[0].CleanupAttempts, want)
		}
	}
	fail = false
	if err := CleanupTaskWorktree(context.Background(), g, "t-0"); err != nil {
		t.Fatalf("cleanup after the blocker clears: %v", err)
	}
	if g.Tasks[0].CleanupAttempts != 0 || g.Tasks[0].CleanupError != "" {
		t.Fatalf("success must reset attempts and error, got %d %q", g.Tasks[0].CleanupAttempts, g.Tasks[0].CleanupError)
	}
}

// storedCleanupGroup persists newCleanupGroup after edit, for the retries that read the dag from the store.
func storedCleanupGroup(t *testing.T, name string, edit func(g *waveobj.TaskGroup)) (context.Context, *waveobj.TaskGroup) {
	t.Helper()
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, name, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	g := newCleanupGroup(t, ch)
	edit(g)
	if err := wstore.AppendDag(ctx, g); err != nil {
		t.Fatal(err)
	}
	stubStopRunWorkers(t)
	return ctx, g
}

func TestRetryCleanupDebtSkipsTasksOverTheCap(t *testing.T) {
	ctx, g := storedCleanupGroup(t, "cleanup-cap", func(g *waveobj.TaskGroup) {
		g.Tasks[1].Merged = true
		g.Tasks[1].CleanupError = "locked"
		g.Tasks[1].CleanupAttempts = MaxCleanupAttempts
		g.Tasks[4].Merged = true
		g.Tasks[4].CleanupError = "locked"
		g.Tasks[4].CleanupAttempts = 1
	})
	var keys []string
	stubCleanupRemover(t, func(_ context.Context, _, key string) error {
		keys = append(keys, key)
		return nil
	})

	RetryCleanupDebt(ctx, g.OID)
	if len(keys) != 1 || keys[0] != TaskWorktreeKey(g.RunID, "t-4") {
		t.Fatalf("only the task under the cap may be retried, got %v", keys)
	}
}

func TestRetryCleanupDebtMixedDebt(t *testing.T) {
	ctx, g := storedCleanupGroup(t, "cleanup-retry", func(g *waveobj.TaskGroup) {
		g.Tasks[1].Merged = true
		g.Tasks[1].CleanupError = "locked"
		g.Tasks[4].Merged = true
		g.Tasks[4].CleanupPending = true
	})
	calls := 0
	stubCleanupRemover(t, func(_ context.Context, _, key string) error {
		calls++
		if key == TaskWorktreeKey(g.RunID, "t-1") {
			return errors.New("still locked")
		}
		return nil
	})

	RetryCleanupDebt(ctx, g.OID)
	if calls != 2 {
		t.Fatalf("both debt tasks must be attempted, got %d calls", calls)
	}
	stored, err := wstore.GetDag(ctx, g.OID)
	if err != nil {
		t.Fatal(err)
	}
	if e := stored.Tasks[1].CleanupError; !strings.Contains(e, "still locked") || len(e) > MaxCleanupErrorLen {
		t.Fatalf("still-failing debt must keep a bounded error, got %q", e)
	}
	if stored.Tasks[4].CleanupPending || stored.Tasks[4].CleanupError != "" {
		t.Fatalf("later cleared debt must clear the task, got pending=%v err=%q", stored.Tasks[4].CleanupPending, stored.Tasks[4].CleanupError)
	}

	// retry again once the blocker clears: the full debt set clears.
	stubCleanupRemover(t, func(context.Context, string, string) error { return nil })
	RetryCleanupDebt(ctx, g.OID)
	if stored, err = wstore.GetDag(ctx, g.OID); err != nil {
		t.Fatal(err)
	}
	if HasCleanupDebt(stored) {
		t.Fatal("all debt must be cleared after the successful retry")
	}
}

func TestPersistTaskCleanupRecomputesDag(t *testing.T) {
	ctx, g := storedCleanupGroup(t, "cleanup-persist", func(g *waveobj.TaskGroup) {
		g.MergeRequired = true
		g.Tasks[0].State = TaskState_Done
		g.Tasks[0].Merged = true
		g.Tasks[0].CleanupPending = true
		for i := 1; i < len(g.Tasks); i++ {
			g.Tasks[i].State = TaskState_Skipped
		}
	})
	persist := func(task waveobj.TaskNode) *waveobj.TaskGroup {
		t.Helper()
		if err := withDagMutation(g.OID, func() error { return persistTaskCleanupLocked(ctx, g.OID, &task) }); err != nil {
			t.Fatal(err)
		}
		stored, err := wstore.GetDag(ctx, g.OID)
		if err != nil {
			t.Fatal(err)
		}
		return stored
	}

	stored := persist(waveobj.TaskNode{ID: "t-0", CleanupError: "locked", CleanupAttempts: 1})
	if stored.Tasks[0].CleanupPending || stored.Tasks[0].CleanupError != "locked" || stored.Tasks[0].CleanupAttempts != 1 {
		t.Fatalf("persisted cleanup state = pending %v error %q attempts %d", stored.Tasks[0].CleanupPending, stored.Tasks[0].CleanupError, stored.Tasks[0].CleanupAttempts)
	}
	if stored.Status == DagStatus_Done {
		t.Fatal("failed cleanup debt must keep the DAG non-terminal")
	}
	if stored.Tasks[0].State != TaskState_Done || !stored.Tasks[0].Merged {
		t.Fatal("only the cleanup fields may be written")
	}

	if stored = persist(waveobj.TaskNode{ID: "t-0"}); stored.Status != DagStatus_Finalizing {
		t.Fatalf("cleared cleanup debt must hand the DAG to the final stage, got %s", stored.Status)
	}
}

// seedCleanupDebtOn is a dag of independent tasks, each a lane of its own, whose named tasks are merged and owed a
// removal under the retry cap.
func seedCleanupDebtOn(t *testing.T, ids ...string) (context.Context, *waveobj.TaskGroup) {
	t.Helper()
	return storedCleanupGroup(t, "cleanup-debt", func(g *waveobj.TaskGroup) {
		for _, id := range ids {
			task := taskByID(g, id)
			task.State, task.Merged = TaskState_Done, true
			task.CleanupPending, task.CleanupError, task.CleanupAttempts = true, "", 0
		}
	})
}

// the tick's debt retry must neither remove a tree a merge is removing nor wait for it
func TestTheTickSkipsATreeAnotherCallerIsRemoving(t *testing.T) {
	// under the retry cap: seedCleanupDebt sets MaxCleanupAttempts, which the retry skips before any tree lock
	ctx, dag := seedCleanupDebtOn(t, "t-0")
	var calls atomic.Int32
	entered, release := make(chan struct{}), make(chan struct{})
	stubCleanupRemover(t, func(context.Context, string, string) error {
		if calls.Add(1) == 1 {
			close(entered)
			<-release
		}
		return nil
	})
	first := make(chan error, 1)
	go func() { first <- removeTaskTree(ctx, dag.OID, "t-0", true) }()
	<-entered
	tick := make(chan struct{})
	go func() { RetryCleanupDebt(ctx, dag.OID); close(tick) }()
	select {
	case <-tick:
	case <-time.After(2 * time.Second):
		t.Fatal("the tick waited on a tree another caller is removing")
	}
	close(release)
	if err := <-first; err != nil {
		t.Fatal(err)
	}
	if n := calls.Load(); n != 1 {
		t.Fatalf("remover called %d times, want 1", n)
	}
}

// each removal records only its own task: a stale snapshot must not revert another tree's recorded result
func TestRemovingOneTreeKeepsAnotherTreesRecordedResult(t *testing.T) {
	ctx, dag := seedCleanupDebtOn(t, "t-0", "t-1") // both merged with CleanupPending, separate lanes
	entered, release := make(chan struct{}), make(chan struct{})
	stubCleanupRemover(t, func(_ context.Context, _, key string) error {
		if strings.HasSuffix(key, "-t-0") {
			close(entered)
			<-release
		}
		return nil
	})
	slow := make(chan error, 1)
	go func() { slow <- removeTaskTree(ctx, dag.OID, "t-0", true) }()
	<-entered
	if err := removeTaskTree(ctx, dag.OID, "t-1", true); err != nil {
		t.Fatal(err)
	}
	close(release)
	if err := <-slow; err != nil {
		t.Fatal(err)
	}
	g, err := wstore.GetDag(ctx, dag.OID)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"t-0", "t-1"} {
		if task := taskByID(g, id); task.CleanupPending || task.CleanupError != "" {
			t.Fatalf("%s: pending %v error %q, want cleared", id, task.CleanupPending, task.CleanupError)
		}
	}
}

// a cancelled dag's trees are Cancel's: it dumps each one's work outside the lock before removing it, so a tick
// that removed one first would lose that work
func TestScheduleLeavesACancelledDagsTreesToCancel(t *testing.T) {
	ctx, dag := seedCleanupDebtOn(t, "t-0")
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Status = DagStatus_Cancelled
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	stubCleanupRemover(t, func(context.Context, string, string) error {
		calls.Add(1)
		return nil
	})
	if err := Schedule(ctx, dag.OID); err != nil {
		t.Fatal(err)
	}
	if n := calls.Load(); n != 0 {
		t.Fatalf("the tick removed %d tree(s) of a cancelled dag", n)
	}
	if task := firstTask(t, ctx, dag.OID); !task.CleanupPending || task.CleanupError != "" || task.CleanupAttempts != 0 {
		t.Fatalf("debt changed: pending %v error %q attempts %d", task.CleanupPending, task.CleanupError, task.CleanupAttempts)
	}
}

// a repo that cannot be resolved is a failed attempt like any other, so it reaches the retry cap
func TestRemoveTaskTreeRecordsAProjectPathFailure(t *testing.T) {
	ctx := context.Background()
	g, err := NewTaskGroup("missing-owner", "missing-channel", "g", 1, true, []waveobj.TaskNode{{ID: "t-0", Label: "a"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	g.Tasks[0].State, g.Tasks[0].Merged, g.Tasks[0].CleanupPending = TaskState_Done, true, true
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	stubCleanupRemover(t, func(context.Context, string, string) error {
		t.Fatal("no removal without a repo")
		return nil
	})
	if err := removeTaskTree(ctx, g.OID, "t-0", true); err == nil {
		t.Fatal("want the project path error")
	}
	task := firstTask(t, ctx, g.OID)
	if task.CleanupPending || task.CleanupError == "" || task.CleanupAttempts != 1 {
		t.Fatalf("want one failed attempt recorded, got pending %v error %q attempts %d", task.CleanupPending, task.CleanupError, task.CleanupAttempts)
	}
}

func TestPendingCleanupTasksOrder(t *testing.T) {
	ch, err := wstore.CreateChannel(context.Background(), "cleanup-order", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	g := newCleanupGroup(t, ch)
	g.Tasks[1].Merged = true
	g.Tasks[1].CleanupPending = true
	g.Tasks[4].Merged = true
	g.Tasks[4].CleanupError = "locked"

	got := PendingCleanupTasks(g)
	if len(got) != 2 {
		t.Fatalf("want 2 debt tasks, got %d: %v", len(got), got)
	}
	if got[0].ID != "t-1" || got[1].ID != "t-4" {
		t.Fatalf("debt tasks must come back in DAG order, got %s, %s", got[0].ID, got[1].ID)
	}
	if !HasCleanupDebt(g) {
		t.Fatal("group with cleanup debt must report HasCleanupDebt")
	}
	g.Tasks[1].CleanupPending = false
	g.Tasks[4].CleanupError = ""
	if HasCleanupDebt(g) {
		t.Fatal("group without cleanup debt must not report HasCleanupDebt")
	}
	g.Tasks[0].CleanupError = "orphaned debt"
	if !HasCleanupDebt(g) {
		t.Fatal("persisted cleanup flags must report debt even before merge identity is present")
	}
	// its cleanup reaches only what its tree's removals left behind (TestCleanupTaskWorktreeAllowsUnmergedOnlyAfterCancellation)
	if got := PendingCleanupTasks(g); len(got) != 1 || got[0].ID != "t-0" {
		t.Fatalf("active unmerged debt is retried, got %v", got)
	}
	g.Status = DagStatus_Cancelled
	if got := PendingCleanupTasks(g); len(got) != 1 || got[0].ID != "t-0" {
		t.Fatalf("cancelled unmerged debt must be retryable, got %v", got)
	}
}

// A worker harness sits at its prompt after reporting done instead of exiting, and its live cwd is what
// keeps the tree busy. Every task in a lane ran in the one shared tree, so the whole lane is reaped, and
// it happens before the removal, not after.
func TestCleanupTaskWorktreeReapsTheLanesWorkersFirst(t *testing.T) {
	ctx := context.Background()
	projectDir := newGitRepo(t)
	ch, err := wstore.CreateChannel(ctx, "cleanup-reap", projectDir)
	if err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup("run-1", ch.OID, "reap group", 2, false, []waveobj.TaskNode{
		{ID: "t-1", Label: "one"},
		{ID: "t-2", Label: "two", Deps: []string{"t-1"}}, // same lane, same worktree, own worker
		{ID: "t-3", Label: "three"},                      // a lane of its own: must not be reaped
	}, time.Now().UnixMilli(), nil)
	if err != nil {
		t.Fatal(err)
	}
	for i := range g.Tasks {
		runID := "child-" + g.Tasks[i].ID
		g.Tasks[i].RunID = runID
		g.Tasks[i].State = TaskState_Done
		g.Tasks[i].Merged = true
		if err := wstore.AppendRun(ctx, ch.OID, waveobj.Run{
			ID:     runID,
			Phases: []waveobj.RunPhase{{WorkerOrefs: []string{"tab:" + runID}}},
		}); err != nil {
			t.Fatal(err)
		}
	}
	g.Tasks[1].CleanupPending = true

	var order []string
	oldStop := stopRunWorkers
	stopRunWorkers = func(_ context.Context, run *waveobj.Run) error {
		order = append(order, "stop:"+run.ID)
		return nil
	}
	restoreAfterStages(t, func() { stopRunWorkers = oldStop })
	stubCleanupRemover(t, func(context.Context, string, string) error {
		order = append(order, "remove")
		return nil
	})

	if err := CleanupTaskWorktree(ctx, &g, "t-2"); err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	want := []string{"stop:child-t-1", "stop:child-t-2", "remove"}
	if !slices.Equal(order, want) {
		t.Fatalf("cleanup of lane tip t-2 did %v, want %v", order, want)
	}
}

// A reviewer runs in the lane tree and stays at its prompt after its verdict, holding the tree as its cwd; the
// run's ReviewRunID is cleared by then, so only the tree path finds it (run 28caa81f lost five trees this way).
func TestCleanupTaskWorktreeReapsEveryRunInTheTree(t *testing.T) {
	ctx := context.Background()
	projectDir := newGitRepo(t)
	ch, err := wstore.CreateChannel(ctx, "cleanup-reap-tree", projectDir)
	if err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup("run-1", ch.OID, "reap tree group", 2, false, []waveobj.TaskNode{
		{ID: "t-1", Label: "one"},
		{ID: "t-2", Label: "two"},
	}, time.Now().UnixMilli(), nil)
	if err != nil {
		t.Fatal(err)
	}
	g.Tasks[0].RunID, g.Tasks[0].State, g.Tasks[0].Merged = "worker-t-1", TaskState_Done, true
	g.Tasks[0].CleanupPending = true
	tree := worktreeDir(projectDir, LaneWorktreeKey(&g, "t-1"))
	otherTree := worktreeDir(projectDir, LaneWorktreeKey(&g, "t-2"))
	for _, r := range []waveobj.Run{
		{ID: "worker-t-1", DagORef: g.OID, ProjectPath: tree},
		{ID: "reviewer-t-1", DagORef: g.OID, ProjectPath: tree},
		{ID: "reviewer-t-2", DagORef: g.OID, ProjectPath: otherTree},
		{ID: "other-dag", DagORef: "some-other-dag", ProjectPath: tree},
	} {
		r.Phases = []waveobj.RunPhase{{WorkerOrefs: []string{"tab:" + r.ID}}}
		if err := wstore.AppendRun(ctx, ch.OID, r); err != nil {
			t.Fatal(err)
		}
	}

	var stopped []string
	oldStop := stopRunWorkers
	stopRunWorkers = func(_ context.Context, run *waveobj.Run) error {
		stopped = append(stopped, run.ID)
		return nil
	}
	restoreAfterStages(t, func() { stopRunWorkers = oldStop })
	stubCleanupRemover(t, func(context.Context, string, string) error { return nil })

	if err := CleanupTaskWorktree(ctx, &g, "t-1"); err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	slices.Sort(stopped)
	if want := []string{"reviewer-t-1", "worker-t-1"}; !slices.Equal(stopped, want) {
		t.Fatalf("cleanup of t-1 stopped %v, want %v (never another tree's reviewer or another dag's run)", stopped, want)
	}
}

// seedCleanupDebt is a one-task dag whose merged task's tree failed removal until its attempts ran out.
func seedCleanupDebt(t *testing.T) (context.Context, *waveobj.TaskGroup) {
	t.Helper()
	ctx, dag := seedPendingDag(t)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].State, g.Tasks[0].Merged = TaskState_Done, true
		g.Tasks[0].CleanupError = "removing worktree dir: unlinkat: The process cannot access the file"
		g.Tasks[0].CleanupAttempts = MaxCleanupAttempts
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	stubStopRunWorkers(t)
	return ctx, dag
}

func TestRetryCleanupClearsDebtOnceTheTreeGoes(t *testing.T) {
	ctx, dag := seedCleanupDebt(t)
	stubCleanupRemover(t, func(context.Context, string, string) error { return nil })
	if err := RetryCleanup(ctx, dag.OID, "t-0"); err != nil {
		t.Fatalf("retry-cleanup: %v", err)
	}
	task := firstTask(t, ctx, dag.OID)
	if task.CleanupError != "" || task.CleanupAttempts != 0 || task.CleanupPending {
		t.Fatalf("a removed tree clears the debt, got error %q attempts %d pending %v", task.CleanupError, task.CleanupAttempts, task.CleanupPending)
	}
}

// the attempts reset, so a tree still held counts one fresh failure and the watchdog keeps retrying it
func TestRetryCleanupThatFailsAgainRestartsTheAttempts(t *testing.T) {
	ctx, dag := seedCleanupDebt(t)
	stubCleanupRemover(t, func(context.Context, string, string) error { return errors.New("still locked") })
	err := RetryCleanup(ctx, dag.OID, "t-0")
	if err == nil || !strings.Contains(err.Error(), "still locked") {
		t.Fatalf("want the removal's error, got %v", err)
	}
	if task := firstTask(t, ctx, dag.OID); task.CleanupAttempts != 1 || task.CleanupError == "" {
		t.Fatalf("want one fresh attempt recorded, got attempts %d error %q", task.CleanupAttempts, task.CleanupError)
	}
}

func TestRetryCleanupRefusesATaskWithNoDebt(t *testing.T) {
	ctx, dag := seedPendingDag(t)
	if err := RetryCleanup(ctx, dag.OID, "t-0"); err == nil {
		t.Fatal("a task with no tree left must be refused")
	}
	if err := RetryCleanup(ctx, dag.OID, "t-404"); err == nil {
		t.Fatal("an unknown task must be refused")
	}
}

// cancelling queues every tree for cleanup, so a cancelled dag's debt must stay retryable
func TestRetryCleanupWorksOnACancelledDag(t *testing.T) {
	ctx, dag := seedCleanupDebt(t)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Status = DagStatus_Cancelled
		g.Tasks[0].Merged = false
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	stubCleanupRemover(t, func(context.Context, string, string) error { return nil })
	if err := RetryCleanup(ctx, dag.OID, "t-0"); err != nil {
		t.Fatalf("retry-cleanup on a cancelled dag: %v", err)
	}
}
