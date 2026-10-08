// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/util/keyedmutex"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

var dagMutationLocks = keyedmutex.New()

// WithDagMutation serializes every read-modify-write of one DAG. The engine's scheduling write is a
// whole-object replace of a snapshot loaded under this lock, so any writer that skips it has its
// changes silently reverted by an overlapping tick. Exported because the merge handlers live in
// wshserver (which imports this package) and are dag writers too. Not reentrant. Work on a tree or a process
// (a Setup aside) runs outside it, and only its result is recorded under it: a hold of tens of seconds makes
// every exit it causes wait.
func WithDagMutation(dagID string, fn func() error) error {
	if dagID == "" {
		return fmt.Errorf("dag id is required")
	}
	dagMutationLocks.Lock(dagID)
	defer dagMutationLocks.Unlock(dagID)
	return fn()
}

// TryWithDagMutation runs fn only if the dag's lock is free, reporting whether it ran. For a write with
// nothing to gain by waiting: the plan's Setup command holds this lock for up to SetupTimeout, and a
// cosmetic write that queues behind it delays whatever its own caller does next.
func TryWithDagMutation(dagID string, fn func() error) (bool, error) {
	if dagID == "" {
		return false, fmt.Errorf("dag id is required")
	}
	if !dagMutationLocks.TryLock(dagID) {
		return false, nil
	}
	defer dagMutationLocks.Unlock(dagID)
	return true, fn()
}

func withDagMutation(dagID string, fn func() error) error {
	return WithDagMutation(dagID, fn)
}

var stopRunWorkers = jarvis.StopRunWorkers
var withMutationTx = wstore.WithTx

const cancelCleanupTimeout = 10 * time.Second

func childRunIDs(g *waveobj.TaskGroup) []string {
	var out []string
	for i := range g.Tasks {
		if g.Tasks[i].RunID != "" {
			out = append(out, g.Tasks[i].RunID)
		}
		// a live reviewer is a child too: cancelling the dag must stop it
		if g.Tasks[i].ReviewRunID != "" {
			out = append(out, g.Tasks[i].ReviewRunID)
		}
	}
	if g.PlanReview != nil && g.PlanReview.RunID != "" {
		out = append(out, g.PlanReview.RunID)
	}
	if g.Final != nil && g.Final.VerifierRunID != "" {
		out = append(out, g.Final.VerifierRunID)
	}
	return out
}

// taskActions serializes the actions on one dag's tasks and holds its ticks off while an action works outside
// the dag lock. Such an action has cancelled a worker's run and not yet recorded why: a tick in that gap would
// derive the task cancelled, or dispatch into the lane being rewound. Taken before the dag lock, never under it;
// a tick, which runs under the dag lock, only tries it.
var taskActions = keyedmutex.New()

func ApplyAction(ctx context.Context, dagID, taskID, action string, target waveobj.RoutePin) error {
	if err := applyAction(ctx, dagID, taskID, action, target); err != nil {
		return err
	}
	// after the action let go of the dag's ticks: this one covers every tick it turned away
	return Schedule(ctx, dagID)
}

func applyAction(ctx context.Context, dagID, taskID, action string, target waveobj.RoutePin) error {
	taskActions.Lock(dagID)
	defer taskActions.Unlock(dagID)
	var prep *taskPrep
	if err := withDagMutation(dagID, func() error {
		var err error
		prep, err = prepareActionLocked(ctx, dagID, taskID, action, target)
		return err
	}); err != nil {
		return err
	}
	if prep != nil {
		// the worker's run is cancelled by now, so the action finishes whether or not its caller still waits
		ctx = context.WithoutCancel(ctx)
		if err := prep.run(ctx); err != nil {
			return err
		}
	}
	if err := withDagMutation(dagID, func() error {
		if err := prep.checkUnmoved(ctx, dagID, taskID); err != nil {
			return err
		}
		return applyActionLocked(ctx, dagID, taskID, action, target)
	}); err != nil {
		return err
	}
	return prep.closeWorkerTab(ctx, taskID)
}

// taskPrep is the slow half of a skip, retry or escalate: stopping the task's worker and rewinding its lane. It is
// decided under the dag lock and run outside it, because each stopped worker exits into HandleChildOutcome, which
// takes that lock, and removing a lane's tree takes tens of seconds.
type taskPrep struct {
	// the task as the locked half found it; the action is not recorded on a task that moved since
	state, runID string
	// the task's cancelled worker run, nil when it has none to stop
	stop *waveobj.Run
	// takes the task's commits off its lane, after the stop so the worker cannot commit behind it
	rewind func(context.Context) error
	// stop only: close the stopped worker's tab, once the task is recorded
	closeTab bool
}

func (p *taskPrep) run(ctx context.Context) error {
	if p.stop != nil {
		if err := stopRunWorkers(ctx, p.stop); err != nil {
			return fmt.Errorf("stopping old run %s: %w", p.stop.ID, err)
		}
	}
	if p.rewind != nil {
		return p.rewind(ctx)
	}
	return nil
}

// checkUnmoved refuses to record an action on a task that changed while its worker was stopped. A cancelled dag is
// left for applyActionLocked to name. The caller holds the dag lock.
func (p *taskPrep) checkUnmoved(ctx context.Context, dagID, taskID string) error {
	if p == nil {
		return nil
	}
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		return fmt.Errorf("loading dag: %w", err)
	}
	if task := taskByID(g, taskID); g.Status != DagStatus_Cancelled && (task == nil || task.State != p.state || task.RunID != p.runID) {
		return fmt.Errorf("task %q changed while its worker was being stopped; try again", taskID)
	}
	return nil
}

// closeWorkerTab closes a stopped worker's tab, the one runTabID names, in its run's workspace. It runs after the
// task is recorded Failed, so a tab that will not close leaves no task a tick would relaunch, only an error saying so.
func (p *taskPrep) closeWorkerTab(ctx context.Context, taskID string) error {
	if p == nil || !p.closeTab || p.stop == nil {
		return nil
	}
	if _, err := closeLeadTab(ctx, p.stop); err != nil {
		return fmt.Errorf("task %q is stopped, but its worker's tab did not close: %w", taskID, err)
	}
	return nil
}

// prepareActionLocked validates a skip, retry, escalate or stop, cancels the run of the worker it will stop and returns
// the work left to do outside the lock. Nil for an action that stops and rewinds nothing; applyActionLocked
// rejects what this leaves unjudged.
func prepareActionLocked(ctx context.Context, dagID, taskID, action string, target waveobj.RoutePin) (*taskPrep, error) {
	if action != "skip" && action != "retry" && action != "escalate" && action != "stop" {
		return nil, nil
	}
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		return nil, fmt.Errorf("loading dag: %w", err)
	}
	if g.Status == DagStatus_Cancelled {
		return nil, fmt.Errorf("dag %s is cancelled", dagID)
	}
	task := taskByID(g, taskID)
	if task == nil {
		return nil, fmt.Errorf("no task %q", taskID)
	}
	prep := &taskPrep{state: task.State, runID: task.RunID}
	switch action {
	case "skip":
		if !skippable(task.State) {
			return nil, fmt.Errorf("task %q cannot be skipped from state %q", taskID, task.State)
		}
		// a failed review's worker already finished: cancelling its run would rewrite a done run. Its rejected
		// commit is still on the lane branch, which lands by squashing, so the branch goes back to before the task.
		if task.State == TaskState_ReviewFailed {
			prep.rewind = func(ctx context.Context) error { return dropRejectedCommit(ctx, g, task) }
			return prep, nil
		}
		prep.rewind = func(ctx context.Context) error { return dropSkippedAttempt(ctx, g, taskID) }
	case "stop":
		// only a task with a live worker has something to stop; a reviewing task's worker already finished
		if !taskActive(task.State) {
			return nil, fmt.Errorf("task %q cannot be stopped from state %q: only a running or stalled task has a worker", taskID, task.State)
		}
		prep.closeTab = true
	case "retry":
		// a reviewing task is refused, and a failed review's worker already finished
		if reviewState(task.State) {
			return nil, nil
		}
	case "escalate":
		owner, err := wstore.GetRun(ctx, g.ChannelId, g.RunID)
		if err != nil {
			return nil, fmt.Errorf("loading owner run: %w", err)
		}
		if _, err := escalationTarget(task, owner, g, target); err != nil {
			return nil, err
		}
		if task.State == TaskState_ReviewFailed {
			return nil, nil
		}
	}
	if prep.stop, err = cancelTaskRun(ctx, g, task); err != nil {
		return nil, err
	}
	return prep, nil
}

// cancelTaskRun cancels the run of a task's worker and returns it for the caller to stop outside the dag lock; nil
// for a task with no run. The cancelled run is how the worker's exit knows the stop was asked for.
func cancelTaskRun(ctx context.Context, g *waveobj.TaskGroup, task *waveobj.TaskNode) (*waveobj.Run, error) {
	if task.RunID == "" {
		return nil, nil
	}
	if err := wstore.UpdateRun(ctx, g.ChannelId, task.RunID, func(r *waveobj.Run) error {
		*r = jarvis.CancelRun(*r)
		return nil
	}); err != nil {
		return nil, fmt.Errorf("cancelling old run %s: %w", task.RunID, err)
	}
	run, err := wstore.GetRun(ctx, g.ChannelId, task.RunID)
	if err != nil {
		return nil, fmt.Errorf("loading old run %s after cancellation: %w", task.RunID, err)
	}
	return run, nil
}

func escalationTarget(task *waveobj.TaskNode, owner *waveobj.Run, group *waveobj.TaskGroup, target waveobj.RoutePin) (waveobj.RoutePin, error) {
	if task == nil {
		return waveobj.RoutePin{}, fmt.Errorf("task is required")
	}
	if task.State != TaskState_Failed && task.State != TaskState_Stalled && task.State != TaskState_BlockedMerge && task.State != TaskState_ReviewFailed {
		return waveobj.RoutePin{}, fmt.Errorf("task %q cannot be escalated from state %q", task.ID, task.State)
	}
	if task.Escalations >= 1 {
		return waveobj.RoutePin{}, fmt.Errorf("task %q is already escalated; it is blocked for the human", task.ID)
	}
	if target.Model == "" {
		return waveobj.RoutePin{}, fmt.Errorf("escalating %q: a target model is required", task.ID)
	}
	if target.Runtime == "" {
		target.Runtime = effectiveTaskRoute(task, owner, group).Runtime
	}
	target = waveobj.RoutePin{Runtime: target.Runtime, Model: target.Model}
	if _, err := runroute.Resolve(target); err != nil {
		return waveobj.RoutePin{}, fmt.Errorf("escalating %q: %w", task.ID, err)
	}
	return target, nil
}

// applyEscalation repins a task to a chosen model and returns it to pending so the next tick
// dispatches it fresh.
func applyEscalation(task *waveobj.TaskNode, target waveobj.RoutePin) {
	task.RunSpec.Runtime = target.Runtime
	task.RunSpec.Model = target.Model
	task.Attempts = 0
	task.LastFailureKind = ""
	task.Escalations++
	task.ModelSource = waveobj.TaskModelSource_Escalation
	task.State = TaskState_Pending
	task.RunID = ""
}

// applyActionLocked records an action on the dag. For a skip, retry or escalate the caller has run the action's
// taskPrep: nothing here stops a worker or touches a tree.
func applyActionLocked(ctx context.Context, dagID, taskID, action string, target waveobj.RoutePin) error {
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		return fmt.Errorf("loading dag: %w", err)
	}
	if g.Status == DagStatus_Cancelled {
		return fmt.Errorf("dag %s is cancelled", dagID)
	}
	if action == "setmodel" || action == "leadmodels" {
		return applyModelActionLocked(ctx, g, taskID, action, target)
	}
	var emit []func()
	switch action {
	case "approve":
		if reviewFailed(g, taskID) {
			// the lead overrules the reviewer: the worker's commit lands as it is
			taskByID(g, taskID).State = TaskState_Done
			emit = append(emit, func() {
				appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindReviewOverruled, nil, map[string]any{"taskid": taskID})
			})
		} else {
			g2, err := ApproveGate(g, taskID)
			if err != nil {
				return err
			}
			g = g2
		}
	case "sendback":
		g2, err := SendBackGate(g, taskID)
		if err != nil {
			return err
		}
		g = g2
	case "skip":
		if err := SkipTask(g, taskID); err != nil {
			return err
		}
	case "retry":
		if task := taskByID(g, taskID); task != nil && task.State == TaskState_Reviewing {
			// its worker finished and a reviewer is judging it; the review's own guards end a stuck reviewer
			return fmt.Errorf("task %q is under review; wait for the verdict (a reviewer silent past %s is replaced)", taskID, ReviewTimeout)
		}
		if reviewFailed(g, taskID) {
			// the rounds start over from the findings; the worker's run already finished
			taskByID(g, taskID).ReviewRound = 0
		}
		if err := RetryTask(g, taskID); err != nil {
			return err
		}
	case "escalate":
		task := taskByID(g, taskID)
		if task == nil {
			return fmt.Errorf("no task %q", taskID)
		}
		owner, err := wstore.GetRun(ctx, g.ChannelId, g.RunID)
		if err != nil {
			return fmt.Errorf("loading owner run: %w", err)
		}
		target, err := escalationTarget(task, owner, g, target)
		if err != nil {
			return err
		}
		if task.State == TaskState_ReviewFailed {
			task.ReviewRound = 0
		}
		applyEscalation(task, target)
		RecomputeDagStatus(g)
	case "stop":
		task := taskByID(g, taskID)
		if task == nil {
			return fmt.Errorf("no task %q", taskID)
		}
		// Failed, not Cancelled: a cancelled task cancels its whole dag (RecomputeDagStatus). The run is
		// dropped so DeriveTaskStates cannot map its cancellation back onto the task.
		task.State = TaskState_Failed
		task.LastFailureKind = FailureKindStopped
		task.RunID = ""
	default:
		return fmt.Errorf("unknown dag action %q", action)
	}
	// the circuit-break's contract is "stop and ask a human", and this action is the answer — so the
	// streak is spent. Without this the dispatch guard deadlocks: nothing spawns, so no fresh success
	// can ever arrive to clear the counter that is stopping the spawns. Terminal task state still
	// blocks the dag on its own, so this only forgives the counter, never a real failure.
	g.Failures = 0
	RecomputeDagStatus(g)
	g.UpdatedTs = time.Now().UnixMilli()
	if err := wstore.UpdateDag(ctx, dagID, func(cur *waveobj.TaskGroup) error {
		*cur = *g
		return nil
	}); err != nil {
		return err
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Dag, g.OID))
	for _, fn := range emit {
		fn()
	}
	return nil
}

func MarkBlockedMerge(ctx context.Context, dagID, childRunID string) error {
	return withDagMutation(dagID, func() error {
		return markBlockedMergeLocked(ctx, dagID, childRunID)
	})
}

// markBlockedMergeLocked is the body of MarkBlockedMerge for callers already holding the dag
// mutation lock (the merge path takes it before running git, so it cannot re-enter).
func markBlockedMergeLocked(ctx context.Context, dagID, childRunID string) error {
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		return fmt.Errorf("loading dag: %w", err)
	}
	if g.Status == DagStatus_Cancelled {
		return fmt.Errorf("dag %s is cancelled", dagID)
	}
	found := false
	taskID := ""
	for i := range g.Tasks {
		if g.Tasks[i].RunID == childRunID {
			g.Tasks[i].State = TaskState_BlockedMerge
			taskID = g.Tasks[i].ID
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("no task owns run %s", childRunID)
	}
	RecomputeDagStatus(g)
	g.UpdatedTs = time.Now().UnixMilli()
	if err := wstore.UpdateDag(ctx, dagID, func(cur *waveobj.TaskGroup) error {
		*cur = *g
		return nil
	}); err != nil {
		return err
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Dag, g.OID))
	PostWake(ctx, g.ChannelId, g.RunID, mergeConflictWake(taskID))
	return nil
}

// recordMergeFailureLocked stamps a squash git refused outright — not a conflict, which leaves the tree
// mid-merge and has its own state. The automatic path re-claims a merge-ready lane every tick, so a
// refusal that is only returned to the caller is a loop nobody can see: the S5b live check spent five
// minutes retrying a squash an untracked file was blocking, with ten identical task-merge-started rows
// and a healthy-looking run. The count is what ends it. Up to the limit the refusal stays retryable,
// because the refusals worth retrying are exactly the ones a human clears out from under the run; at the
// limit the task blocks, which takes it out of autoMergeable and puts it in front of the lead.
// The caller holds the dag mutation lock.
func recordMergeFailureLocked(ctx context.Context, dagID, taskID, errText string, limit int) error {
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		return fmt.Errorf("loading dag: %w", err)
	}
	task := taskByID(g, taskID)
	if task == nil {
		return fmt.Errorf("no task %q", taskID)
	}
	task.MergeFailures++
	task.MergeError = errText
	blocked := task.MergeFailures >= limit
	if blocked {
		task.State = TaskState_BlockedMerge
	}
	RecomputeDagStatus(g)
	g.UpdatedTs = time.Now().UnixMilli()
	if err := wstore.UpdateDag(ctx, dagID, func(cur *waveobj.TaskGroup) error {
		*cur = *g
		return nil
	}); err != nil {
		return err
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Dag, g.OID))
	appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindTaskMergeFailed, nil, map[string]any{
		"taskid":  taskID,
		"error":   errText,
		"attempt": task.MergeFailures,
		"blocked": blocked,
	})
	if blocked {
		PostWake(ctx, g.ChannelId, g.RunID, mergeFailedWake(taskID, errText))
	}
	return nil
}

// clearMergeFailureLocked gives a task its full retry budget back, for the human's explicit
// `dag merge --continue` after they cleared whatever git was refusing over. Without it a retry starts
// already at the limit and blocks again on its first refusal. The caller holds the dag mutation lock.
func clearMergeFailureLocked(ctx context.Context, dagID, taskID string) error {
	return wstore.UpdateDag(ctx, dagID, func(cur *waveobj.TaskGroup) error {
		task := taskByID(cur, taskID)
		if task == nil {
			return fmt.Errorf("no task %q", taskID)
		}
		task.MergeFailures, task.MergeError = 0, ""
		return nil
	})
}

// cancelledDag is what the locked half of Cancel leaves for the tree removals that run after it.
type cancelledDag struct {
	g           *waveobj.TaskGroup
	runIDs      []string
	projectPath string
	landOwner   *waveobj.Run
	errs        []error
}

func Cancel(ctx context.Context, dagID string) error {
	var c *cancelledDag
	if err := withDagMutation(dagID, func() error {
		var err error
		c, err = cancelLocked(ctx, dagID)
		return err
	}); err != nil {
		return err
	}
	// cancelled work is abandoned, so every task's tree goes through the same durable cleanup path, outside the
	// lock: each removal takes tens of seconds and the workers stopped above exit into that lock.
	// dump dirty state first; each cleanup outcome persists and publishes before the next task.
	errs := c.errs
	if IsGitRepo(c.projectPath) {
		removeCtx := context.WithoutCancel(ctx)
		// unreadable leaves it empty, and the patch falls back to the checkout's head
		landHead, _ := landingHead(removeCtx, c.landOwner)
		for i := range c.g.Tasks {
			taskID := c.g.Tasks[i].ID
			// a lane's tasks share one key: the first removes the tree, the rest find nothing left to do
			key := LaneWorktreeKey(c.g, taskID)
			DumpRecoveryPatch(removeCtx, c.projectPath, key, landHead) // best effort
			if err := removeTaskTree(removeCtx, dagID, taskID, true); err != nil {
				errs = append(errs, fmt.Errorf("worktree %s: %w", key, err))
			}
		}
	}
	for _, runID := range c.runIDs {
		if runID != "" {
			wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Run, runID))
			wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, c.g.ChannelId))
		}
	}
	return errors.Join(errs...)
}

// cancelLocked writes the cancelled state and stops every worker; its error is only the state write's, and the
// worker stops' errors ride on the result for Cancel to return.
func cancelLocked(ctx context.Context, dagID string) (*cancelledDag, error) {
	var gCopy *waveobj.TaskGroup
	var runIDs []string
	var projectPath string
	var landOwner *waveobj.Run
	if err := withMutationTx(ctx, func(tx *wstore.TxWrap) error {
		txCtx := tx.Context()
		g, err := wstore.GetDag(txCtx, dagID)
		if err != nil {
			return err
		}
		owner, err := wstore.GetRun(txCtx, g.ChannelId, g.RunID)
		if err != nil {
			return err
		}
		projectPath, landOwner = owner.ProjectPath, owner
		CancelGroup(g)
		if IsGitRepo(projectPath) {
			for i := range g.Tasks {
				g.Tasks[i].CleanupPending = true
				g.Tasks[i].CleanupError = ""
				g.Tasks[i].CleanupAttempts = 0
			}
		}
		if err := wstore.UpdateDag(txCtx, dagID, func(cur *waveobj.TaskGroup) error {
			*cur = *g
			return nil
		}); err != nil {
			return err
		}
		gCopy = g
		runIDs = append([]string{g.RunID}, childRunIDs(g)...)
		for _, runID := range runIDs {
			if runID == "" {
				continue
			}
			if err := wstore.UpdateRun(txCtx, g.ChannelId, runID, func(r *waveobj.Run) error {
				// a landed task's run keeps its outcome, as CancelGroup keeps the done task; its worker is still stopped below
				if r.Status != jarvis.RunStatus_Done {
					*r = jarvis.CancelRun(*r)
				}
				return nil
			}); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}

	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Dag, dagID))
	// dag-cancelled: the terminal lifecycle boundary, recorded only after the cancelled state persists.
	appendRunEvent(ctx, gCopy.ChannelId, gCopy.RunID, waveobj.RunEventKindDagCancelled, nil, map[string]any{"source": "cancel"})
	stopDagVerify(dagID)
	stopDagFinal(dagID)
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), cancelCleanupTimeout)
	defer cancel()
	var errs []error
	for _, runID := range runIDs {
		if runID == "" {
			continue
		}
		run, err := wstore.GetRun(cleanupCtx, gCopy.ChannelId, runID)
		if err != nil {
			errs = append(errs, fmt.Errorf("loading run %s: %w", runID, err))
			continue
		}
		if err := stopRunWorkers(cleanupCtx, run); err != nil {
			errs = append(errs, fmt.Errorf("run %s: %w", runID, err))
		}
	}
	// a verifying stage's detached tree outlived its commands; the verifier stopped above was its last user
	if gCopy.Final != nil && gCopy.Final.State == FinalState_Verifying {
		var release []func()
		releaseFinalTree(gCopy, landOwner, &release)
		for _, fn := range release {
			fn()
		}
	}
	return &cancelledDag{g: gCopy, runIDs: runIDs, projectPath: projectPath, landOwner: landOwner, errs: errs}, nil
}
