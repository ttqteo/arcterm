// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// stageSessionFixture is a plan reviewer's run, in status, whose session runs in a tab of its own.
func stageSessionFixture(t *testing.T, status string) (channelID string, run *waveobj.Run) {
	t.Helper()
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "sessionreap-"+uuid.NewString(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	tabID, blockID := uuid.NewString(), uuid.NewString()
	if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: tabID, BlockIds: []string{blockID}, Meta: waveobj.MetaMapType{}}); err != nil {
		t.Fatal(err)
	}
	r := jarvis.NewRun("review the plan", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	r.StageRole = jarvis.UsageRole_PlanReviewer
	r.Status = status
	r.Phases[0].WorkerOrefs = []string{"tab:" + tabID}
	if err := wstore.AppendRun(ctx, ch.OID, r); err != nil {
		t.Fatal(err)
	}
	return ch.OID, &r
}

func resetFinishedSessions(t *testing.T) {
	t.Helper()
	finishedSessions.Lock()
	finishedSessions.byRun = map[string]string{}
	finishedSessions.Unlock()
	t.Cleanup(func() {
		finishedSessions.Lock()
		finishedSessions.byRun = map[string]string{}
		finishedSessions.Unlock()
	})
}

func queuedSession(runID string) bool {
	finishedSessions.Lock()
	defer finishedSessions.Unlock()
	_, ok := finishedSessions.byRun[runID]
	return ok
}

// The plan reviewer reports its run done right after its verdict, then sits at its prompt for good: run 9bd1b7ec's
// two plan reviewers held its landing tree for hours, so the tree could not be removed.
func TestReapFinishedSessionsClosesADoneStageSessionIdlePastTheGrace(t *testing.T) {
	resetFinishedSessions(t)
	stubBlockShellStatus(t, blockcontroller.Status_Running)
	stubTurnEndedAt(t, time.Now().Add(-TurnEndedGrace-time.Minute).UnixMilli())
	sent := stubLeadTabDelete(t, nil)
	channelID, run := stageSessionFixture(t, jarvis.RunStatus_Done)

	queueFinishedSession(channelID, run.ID)
	reapFinishedSessions(context.Background(), time.Now().UnixMilli())

	if len(*sent) != 1 {
		t.Fatalf("the idle reviewer's tab must close, got %d broadcasts", len(*sent))
	}
	if queuedSession(run.ID) {
		t.Fatal("a closed session must leave the queue")
	}
}

// its verdict is in, but its `complete` has not landed: closing now would cut that call off
func TestReapFinishedSessionsKeepsAStageSessionWhoseRunIsStillOpen(t *testing.T) {
	resetFinishedSessions(t)
	stubBlockShellStatus(t, blockcontroller.Status_Running)
	stubTurnEndedAt(t, time.Now().Add(-TurnEndedGrace-time.Minute).UnixMilli())
	sent := stubLeadTabDelete(t, nil)
	channelID, run := stageSessionFixture(t, jarvis.RunStatus_Executing)

	queueFinishedSession(channelID, run.ID)
	reapFinishedSessions(context.Background(), time.Now().UnixMilli())

	if len(*sent) != 0 || !queuedSession(run.ID) {
		t.Fatalf("an open run keeps its session queued and its tab: broadcasts=%d queued=%v", len(*sent), queuedSession(run.ID))
	}
}

func TestReapFinishedSessionsKeepsASessionStillInItsTurn(t *testing.T) {
	resetFinishedSessions(t)
	stubBlockShellStatus(t, blockcontroller.Status_Running)
	stubTurnEndedAt(t, 0)
	sent := stubLeadTabDelete(t, nil)
	channelID, run := stageSessionFixture(t, jarvis.RunStatus_Done)

	queueFinishedSession(channelID, run.ID)
	reapFinishedSessions(context.Background(), time.Now().UnixMilli())

	if len(*sent) != 0 || !queuedSession(run.ID) {
		t.Fatalf("a session mid-turn keeps its tab: broadcasts=%d queued=%v", len(*sent), queuedSession(run.ID))
	}
}

// the human closed the tab already: nothing to do, and nothing to keep watching
func TestReapFinishedSessionsDropsASessionWhoseTabIsGone(t *testing.T) {
	resetFinishedSessions(t)
	sent := stubLeadTabDelete(t, nil)
	channelID, run := stageSessionFixture(t, jarvis.RunStatus_Done)
	if err := wstore.DBDelete(context.Background(), waveobj.OType_Tab, runTabID(run)); err != nil {
		t.Fatal(err)
	}

	queueFinishedSession(channelID, run.ID)
	reapFinishedSessions(context.Background(), time.Now().UnixMilli())

	if len(*sent) != 0 || queuedSession(run.ID) {
		t.Fatalf("a gone tab is dropped without a delete: broadcasts=%d queued=%v", len(*sent), queuedSession(run.ID))
	}
}

// a lead that MaybeCloseOrchestratorLead could not close yet, mid-turn, is watched until its turn is over: its dag
// is terminal, so no tick of its own will look at it again
func TestMaybeCloseOrchestratorLeadQueuesALeadStillInItsTurn(t *testing.T) {
	resetFinishedSessions(t)
	stubBlockShellStatus(t, blockcontroller.Status_Running)
	stubTurnEndedAt(t, 0)
	stubLeadTabDelete(t, nil)
	owner, g := deadLeadFixture(t)
	owner.Status = jarvis.RunStatus_Done
	owner.ChannelOID = g.ChannelId // as a run read back from the store carries it

	if ok, _ := MaybeCloseOrchestratorLead(context.Background(), owner, g); ok {
		t.Fatal("a lead mid-turn keeps its tab")
	}
	if !queuedSession(owner.ID) {
		t.Fatal("the lead must be queued for the watchdog")
	}
}

func TestReapFinishedSessionsClosesALandedLeadOnABlockedDag(t *testing.T) {
	resetFinishedSessions(t)
	stubBlockShellStatus(t, blockcontroller.Status_Running)
	stubTurnEndedAt(t, time.Now().Add(-TurnEndedGrace-time.Minute).UnixMilli())
	sent := stubLeadTabDelete(t, nil)
	ctx := context.Background()
	owner, g := deadLeadFixture(t)
	g.Status = DagStatus_Blocked
	g.Final = &waveobj.FinalStage{State: FinalState_Failed}
	if err := wstore.DBInsert(ctx, g); err != nil {
		t.Fatal(err)
	}
	channelID := g.ChannelId
	if err := wstore.UpdateRun(ctx, channelID, owner.ID, func(r *waveobj.Run) error {
		r.Status = jarvis.RunStatus_Done
		r.DagORef = g.OID
		r.Land = &waveobj.RunLand{State: LandState_Landed}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	queueFinishedSession(channelID, owner.ID)
	reapFinishedSessions(ctx, time.Now().UnixMilli())

	if len(*sent) != 1 || queuedSession(owner.ID) {
		t.Fatalf("a landed run's idle lead must close: broadcasts=%d queued=%v", len(*sent), queuedSession(owner.ID))
	}
}

// the plan reviewer's session ends with its verdict but its process does not: either verdict queues it
func TestPlanReviewVerdictQueuesTheReviewersSession(t *testing.T) {
	for _, verdict := range []string{ReviewVerdict_Pass, ReviewVerdict_Fail} {
		t.Run(verdict, func(t *testing.T) {
			resetFinishedSessions(t)
			ctx, dag := seedPlanReviewDag(t)
			captureSpawns(t)
			newFakeLead(t)
			reviewer := startPlanReview(t, ctx, dag.OID)
			if err := RecordPlanReviewVerdict(ctx, dag.OID, reviewer, verdict, "the reviewer's say", nil); err != nil {
				t.Fatal(err)
			}
			if !queuedSession(reviewer) {
				t.Fatalf("a %s verdict must queue the reviewer's session", verdict)
			}
		})
	}
}

// the watchdog's tick is what reaches a queued session: its dag is past the statuses the tick schedules
func TestWatchdogTickReapsAFinishedSession(t *testing.T) {
	resetFinishedSessions(t)
	stubBlockShellStatus(t, blockcontroller.Status_Running)
	stubTurnEndedAt(t, time.Now().Add(-TurnEndedGrace-time.Minute).UnixMilli())
	sent := stubLeadTabDelete(t, nil)
	channelID, run := stageSessionFixture(t, jarvis.RunStatus_Done)

	queueFinishedSession(channelID, run.ID)
	watchdogTick(context.Background())

	if len(*sent) != 1 || queuedSession(run.ID) {
		t.Fatalf("the watchdog must close the idle session: broadcasts=%d queued=%v", len(*sent), queuedSession(run.ID))
	}
}

// a forced land runs after the lead's `complete`, off its RPC: every close check that complete made saw a run not
// yet landed on a dag left blocked, so the land itself must hand the lead on (run 9bd1b7ec)
func TestLandPastAFailedFinalStageQueuesTheLead(t *testing.T) {
	resetFinishedSessions(t)
	stubBlockShellStatus(t, blockcontroller.Status_Running)
	stubTurnEndedAt(t, 0)
	stubLeadTabDelete(t, nil)
	f, _ := landFixture(t)
	f.setFinal(t, &waveobj.FinalStage{State: FinalState_Failed, Round: 1})
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.Status = DagStatus_Blocked
		for i := range cur.Tasks {
			cur.Tasks[i].State = TaskState_Done
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	tabID := uuid.NewString()
	if err := wstore.DBInsert(f.ctx, &waveobj.Tab{OID: tabID, BlockIds: []string{uuid.NewString()}, Meta: waveobj.MetaMapType{}}); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateRun(f.ctx, f.channel, f.ownerID, func(r *waveobj.Run) error {
		r.Phases[0].WorkerOrefs = []string{"tab:" + tabID}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	if land := f.landRun(t, true); land.State != LandState_Landed {
		t.Fatalf("land = %+v, want landed", land)
	}
	if !queuedSession(f.ownerID) {
		t.Fatal("the landed run's lead must be queued for the watchdog to close")
	}
}
