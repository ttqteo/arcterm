// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"log"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// deleteTab and sendLeadTabUpdates are deleteLeadTab's side effects, seams so a test needs no live workspace.
var deleteTab = wcore.DeleteTab
var sendLeadTabUpdates = func(updates waveobj.UpdatesRtnType) { wps.Broker.SendUpdateEvents(updates) }

// deleteLeadTab is the tab-deletion seam. Var so tests can stub it without a live workspace. The app drops the
// tab only on a broadcast workspace update, so the updates DeleteTab queues are collected and sent, including
// after a failure part-way, because the blocks it already closed are gone.
var deleteLeadTab = func(ctx context.Context, workspaceId, tabId string) error {
	if waveobj.ContextGetUpdates(ctx) == nil {
		ctx = waveobj.ContextWithUpdates(ctx)
		defer func() { sendLeadTabUpdates(waveobj.ContextGetUpdatesRtn(ctx)) }()
	}
	_, err := deleteTab(ctx, workspaceId, tabId, true)
	return err
}

// runTabID extracts the tab running a run's worker (an orchestrator's lead, a dag child's worker) from
// the run's first worker oref.
func runTabID(run *waveobj.Run) string {
	for _, p := range run.Phases {
		for _, oref := range p.WorkerOrefs {
			if strings.HasPrefix(oref, "tab:") {
				return strings.TrimPrefix(oref, "tab:")
			}
		}
	}
	return ""
}

// MaybeCloseOrchestratorLead deletes the lead's tab when the orchestrator is terminal, the DAG has no
// active tasks, and the lead is not still mid-turn. No-op otherwise. Returns true when it deleted.
func MaybeCloseOrchestratorLead(ctx context.Context, run *waveobj.Run, dag *waveobj.TaskGroup) (bool, error) {
	if !ShouldCloseOrchestratorLead(run, dag) {
		return false, nil
	}
	// deleting the tab under a lead that is still running takes its terminal with it: the lead's own
	// `wsh jarvis complete` returns into a dead block, so it never sees the result and the human never
	// gets the report (run 5d361309). A terminal run says the work is done, not that the turn is over —
	// only the process says that. The lead's exit closes what this skips, via CloseOrchestratorLeadOnExit. A claude
	// lead never exits on its own, though: it sits at its prompt, and a turn it reported over past the grace is
	// just as sure that its `complete` returned.
	if !sessionTurnOver(ctx, run, time.Now().UnixMilli()) {
		// its dag is terminal, so no tick of its own looks at it again: the watchdog does once its turn is over
		queueFinishedSession(run.ChannelOID, run.ID)
		return false, nil
	}
	return closeLeadTab(ctx, run)
}

// sessionTurnOver reports a run's session that can no longer be cut off mid-turn: its process is gone, or it has
// sat at its prompt past TurnEndedGrace since reporting its turn over.
func sessionTurnOver(ctx context.Context, run *waveobj.Run, now int64) bool {
	return !leadProcessAlive(runTabID(run)) || turnEndedPast(ctx, run, now)
}

// CloseOrchestratorLeadOnExit closes a terminal orchestrator run's lead tab from the lead's own exit
// hook. A lead opts out of the shell layer's close-on-exit (cmd:keeponexit, so its tab can outlive the
// process while DAG children run), so nothing else collects it — and a bounded run, having no DAG to
// tick, reaches no other close site at all.
//
// It skips MaybeCloseOrchestratorLead's liveness guard on purpose: the exit is itself the proof the turn
// is over, and the shell wait loop launches this hook BEFORE the deferred write that stamps
// Status_Done, so asking whether the process is alive here would race that write.
func CloseOrchestratorLeadOnExit(ctx context.Context, run *waveobj.Run, dag *waveobj.TaskGroup) (bool, error) {
	if !ShouldCloseOrchestratorLead(run, dag) {
		return false, nil
	}
	return closeLeadTab(ctx, run)
}

// closeLeadTab deletes the tab running run's lead. Shared by the two entry points above, which differ
// only in how they establish that the lead is no longer mid-turn.
func closeLeadTab(ctx context.Context, run *waveobj.Run) (bool, error) {
	tabId := runTabID(run)
	if tabId == "" || run.WorkspaceId == "" {
		return false, nil
	}
	if err := deleteLeadTab(ctx, run.WorkspaceId, tabId); err != nil {
		return false, err
	}
	return true, nil
}

// landedRun reports a done run whose branch is merged into its base.
func landedRun(run *waveobj.Run) bool {
	return run.Status == jarvis.RunStatus_Done && run.Land != nil && run.Land.State == LandState_Landed
}

// ShouldCloseOrchestratorLead reports whether an orchestrator lead's tab can be
// auto-closed. The lead's lifecycle is owned by Run/DAG, not by the shell exit:
// it must stay (even idle) while DAG children are still active, and only be
// closed after both the run and the DAG are terminal.
func ShouldCloseOrchestratorLead(run *waveobj.Run, dag *waveobj.TaskGroup) bool {
	if run == nil {
		return false
	}
	if run.Mode != jarvis.RunMode_Orchestrator {
		return false
	}
	if run.Status != jarvis.RunStatus_Done && run.Status != jarvis.RunStatus_Cancelled {
		return false
	}
	// no dag means the lead judged the goal bounded and did the work itself, so there are no children
	// to outlive: nil is "nothing to wait for", not "unknown". Reading it as unknown is what left every
	// bounded run's lead tab behind for good, since no dag also means no tick to re-check it later.
	if dag == nil {
		return true
	}
	// dag must be terminal — no active tasks. done/cancelled are the only
	// terminal dag statuses; blocked/awaiting-review still need the lead to
	// triage the gate, so keep it — unless a human already landed the run past
	// that gate (a failed final stage): the dag stays blocked on the failure, but
	// the work is in its base and nothing is left to triage.
	if dag.Status != DagStatus_Done && dag.Status != DagStatus_Cancelled && !landedRun(run) {
		return false
	}
	return allTasksTerminal(dag)
}

// leadProcessAlive reports whether the tab's agent block has a live controller. A lead still starting
// counts as alive, so a run whose lead is mid-launch is not closed out from under it.
func leadProcessAlive(tabID string) bool {
	tab, err := wstore.DBGet[*waveobj.Tab](context.Background(), tabID)
	if err != nil || tab == nil || len(tab.BlockIds) == 0 {
		return false
	}
	status := blockShellStatus(tab.BlockIds[0])
	return status == blockcontroller.Status_Running || status == blockcontroller.Status_Init
}

// SealRunEvidenceHook seals a done run's evidence snapshot, then lands its branch (LandRun). Wired to wshserver
// at startup so a run the engine closes itself gets the same snapshot and land-back `wsh jarvis complete`
// produces; no-op by default, because wsh and the tests link this package without the server.
var SealRunEvidenceHook = func(channelId, runId string) {}

// MaybeCompleteLeadFreeRun closes an owner run whose DAG finished but which has no lead to report the
// completion (no lead tab, or one whose process is gone). RunStatus_Done is only ever written by CompletePhase, reachable only through
// `wsh jarvis complete` — so a human-planned run (DeferStart never spawns a lead) finished its DAG and
// then sat in planning forever, its evidence never sealed. Returns true when it closed the run.
//
// Only a done DAG qualifies. Cancelling a dag already cascades CancelRun onto the owner, and closing a
// run whose tasks were cancelled would claim a success that did not happen.
func MaybeCompleteLeadFreeRun(ctx context.Context, run *waveobj.Run, dag *waveobj.TaskGroup) bool {
	if run == nil || dag == nil || run.Mode != jarvis.RunMode_Orchestrator {
		return false
	}
	if dag.Status != DagStatus_Done || !allTasksTerminal(dag) {
		return false
	}
	if run.Status == jarvis.RunStatus_Done || run.Status == jarvis.RunStatus_Cancelled {
		return false
	}
	// a lead's process, not its tab, is what owes the human a summary after the last task lands. a tab
	// outlives its process, so one whose controller is gone reports nothing and must not keep the run open.
	if tabId := runTabID(run); tabId != "" && leadProcessAlive(tabId) {
		return false
	}
	idx := jarvis.RunningPhaseIndex(*run)
	if idx < 0 || run.Phases[idx].Kind != jarvis.PhaseKind_Orchestrate || run.Phases[idx].Held {
		return false
	}
	// the commit a lead's `wsh jarvis complete` records for its plan run (AdvanceRunCommand). It scopes
	// the sealed diff to BaseCommit..EndCommit; SealEvidence falls back to the working tree when it is
	// absent, so a non-repo project is not a reason to leave the run open.
	endCommit, cerr := ProjectHeadCommit(ctx, jarvis.LandPath(run))
	if cerr != nil {
		log.Printf("complete lead-free run %s: no head commit, evidence falls back to the working tree: %v", run.ID, cerr)
	}
	ts := time.Now().UnixMilli()
	var completedIdx int
	// detached: two of the three Schedule callers are RPC handlers, and this is the write that closes
	// the run. A done dag is outside the watchdog's tick set, so nothing retries — a cancelled ctx here
	// would strand the run exactly as the missing lead did.
	if err := wstore.UpdateRun(context.WithoutCancel(ctx), dag.ChannelId, run.ID, func(r *waveobj.Run) error {
		completedIdx = jarvis.RunningPhaseIndex(*r)
		next, e := jarvis.CompletePhase(*r, completedIdx, nil, ts)
		if e != nil {
			return e
		}
		if endCommit != "" {
			next.EndCommit = endCommit
		}
		*r = next
		return nil
	}); err != nil {
		log.Printf("complete lead-free run %s: %v", run.ID, err)
		return false
	}
	if fresh, err := wstore.GetRun(ctx, dag.ChannelId, run.ID); err == nil {
		*run = *fresh
	}
	appendRunEvent(ctx, dag.ChannelId, run.ID, waveobj.RunEventKindPhaseComplete, &completedIdx, map[string]any{"commit": endCommit, "source": "engine"})
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Run, run.ID))
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, dag.ChannelId))
	SealRunEvidenceHook(dag.ChannelId, run.ID)
	return true
}

// allTasksTerminal reports whether no task is still active — a dag status claiming done can be a stale
// snapshot, so both close paths check the tasks themselves.
func allTasksTerminal(dag *waveobj.TaskGroup) bool {
	for _, t := range dag.Tasks {
		switch t.State {
		case TaskState_Done, TaskState_Skipped, TaskState_Failed, TaskState_Cancelled:
			continue
		default:
			return false
		}
	}
	return true
}
