// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// stopSeesDagLock stubs the worker stop to report whether the dag lock was free while it ran. A free lock also
// gets a tick, as the stopped worker's exit pokes one.
func stopSeesDagLock(t *testing.T, dagID string) *[]bool {
	t.Helper()
	var free []bool
	old := stopRunWorkers
	stopRunWorkers = func(ctx context.Context, _ *waveobj.Run) error {
		ran, err := TryWithDagMutation(dagID, func() error { return nil })
		if err != nil {
			return err
		}
		free = append(free, ran)
		if !ran {
			return nil
		}
		return Schedule(ctx, dagID)
	}
	restoreAfterStages(t, func() { stopRunWorkers = old })
	return &free
}

func assertStoppedOutsideLock(t *testing.T, free []bool) {
	t.Helper()
	if len(free) != 1 || !free[0] {
		t.Fatalf("the worker is stopped once, with the dag lock free: every exit the stop causes waits on that lock (free=%v)", free)
	}
}

// RAD-a558169f: a skip, retry or escalate stopped the task's worker under the dag lock
func TestTaskActionsStopTheWorkerOutsideTheDagLock(t *testing.T) {
	t.Run("skip", func(t *testing.T) {
		ctx, dag, _, child := seedRunningDag(t)
		if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
			g.Tasks[0].State = TaskState_Stalled
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		free := stopSeesDagLock(t, dag.OID)
		if err := ApplyAction(ctx, dag.OID, "t-0", "skip", waveobj.RoutePin{}); err != nil {
			t.Fatal(err)
		}
		assertStoppedOutsideLock(t, *free)
		// the tick inside the stop saw a cancelled run: it must leave the task for the skip to record
		if got := mustLoadDag(t, ctx, dag.OID).Tasks[0]; got.State != TaskState_Skipped || got.RunID != "" {
			t.Fatalf("skipped task = state %q run %q (was %q)", got.State, got.RunID, child.ID)
		}
	})
	t.Run("retry", func(t *testing.T) {
		ctx, dag, _, child := seedRunningDag(t)
		if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
			g.Tasks[0].State = TaskState_Failed
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		allowEscalationSchedule(t)
		free := stopSeesDagLock(t, dag.OID)
		if err := ApplyAction(ctx, dag.OID, "t-0", "retry", waveobj.RoutePin{}); err != nil {
			t.Fatal(err)
		}
		assertStoppedOutsideLock(t, *free)
		if got := mustLoadDag(t, ctx, dag.OID).Tasks[0]; got.State != TaskState_Running || got.RunID == "" || got.RunID == child.ID {
			t.Fatalf("retried task = state %q run %q (was %q), want it dispatched again", got.State, got.RunID, child.ID)
		}
	})
	t.Run("escalate", func(t *testing.T) {
		ctx, dag, child, _ := seedEscalationDag(t, "claude", TaskState_Failed, 0)
		allowEscalationSchedule(t)
		free := stopSeesDagLock(t, dag.OID)
		if err := ApplyAction(ctx, dag.OID, "t-0", "escalate", waveobj.RoutePin{Model: "opus"}); err != nil {
			t.Fatal(err)
		}
		assertStoppedOutsideLock(t, *free)
		if got := mustLoadDag(t, ctx, dag.OID).Tasks[0]; got.Escalations != 1 || got.RunID == child.ID {
			t.Fatalf("escalated task = %+v", got)
		}
	})
}

func TestAutoRetryStopsTheStalledWorkerOutsideTheDagLock(t *testing.T) {
	_, ctx, g, oldRun := stalledNoLead(t, "auto-retry-lock", false)
	stubSpawnWorker(t, "tab:retry-worker", nil)
	free := stopSeesDagLock(t, g.OID)

	if err := ScheduleOnce(ctx, g); err != nil {
		t.Fatal(err)
	}
	assertStoppedOutsideLock(t, *free)
	if task := g.Tasks[0]; task.State != TaskState_Running || task.StallRetries != 1 || task.RunID == oldRun {
		t.Fatalf("the stalled task is retried and dispatched again, got state=%s stallretries=%d run=%q (was %q)", task.State, task.StallRetries, task.RunID, oldRun)
	}
}

// the lane's tree is dumped and removed after the stop, which takes tens of seconds on Windows
func TestSkipRewindsTheLaneOutsideTheDagLock(t *testing.T) {
	f := newMergeFixture(t, oneLane())
	wt, _ := f.startSecondTask(t)
	commitInTree(t, wt, "bad.txt")
	f.setTaskState(t, "t-2", TaskState_Failed)
	stopped := make(chan struct{})
	var once sync.Once
	old := stopRunWorkers
	stopRunWorkers = func(context.Context, *waveobj.Run) error {
		// the lane's merge reaps the same worker later
		once.Do(func() { close(stopped) })
		return nil
	}
	restoreAfterStages(t, func() { stopRunWorkers = old })

	// another caller removing the tree holds the rewind where the test can look at the dag lock
	treeRemovals.Lock(wt)
	done := make(chan error, 1)
	go func() { done <- ApplyAction(f.ctx, f.dagID, "t-2", "skip", waveobj.RoutePin{}) }()
	<-stopped
	locked := make(chan error, 1)
	go func() { locked <- WithDagMutation(f.dagID, func() error { return nil }) }()
	var early, lockErr error
	finished, gotLock := false, false
	select {
	case lockErr = <-locked:
		gotLock = true
	case <-time.After(5 * time.Second):
	}
	select {
	case early = <-done:
		finished = true
	default:
	}
	treeRemovals.Unlock(wt)
	if finished {
		t.Fatalf("the skip rewound the lane while another caller was removing its tree (err=%v)", early)
	}
	if !gotLock || lockErr != nil {
		t.Fatalf("the dag lock was held while the lane was rewound (got=%v err=%v)", gotLock, lockErr)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if got := f.dag(t).Tasks[1].State; got != TaskState_Skipped {
		t.Fatalf("t-2 = %s, want skipped", got)
	}
	if got := committedFiles(t, f.project, "HEAD"); !reflect.DeepEqual(got, []string{"schema.txt"}) {
		t.Fatalf("the lane lands t-1's work and none of the skipped t-2's, got %v", got)
	}
}

func TestSkipDropsARejectedCommitOutsideTheDagLock(t *testing.T) {
	ctx, dag, worker := seedReviewFailedDag(t)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].ReviewBase = worker.BaseCommit
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var free []bool
	old := resetReviewTree
	resetReviewTree = func(context.Context, string, string) error {
		ran, err := TryWithDagMutation(dag.OID, func() error { return nil })
		free = append(free, ran)
		return err
	}
	restoreAfterStages(t, func() { resetReviewTree = old })
	if err := ApplyAction(ctx, dag.OID, "t-0", "skip", waveobj.RoutePin{}); err != nil {
		t.Fatal(err)
	}
	if len(free) != 1 || !free[0] {
		t.Fatalf("the lane tree is reset once, with the dag lock free (free=%v)", free)
	}
}

// the worker a skip or retry stops exits non-zero while the task still names its run
func TestHandleChildOutcomeIgnoresAFailedExitOfACancelledRun(t *testing.T) {
	h := newChildOutcomeHarness(t, 1)
	runID := h.loadDag(t).Tasks[0].RunID
	if err := wstore.UpdateRun(h.ctx, h.channel, runID, func(r *waveobj.Run) error {
		*r = jarvis.CancelRun(*r)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := HandleChildOutcome(h.ctx, h.workers[0], jarvis.OutcomeData{Status: "failed", Summary: "killed", ExitCode: 1}); err != nil {
		t.Fatal(err)
	}
	task := h.loadDag(t).Tasks[0]
	if task.RunID != runID || task.Attempts != 0 || len(h.workers) != 1 {
		t.Fatalf("a stopped worker's exit is not a failure to retry, got %+v workers=%d", task, len(h.workers))
	}
}
