// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// a tick that cannot read the landing head returns before it starts a reviewer it could not record, so the next tick
// does not start another
func TestUnreadableLandingHeadStartsNoReviewer(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	stubReviewTree(t, worker.EndCommit)
	calls := captureSpawns(t)
	// the project is no git checkout, so the landing head cannot be read
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.MergeRequired = true
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := Schedule(ctx, dag.OID); err == nil {
			t.Fatal("want the unreadable landing head reported")
		}
	}
	if len(*calls) != 0 {
		t.Fatalf("no reviewer starts in a tick that cannot commit, got %d spawned", len(*calls))
	}
}

// a tick that fails after it started a reviewer stops that reviewer: the dag never records it, and the next tick would
// start another beside it
func TestFailedTickStopsTheReviewerItStarted(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	stubReviewTree(t, worker.EndCommit)
	captureSpawns(t)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Parallelism = 2
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	addTask(t, ctx, dag, waveobj.TaskNode{ID: "t-1", Label: "b", State: TaskState_Pending})
	var reviewerRun string
	oldAppend := appendChildRun
	appendChildRun = func(ctx context.Context, channel string, run waveobj.Run) error {
		if !run.Review {
			return errors.New("disk full")
		}
		reviewerRun = run.ID
		return oldAppend(ctx, channel, run)
	}
	restoreAfterStages(t, func() { appendChildRun = oldAppend })
	var stopped []string
	oldStop := stopRunWorkers
	stopRunWorkers = func(_ context.Context, r *waveobj.Run) error {
		stopped = append(stopped, r.ID)
		return nil
	}
	restoreAfterStages(t, func() { stopRunWorkers = oldStop })

	if err := Schedule(ctx, dag.OID); err == nil {
		t.Fatal("want the failed dispatch reported")
	}
	if reviewerRun == "" {
		t.Fatal("the tick started no reviewer")
	}
	if run, err := wstore.GetRun(ctx, dag.ChannelId, reviewerRun); err != nil || run.Status != jarvis.RunStatus_Cancelled {
		t.Fatalf("the unrecorded reviewer's run is cancelled, got %+v err=%v", run, err)
	}
	if len(stopped) != 1 || stopped[0] != reviewerRun {
		t.Fatalf("the unrecorded reviewer's process is stopped, got %v", stopped)
	}
	if task := firstTask(t, ctx, dag.OID); task.ReviewRunID != "" {
		t.Fatalf("the dag does not record the stopped reviewer, got %q", task.ReviewRunID)
	}
}

// a worker that would not start is abandoned on a live context, though the spawn spent the one it was given
func TestUnstartedWorkerIsAbandonedPastTheSpawnDeadline(t *testing.T) {
	ctx, dag := seedPendingDag(t)
	run := jarvis.NewRun("worker goal", "ws-1", t.TempDir(), nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	if err := wstore.AppendRun(ctx, dag.ChannelId, run); err != nil {
		t.Fatal(err)
	}
	var stopErr error
	oldStop := stopSpawnedWorker
	stopSpawnedWorker = func(ctx context.Context, _ string) error {
		stopErr = ctx.Err()
		return nil
	}
	restoreAfterStages(t, func() { stopSpawnedWorker = oldStop })
	spent, cancel := context.WithCancel(ctx)
	cancel()

	abandonUnstartedWorker(spent, dag.ChannelId, run.ID, "tab:worker")
	if got, err := wstore.GetRun(ctx, dag.ChannelId, run.ID); err != nil || got.Status != jarvis.RunStatus_Cancelled {
		t.Fatalf("the unstarted worker's run is cancelled, got %+v err=%v", got, err)
	}
	if stopErr != nil {
		t.Fatalf("the worker's tab is disarmed on a live context, got %v", stopErr)
	}
}

// a stalled worker that completed after the tick read it keeps its work: the engine leaves the task for the next
// tick to derive done instead of retrying it over the finished run
func TestAutoRetrySkipsAStalledWorkerThatCompleted(t *testing.T) {
	_, ctx, g, runID := stalledNoLead(t, "auto-retry-completed", false)
	if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
		cur.Tasks[0].State = TaskState_Stalled
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateRun(ctx, g.ChannelId, runID, func(r *waveobj.Run) error {
		r.Status, r.EndCommit = jarvis.RunStatus_Done, "work111"
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	if autoRetryStalled(ctx, g.OID, stalledTask{taskID: "t-0", runID: runID}) {
		t.Fatal("a stalled task whose worker completed is not retried")
	}
	if run, err := wstore.GetRun(ctx, g.ChannelId, runID); err != nil || run.Status != jarvis.RunStatus_Done || run.EndCommit != "work111" {
		t.Fatalf("the finished run keeps its status and commit, got %+v err=%v", run, err)
	}
	if got := mustLoadDag(t, ctx, g.OID).Tasks[0]; got.RunID != runID || got.StallRetries != 0 {
		t.Fatalf("the task keeps its run for the next tick to derive, got %+v", got)
	}
}

// the tick's deadline is a wedge guard: a full batch of dispatches, each at its own bounds, finishes inside it, so a
// slow but healthy batch is never rolled back by its own commit failing
func TestTickBoundCoversAFullDispatchBatch(t *testing.T) {
	batch := MaxParallelism * (2*jarvis.RunWorkerSpawnTimeout + SetupTimeout)
	if scheduleTickTimeout <= batch {
		t.Fatalf("scheduleTickTimeout %s does not cover a batch of %d dispatches (%s)", scheduleTickTimeout, MaxParallelism, batch)
	}
}
