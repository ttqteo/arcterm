package orchestrate

import (
	"context"
	"fmt"
	"log"
	"slices"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

var workerOwnerOf = wstore.GetWorkerOwner

func init() {
	jarvis.ChildOutcomeHook = HandleChildOutcome
	jarvis.RunWorkerExitHook = HandleRunWorkerExit
	wcore.WorkerTabCloseHook = HandleWorkerTabClose
}

// HandleChildOutcome reacts to a dag child's worker process exiting. A "failed" outcome is classified
// and retried or counted. A "done" outcome matters too: the contract asks the child to run
// `wsh jarvis complete` before exiting, and a child that exited without doing so has not completed —
// noticing that here costs seconds, whereas waiting for the transcript to go quiet costs
// StallThreshold. "waiting" (blocked on an ask) is left alone; the ask machinery owns it.
func HandleChildOutcome(ctx context.Context, workerORef string, data jarvis.OutcomeData) error {
	if data.Status != "failed" && data.Status != "done" {
		return nil
	}
	// the exit's context bounds its own reads; this waits on the dag lock, which a merge's cleanup or a spawn's
	// Setup can hold for longer, and an outcome lost there leaves a failed worker running until the stall watchdog
	ctx = context.WithoutCancel(ctx)
	channelId, runId, err := workerRunIds(ctx, workerORef)
	if err != nil || runId == "" {
		return err
	}
	run, err := wstore.GetRun(ctx, channelId, runId)
	if err != nil {
		return fmt.Errorf("loading child run %s: %w", runId, err)
	}
	if run.DagORef == "" {
		return nil
	}
	// a suspended worker's exit is not an outcome: the pause marked it before it stopped anything
	if runUnderPause(ctx, run) {
		return nil
	}
	poke := false
	err = withDagMutation(run.DagORef, func() error {
		g, err := wstore.GetDag(ctx, run.DagORef)
		if err != nil {
			return fmt.Errorf("loading dag for child outcome: %w", err)
		}
		// re-read under the lock: a pause that landed while this waited for it
		if dagPaused(g) {
			return nil
		}
		task := taskByRunID(g, run.ID)
		if task == nil {
			// a reviewer's exit: judge now whether it left a verdict, not at the watchdog's next pass
			poke = taskByReviewRunID(g, run.ID) != nil
			return nil
		}
		if !taskActive(task.State) {
			return nil
		}
		// re-read inside the lock: the child's `wsh jarvis complete` is a synchronous RPC that
		// lands just before the process exits, so a snapshot taken before the lock can race it.
		fresh, ferr := wstore.GetRun(ctx, g.ChannelId, run.ID)
		if ferr != nil {
			return fmt.Errorf("re-loading child run %s: %w", run.ID, ferr)
		}
		// a skip or retry cancels the run, then stops its worker outside this lock: the exit that stop causes is
		// the action's to record, not a failure to retry
		if fresh.Status == jarvis.RunStatus_Cancelled {
			return nil
		}
		kind := classifyFailure(data.Summary, data.ExitCode)
		if data.Status == "done" {
			// Anything but a still-active run means the exit was accounted for (completed, already blocked) and
			// there is nothing to record.
			if fresh.Status != jarvis.RunStatus_Executing && fresh.Status != jarvis.RunStatus_Planning {
				return nil
			}
			// the summary of a clean exit describes the work, not a fault — never classify it
			kind = FailureKindWorkerExit
		}
		task.LastFailureKind = kind
		mayRetry := retryDecision(kind, task.Attempts)
		task.Attempts++
		attempt := task.Attempts
		task.State = TaskState_Failed
		// a recoverable flake is retried, not a genuine failure: it must not push the streak
		// toward the circuit-break, or n concurrent one-shot flakes (plus any manual failure)
		// would block the DAG though every flake auto-recovers. only terminal failures count.
		if !mayRetry {
			g.Failures++
		}
		if mayRetry {
			// RetryTask clears the run id, after which no task names the run: still executing, the dag's cancel
			// (childRunIDs) and the exit hook (which skips dag children) would never reach it. Its worker has exited.
			if _, err := cancelTaskRun(ctx, g, task); err != nil {
				return err
			}
			if err := RetryTask(g, task.ID); err != nil {
				return err
			}
		}
		g.UpdatedTs = time.Now().UnixMilli()
		RecomputeDagStatus(g)
		if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
			*cur = *g
			return nil
		}); err != nil {
			return err
		}
		// emit only after the persist lands so the event never describes state the store rejected
		if mayRetry {
			detail := map[string]any{"taskid": task.ID, "kind": kind, "attempt": attempt}
			publishDagEvent(DagEventTaskRetried, g, task.ID)
			appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindTaskRetried, nil, detail)
		} else {
			// a clean exit's summary describes the work, not what went wrong
			why := data.Summary
			if data.Status == "done" {
				why = ""
			}
			PostWake(ctx, g.ChannelId, g.RunID, taskFailedWake(task.ID, kind, why))
		}
		poke = true
		return nil
	})
	if err != nil || !poke {
		return err
	}
	return runTick(ctx, run.DagORef)
}

// workerRunIds resolves the channel and run a worker tab was spawned for; empty ids for a tab no run owns.
func workerRunIds(ctx context.Context, workerORef string) (string, string, error) {
	runORef, channelORef, err := workerOwnerOf(ctx, workerORef)
	if err != nil {
		return "", "", fmt.Errorf("resolving owner for worker %s: %w", workerORef, err)
	}
	if runORef == "" || channelORef == "" {
		return "", "", nil
	}
	runRef, err := waveobj.ParseORef(runORef)
	if err != nil || runRef.OType != waveobj.OType_Run {
		return "", "", fmt.Errorf("worker %s has invalid run oref %q", workerORef, runORef)
	}
	channelRef, err := waveobj.ParseORef(channelORef)
	if err != nil || channelRef.OType != waveobj.OType_Channel {
		return "", "", fmt.Errorf("worker %s has invalid channel oref %q", workerORef, channelORef)
	}
	return channelRef.OID, runRef.OID, nil
}

// closeLeadTabOnExit collects the lead's tab once its process is gone, for a run that is already
// terminal. A non-orchestrator run and a still-running one are both no-ops, so every other exit that
// lands in the hook passes straight through.
func closeLeadTabOnExit(ctx context.Context, run *waveobj.Run) {
	var dag *waveobj.TaskGroup
	if run.DagORef != "" {
		g, err := wstore.GetDag(ctx, run.DagORef)
		if err != nil {
			return // the dag decides whether children still need the tab; unreadable means leave it
		}
		dag = g
	}
	if _, err := CloseOrchestratorLeadOnExit(ctx, run, dag); err != nil {
		log.Printf("closing lead tab for run %s: %v", run.ID, err)
	}
}

// leadExitedNote is why an orchestrator run whose lead exited before submitting a plan stopped (spec §2, G8).
const leadExitedNote = "lead exited before submitting a plan"

// workerExitedNote is why a quick or pipeline run whose worker exited without completing its phase stopped.
const workerExitedNote = "worker exited before completing its phase"

// leadTabClosedNote and workerTabClosedNote are the same stops, by a close of the agent's tab.
const (
	leadTabClosedNote   = "lead's tab was closed before it submitted a plan"
	workerTabClosedNote = "worker's tab was closed before it completed its phase"
)

// HandleRunWorkerExit fails a non-dag run whose worker exits without completing the phase it was running:
// nothing else will move the run, and the human needs to see why it stopped. It covers every run mode that
// has no dag of its own to reconcile the exit for it:
//   - orchestrator: a lead that exits before submitting a plan (spec §2, G8). A lead that already submitted
//     leaves its dag running — DagORef is set, so this is a no-op — and the wake adapter hands judgment to
//     the human instead.
//   - quick / pipeline: the run's only worker exits before running `wsh jarvis complete`. Nothing else
//     reconciles these modes (F26): a dag child's exit is HandleChildOutcome's job, not this one.
func HandleRunWorkerExit(ctx context.Context, workerORef string, exit jarvis.WorkerExit) error {
	channelId, runId, err := workerRunIds(ctx, workerORef)
	if err != nil || runId == "" {
		return err
	}
	// every agent tab exit lands here, dag children included; only a run with no dag is worth a write
	run, err := wstore.GetRun(ctx, channelId, runId)
	if err != nil {
		return fmt.Errorf("loading run %s: %w", runId, err)
	}
	// before anything is recorded or closed: a worker the pause suspended exits like a failed one, and is neither. Its
	// lead's tab is not collected either: the resume reopens it
	if runUnderPause(ctx, run) {
		return nil
	}
	recordWorkerOutput(ctx, run, workerORef, exit)
	// before the dag early-return, because a lead's tab has to be collected in both shapes: a bounded
	// run reaches no other close site at all, and a dag run whose lead was still mid-turn when the dag
	// went terminal was deliberately skipped there for this moment. Best-effort, never fails the exit.
	closeLeadTabOnExit(ctx, run)
	if run.DagORef != "" {
		// a dag run's lead that exits is the waker's to hand over: nothing else notices it while the dag waits on it
		if isRunLeadTab(run, workerORef) {
			LeadExited(ctx, channelId, runId)
		}
		return nil
	}
	return failWorkerPhase(ctx, channelId, runId, workerORef, workerExitedNote, leadExitedNote)
}

// HandleWorkerTabClose fails a non-dag run whose worker's tab is closing, as HandleRunWorkerExit does when the
// worker exits: the close deletes the block before the process ends, so that exit finds no run to fail. A dag
// child's closed tab is the watchdog's, which reads a missing tab as a gone worker. Best-effort: a failure is
// logged and never stops the close.
func HandleWorkerTabClose(ctx context.Context, tabId string) {
	workerORef := waveobj.MakeORef(waveobj.OType_Tab, tabId).String()
	channelId, runId, err := workerRunIds(ctx, workerORef)
	if err == nil && runId != "" {
		// a suspended worker's tab closed by hand: the run stays paused, and its resume reopens it in a new tab
		if run, gerr := wstore.GetRun(ctx, channelId, runId); gerr == nil && runUnderPause(ctx, run) {
			return
		}
		err = failWorkerPhase(ctx, channelId, runId, workerORef, workerTabClosedNote, leadTabClosedNote)
	}
	if err != nil {
		log.Printf("closing worker tab %s: %v", tabId, err)
	}
}

// failWorkerPhase fails the run's running phase when workerORef works it, recording why with the worker's note,
// or the lead's on an orchestrator run.
func failWorkerPhase(ctx context.Context, channelId, runId, workerORef, workerNote, leadNote string) error {
	phaseIdx, mode, err := failRunningPhase(ctx, channelId, runId, func(workers []string) bool {
		// a worker that stopped belongs to an earlier or later phase's roster; only the phase actually
		// running when it stopped is this stop's to fail
		return slices.Contains(workers, workerORef)
	})
	if err != nil || phaseIdx < 0 {
		return err
	}
	kind, reason := waveobj.RunEventKindWorkerExited, workerNote
	if mode == jarvis.RunMode_Orchestrator {
		kind, reason = waveobj.RunEventKindLeadExited, leadNote
	}
	appendRunEvent(ctx, channelId, runId, kind, nil, map[string]any{"reason": reason})
	sendRunUpdates(channelId, runId)
	return nil
}

// recordWorkerOutput keeps what a worker printed before it failed, in the log and on its own run: its tab
// closes itself with the exit and takes the terminal with it. Only an exit nobody asked for is kept: a worker
// the engine stopped also exits non-zero, after its run was closed.
func recordWorkerOutput(ctx context.Context, run *waveobj.Run, workerORef string, exit jarvis.WorkerExit) {
	if exit.ExitCode == 0 || (run.Status != jarvis.RunStatus_Executing && run.Status != jarvis.RunStatus_Planning) {
		return
	}
	log.Printf("run %s: worker %s exited with code %d: %q", run.ID, workerORef, exit.ExitCode, exit.Output)
	appendRunEvent(ctx, run.ChannelOID, run.ID, waveobj.RunEventKindWorkerOutput, nil, map[string]any{
		"exitcode": exit.ExitCode, "output": exit.Output, "worker": workerORef,
	})
}

// failRunningPhase fails a non-dag run's running phase when owns accepts that phase's workers, returning
// the phase it failed (-1 when it did not) and the run's mode. Decided under the update: a submit or a
// completion that lands first wins.
func failRunningPhase(ctx context.Context, channelId, runId string, owns func(workers []string) bool) (int, string, error) {
	failed := -1
	var mode string
	err := wstore.UpdateRun(ctx, channelId, runId, func(cur *waveobj.Run) error {
		failed = -1
		mode = cur.Mode
		if cur.DagORef != "" {
			return nil
		}
		if cur.Status != jarvis.RunStatus_Executing && cur.Status != jarvis.RunStatus_Planning {
			return nil
		}
		i := jarvis.RunningPhaseIndex(*cur)
		if i < 0 || !owns(cur.Phases[i].WorkerOrefs) {
			return nil
		}
		updated, ferr := jarvis.FailPhase(*cur, i, time.Now().UnixMilli())
		if ferr != nil {
			return ferr
		}
		*cur = updated
		failed = i
		return nil
	})
	return failed, mode, err
}

func sendRunUpdates(channelId, runId string) {
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Run, runId))
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, channelId))
}

func taskByRunID(g *waveobj.TaskGroup, runID string) *waveobj.TaskNode {
	for i := range g.Tasks {
		if g.Tasks[i].RunID == runID {
			return &g.Tasks[i]
		}
	}
	return nil
}
