// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// stubLeadTabDelete makes DeleteTab queue the workspace and tab updates it would, then return err.
func stubLeadTabDelete(t *testing.T, err error) *[]waveobj.UpdatesRtnType {
	t.Helper()
	oldDelete, oldSend := deleteTab, sendLeadTabUpdates
	restoreAfterStages(t, func() { deleteTab, sendLeadTabUpdates = oldDelete, oldSend })
	deleteTab = func(ctx context.Context, workspaceId, tabId string, _ bool) (string, error) {
		waveobj.ContextAddUpdate(ctx, waveobj.WaveObjUpdate{UpdateType: waveobj.UpdateType_Update, OType: waveobj.OType_Workspace, OID: workspaceId})
		waveobj.ContextAddUpdate(ctx, waveobj.WaveObjUpdate{UpdateType: waveobj.UpdateType_Delete, OType: waveobj.OType_Tab, OID: tabId})
		return "", err
	}
	var sent []waveobj.UpdatesRtnType
	sendLeadTabUpdates = func(u waveobj.UpdatesRtnType) { sent = append(sent, u) }
	return &sent
}

// the app drops a tab only on a broadcast workspace update; without one the closed lead stays a frozen row
func TestDeleteLeadTabBroadcastsTheWorkspaceChange(t *testing.T) {
	sent := stubLeadTabDelete(t, nil)
	if err := deleteLeadTab(context.Background(), "ws-1", "lead-tab"); err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 1 || len((*sent)[0]) != 2 {
		t.Fatalf("want one broadcast of the workspace and tab updates, got %+v", *sent)
	}
}

// a DeleteTab that fails part-way may already have closed the blocks, so what it did is still broadcast
func TestDeleteLeadTabBroadcastsAfterAFailure(t *testing.T) {
	sent := stubLeadTabDelete(t, errors.New("boom"))
	if err := deleteLeadTab(context.Background(), "ws-1", "lead-tab"); err == nil {
		t.Fatal("the delete error must be returned")
	}
	if len(*sent) != 1 {
		t.Fatalf("want the partial updates broadcast, got %d broadcasts", len(*sent))
	}
}

// stubBlockShellStatus fakes the block controller's process status, "" meaning it has no controller.
func stubBlockShellStatus(t *testing.T, status string) {
	t.Helper()
	old := blockShellStatus
	t.Cleanup(func() { blockShellStatus = old })
	blockShellStatus = func(string) string { return status }
}

// deadLeadFixture is a finished dag under an owner run whose orchestrate phase carries a lead tab.
func deadLeadFixture(t *testing.T) (*waveobj.Run, *waveobj.TaskGroup) {
	t.Helper()
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "leadclose-"+uuid.NewString(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	tabID, blockID := uuid.NewString(), uuid.NewString()
	if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: tabID, BlockIds: []string{blockID}, Meta: waveobj.MetaMapType{}}); err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	owner.Phases[0].WorkerOrefs = []string{"tab:" + tabID}
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{{ID: "t-0", Label: "a"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	g.Status = DagStatus_Done
	g.Tasks[0].State = TaskState_Done
	return &owner, &g
}

func TestMaybeCompleteLeadFreeRunClosesARunWhoseLeadProcessIsGone(t *testing.T) {
	stubBlockShellStatus(t, blockcontroller.Status_Done)
	owner, g := deadLeadFixture(t)
	if !MaybeCompleteLeadFreeRun(context.Background(), owner, g) {
		t.Fatal("a lead tab with no live process must not keep a finished run open")
	}
	if owner.Status != jarvis.RunStatus_Done {
		t.Fatalf("run status = %q, want done", owner.Status)
	}
}

func TestMaybeCompleteLeadFreeRunLeavesARunWithALiveLead(t *testing.T) {
	stubBlockShellStatus(t, blockcontroller.Status_Running)
	owner, g := deadLeadFixture(t)
	before := owner.Status
	if MaybeCompleteLeadFreeRun(context.Background(), owner, g) {
		t.Fatal("a live lead still owes the human a summary")
	}
	if owner.Status != before {
		t.Fatalf("run status = %q, want unchanged %q", owner.Status, before)
	}
}

func TestMaybeCompleteLeadFreeRunLeavesALeadStillStarting(t *testing.T) {
	stubBlockShellStatus(t, blockcontroller.Status_Init)
	owner, g := deadLeadFixture(t)
	if MaybeCompleteLeadFreeRun(context.Background(), owner, g) {
		t.Fatal("a lead mid-launch must not be closed out from under it")
	}
}

// A bounded run — one the lead judged small enough to do itself — never submits a plan, so it has no
// dag. Reading that nil as "unknown" left every such lead tab behind for good, because no dag also means
// no tick that could ever re-check it.
func TestShouldCloseBoundedLeadThatHasNoDag(t *testing.T) {
	tests := []struct {
		name string
		run  waveobj.Run
		want bool
	}{
		{
			name: "done orchestrator with no dag closes",
			run:  waveobj.Run{Mode: jarvis.RunMode_Orchestrator, Status: jarvis.RunStatus_Done},
			want: true,
		},
		{
			name: "cancelled orchestrator with no dag closes",
			run:  waveobj.Run{Mode: jarvis.RunMode_Orchestrator, Status: jarvis.RunStatus_Cancelled},
			want: true,
		},
		{
			name: "still-planning orchestrator keeps its lead",
			run:  waveobj.Run{Mode: jarvis.RunMode_Orchestrator, Status: jarvis.RunStatus_Planning},
			want: false,
		},
		{
			name: "a quick run has no lead to close",
			run:  waveobj.Run{Mode: jarvis.RunMode_Quick, Status: jarvis.RunStatus_Done},
			want: false,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := ShouldCloseOrchestratorLead(&tc.run, nil); got != tc.want {
				t.Errorf("ShouldCloseOrchestratorLead(run, nil) = %v, want %v", got, tc.want)
			}
		})
	}
}

// The tab a lead is still running in must not be deleted under it: its own `wsh jarvis complete` would
// return into a dead block, so the lead never sees the result and the human never gets the report
// (run 5d361309). A terminal run says the work is done, not that the turn is over.
func TestMaybeCloseOrchestratorLeadKeepsATabWhoseLeadIsStillRunning(t *testing.T) {
	stubBlockShellStatus(t, blockcontroller.Status_Running)
	sent := stubLeadTabDelete(t, nil)
	owner, g := deadLeadFixture(t)
	owner.Status = jarvis.RunStatus_Done

	ok, err := MaybeCloseOrchestratorLead(context.Background(), owner, g)
	if err != nil {
		t.Fatal(err)
	}
	if ok || len(*sent) != 0 {
		t.Fatalf("a mid-turn lead's tab must survive: closed=%v broadcasts=%d", ok, len(*sent))
	}
}

// stubTurnEndedAt fakes when a session last reported its turn over, 0 meaning it has not.
func stubTurnEndedAt(t *testing.T, ts int64) {
	t.Helper()
	old := workerTurnEndedAt
	t.Cleanup(func() { workerTurnEndedAt = old })
	workerTurnEndedAt = func(context.Context, *waveobj.Run) int64 { return ts }
}

// A claude lead never exits on its own: it sits at its prompt once its turn ends, so waiting for its exit left every
// finished lead's tab behind (run 9bd1b7ec's lead sat idle for hours). A turn reported over past the grace is the
// proof its `complete` returned, which is all the liveness guard protects.
func TestMaybeCloseOrchestratorLeadClosesALeadIdleAtItsPromptPastTheGrace(t *testing.T) {
	stubBlockShellStatus(t, blockcontroller.Status_Running)
	stubTurnEndedAt(t, time.Now().Add(-TurnEndedGrace-time.Minute).UnixMilli())
	sent := stubLeadTabDelete(t, nil)
	owner, g := deadLeadFixture(t)
	owner.Status = jarvis.RunStatus_Done

	ok, err := MaybeCloseOrchestratorLead(context.Background(), owner, g)
	if err != nil {
		t.Fatal(err)
	}
	if !ok || len(*sent) != 1 {
		t.Fatalf("a lead idle past the grace must be closed: closed=%v broadcasts=%d", ok, len(*sent))
	}
}

func TestMaybeCloseOrchestratorLeadKeepsALeadJustIdle(t *testing.T) {
	stubBlockShellStatus(t, blockcontroller.Status_Running)
	stubTurnEndedAt(t, time.Now().Add(-time.Minute).UnixMilli())
	sent := stubLeadTabDelete(t, nil)
	owner, g := deadLeadFixture(t)
	owner.Status = jarvis.RunStatus_Done

	if ok, err := MaybeCloseOrchestratorLead(context.Background(), owner, g); err != nil || ok || len(*sent) != 0 {
		t.Fatalf("a lead idle under the grace keeps its tab: closed=%v err=%v broadcasts=%d", ok, err, len(*sent))
	}
}

// The lead's exit is the one moment its tab is provably free, and the only close site a bounded run ever
// reaches. It must not consult the process status: the shell wait loop launches this hook BEFORE the
// deferred write that stamps Status_Done, so a liveness check here would race that write and usually
// lose — leaving the tab behind exactly as before.
func TestCloseOrchestratorLeadOnExitClosesABoundedLeadDespiteAStaleRunningStatus(t *testing.T) {
	stubBlockShellStatus(t, blockcontroller.Status_Running)
	sent := stubLeadTabDelete(t, nil)
	owner, _ := deadLeadFixture(t)
	owner.Status = jarvis.RunStatus_Done

	ok, err := CloseOrchestratorLeadOnExit(context.Background(), owner, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !ok || len(*sent) != 1 {
		t.Fatalf("a bounded run's lead tab must be collected on exit: closed=%v broadcasts=%d", ok, len(*sent))
	}
}

// keeponexit exists for exactly this: a lead that exits while its dag still has work keeps its tab.
func TestCloseOrchestratorLeadOnExitKeepsALeadWhoseDagStillRuns(t *testing.T) {
	sent := stubLeadTabDelete(t, nil)
	owner, g := deadLeadFixture(t)
	owner.Status = jarvis.RunStatus_Done
	g.Status = DagStatus_Running
	g.Tasks[0].State = TaskState_Running

	ok, err := CloseOrchestratorLeadOnExit(context.Background(), owner, g)
	if err != nil {
		t.Fatal(err)
	}
	if ok || len(*sent) != 0 {
		t.Fatalf("children still need the tab: closed=%v broadcasts=%d", ok, len(*sent))
	}
}
