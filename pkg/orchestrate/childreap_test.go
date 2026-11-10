// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// A task's worker and reviewer sit at their prompt after they report, a claude session holding ~1.5 GB each. Run
// b539a1af (2026-11-10) held eight sessions at parallelism 3: the workers of two tasks under review, and the worker
// and reviewer of a task long done, all idle until their lane's tree was removed.

// recordStops scripts stopRunWorkers and returns the runs it was asked to stop, in order.
func recordStops(t *testing.T) *[]string {
	t.Helper()
	var stopped []string
	old := stopRunWorkers
	stopRunWorkers = func(_ context.Context, r *waveobj.Run) error {
		stopped = append(stopped, r.ID)
		return nil
	}
	restoreAfterStages(t, func() { stopRunWorkers = old })
	return &stopped
}

// taskSessionFixture is a task's worker run, in status, whose session runs in a tab of its own.
func taskSessionFixture(t *testing.T, status string) (channelID string, run *waveobj.Run) {
	t.Helper()
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "childreap-"+uuid.NewString(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	tabID, blockID := uuid.NewString(), uuid.NewString()
	if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: tabID, BlockIds: []string{blockID}, Meta: waveobj.MetaMapType{}}); err != nil {
		t.Fatal(err)
	}
	r := jarvis.NewRun("worker goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	r.TaskId = "t-1"
	r.DagORef = "dag-" + uuid.NewString()
	r.Status = status
	r.Phases[0].WorkerOrefs = []string{"tab:" + tabID}
	if err := wstore.AppendRun(ctx, ch.OID, r); err != nil {
		t.Fatal(err)
	}
	return ch.OID, &r
}

func TestFinishedWorkerIsQueuedWhenItsTaskEntersReview(t *testing.T) {
	resetFinishedSessions(t)
	ctx, dag, worker := seedReviewDag(t)
	stubReviewTree(t, worker.EndCommit)
	captureSpawns(t)
	schedule(t, ctx, dag.OID)
	if got := firstTask(t, ctx, dag.OID); got.State != TaskState_Reviewing {
		t.Fatalf("want the task under review, got %s", got.State)
	}
	if !queuedSession(worker.ID) {
		t.Fatal("a worker that reported done must be queued: nothing types into it again, a failed review spawns a new one")
	}
}

func TestReviewVerdictQueuesTheTaskReviewersSession(t *testing.T) {
	for _, verdict := range []string{ReviewVerdict_Pass, ReviewVerdict_Fail} {
		t.Run(verdict, func(t *testing.T) {
			resetFinishedSessions(t)
			ctx, dag, worker := seedReviewDag(t)
			stubReviewTree(t, worker.EndCommit)
			captureSpawns(t)
			newFakeLead(t)
			schedule(t, ctx, dag.OID)
			reviewer := firstTask(t, ctx, dag.OID).ReviewRunID
			if err := RecordReviewVerdict(ctx, dag.OID, reviewer, verdict, "the reviewer's say", "", "", nil); err != nil {
				t.Fatal(err)
			}
			schedule(t, ctx, dag.OID)
			if !queuedSession(reviewer) {
				t.Fatalf("a %s verdict must queue the task reviewer's session", verdict)
			}
		})
	}
}

// a task's session is stopped, not closed: its tab and scrollback stay for the run view until the run closes
func TestReapFinishedSessionsStopsADoneTaskSessionAndKeepsItsTab(t *testing.T) {
	resetFinishedSessions(t)
	stubBlockShellStatus(t, blockcontroller.Status_Running)
	stubTurnEndedAt(t, time.Now().Add(-TurnEndedGrace-time.Minute).UnixMilli())
	sent := stubLeadTabDelete(t, nil)
	stopped := recordStops(t)
	channelID, run := taskSessionFixture(t, jarvis.RunStatus_Done)

	queueFinishedSession(channelID, run.ID)
	reapFinishedSessions(context.Background(), time.Now().UnixMilli())

	if !slices.Equal(*stopped, []string{run.ID}) || len(*sent) != 0 {
		t.Fatalf("want the task session stopped and its tab kept: stopped=%v broadcasts=%d", *stopped, len(*sent))
	}
	if queuedSession(run.ID) {
		t.Fatal("a stopped session must leave the queue, or every tick stops it again")
	}
}

func TestReapFinishedSessionsKeepsATaskSessionWhoseRunIsStillOpen(t *testing.T) {
	resetFinishedSessions(t)
	stubBlockShellStatus(t, blockcontroller.Status_Running)
	stubTurnEndedAt(t, time.Now().Add(-TurnEndedGrace-time.Minute).UnixMilli())
	stubLeadTabDelete(t, nil)
	stopped := recordStops(t)
	channelID, run := taskSessionFixture(t, jarvis.RunStatus_Executing)

	queueFinishedSession(channelID, run.ID)
	reapFinishedSessions(context.Background(), time.Now().UnixMilli())

	if len(*stopped) != 0 || !queuedSession(run.ID) {
		t.Fatalf("an open run keeps its session: stopped=%v queued=%v", *stopped, queuedSession(run.ID))
	}
}

// its `complete` may still be on its way back: the turn decides, as for every other queued session
func TestReapFinishedSessionsKeepsATaskSessionStillInItsTurn(t *testing.T) {
	resetFinishedSessions(t)
	stubBlockShellStatus(t, blockcontroller.Status_Running)
	stubTurnEndedAt(t, 0)
	stubLeadTabDelete(t, nil)
	stopped := recordStops(t)
	channelID, run := taskSessionFixture(t, jarvis.RunStatus_Done)

	queueFinishedSession(channelID, run.ID)
	reapFinishedSessions(context.Background(), time.Now().UnixMilli())

	if len(*stopped) != 0 || !queuedSession(run.ID) {
		t.Fatalf("a session mid-turn keeps running: stopped=%v queued=%v", *stopped, queuedSession(run.ID))
	}
}

// a pause stopped only each run's running session, so the finished sessions it found idle kept their RAM under a
// paused run: run b539a1af's pause left four claude sessions, ~6.5 GB, running
func TestPauseDagStopsTheIdleSessionsOfFinishedRuns(t *testing.T) {
	f := newPauseFixture(t, "t-0", "t-1")
	if err := wstore.UpdateRun(f.ctx, f.channel, f.workers["t-0"], func(r *waveobj.Run) error {
		next, err := jarvis.CompletePhase(*r, 0, nil, 2)
		*r = next
		return err
	}); err != nil {
		t.Fatal(err)
	}
	tabs := stubSuspend(t, nil)
	stopped := recordStops(t)
	got, err := PauseDag(f.ctx, f.dagID, f.ownerID)
	if err != nil {
		t.Fatal(err)
	}
	if slices.Contains(*tabs, "tab:w-t-0") || len(got) != 2 {
		t.Fatalf("a finished run is not suspended for a resume: suspended %v (%d sessions)", *tabs, len(got))
	}
	if !slices.Contains(*stopped, f.workers["t-0"]) {
		t.Fatalf("the finished run's session must be stopped for good, stopped %v", *stopped)
	}
	if slices.Contains(*stopped, f.workers["t-1"]) || slices.Contains(*stopped, f.ownerID) {
		t.Fatalf("a running session is suspended, not stopped: stopped %v", *stopped)
	}
}
