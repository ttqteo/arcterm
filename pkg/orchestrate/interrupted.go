// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// interruptedNote is why a non-dag run found running at boot stopped.
const interruptedNote = "the app stopped while the worker was running"

// MarkInterruptedRuns fails the running phase of every non-dag run that was executing when wavesrv last
// stopped, then resumes it in its own session. Neither a quit nor a crash reaches HandleRunWorkerExit, and every
// worker is a child of the previous wavesrv, so at boot none of them can be alive: without this the run reads
// executing forever, and without the resume it sat blocked until someone noticed. Dag runs are the watchdog's.
// Call before StartWatchdog; a run that fails to reconcile is logged and skipped.
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
		phaseIdx, _, err := failRunningPhase(ctx, run.ChannelOID, run.ID, func(workers []string) bool {
			// a running phase with no worker was never launched, so nothing was interrupted
			return len(workers) > 0
		})
		if err != nil {
			log.Printf("marking run %s interrupted: %v", run.ID, err)
			continue
		}
		if phaseIdx < 0 {
			continue
		}
		appendRunEvent(ctx, run.ChannelOID, run.ID, waveobj.RunEventKindInterrupted, nil, map[string]any{"reason": interruptedNote})
		sendRunUpdates(run.ChannelOID, run.ID)
		// failed first so the log shows the interruption; a run that cannot come back stays blocked for the human
		if err := ResumeRun(ctx, run.ChannelOID, run.ID, phaseIdx); err != nil {
			log.Printf("run %s stays blocked: %v", run.ID, err)
		}
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

// resumeRefusal is why a run's failed phase cannot be resumed, or "" when it can. The worker's tab is
// checked by the restart itself.
func resumeRefusal(run *waveobj.Run, phaseIdx int) string {
	switch {
	case run.DagORef != "":
		return "a run with a submitted plan is the engine's to restart"
	case phaseIdx < 0 || phaseIdx >= len(run.Phases):
		return fmt.Sprintf("phase index %d out of range", phaseIdx)
	case run.Phases[phaseIdx].State != jarvis.PhaseState_Failed:
		return fmt.Sprintf("phase %d is %q, not failed", phaseIdx, run.Phases[phaseIdx].State)
	case len(run.Phases[phaseIdx].WorkerOrefs) == 0:
		return "the phase never had a worker"
	case run.SessionId == "":
		return "the run has no session to resume"
	}
	if _, ok := jarvis.ResumeWorkerArgs(run.Runtime, run.SessionId, nil, jarvis.ResumeNudge); !ok {
		return fmt.Sprintf("runtime %q cannot resume a session", run.Runtime)
	}
	return ""
}

// ResumeRun puts a failed phase back to running and restarts its worker in its own session and tab. The phase
// is running before the worker starts, so a worker that exits at once, or never starts, fails it again through
// the exit hook like any other exit; a restart that errors outright is rolled back to failed.
func ResumeRun(ctx context.Context, channelId, runId string, phaseIdx int) error {
	var worker, runtime, sessionId string
	err := wstore.UpdateRun(ctx, channelId, runId, func(r *waveobj.Run) error {
		if reason := resumeRefusal(r, phaseIdx); reason != "" {
			return errors.New(reason)
		}
		workers := r.Phases[phaseIdx].WorkerOrefs
		worker, runtime, sessionId = workers[len(workers)-1], r.Runtime, r.SessionId
		next, e := jarvis.ResumePhase(*r, phaseIdx)
		if e != nil {
			return e
		}
		*r = next
		return nil
	})
	if err != nil {
		return fmt.Errorf("cannot resume run %s: %w", runId, err)
	}
	if rerr := jarvis.ResumeRunWorker(ctx, worker, runtime, sessionId, jarvis.ResumeNudge); rerr != nil {
		if err := wstore.UpdateRun(ctx, channelId, runId, func(r *waveobj.Run) error {
			if r.Phases[phaseIdx].State != jarvis.PhaseState_Running {
				return nil // the exit hook already failed it
			}
			next, e := jarvis.FailPhase(*r, phaseIdx, time.Now().UnixMilli())
			if e != nil {
				return e
			}
			*r = next
			return nil
		}); err != nil {
			log.Printf("resume: rolling back run %s phase %d: %v", runId, phaseIdx, err)
		}
		sendRunUpdates(channelId, runId)
		return fmt.Errorf("resuming run %s: %w", runId, rerr)
	}
	appendRunEvent(ctx, channelId, runId, waveobj.RunEventKindWorkerResumed, &phaseIdx, map[string]any{})
	sendRunUpdates(channelId, runId)
	return nil
}
