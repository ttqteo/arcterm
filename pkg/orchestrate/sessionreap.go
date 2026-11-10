// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"log"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// finishedSessions are runs whose work is over but whose session may still sit at its prompt, by run id to
// channel id: a lead whose run closed while it was mid-turn, a plan reviewer or a final verifier that gave its
// verdict, a task's worker once it reported done, a task's reviewer once its verdict applied. A claude session never exits on its own, and once its dag stops nothing ticks it again, so the watchdog
// collects each tab when its turn is over. A session that lived in a run's landing tree held that tree as its
// working directory, which is why landed runs left their tree behind.
var finishedSessions = struct {
	sync.Mutex
	byRun map[string]string
}{byRun: map[string]string{}}

func queueFinishedSession(channelID, runID string) {
	if channelID == "" || runID == "" {
		return
	}
	finishedSessions.Lock()
	finishedSessions.byRun[runID] = channelID
	finishedSessions.Unlock()
}

func dropFinishedSession(runID string) {
	finishedSessions.Lock()
	delete(finishedSessions.byRun, runID)
	finishedSessions.Unlock()
}

// queueFinishedWorkers queues the worker of each task that DeriveTaskStates just moved off a live worker to review or
// done: its run is complete, and nothing types into it again (a failed review spawns a new worker), but a claude
// session sits at its prompt holding its memory until its lane's tree is removed, which for a lane a later task
// continues is when the whole lane lands.
func queueFinishedWorkers(g *waveobj.TaskGroup, runs map[string]*waveobj.Run, prevStates map[string]string, afterCommit *[]func()) {
	channelID := g.ChannelId
	for i := range g.Tasks {
		t := &g.Tasks[i]
		if !taskActive(prevStates[t.ID]) || (t.State != TaskState_Reviewing && t.State != TaskState_Done) {
			continue
		}
		if r := runs[t.RunID]; r != nil && r.Status == jarvis.RunStatus_Done {
			runID := r.ID
			*afterCommit = append(*afterCommit, func() { queueFinishedSession(channelID, runID) })
		}
	}
}

// reapFinishedSessions closes the tab of each queued session whose run is over and whose turn is over, or for a
// task's session stops its process and keeps the tab. One whose
// tab is gone, or whose run cannot be read, leaves the queue; one still working stays for the next tick.
func reapFinishedSessions(ctx context.Context, now int64) {
	finishedSessions.Lock()
	queued := make(map[string]string, len(finishedSessions.byRun))
	for runID, channelID := range finishedSessions.byRun {
		queued[runID] = channelID
	}
	finishedSessions.Unlock()
	for runID, channelID := range queued {
		run, err := wstore.GetRun(ctx, channelID, runID)
		if err != nil || !sessionTabOpen(ctx, run) {
			dropFinishedSession(runID)
			continue
		}
		if !sessionRunOver(ctx, run) || !sessionTurnOver(ctx, run, now) {
			continue
		}
		// a task's session is stopped, not closed: its tab and scrollback stay for the run view until the run
		// closes (CloseRunWorkerTabs). Its tab stays open, so it leaves the queue here, stopped or not.
		if taskSession(run) {
			if err := stopRunWorkers(ctx, run); err != nil {
				log.Printf("run %s: stopping its finished task session: %v", runID, err)
			}
			dropFinishedSession(runID)
			continue
		}
		if _, err := closeLeadTab(ctx, run); err != nil {
			log.Printf("run %s: closing its finished session's tab: %v", runID, err)
			continue
		}
		dropFinishedSession(runID)
	}
}

// taskSession reports a task's worker or reviewer: a dag child run that works on a task, as opposed to a lead or a
// stage session (plan reviewer, final verifier), which carry no task.
func taskSession(run *waveobj.Run) bool {
	return run.TaskId != "" && run.StageRole == ""
}

// sessionTabOpen reports whether the tab a run's session runs in still exists.
func sessionTabOpen(ctx context.Context, run *waveobj.Run) bool {
	tabID := runTabID(run)
	if tabID == "" {
		return false
	}
	tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabID)
	return err == nil && tab != nil
}

// sessionRunOver reports a run whose session has nothing left to do: a stage session's run done or cancelled, a
// lead's run as ShouldCloseOrchestratorLead judges it.
func sessionRunOver(ctx context.Context, run *waveobj.Run) bool {
	if run.StageRole != "" || taskSession(run) {
		return run.Status == jarvis.RunStatus_Done || run.Status == jarvis.RunStatus_Cancelled
	}
	var dag *waveobj.TaskGroup
	if run.DagORef != "" {
		g, err := wstore.GetDag(ctx, run.DagORef)
		if err != nil {
			return false
		}
		dag = g
	}
	return ShouldCloseOrchestratorLead(run, dag)
}
