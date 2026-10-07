package orchestrate

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/harness"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// DagEvent kinds published on the wps broker. The names live in wps (the event hub's single source
// of truth — the FE event union is generated from wps.AllEvents); these aliases keep the engine's
// references unchanged.
const (
	DagEventChildDone   = wps.DagEventChildDone
	DagEventGateOpen    = wps.DagEventGateOpen
	DagEventBlocked     = wps.DagEventBlocked
	DagEventComplete    = wps.DagEventComplete
	DagEventTaskSpawned = wps.DagEventTaskSpawned
	DagEventChildAsk    = wps.DagEventChildAsk
	DagEventTaskStalled = wps.DagEventTaskStalled
	DagEventTaskRetried = wps.DagEventTaskRetried
)

// spawnWorker is the child-run launch seam. Package var so engine tests can stub it;
// defaults to jarvis.SpawnRunWorker, read at call time so external stubs (e.g. swapping
// jarvis.SpawnRunWorker in handler tests) take effect too.
var spawnWorker = func(ctx context.Context, cap runroute.Capability, workspaceId, projectName, cwd, prompt string, opts jarvis.RunWorkerOptions) (string, error) {
	return jarvis.SpawnRunWorker(ctx, cap, workspaceId, projectName, cwd, prompt, opts)
}

var validateWorkerHarness = func(runtime string) error {
	_, err := harness.ValidateInstalled(runtime, harness.OperationRunWorker)
	return err
}

// SetValidateWorkerHarnessForTest stubs harness validation for tests.
func SetValidateWorkerHarnessForTest(fn func(string) error) func() {
	old := validateWorkerHarness
	validateWorkerHarness = fn
	return func() { validateWorkerHarness = old }
}

// startWorker launches a spawned worker's process once its run is recorded. Read at call time, like
// spawnWorker.
var startWorker = func(ctx context.Context, workerORef string) error {
	return jarvis.StartRunWorker(ctx, workerORef)
}

// abandonUnstartedWorker cancels the run recorded for a worker whose process would not start and disarms
// its tab, so nothing reads the run as working.
func abandonUnstartedWorker(ctx context.Context, channelId, runID, workerORef string) {
	if err := wstore.UpdateRun(ctx, channelId, runID, func(r *waveobj.Run) error {
		*r = jarvis.CancelRun(*r)
		return nil
	}); err != nil {
		log.Printf("cancelling run %s of unstarted worker %s: %v", runID, workerORef, err)
	}
	if err := stopSpawnedWorker(ctx, workerORef); err != nil {
		log.Printf("stopping unstarted worker %s: %v", workerORef, err)
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Run, runID))
}

var appendChildRun = wstore.AppendRun
var stopSpawnedWorker = jarvis.StopRunWorker
var stampSpawnedWorker = wstore.StampWorkerOwner

const scheduleCleanupTimeout = 10 * time.Second

// scheduleTickTimeout bounds one detached tick. A tick dispatches up to MaxParallelism workers in
// sequence, each bounded by jarvis.RunWorkerSpawnTimeout, so the bound is that worst case with room to
// spare — it exists to stop a wedged tick living forever, not to pace a healthy one.
const scheduleTickTimeout = 10 * time.Minute

// spawnBudget hands each step of a tick its own jarvis.RunWorkerSpawnTimeout. One deadline for the whole tick
// is spent by the first slow dispatch (a large checkout, a long Setup), and every task after it fails on arrival.
type spawnBudget struct {
	parent  context.Context
	cancels []context.CancelFunc
}

func (b *spawnBudget) next() context.Context {
	ctx, cancel := context.WithTimeout(b.parent, jarvis.RunWorkerSpawnTimeout)
	b.cancels = append(b.cancels, cancel)
	return ctx
}

func (b *spawnBudget) release() {
	for _, cancel := range b.cancels {
		cancel()
	}
}

type spawnedWorkerInfo struct {
	childRun  waveobj.Run
	oref      string
	taskID    string
	persisted bool
}

func publishSpawnedRunUpdates(channelID string, spawned []spawnedWorkerInfo) {
	publishedChannel := false
	for _, sp := range spawned {
		if !sp.persisted {
			continue
		}
		wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Run, sp.childRun.ID))
		publishedChannel = true
	}
	if publishedChannel {
		wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, channelID))
	}
}

func cleanupScheduleFailure(ctx, workerCtx context.Context, g *waveobj.TaskGroup, spawned []spawnedWorkerInfo, cause error) error {
	cleanupCtx := ctx
	cancel := func() {}
	if cleanupCtx.Err() != nil {
		cleanupCtx, cancel = context.WithTimeout(context.WithoutCancel(ctx), scheduleCleanupTimeout)
	}
	defer cancel()
	if workerCtx.Err() != nil {
		workerCtx = cleanupCtx
	}

	errs := []error{cause}
	for _, sp := range spawned {
		if err := stopSpawnedWorker(workerCtx, sp.oref); err != nil {
			errs = append(errs, fmt.Errorf("stop worker %s for task %s: %w", sp.oref, sp.taskID, err))
		}
		if !sp.persisted {
			continue
		}
		if err := wstore.UpdateRun(cleanupCtx, g.ChannelId, sp.childRun.ID, func(r *waveobj.Run) error {
			*r = jarvis.CancelRun(*r)
			return nil
		}); err != nil {
			errs = append(errs, fmt.Errorf("cancel child run %s for task %s: %w", sp.childRun.ID, sp.taskID, err))
		}
	}

	publishSpawnedRunUpdates(g.ChannelId, spawned)
	fresh, err := wstore.GetDag(cleanupCtx, g.OID)
	if err != nil {
		return errors.Join(append(errs, fmt.Errorf("reload dag for task failure cleanup: %w", err))...)
	}
	var failed []int
	for _, sp := range spawned {
		if idx := taskIdx(fresh, sp.taskID); idx >= 0 {
			fresh.Tasks[idx].State = TaskState_Failed
			fresh.Tasks[idx].RunID = ""
			fresh.Tasks[idx].LastFailureKind = FailureKindUnrecorded
			fresh.Tasks[idx].Attempts++
			failed = append(failed, idx)
		}
	}
	fresh.UpdatedTs = time.Now().UnixMilli()
	RecomputeDagStatus(fresh)
	if err := wstore.UpdateDag(cleanupCtx, fresh.OID, func(cur *waveobj.TaskGroup) error {
		*cur = *fresh
		return nil
	}); err != nil {
		errs = append(errs, fmt.Errorf("recording task failure: %w", err))
	} else {
		wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Dag, fresh.OID))
		// the child run was cancelled or never persisted, so as with failDispatch the event is the only
		// place the reason survives
		detail := truncateText(cause.Error(), MaxFailureDetailLen)
		for _, idx := range failed {
			appendRunEvent(cleanupCtx, fresh.ChannelId, fresh.RunID, waveobj.RunEventKindTaskFailed, nil, map[string]any{
				"taskid": fresh.Tasks[idx].ID, "lastfailurekind": FailureKindUnrecorded, "attempts": fresh.Tasks[idx].Attempts, "detail": detail,
			})
			PostWake(cleanupCtx, fresh.ChannelId, fresh.RunID, taskFailedWake(fresh.Tasks[idx].ID, FailureKindUnrecorded))
		}
	}
	return errors.Join(errs...)
}

// MaxAutoStallRetries is how many times the engine retries a stalled task itself. A stall is otherwise
// only ever retried by a lead or a human, so a run whose lead is gone stays parked forever; one retry
// clears the transient hang, and a task that stalls again waits for a human.
const MaxAutoStallRetries = 1

// stalledTask is a task a tick found freshly stalled with nobody to judge it, for autoRetryStalled once the tick
// has released the dag lock. hung is the wake its lead gets if the retry cannot be made.
type stalledTask struct {
	taskID, runID, hung string
}

// autoRetriable reports a stalled task the engine retries itself: the run has no live lead to judge it, and the
// engine has not retried it already. A run with a live lead is left alone: the lead is woken and decides.
func autoRetriable(ctx context.Context, g *waveobj.TaskGroup, task *waveobj.TaskNode) bool {
	return task.StallRetries < MaxAutoStallRetries && !leadStateFn(ctx, g.ChannelId, g.RunID).Alive
}

// autoRetryStalled returns a stalled task to pending, stopping its child first. The caller must not hold the dag
// lock: the child is stopped outside it, as in applyAction. The dag-wide failure streak is untouched (RetryTask).
// Reports whether it retried; a failure to stop the child leaves the task stalled for a human.
func autoRetryStalled(ctx context.Context, dagID string, s stalledTask) bool {
	taskActions.Lock(dagID)
	defer taskActions.Unlock(dagID)
	var g *waveobj.TaskGroup
	// stalled reloads the dag and finds the task as the tick left it; nil when something else has moved it since
	stalled := func() (*waveobj.TaskNode, error) {
		var err error
		if g, err = wstore.GetDag(ctx, dagID); err != nil {
			return nil, fmt.Errorf("loading dag: %w", err)
		}
		if task := taskByID(g, s.taskID); task != nil && task.State == TaskState_Stalled && task.RunID == s.runID {
			return task, nil
		}
		return nil, nil
	}
	var run *waveobj.Run
	moved := false
	err := withDagMutation(dagID, func() error {
		task, err := stalled()
		if err != nil || task == nil {
			moved = task == nil
			return err
		}
		run, err = cancelTaskRun(ctx, g, task)
		return err
	})
	if err == nil && run != nil {
		err = stopRunWorkers(ctx, run)
	}
	if err == nil && !moved {
		err = withDagMutation(dagID, func() error {
			task, err := stalled()
			if err != nil || task == nil {
				moved = task == nil
				return err
			}
			if err := RetryTask(g, s.taskID); err != nil {
				return err
			}
			task.StallRetries++
			return persistDag(ctx, g)
		})
	}
	if err != nil {
		log.Printf("schedule dag %s task %s: auto-retry of stalled task: %v", dagID, s.taskID, err)
		if g != nil && s.hung != "" {
			PostWake(ctx, g.ChannelId, g.RunID, s.hung)
		}
		return false
	}
	if moved {
		return false
	}
	publishDagEvent(DagEventTaskRetried, g, s.taskID)
	appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindTaskRetried, nil, map[string]any{"taskid": s.taskID, "kind": TaskState_Stalled, "auto": true})
	return true
}

// failDispatch records a task that died before it ever started. A dispatch failure produces no child
// run and no transcript, so unless the reason is written here it exists nowhere: the classifier kind
// lands on the node (feeding the digest's blocking-kind), the message on the task-failed lifecycle
// event, and the raw error in the server log. RecomputeDagStatus already blocks the DAG on any failed
// task, so the streak counter is deliberately untouched — this is a dispatch fault, not a run of bad
// worker outcomes.
// A transient kind (retryDecision) goes back to pending instead, up to its bound, and the next tick dispatches it
// again: EnsureRunWorktree rebuilds whatever tree the failed attempt left, as it does for a hand retry.
func failDispatch(ctx context.Context, g *waveobj.TaskGroup, taskID, kind string, cause error, afterCommit *[]func()) {
	idx := taskIdx(g, taskID)
	if idx < 0 {
		return
	}
	task := &g.Tasks[idx]
	if task.LastFailureKind != kind {
		task.Attempts = 0
	}
	task.LastFailureKind = kind
	retry := retryDecision(kind, task.Attempts)
	task.Attempts++
	log.Printf("schedule dag %s task %s: %s (attempt %d, retry %t): %v", g.OID, taskID, kind, task.Attempts, retry, cause)
	detail := failureDetail(cause)
	attempts := task.Attempts
	// the append waits for the whole batch's commit, and the tasks after this one take seconds each
	failedAt := time.Now().UnixMilli()
	if retry && RetryTask(g, taskID) == nil {
		*afterCommit = append(*afterCommit, func() {
			publishDagEvent(DagEventTaskRetried, g, taskID)
			appendRunEventAt(ctx, failedAt, g.ChannelId, g.RunID, waveobj.RunEventKindTaskRetried, nil, map[string]any{
				"taskid": taskID, "kind": kind, "attempt": attempts, "auto": true, "detail": detail,
			})
		})
		return
	}
	task.State = TaskState_Failed
	*afterCommit = append(*afterCommit, func() {
		appendRunEventAt(ctx, failedAt, g.ChannelId, g.RunID, waveobj.RunEventKindTaskFailed, nil, map[string]any{
			"taskid": taskID, "lastfailurekind": kind, "attempts": attempts, "detail": detail,
		})
		PostWake(ctx, g.ChannelId, g.RunID, taskFailedWake(taskID, kind))
	})
}

// Schedule advances the DAG one step: derive task states from child runs, count
// consecutive failures, spawn ready tasks (managed worktrees when the project is git),
// persist, and publish waveobj + event updates. Idempotent — safe to call repeatedly.
// It is authoritative: it reloads the DAG after acquiring the per-DAG mutation lock.
func Schedule(ctx context.Context, dagID string) error {
	// the whole tick owns its lifetime, not just the merge half. Two of the three callers are RPC
	// handlers, and every write a tick makes - the squash commit, the child run rows, the lifecycle
	// events - has to finish whether or not the client that poked it is still waiting. A cancelled tick
	// kills git mid-commit and leaves an index.lock no later tick gets past, spawns workers it cannot
	// record, and drops the task-spawned rows that are the only account of what it did.
	ctx = context.WithoutCancel(ctx)
	ctx, cancel := context.WithTimeout(ctx, scheduleTickTimeout)
	defer cancel()
	// before the tick, not inside it: the merge takes the same lock and it is not reentrant. A
	// landed merge is what makes a dependent's dep satisfied, so merging first lets one tick both
	// land the predecessor and dispatch what it unblocked.
	AutoMergeReady(ctx, dagID)
	// before the lock, like the merge: a removal holds no dag lock, and a tree held open must not stall the tick.
	// A cancelled dag's trees are Cancel's, which dumps each one's work before removing it.
	if g, err := wstore.GetDag(ctx, dagID); err == nil && g.Status != DagStatus_Cancelled {
		retryCleanupDebt(ctx, g)
	}
	return runTick(ctx, dagID)
}

// runTick runs one scheduling pass under the dag lock, then retries the tasks it found stalled with nobody to judge
// them, outside the lock, and runs again to dispatch them. Each task is retried at most MaxAutoStallRetries times,
// which is what ends the loop.
func runTick(ctx context.Context, dagID string) error {
	for {
		var stalled []stalledTask
		if err := withDagMutation(dagID, func() error { return scheduleLocked(ctx, dagID, &stalled) }); err != nil {
			return err
		}
		retried := false
		for _, s := range stalled {
			retried = autoRetryStalled(ctx, dagID, s) || retried
		}
		if !retried {
			return nil
		}
	}
}

// scheduleLocked is one scheduling pass; the caller holds the dag lock. The tasks whose stall the engine retries
// itself are left stalled and appended to stalled: stopping a worker is not done under the lock.
func scheduleLocked(ctx context.Context, dagID string, stalled *[]stalledTask) error {
	// an action is working on a task outside the dag lock (taskActions), and ticks when it is done
	if !taskActions.TryLock(dagID) {
		return nil
	}
	defer taskActions.Unlock(dagID)
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		return fmt.Errorf("loading dag: %w", err)
	}
	if g.Status == DagStatus_Cancelled {
		return nil
	}
	var afterCommit []func()
	budget := spawnBudget{parent: context.WithoutCancel(ctx)}
	defer budget.release()
	spawnCtx := budget.next()
	owner, err := wstore.GetRun(ctx, g.ChannelId, g.RunID)
	if err != nil {
		return fmt.Errorf("loading owning run: %w", err)
	}
	runs := map[string]*waveobj.Run{}
	prevStates := map[string]string{}
	for i := range g.Tasks {
		t := &g.Tasks[i]
		prevStates[t.ID] = t.State
		if t.RunID == "" {
			continue
		}
		if run, rerr := wstore.GetRun(ctx, g.ChannelId, t.RunID); rerr == nil {
			runs[t.RunID] = run
		}
	}
	DeriveTaskStates(g, runs)
	// liveness + stall detection: refresh each running task's last-activity from its child's own
	// transcript writes; a running task silent past StallThreshold is flagged stalled (nothing else ever
	// notices a headless child that stopped progressing). A stalled task whose child later completes
	// still derives done (DeriveTaskStates).
	now := time.Now().UnixMilli()
	for i := range g.Tasks {
		t := &g.Tasks[i]
		if t.RunID == "" {
			continue
		}
		// a reboot leaves the child run running and its transcript frozen, with nothing to relaunch the worker,
		// and so does an exit the hook lost: waiting out StallThreshold only delays the retry. The run is
		// re-read because a worker that just completed is gone too
		if t.State == TaskState_Running && workerControllerGone(ctx, runs[t.RunID]) && childStillOpen(ctx, g.ChannelId, t.RunID) {
			t.State = TaskState_Stalled
		}
		verdict := cpuNone
		if t.State == TaskState_Running || t.State == TaskState_Stalled {
			verdict = sampleWorkerCPU(ctx, t, runs[t.RunID], now)
			t.LatestTool = workerLatestTool(ctx, runs[t.RunID])
		}
		activity, tracked := lastActivityForRun(runs[t.RunID])
		if activity > t.LastActivity {
			t.LastActivity = activity
		}
		// first-activity boundary: stamped once, from the first tick that can read the child's
		// transcript at all. Spawn stamps LastActivity, so the transition to "has written something"
		// is not visible in that field — this is why FirstActivity is its own stamp rather than a
		// zero check. Without it a child's wall clock is one opaque span and every claim about task
		// size is a guess about which part of it is setup.
		if tracked && activity > 0 && t.FirstActivity == 0 {
			t.FirstActivity = activity
			taskID := t.ID
			sinceSpawn := int64(0)
			if spawned := spawnTs(runs[t.RunID]); spawned > 0 {
				sinceSpawn = activity - spawned
			}
			afterCommit = append(afterCommit, func() {
				appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindTaskFirstActivity, nil, map[string]any{"taskid": taskID, "sincespawnms": sinceSpawn})
			})
		}
		// what the human typed into the worker's own terminal goes on the lead's record once, and wakes nobody: the
		// lead reads it in the status it checks when something else wakes it
		if tracked && (t.State == TaskState_Running || t.State == TaskState_Stalled) {
			for _, p := range toldSince(runs[t.RunID], t.ToldTs) {
				t.ToldTs = p.Ts
				// the lead's own `dag tell`, which the transcript shows as typed input
				if takeLeadTold(t, p.Text) {
					continue
				}
				// an answer to the worker's prose question was typed for whoever answered it, and its ask rows say who
				if agentask.GlobalRegistry.TakeTypedAnswer(g.OID, t.ID, p.Text, p.Ts) {
					continue
				}
				detail := map[string]any{"taskid": t.ID, "text": toldText(p.Text)}
				afterCommit = append(afterCommit, func() {
					appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindTaskTold, nil, detail)
				})
			}
		}
		// active but not progressing: liveness calls a worker that loops for an hour healthy. Every runtime, since only
		// the failure scan needs a transcript; the lead judges, the engine does not act.
		if t.State == TaskState_Running {
			if reason, detail, flagged := checkProgress(ctx, t, runs[t.RunID], now); flagged {
				taskID := t.ID
				afterCommit = append(afterCommit, func() {
					appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindTaskSuspect, nil, detail)
					PostWake(ctx, g.ChannelId, g.RunID, taskSuspectWake(taskID, reason))
				})
			}
		}
		// a worker waiting on an ask is quiet by design and is the question queue's: the wait counts toward no
		// stall clock below, or a run with no lead retries a worker that was only waiting for its answer
		if t.State == TaskState_Running && workerAsking(ctx, runs[t.RunID]) {
			t.AskTs = now
		}
		// no readable activity source: the spawn-time seed would age into a stall on its own and hand
		// the lead a retry that kills a working child. Report freshness unknown (zero) instead — a
		// missed stall only costs a timeout. It skips the first-token deadline too: an unreadable child
		// has written nothing as far as the probe can tell, however hard it is working.
		if !tracked {
			t.LastActivity = 0
			continue
		}
		// readable but nothing written yet: the spawn seed is not activity either. Kept, it ages into a
		// stall on a child that simply writes no transcript (claude routinely), and it hides the child
		// from the first-token deadline, which only judges a zero.
		if activity == 0 {
			t.LastActivity = 0
		}
		// a worker whose turn ended with its run still open has nothing left to write, so its transcript can sit
		// fresh for all of StallThreshold while nobody hears of it (run 28caa81f's t-4). Its CPU still decides,
		// because a turn can end on a background test run.
		// silence is the transcript's and the CPU's together: a busy sample restarts it as a write would. Only a
		// fresh idle sample, or none at all, lets a quiet task stall; a skipped or first reading defers a tick
		quiet := t.LastActivity > 0 && now-max(t.LastActivity, t.BusyTs, t.AskTs) > StallThreshold.Milliseconds()
		turnEnded := now-t.AskTs > TurnEndedGrace.Milliseconds() && turnEndedPast(ctx, runs[t.RunID], now)
		if t.State == TaskState_Running && (quiet || turnEnded) &&
			(verdict == cpuIdle || verdict == cpuNone) {
			t.State = TaskState_Stalled
		}
		// first-token deadline: a child that has written nothing has no mtime to age, so without this
		// it can never stall. The exit hook catches a child that DIED before its first token; this
		// catches one that hangs, which leaves no signal anywhere else. A runtime the deadline is off for still
		// stalls when its worker's process never started.
		if spawned := spawnTs(runs[t.RunID]); t.State == TaskState_Running && t.LastActivity == 0 && spawned > 0 &&
			now-max(spawned, t.AskTs) > FirstTokenDeadline.Milliseconds() &&
			(firstTokenArmed(runs[t.RunID]) || workerStuckStarting(ctx, runs[t.RunID])) {
			t.State = TaskState_Stalled
		}
	}
	// review: apply verdicts, replace a reviewer that ended without one, spawn the missing ones. Before the
	// task-done accounting below, so a pass is counted done in the tick that applied it.
	advanceReviews(ctx, spawnCtx, g, owner, runs, now, &afterCommit)
	// the plan reviewer, before dispatch: NextToSpawn holds every task until its review clears
	advancePlanReview(ctx, spawnCtx, g, owner, now, &afterCommit)
	// the plan's Check on the base, beside the plan review, so a broken base is named once before any worker
	advanceBaseCheck(ctx, g, owner, &afterCommit)
	// child-done: record the task-done lifecycle boundary (task id + child run id). A done child is not
	// judgment, so the lead is not woken; the merge that follows wakes it only on a conflict.
	for i := range g.Tasks {
		t := &g.Tasks[i]
		if t.State == TaskState_Done && t.RunID != "" && taskInFlight(prevStates[t.ID]) {
			taskID := t.ID
			childRunID := t.RunID
			// a worker goes straight to done only when it reported no commit to review (DeriveTaskStates)
			unreviewed := ""
			if taskActive(prevStates[t.ID]) {
				unreviewed = noCommitLine(taskID, runs[t.RunID], len(unfinishedDescendants(g, taskID)) == 0)
			}
			afterCommit = append(afterCommit, func() {
				publishDagEvent(DagEventChildDone, g, taskID)
				appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindTaskDone, nil, map[string]any{"taskid": taskID, "runid": childRunID})
				if unreviewed != "" {
					PostQuiet(ctx, g.ChannelId, g.RunID, unreviewed)
				}
			})
		}
		if t.State == TaskState_Stalled && prevStates[t.ID] == TaskState_Running {
			taskID := t.ID
			// silence runs from the last write, or from spawn for a child that never wrote (the first-token stall)
			since := t.LastActivity
			if since == 0 {
				since = spawnTs(runs[t.RunID])
			}
			hung := hungWake(ctx, taskID, runs[t.RunID], now-since)
			// a worker that ended its turn may have finished (its complete lost to an EC-TIME): a retry would throw
			// its work away, so the lead judges it
			retry := workerTurnEndedAt(ctx, runs[t.RunID]) == 0 && autoRetriable(ctx, g, t)
			if retry {
				*stalled = append(*stalled, stalledTask{taskID: taskID, runID: t.RunID, hung: hung})
			}
			afterCommit = append(afterCommit, func() {
				publishDagEvent(DagEventTaskStalled, g, taskID)
				appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindTaskStalled, nil, map[string]any{"taskid": taskID})
				if !retry && hung != "" {
					PostWake(ctx, g.ChannelId, g.RunID, hung)
				}
			})
		}
	}
	// consecutive-failure accounting: a failure *streak* breaks only on a fresh success —
	// a task that completed in an earlier tick must not keep resetting the counter, or the
	// circuit-break at MaxConsecutiveFailures could never trip once any task had ever succeeded.
	freshSuccess := false
	for i := range g.Tasks {
		if !taskInFlight(prevStates[g.Tasks[i].ID]) || g.Tasks[i].State != TaskState_Done {
			continue
		}
		freshSuccess = true
		g.Tasks[i].Attempts = 0
		g.Tasks[i].LastFailureKind = ""
	}
	if freshSuccess && g.Failures > 0 {
		g.Failures = 0
	}
	for i := range g.Tasks {
		if g.Tasks[i].State == TaskState_Failed && taskActive(prevStates[g.Tasks[i].ID]) {
			g.Failures++
			// task-failed: record the terminal failure boundary (task id, child run id, failure
			// classifier, attempt count) — emitted only after the persist lands.
			taskID := g.Tasks[i].ID
			childRunID := g.Tasks[i].RunID
			kind := g.Tasks[i].LastFailureKind
			attempts := g.Tasks[i].Attempts
			afterCommit = append(afterCommit, func() {
				appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindTaskFailed, nil, map[string]any{"taskid": taskID, "runid": childRunID, "lastfailurekind": kind, "attempts": attempts})
				PostWake(ctx, g.ChannelId, g.RunID, taskFailedWake(taskID, kind))
			})
		}
	}
	var spawned []spawnedWorkerInfo
	spawnBase := owner.BaseCommit
	if g.MergeRequired {
		spawnBase, err = landingHead(spawnCtx, owner)
		if err != nil {
			return fmt.Errorf("resolving project head for dag %s: %w", g.ID, err)
		}
	}
	for _, taskID := range NextToSpawn(g) {
		task := taskByID(g, taskID)
		pin := effectiveTaskRoute(task, owner, g)
		capability, routeErr := runroute.Resolve(pin)
		if routeErr != nil {
			failDispatch(ctx, g, taskID, FailureKindRoute, routeErr, &afterCommit)
			continue
		}
		if harnessErr := validateWorkerHarness(pin.Runtime); harnessErr != nil {
			failDispatch(ctx, g, taskID, FailureKindHarness, harnessErr, &afterCommit)
			continue
		}
		// dispatch timing: worktree creation and the spawn call are in-process and separately
		// fixable (a warm tree vs. a warm worker), so they are measured separately rather than
		// folded into the child's wall clock where neither can be told apart.
		spawnCtx = budget.next()
		cwd := owner.ProjectPath
		taskBase := spawnBase
		var branch string
		var worktreeMs, setupMs int64
		if IsGitRepo(owner.ProjectPath) {
			// a lane's tasks share one tree, so each starts from the commits of the task before it
			key := LaneWorktreeKey(g, taskID)
			wtStart := time.Now()
			wt, head, created, werr := EnsureRunWorktree(spawnCtx, owner.ProjectPath, key, spawnBase)
			worktreeMs = time.Since(wtStart).Milliseconds()
			if werr != nil {
				failDispatch(ctx, g, taskID, FailureKindWorktree, werr, &afterCommit)
				continue
			}
			if created && g.Setup != "" {
				setupStart := time.Now()
				// no progress sink: Setup runs under the dag mutation lock, so nothing can read a
				// partial tail while it holds the lock anyway
				_, serr := runPlanCommand(context.WithoutCancel(ctx), wt, g.Setup, nil, SetupTimeout, nil)
				setupMs = time.Since(setupStart).Milliseconds()
				if serr != nil {
					// only a new tree is set up, so a retry must not reuse this half-prepared one. The branch
					// stays: it holds the lane's earlier commits, and the retry checks it out again.
					if rerr := removeWorktreeDir(context.WithoutCancel(ctx), owner.ProjectPath, wt); rerr != nil {
						log.Printf("schedule dag %s task %s: removing worktree after setup failure: %v", g.OID, taskID, rerr)
					}
					failDispatch(ctx, g, taskID, FailureKindSetup, serr, &afterCommit)
					continue
				}
				// Setup ran on its own SetupTimeout, and its wall clock is not the spawn's to pay
				spawnCtx = budget.next()
			}
			cwd = wt
			taskBase = attemptBase(spawnCtx, g, taskID, wt, head)
			branch = "wave/" + key
		}
		reportPath := WorkerReportPath(g.OID, taskID)
		if err := os.MkdirAll(filepath.Dir(reportPath), 0o755); err != nil {
			log.Printf("schedule dag %s task %s: creating the report dir: %v", g.OID, taskID, err)
		}
		// a retry writes to the same path, and a stale report would pass for this attempt's
		if err := os.Remove(reportPath); err != nil && !os.IsNotExist(err) {
			log.Printf("schedule dag %s task %s: removing a stale report: %v", g.OID, taskID, err)
		}
		prompt := taskPrompt(g, task, owner, pin.Runtime, cwd, predecessorHandoff(task, g, runs))
		// a new session per dispatch: its transcript is named by the id, so liveness and evidence never
		// read a previous attempt's file as this one's.
		sessionId := uuid.NewString()
		spawnStart := time.Now()
		// the worker block is stamped with its run before the run row exists, so the id is minted here
		runID := uuid.NewString()
		// named after its task: a prompt too long for a command line moves to a file, and the ai-title of the
		// pointer to it names every such worker the same
		oref, err := spawnWorker(spawnCtx, capability, owner.WorkspaceId, "", cwd, prompt,
			jarvis.RunWorkerOptions{SessionId: sessionId, RunId: runID, TaskId: taskID, Label: task.Label})
		spawnMs := time.Since(spawnStart).Milliseconds()
		spawnedAt := time.Now().UnixMilli()
		if err != nil {
			failDispatch(ctx, g, taskID, FailureKindSpawn, err, &afterCommit)
			continue
		}
		childRun := childRunFromSpec(g, task, owner, pin, cwd, taskBase, prompt)
		childRun.ID = runID
		childRun.SessionId = sessionId
		childRun.Branch = branch
		// attach worker to child run before persisting
		attached := false
		for i := range childRun.Phases {
			if childRun.Phases[i].State == jarvis.PhaseState_Running {
				childRun.Phases[i].WorkerOrefs = []string{oref}
				attached = true
				break
			}
		}
		spawned = append(spawned, spawnedWorkerInfo{childRun: childRun, oref: oref, taskID: taskID})
		if !attached {
			return cleanupScheduleFailure(ctx, spawnCtx, g, spawned, fmt.Errorf("child run for task %s has no running phase", taskID))
		}
		// spawnCtx, not ctx: the row that records a spawned worker must outlive exactly as long as the
		// spawn it records. Persisting on the caller's budget is what leaves a live process with no run
		// row, and the task's RunID is cleared on this failure, so nothing can ever reap it.
		if err := appendChildRun(spawnCtx, g.ChannelId, childRun); err != nil {
			return cleanupScheduleFailure(ctx, spawnCtx, g, spawned, fmt.Errorf("persisting child run for task %s: %w", taskID, err))
		}
		spawned[len(spawned)-1].persisted = true
		runORef := waveobj.MakeORef(waveobj.OType_Run, childRun.ID).String()
		channelORef := waveobj.MakeORef(waveobj.OType_Channel, g.ChannelId).String()
		if err := stampSpawnedWorker(spawnCtx, oref, runORef, channelORef); err != nil {
			log.Printf("schedule dag %s task %s: stamp worker %s: %v", g.OID, taskID, oref, err)
		}
		// last: the exit hook finds this worker's run through the row and the stamp above, and waits on the
		// dag lock this tick holds
		if err := startWorker(spawnCtx, oref); err != nil {
			abandonUnstartedWorker(spawnCtx, g.ChannelId, childRun.ID, oref)
			spawned = spawned[:len(spawned)-1]
			failDispatch(ctx, g, taskID, FailureKindSpawn, err, &afterCommit)
			continue
		}
		// now, not at tick end: the app already shows the tab, and until its run arrives the tab sits outside
		// the run's tree for as long as the rest of the batch takes to spawn. The tab's stamped task id nests it
		// before the dag commit names the run.
		wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Run, childRun.ID))
		if err := MarkRunning(g, taskID, childRun.ID); err != nil {
			return cleanupScheduleFailure(ctx, spawnCtx, g, spawned, err)
		}
		g.Tasks[taskIdx(g, taskID)].LastActivity = now
		spawnedTaskID := taskID
		afterCommit = append(afterCommit, func() {
			publishDagEvent(DagEventTaskSpawned, g, spawnedTaskID)
			// the append waits for the whole batch's commit, and a serial batch takes seconds per task
			appendRunEventAt(ctx, spawnedAt, g.ChannelId, g.RunID, waveobj.RunEventKindTaskSpawned, nil, map[string]any{"taskid": spawnedTaskID, "worktreems": worktreeMs, "setupms": setupMs, "spawnms": spawnMs})
		})
	}
	spawnCtx = budget.next()
	RecomputeDagStatus(g)
	// every task landed: the final stage judges the merged result before the dag is done
	advanceFinal(ctx, spawnCtx, g, owner, now, &afterCommit)
	// status notifications: gate-open / blocked / complete, once per condition. The watchdog and every
	// dag mutation re-enter Schedule, so emitting the standing status would refill the lifecycle log with
	// identical rows and re-wake the lead about what it was already told. The gate cannot be compared
	// against the status this tick started from: the mutation paths recompute and PERSIST the new status
	// before calling Schedule, so the row already reads the new condition. What was last announced is its
	// own fact, so the dag records it. Only the finished run wakes the lead here: a gate is the human's,
	// and each failure behind a blocked dag woke the lead when it happened.
	condition := dagCondition(g)
	notify := condition != g.NotifiedCondition
	g.NotifiedCondition = condition
	switch {
	case notify && g.Status == DagStatus_AwaitingReview:
		gateTask := gatedTaskID(g)
		afterCommit = append(afterCommit, func() {
			publishDagEvent(DagEventGateOpen, g, "")
			appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindDagGateOpen, nil, map[string]any{"taskid": gateTask})
		})
	case notify && g.Status == DagStatus_Blocked:
		failures := g.Failures
		blockingKind := BlockingKind(g)
		afterCommit = append(afterCommit, func() {
			publishDagEvent(DagEventBlocked, g, "")
			appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindDagBlocked, nil, map[string]any{"failures": failures, "kind": blockingKind})
		})
	case notify && g.Status == DagStatus_Done:
		// detached: a caller's short rpc budget must not cut the total off part-way through the transcripts
		g.Usage = jarvis.RunUsage(spawnCtx, owner, jarvis.DagChildRuns(spawnCtx, g.ChannelId, g.OID, owner.ID))
		finished := RunFinishedWake(g.Final)
		afterCommit = append(afterCommit, func() {
			publishDagEvent(DagEventComplete, g, "")
			appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindDagDone, nil, map[string]any{})
			PostWake(ctx, g.ChannelId, g.RunID, finished+landConflictLine(ctx, owner))
		})
	}
	g.UpdatedTs = time.Now().UnixMilli()
	// whole-object replace: the snapshot was loaded under the dag mutation lock, so it cannot have
	// gone stale. This is only sound while EVERY dag writer holds that lock — a write made outside it
	// (the merge stamp used to be one) is silently discarded here, because UpdateDag hands the mutator
	// the fresh row and this mutator throws it away. Field-scoped writers (persistTaskCleanupLocked) are the
	// pattern to follow if a writer ever genuinely cannot take the lock.
	if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
		*cur = *g
		return nil
	}); err != nil {
		return cleanupScheduleFailure(ctx, spawnCtx, g, spawned, err)
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Dag, g.OID))
	publishSpawnedRunUpdates(g.ChannelId, spawned)
	for _, publish := range afterCommit {
		publish()
	}
	// the one place a dag goes terminal regardless of what triggered the tick, so both closures hang
	// here: complete a run that has no lead to report its own completion, then close a lead tab whose
	// process may already be idle (keeponexit kept it), which the shell layer will not delete. The first
	// completes a run only when no lead process is alive, and the second closes a tab only once the run is
	// done, so a live lead's tab is never touched. best-effort: never fail Schedule over either.
	if owner != nil {
		if freshRun, err := wstore.GetRun(ctx, g.ChannelId, g.RunID); err == nil {
			if freshDag, err := wstore.GetDag(ctx, g.OID); err == nil {
				MaybeCompleteLeadFreeRun(ctx, freshRun, freshDag)
				_, _ = MaybeCloseOrchestratorLead(ctx, freshRun, freshDag)
			}
		}
	}
	return nil
}

// GroupForRun resolves the dag owning a run (the run carries DagORef — set on the
// orchestrator run by DagSubmitCommand and copied onto children by childRunFromSpec).
func GroupForRun(ctx context.Context, channelId, runID string) (*waveobj.TaskGroup, error) {
	run, err := wstore.GetRun(ctx, channelId, runID)
	if err != nil {
		return nil, err
	}
	if run.DagORef == "" {
		return nil, fmt.Errorf("run %q has no dag", runID)
	}
	return wstore.GetDag(ctx, run.DagORef)
}

func taskByID(g *waveobj.TaskGroup, taskID string) *waveobj.TaskNode {
	for i := range g.Tasks {
		if g.Tasks[i].ID == taskID {
			return &g.Tasks[i]
		}
	}
	return nil
}

func taskIdx(g *waveobj.TaskGroup, taskID string) int {
	for i := range g.Tasks {
		if g.Tasks[i].ID == taskID {
			return i
		}
	}
	return -1
}

// WorkerReportPath is where a task's worker writes the report it hands to `wsh jarvis complete --report`,
// which the seal takes as its summary. It sits outside every worktree so it can't be committed, and it
// uses forward slashes because Git Bash eats the backslashes of an unquoted Windows path.
func WorkerReportPath(dagOID, taskID string) string {
	return filepath.ToSlash(filepath.Join(os.TempDir(), "arc-reports", dagOID, taskID+".md"))
}

// workerContract opens every dag worker's prompt (spec §4). The plan is approved, so the worker neither
// re-plans nor guesses a consequential decision: it asks, and the lead or the human answers. It owns its
// task's tests, and it names the plan so a compacted worker can re-read its task. tree is the worker's own
// tree, where a branch-landed dag's docs are the snapshot committed at submit.
func workerContract(g *waveobj.TaskGroup, task *waveobj.TaskNode, runtime, tree string) string {
	var b strings.Builder
	if g.PlanPath != "" {
		fmt.Fprintf(&b, "You are the worker for task %s of the plan at %s", strings.TrimPrefix(task.ID, "t-"), DocPath(g, tree, g.PlanPath))
		if g.SpecPath != "" {
			fmt.Fprintf(&b, " (spec: %s)", DocPath(g, tree, g.SpecPath))
		}
		b.WriteString(".\n")
	} else {
		fmt.Fprintf(&b, "You are the worker for task %s of this run's dag.\n", task.ID)
	}
	fmt.Fprintf(&b, "The plan is approved: don't re-plan or pause for design approval. If a consequential decision isn't pinned, or the plan and the code disagree, ask once with %s and concrete options, then wait; the lead or the human answers.\n", jarvis.AskTool(runtime))
	b.WriteString("A reviewer checks your commit against this task and the spec before it lands, and the lead reads your report.\n")
	b.WriteString("Edit files with your edit tool; don't script multi-kilobyte replacements through the shell.\n")
	b.WriteString("Run the tests your task names")
	if g.Check != "" {
		fmt.Fprintf(&b, ", and `%s`,", g.Check)
	}
	b.WriteString(" and get them passing before you complete; if you can't, ask.")
	if baseCheckFailed(g) {
		fmt.Fprintf(&b, " `%s` already fails on the base, before any task (%s): don't fix those failures or count them as yours, and name them under Found not fixed in your report.", g.Check, g.BaseCheck.Detail)
	}
	if g.Verify != "" {
		// the brief wins over a plan whose task steps name whole-package runs (run 6c7652be spent most worker time on them)
		fmt.Fprintf(&b, " Don't run the plan's full Verify (`%s`), a whole package or the full suite, even when your task says to: the engine runs Verify after your task merges and again on the merged result. Run the tests your task names alone (for Go, `-run '<names>'`).", g.Verify)
	}
	if g.FinalCmd != "" {
		// first-round workers wrote scenarios they never ran, so Final was their first run (5 of 13 runs failed it, 2026-10-07 review)
		fmt.Fprintf(&b, " The plan's Final command (`%s`) checks the running app, and the engine runs it only after every task has merged: when your task adds or changes a scenario it runs, or the view or interaction one of its steps checks, run that one scenario yourself (the Final command narrowed to it) and get its steps passing before you complete.", g.FinalCmd)
	}
	b.WriteString(" To reproduce a flake, run the one failing test alone (for Go, `-run '^TestX$' -count=N`), never `-count=N` on a whole package.")
	b.WriteString(" Don't pipe a test into `tail`, `head` or `grep`: a pipe exits with its last command's status, so a failing test reads as passing. If you must pipe, run `set -o pipefail` first.")
	reportPath := WorkerReportPath(g.OID, task.ID)
	fmt.Fprintf(&b, " Commit, then write your report with your file-writing tool to `%s`, with exactly these five sections in this order:\n%s\nNothing goes before the first heading (the commit is already passed with `--commit`). A section with nothing to say holds `None`. Not verified lists only checks the task or plan asked for, never the suite the engine runs after your merge; a failure that predates your task goes under Found not fixed. `wsh jarvis complete` refuses a report that doesn't match. Then run `wsh jarvis complete --commit $(git rev-parse HEAD) --report %s`. ", reportPath, jarvis.WorkerReportTemplate, reportPath)
	b.WriteString(jarvis.NoAttributionRule)
	b.WriteString(" " + jarvis.SubagentCapRule)
	if g.PlanPath != "" {
		b.WriteString("\nIf your context was compacted, re-read your task from the plan.")
	}
	return b.String()
}

// predecessor handoff bounds: a brief, not a transcript. The child can read the whole change with
// `git show`; what it needs inline is enough to know a decision was made and where to look.
const (
	handoffMaxFiles      = 12
	handoffMaxSummaryLen = 600
	reportSectionMaxLen  = 2500
)

// predecessorHandoff describes what each of a task's satisfied dependencies actually did: the squash
// commit its work landed as, the files it touched, and its closing note. Without this a dependent
// learns only its own label and description, so it re-derives (or contradicts) decisions a sibling
// already made and committed. Everything here is already loaded at dispatch time — runs is the map
// scheduleLocked built for DeriveTaskStates, keyed by child run id.
//
// The commit is citable from the dependent's own tree: a dependency in the same lane committed it in the
// tree the dependent now works in, and one in another lane is satisfied only once its lane merged onto the
// project branch the dependent's tree branches from (depSatisfied).
// Evidence can still be nil — cleanup or the seal may have failed and the backfill retries — so the
// files and the note degrade to the commit line alone.
//
// Every done ancestor, not only a direct dependency, adds its report's For later tasks: that section is where a
// worker writes what a later task must know, and this read at dispatch is how a task not started when the
// ancestor passed review gets it. A report from before the format keeps its bounded note, for a direct
// dependency only.
func predecessorHandoff(task *waveobj.TaskNode, g *waveobj.TaskGroup, runs map[string]*waveobj.Run) string {
	var b strings.Builder
	heading := sectionHeading(jarvis.ReportKeyForLater)
	for _, depID := range ancestors(g, task) {
		dep := taskByID(g, depID)
		if dep == nil || dep.RunID == "" {
			continue
		}
		depRun := runs[dep.RunID]
		if depRun == nil {
			continue
		}
		rep, unstructured := workerReportOf(depRun)
		forLater := ""
		if rep.ForLater != "" {
			forLater = capSection(dep.ID, jarvis.ReportKeyForLater, rep.ForLater)
		}
		landed := slices.Contains(task.Deps, depID) && depRun.EndCommit != ""
		if !landed && forLater == "" {
			continue
		}
		if b.Len() == 0 {
			b.WriteString("Work already landed by the tasks this one depends on. It is in your starting tree — read it before you touch any file it changed, and do not redo or revert its decisions.\n")
		}
		label := dep.Label
		if label == "" {
			label = dep.ID
		}
		if !landed {
			fmt.Fprintf(&b, "\n- %s (task %s), which this one builds on through its dependencies:\n", label, dep.ID)
			fmt.Fprintf(&b, "  Its %s: %s\n", heading, indentLines(forLater, "  "))
			continue
		}
		fmt.Fprintf(&b, "\n- %s (task %s) landed as commit %s — inspect it with `git show --stat %s`.\n", label, dep.ID, depRun.EndCommit, depRun.EndCommit)
		if depRun.Evidence == nil {
			continue
		}
		if files := depRun.Evidence.Files; len(files) > 0 {
			b.WriteString("  Files: ")
			for i, f := range files {
				if i == handoffMaxFiles {
					fmt.Fprintf(&b, ", and %d more", len(files)-handoffMaxFiles)
					break
				}
				if i > 0 {
					b.WriteString(", ")
				}
				fmt.Fprintf(&b, "%s (+%d/-%d)", f.Path, f.Add, f.Del)
			}
			b.WriteString("\n")
		}
		if forLater != "" {
			fmt.Fprintf(&b, "  Its %s: %s\n", heading, indentLines(forLater, "  "))
		} else if note := truncateNote(unstructured, handoffMaxSummaryLen); note != "" {
			fmt.Fprintf(&b, "  It reported: %s\n", note)
		}
	}
	return strings.TrimSpace(b.String())
}

// ancestors is every task a task transitively depends on, in dag order.
func ancestors(g *waveobj.TaskGroup, task *waveobj.TaskNode) []string {
	in := map[string]bool{}
	queue := append([]string{}, task.Deps...)
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		if in[id] || id == task.ID {
			continue
		}
		in[id] = true
		if t := taskByID(g, id); t != nil {
			queue = append(queue, t.Deps...)
		}
	}
	var out []string
	for i := range g.Tasks {
		if in[g.Tasks[i].ID] {
			out = append(out, g.Tasks[i].ID)
		}
	}
	return out
}

// indentLines indents every line after the first, so a multi-line section stays under its bullet.
func indentLines(s, indent string) string {
	return strings.ReplaceAll(s, "\n", "\n"+indent)
}

// truncateNote collapses a child's closing note to one bounded run of text. A worker's final message
// can be arbitrarily long and a dependent's prompt is not the place to replay it.
func truncateNote(s string, max int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) <= max {
		return s
	}
	cut := s[:max]
	if i := strings.LastIndex(cut, " "); i > max/2 {
		cut = cut[:i]
	}
	return cut + "..."
}

// taskPrompt is the child's goal: the worker contract, then the task's text (its RunSpec goal, else its
// label, with the plan description and its decision pins), then the handoff from landed dependencies.
func taskPrompt(g *waveobj.TaskGroup, task *waveobj.TaskNode, owner *waveobj.Run, runtime, tree, handoff string) string {
	var b strings.Builder
	b.WriteString(workerContract(g, task, runtime, tree))
	b.WriteString("\n\n")
	if g.Preamble != "" {
		b.WriteString("The plan's header applies to every task:\n")
		b.WriteString(g.Preamble)
		b.WriteString("\n\n")
	}
	if task.RunSpec.Goal != "" {
		b.WriteString(task.RunSpec.Goal)
	} else if task.Label != "" {
		b.WriteString(task.Label)
	} else {
		fmt.Fprintf(&b, "task %s of %q", task.ID, owner.Goal)
	}
	if task.Description != "" {
		b.WriteString("\n\n")
		b.WriteString(roundDescription(g, task.Description, tree))
	}
	if len(task.LeadNotes) > 0 {
		b.WriteString("\n\nThe lead added after earlier tasks landed:")
		for _, n := range task.LeadNotes {
			fmt.Fprintf(&b, "\n- %s", n)
		}
	}
	if feedback := reviewFeedback(task); feedback != "" {
		b.WriteString("\n\n")
		b.WriteString(feedback)
	}
	if handoff != "" {
		b.WriteString("\n\n")
		b.WriteString(handoff)
	}
	return b.String()
}

// childRunFromSpec builds the child run that owns the spawned worker. The child carries
// DagORef so GroupForRun resolves the group from any run in the DAG, and its ProjectPath is
// the worktree cwd so evidence/continuity machinery scopes to the isolated checkout.
func childRunFromSpec(g *waveobj.TaskGroup, task *waveobj.TaskNode, owner *waveobj.Run, route waveobj.RoutePin, cwd, baseCommit, goal string) waveobj.Run {
	mode := task.RunSpec.Mode
	if mode == "" {
		mode = jarvis.RunMode_Quick
	}
	run := jarvis.NewRun(goal, owner.WorkspaceId, cwd, nil, mode, jarvis.QuickPlaybook(), time.Now().UnixMilli())
	run.Runtime = route.Runtime
	run.Model = route.Model
	run.DagORef = g.OID
	run.TaskId = task.ID
	run.BaseCommit = baseCommit
	return run
}

// publishDagEvent broadcasts an engine event scoped to the dag and its owning run.
func publishDagEvent(kind string, g *waveobj.TaskGroup, detail string) {
	wps.Broker.Publish(wps.WaveEvent{
		Event:  kind,
		Scopes: []string{waveobj.MakeORef(waveobj.OType_Dag, g.OID).String(), waveobj.MakeORef(waveobj.OType_Run, g.RunID).String()},
		Data:   detail,
	})
}

// appendRunEvent records a lifecycle event on the dag's owning run's log and broadcasts it to the
// focused run card. Best-effort telemetry — a failure is logged, never returned: the engine's
// scheduling must not fail over a log write. Local copy of the wshserver helper (that package imports
// this one, so a shared implementation would be a cycle). Var so tests can stub an append failure.
var appendRunEventAt = func(ctx context.Context, ts int64, channelId, runId, kind string, phaseIdx *int, detail any) {
	if ev, err := wstore.AppendRunEventAt(ctx, ts, channelId, runId, kind, phaseIdx, detail); err != nil {
		log.Printf("appendRunEvent(%s): %v", kind, err)
	} else {
		wps.Broker.Publish(wps.WaveEvent{
			Event:  wps.Event_RunEvent,
			Scopes: []string{waveobj.MakeORef(waveobj.OType_Run, runId).String()},
			Data:   wshrpc.RunEventData{ChannelId: channelId, RunId: runId, Event: ev},
		})
	}
}

var appendRunEvent = func(ctx context.Context, channelId, runId, kind string, phaseIdx *int, detail any) {
	appendRunEventAt(ctx, time.Now().UnixMilli(), channelId, runId, kind, phaseIdx, detail)
}
