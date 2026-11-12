// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"fmt"
	"log"
	"slices"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// interruptedNote is why a non-dag run found running at boot stopped.
const interruptedNote = "the app stopped while the worker was running"

// MarkInterruptedRuns fails the running phase of every non-dag run that was executing when wavesrv last
// stopped, then resumes it in its own session. Neither a quit nor a crash reaches HandleRunWorkerExit, and every
// worker is a child of the previous wavesrv, so at boot none of them can be alive: without this the run reads
// executing forever, and without the resume it sat blocked until someone noticed. Dag runs are the watchdog's,
// except the ones their dag never recorded (cancelOrphanedDagRun). Call before StartWatchdog; a run that fails to
// reconcile is logged and skipped.
func MarkInterruptedRuns(ctx context.Context) {
	runs, err := wstore.GetRunsByStatus(ctx, jarvis.RunStatus_Executing, jarvis.RunStatus_Planning)
	if err != nil {
		log.Printf("listing runs to mark interrupted: %v", err)
		return
	}
	for _, run := range runs {
		// a paused run's workers were suspended, not killed by the stop: the resume reopens them (runpause.ResumeAtBoot)
		if jarvis.RunPaused(run) {
			continue
		}
		if run.DagORef != "" {
			cancelOrphanedDagRun(ctx, run)
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

// cancelOrphanedDagRun cancels a dag's run that neither its owner nor any task, reviewer, plan reviewer, final
// verifier or the land resolver of the owner's land names. A tick records each child run before it starts its worker
// but commits the dag at the end of the batch, so a quit in between leaves runs the dag never took: the watchdog sees
// only the runs its tasks name, and the tick dispatches those tasks again. Its tab is disarmed too, or a resync
// starts a second worker for the task. A land resolver is the land driver's (tendResolver), which holds the land
// when it ends without a merge.
func cancelOrphanedDagRun(ctx context.Context, run *waveobj.Run) {
	if jarvis.RunPaused(run) {
		return
	}
	g, err := wstore.GetDag(ctx, run.DagORef)
	if err != nil {
		log.Printf("run %s: reading its dag %s at boot: %v", run.ID, run.DagORef, err)
		return
	}
	if run.ID == g.RunID || slices.Contains(childRunIDs(g), run.ID) {
		return
	}
	owner, err := wstore.GetRun(ctx, run.ChannelOID, g.RunID)
	if err != nil {
		// without the owner there is no telling whether its land names this run
		log.Printf("run %s: reading the owner %s of its dag %s at boot: %v", run.ID, g.RunID, g.OID, err)
		return
	}
	if owner.Land != nil && owner.Land.Resolver == run.ID {
		return
	}
	if err := wstore.UpdateRun(ctx, run.ChannelOID, run.ID, func(r *waveobj.Run) error {
		*r = jarvis.CancelRun(*r)
		return nil
	}); err != nil {
		log.Printf("cancelling run %s, which dag %s never recorded: %v", run.ID, g.OID, err)
		return
	}
	if err := stopRunWorkers(ctx, run); err != nil {
		log.Printf("stopping the worker of run %s, which dag %s never recorded: %v", run.ID, g.OID, err)
	}
	sendRunUpdates(run.ChannelOID, run.ID)
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
		// a paused lead has no controller by design: the resume reopens it, not this boot pass
		if run.Mode != jarvis.RunMode_Orchestrator || run.DagORef == "" || run.SessionId == "" || jarvis.RunPaused(run) || !workerControllerGone(ctx, run) {
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

// resumeRefusal is why a run's failed phase cannot be resumed, or "" when it can. A closed worker tab is no
// refusal: the worker resumes in a new one.
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

// ResumeRun puts a failed phase back to running and restarts its worker in its own session: in its tab, or in a
// new one when its tab was closed. The phase is running before the worker starts, so a worker that exits at once,
// or never starts, fails it again through the exit hook like any other exit; a restart that errors outright is
// rolled back to failed.
func ResumeRun(ctx context.Context, channelId, runId string, phaseIdx int) error {
	var run waveobj.Run
	err := wstore.UpdateRun(ctx, channelId, runId, func(r *waveobj.Run) error {
		if reason := resumeRefusal(r, phaseIdx); reason != "" {
			return errors.New(reason)
		}
		next, e := jarvis.ResumePhase(*r, phaseIdx)
		if e != nil {
			return e
		}
		*r = next
		run = next
		return nil
	})
	if err != nil {
		return fmt.Errorf("cannot resume run %s: %w", runId, err)
	}
	workers := run.Phases[phaseIdx].WorkerOrefs
	worker := workers[len(workers)-1]
	var rerr error
	if workerTabGone(ctx, worker) {
		rerr = resumeInNewTab(ctx, &run, phaseIdx, worker, jarvis.ResumeNudge)
	} else {
		rerr = jarvis.ResumeRunWorker(ctx, worker, run.Runtime, run.SessionId, jarvis.ResumeNudge)
	}
	if rerr != nil {
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

// workerTabGone reports a worker tab that no longer exists. An oref that names no tab is not gone: the restart
// reports it.
func workerTabGone(ctx context.Context, workerORef string) bool {
	oref, err := waveobj.ParseORef(workerORef)
	if err != nil || oref.OType != waveobj.OType_Tab {
		return false
	}
	tab, err := wstore.DBGet[*waveobj.Tab](ctx, oref.OID)
	return err == nil && tab == nil
}

// resumeInNewTab resumes a worker whose tab was closed in a new tab, which takes the closed one's place on the
// phase and carries the run's owner stamp before it starts, so the resumed agent's wsh calls resolve to its run.
func resumeInNewTab(ctx context.Context, run *waveobj.Run, phaseIdx int, closed, nudge string) error {
	// a tab is created, so a caller's short RPC budget must not cancel it half-made
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), jarvis.RunWorkerSpawnTimeout)
	defer cancel()
	cap, err := runroute.Resolve(waveobj.RoutePin{Runtime: runroute.DefaultRuntime(run.Runtime), Model: run.Model})
	if err != nil {
		return err
	}
	ch, err := wstore.DBMustGet[*waveobj.Channel](ctx, run.ChannelOID)
	if err != nil {
		return fmt.Errorf("loading channel: %w", err)
	}
	// a lead's tab must outlive its process while the dag's children run, as the first spawn keeps it
	// (jarvis.EnsureWorkers); without it every pause/resume of the lead makes yet another tab
	opts := jarvis.RunWorkerOptions{KeepOnExit: run.Mode == jarvis.RunMode_Orchestrator, RunId: run.ID}
	tabORef, err := jarvis.SpawnRunWorker(ctx, cap, run.WorkspaceId, ch.Name, jarvis.LandPath(run), nudge, opts)
	if err != nil {
		return err
	}
	if err := wstore.UpdateRun(ctx, run.ChannelOID, run.ID, func(r *waveobj.Run) error {
		workers := r.Phases[phaseIdx].WorkerOrefs
		if i := slices.Index(workers, closed); i >= 0 {
			workers[i] = tabORef
			return nil
		}
		return fmt.Errorf("its closed tab %s is no longer the phase's worker", closed)
	}); err != nil {
		return err
	}
	runORef := waveobj.MakeORef(waveobj.OType_Run, run.ID).String()
	channelORef := waveobj.MakeORef(waveobj.OType_Channel, run.ChannelOID).String()
	if err := wstore.StampWorkerOwner(ctx, tabORef, runORef, channelORef); err != nil {
		return err
	}
	return jarvis.ResumeRunWorker(ctx, tabORef, run.Runtime, run.SessionId, nudge)
}
