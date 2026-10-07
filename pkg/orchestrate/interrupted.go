// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"log"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// interruptedNote is why a non-dag run found running at boot stopped.
const interruptedNote = "the app stopped while the worker was running"

// MarkInterruptedRuns fails the running phase of every non-dag run that was executing when wavesrv last
// stopped. Neither a quit nor a crash reaches HandleRunWorkerExit, and every worker is a child of the previous
// wavesrv, so at boot none of them can be alive: without this the run reads executing forever. Dag runs are
// the watchdog's. Call before StartWatchdog; a run that fails to reconcile is logged and skipped.
func MarkInterruptedRuns(ctx context.Context) {
	runs, err := wstore.GetRunsByStatus(ctx, jarvis.RunStatus_Executing, jarvis.RunStatus_Planning)
	if err != nil {
		log.Printf("listing runs to mark interrupted: %v", err)
		return
	}
	for _, run := range runs {
		if run.DagORef != "" {
			continue
		}
		failed, _, err := failRunningPhase(ctx, run.ChannelOID, run.ID, func(workers []string) bool {
			// a running phase with no worker was never launched, so nothing was interrupted
			return len(workers) > 0
		})
		if err != nil {
			log.Printf("marking run %s interrupted: %v", run.ID, err)
			continue
		}
		if !failed {
			continue
		}
		appendRunEvent(ctx, run.ChannelOID, run.ID, waveobj.RunEventKindInterrupted, nil, map[string]any{"reason": interruptedNote})
		sendRunUpdates(run.ChannelOID, run.ID)
	}
}

// leadResumeNudge is a lead's first turn after the app restarted under it. The worker nudge would send it
// back to "the task", and a lead that thinks it is picking its own work up again re-dispatches the dag's.
const leadResumeNudge = "The app restarted while your run was going, and your process stopped with it. The dag kept running without you, so do not resubmit the plan or redispatch tasks. Start with `wsh jarvis dag status`."

// ResumeInterruptedLeads restarts, in its own tab and session, the lead of every dag run that was going when
// wavesrv last stopped. The watchdog picks a dag's workers back up by itself, but nothing owned the lead: its
// tab outlived its process, and the first wake found it dead and handed the run's judgment to the human. A
// lead that cannot be resumed is logged and left to that path. Call before StartWatchdog, whose first tick
// can post a wake.
func ResumeInterruptedLeads(ctx context.Context) {
	runs, err := wstore.GetRunsByStatus(ctx, jarvis.RunStatus_Executing, jarvis.RunStatus_Planning)
	if err != nil {
		log.Printf("listing runs to resume their leads: %v", err)
		return
	}
	for _, run := range runs {
		// a dag's task runs carry its DagORef too, and the watchdog restarts those
		if run.Mode != jarvis.RunMode_Orchestrator || run.DagORef == "" || run.SessionId == "" || !workerControllerGone(ctx, run) {
			continue
		}
		if err := jarvis.ResumeRunWorker(ctx, "tab:"+runTabID(run), run.Runtime, run.SessionId, leadResumeNudge); err != nil {
			log.Printf("resuming run %s's lead: %v", run.ID, err)
			continue
		}
		wakes.leadRestarted(run.ChannelOID, run.ID)
		appendRunEvent(ctx, run.ChannelOID, run.ID, waveobj.RunEventKindLeadLaunched, nil, map[string]any{"text": leadResumeNudge})
	}
}
