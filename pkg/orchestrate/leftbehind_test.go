// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// holdDir makes dir undeletable the way a process holding it does - on Windows an open file inside it, elsewhere a
// read-only directory inside it - and returns the func that lets go. git's forced removal then unregisters the tree
// and leaves the directory, as it did in run eb4d4b0e.
func holdDir(t *testing.T, dir string) func() {
	t.Helper()
	var release func()
	if runtime.GOOS == "windows" {
		f, err := os.Create(filepath.Join(dir, "held.txt"))
		if err != nil {
			t.Fatal(err)
		}
		release = func() { f.Close() }
	} else {
		if os.Geteuid() == 0 {
			t.Skip("root deletes inside a read-only directory")
		}
		held := filepath.Join(dir, "held")
		writeFile(t, filepath.Join(held, "held.txt"), "held\n")
		if err := os.Chmod(held, 0o500); err != nil {
			t.Fatal(err)
		}
		release = func() { os.Chmod(held, 0o700) }
	}
	var once sync.Once
	release = func(r func()) func() { return func() { once.Do(r) } }(release)
	t.Cleanup(release)
	return release
}

// heldRetry dispatches t-1, commits its work, holds its tree and retries it: the retry's dispatch finds a dirty tree
// it cannot delete. It returns the held tree and the commit the lane holds.
func heldRetry(t *testing.T) (*mergeFixture, string, string, func()) {
	t.Helper()
	f := newMergeFixture(t, oneLane())
	var spawned []string
	stubSpawn(t, &spawned)
	stubStopWorkers(t)
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	wt := worktreeDir(f.project, TaskWorktreeKey(f.ownerID, "t-1"))
	work := commitInTree(t, wt, "schema.txt")
	release := holdDir(t, wt)
	f.setTaskState(t, "t-1", TaskState_Stalled)
	if err := ApplyAction(f.ctx, f.dagID, "t-1", "retry", waveobj.RoutePin{}); err != nil {
		t.Fatalf("a held stale tree must not fail the retry: %v", err)
	}
	return f, wt, work, release
}

// run eb4d4b0e: t-7's tree was unregistered but held, and every retry and escalate failed as worktree-failed
func TestDispatchChecksAHeldStaleTreeOutAtAFreshPath(t *testing.T) {
	f, wt, work, _ := heldRetry(t)
	key := TaskWorktreeKey(f.ownerID, "t-1")
	fresh := wt + ".1"
	task := taskByID(f.dag(t), "t-1")
	if task.State != TaskState_Running {
		t.Fatalf("the retry starts the task, got %s (%s)", task.State, task.LastFailureKind)
	}
	if run := f.taskRun(t, "t-1"); run.ProjectPath != fresh {
		t.Fatalf("the retry runs in %s, want the fresh path %s", run.ProjectPath, fresh)
	}
	if got := gitCmd(t, fresh, "rev-parse", "HEAD"); got != work {
		t.Fatalf("the fresh tree is the lane's branch at %s, got %s", work, got)
	}
	if got := laneTree(f.ctx, f.project, key); got != fresh {
		t.Fatalf("the lane's tree resolves to %s, want %s", got, fresh)
	}
	if !strings.Contains(task.CleanupError, filepath.Base(wt)) {
		t.Fatalf("the held directory is the task's cleanup debt, got %q", task.CleanupError)
	}
	if got := laneLeftovers(f.ctx, f.project, key); !slices.Equal(got, []string{wt}) {
		t.Fatalf("leftovers = %v, want only the held %s", got, wt)
	}
	// the sweep and the storage report find the fresh path under the lane's key
	if got, ok := RunKeyForTreeDir(filepath.Dir(fresh), filepath.Base(fresh)); !ok || got != key {
		t.Fatalf("RunKeyForTreeDir(%s) = %q %v, want %q", filepath.Base(fresh), got, ok, key)
	}
}

func TestRetryCleanupReachesADebtRecordedAtDispatch(t *testing.T) {
	f, wt, _, release := heldRetry(t)
	release()
	if err := RetryCleanup(f.ctx, f.dagID, "t-1"); err != nil {
		t.Fatalf("retry-cleanup: %v", err)
	}
	if _, err := os.Stat(wt); !os.IsNotExist(err) {
		t.Fatalf("the held directory is deleted once let go, stat err %v", err)
	}
	if !worktreeOnBranch(f.ctx, wt+".1", TaskWorktreeKey(f.ownerID, "t-1")) {
		t.Fatal("the running task's tree must survive the cleanup")
	}
	if task := taskByID(f.dag(t), "t-1"); task.CleanupError != "" || task.CleanupPending {
		t.Fatalf("the debt clears, got error %q pending %v", task.CleanupError, task.CleanupPending)
	}
}

// run eb4d4b0e: `dag skip t-7` failed on the held directory after git had let go of the tree
func TestSkipWithAHeldTreeRewindsTheLaneAndRecordsTheDirectory(t *testing.T) {
	f := newMergeFixture(t, threeLane())
	wt, schema := f.startSecondTask(t)
	commitInTree(t, wt, "bad.txt")
	release := holdDir(t, wt)
	f.setTaskState(t, "t-2", TaskState_Stalled)

	if err := ApplyAction(f.ctx, f.dagID, "t-2", "skip", waveobj.RoutePin{}); err != nil {
		t.Fatalf("a held directory must not fail the skip: %v", err)
	}
	if got := f.laneHead(t); got != schema {
		t.Fatalf("the lane goes back to t-1's commit %s, got %s", schema, got)
	}
	if task := taskByID(f.dag(t), "t-2"); task.State != TaskState_Skipped || task.CleanupError == "" {
		t.Fatalf("t-2 is skipped with its held directory as debt, got %s %q", task.State, task.CleanupError)
	}
	third := f.taskRun(t, "t-3")
	if third.ProjectPath != wt+".1" || third.BaseCommit != schema {
		t.Fatalf("t-3 starts at t-1's commit %s in a fresh tree, got %s at %s", schema, third.BaseCommit, third.ProjectPath)
	}

	release()
	if err := RetryCleanup(f.ctx, f.dagID, "t-2"); err != nil {
		t.Fatalf("retry-cleanup of the skipped task: %v", err)
	}
	if _, err := os.Stat(wt); !os.IsNotExist(err) {
		t.Fatalf("the held directory is deleted once let go, stat err %v", err)
	}
	if !worktreeOnBranch(f.ctx, third.ProjectPath, TaskWorktreeKey(f.ownerID, "t-1")) {
		t.Fatal("t-3's tree must survive the skipped task's cleanup")
	}
}

// run eb4d4b0e: what held t-7's tree was its reviewer, idle after its verdict, whose run record was gone, so
// neither the task's links nor the dag's runs reached it
func TestCleanupReapsAnEngineSessionWhoseRunIsGone(t *testing.T) {
	ctx := context.Background()
	projectDir := newGitRepo(t)
	ch, err := wstore.CreateChannel(ctx, "cleanup-reap-session", projectDir)
	if err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup("run-1", ch.OID, "reap session group", 2, false, []waveobj.TaskNode{
		{ID: "t-1", Label: "one"},
		{ID: "t-2", Label: "two"},
	}, time.Now().UnixMilli(), nil)
	if err != nil {
		t.Fatal(err)
	}
	g.Tasks[0].State, g.Tasks[0].Merged, g.Tasks[0].CleanupPending = TaskState_Done, true, true
	tree := worktreeDir(projectDir, LaneWorktreeKey(&g, "t-1"))
	otherTree := worktreeDir(projectDir, LaneWorktreeKey(&g, "t-2"))
	session := func(runID, cwd string) string {
		tabID := uuid.NewString()
		meta := waveobj.MetaMapType{waveobj.MetaKey_CmdCwd: cwd}
		if runID != "" {
			meta[blockMetaRunID] = runID
		}
		if err := wstore.DBInsert(ctx, &waveobj.Block{OID: uuid.NewString(), ParentORef: "tab:" + tabID, Meta: meta}); err != nil {
			t.Fatal(err)
		}
		return "tab:" + tabID
	}
	reviewer := session(uuid.NewString(), tree)
	nested := session(uuid.NewString(), filepath.Join(tree, "frontend"))
	session(uuid.NewString(), otherTree)
	session("", tree) // a session the engine did not launch is the human's

	var stopped []string
	oldStop := stopWorkerTab
	stopWorkerTab = func(_ context.Context, tab string) error {
		stopped = append(stopped, tab)
		return nil
	}
	restoreAfterStages(t, func() { stopWorkerTab = oldStop })
	stubStopRunWorkers(t)
	stubCleanupRemover(t, func(context.Context, string, string) error { return nil })

	if err := CleanupTaskWorktree(ctx, &g, "t-1"); err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	want := []string{reviewer, nested}
	slices.Sort(stopped)
	slices.Sort(want)
	if !slices.Equal(stopped, want) {
		t.Fatalf("cleanup stopped %v, want the engine sessions in the tree %v", stopped, want)
	}
}

// the engine locks a lane tree's removal at worktreeDir whichever path the tree moved to, so Storage's removal of
// <dir>.1 has to wait on the same lock
func TestRemoveWorktreeKeepBranchSharesTheLockOfAFreshPath(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "abcd1234-t-1")
	treeRemovals.Lock(dir)
	defer treeRemovals.Unlock(dir)
	if err := RemoveWorktreeKeepBranch(context.Background(), t.TempDir(), dir+".1"); err != ErrTreeBusy {
		t.Fatalf("want ErrTreeBusy while the engine removes the lane's tree, got %v", err)
	}
}
