// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"encoding/json"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// DagDigestSnapshot is the explicit snapshot the RPC layer gathers for one status request: the group,
// the bounded child runs, pending asks, retained lifecycle rows, and now. BuildDigest is pure — it
// performs no storage or clock reads, so the RPC layer stays the only place deciding what inputs are
// fresh enough to report.
type DagDigestSnapshot struct {
	Group    *waveobj.TaskGroup
	Owner    *waveobj.Run // the run that owns the dag; nil leaves the digest without timing
	Runs     []*waveobj.Run
	Asks     []wshrpc.DagAskItem
	Retained []waveobj.RunEvent
	Now      time.Time
}

// digest action sets, mirroring the digest contract's enum. Single derivation shared by CLI and UI —
// neither reconstructs alternatives from task state.
var (
	digestActionAnswer            = []string{"answer"}
	digestActionApproveSendback   = []string{"approve", "sendback"}
	digestActionMerge             = []string{"merge"}
	digestActionResolveMerge      = []string{"resolve-merge"}
	digestActionRetryCleanup      = []string{"retry-cleanup"}
	digestActionRetrySkipEscalate = []string{"retry", "skip", "escalate"}
	digestActionReviewFailed      = []string{"approve", "sendback", "retry", "skip", "escalate"}
)

// BuildDigest projects the group (+ its child runs, asks, and retained lifecycle history) onto the
// shared typed digest. DagVersion pins the source group version so consumers can reject stale answers.
func BuildDigest(sn DagDigestSnapshot) wshrpc.DagStatusDigest {
	g := sn.Group
	if g == nil {
		return wshrpc.DagStatusDigest{}
	}
	askByTask := askIndex(sn.Asks)
	retried := retriedTaskSet(sn.Retained)
	gateClock := mergeGateClock(g, sn.Retained)
	staleGate := staleMergeGates(gateClock, sn.Now)
	d := wshrpc.DagStatusDigest{
		DagVersion: g.Version,
		Health:     buildHealth(g, sn.Owner, askByTask, staleGate),
		Counts:     buildCounts(g, askByTask, retried, staleGate),
		Next:       buildNext(g, askByTask),
		Durations:  buildDurations(sn),
	}
	d.Report = buildReport(sn, d.Durations)
	d.Shape = PlanShapeOf(g.Tasks)
	d.Final = g.Final
	d.Lanes = jarvis.Lanes(g.Tasks)
	d.Told = jarvis.TallyDagEvents(sn.Retained).Told
	d.Timing = buildTiming(sn)
	runByID := map[string]*waveobj.Run{}
	for _, r := range sn.Runs {
		if r != nil {
			runByID[r.ID] = r
		}
	}
	for i := range g.Tasks {
		td := buildTaskDigest(g, &g.Tasks[i], askByTask, retried, gateClock, sn.Now.UnixMilli())
		withReview(&td, &g.Tasks[i], runByID[g.Tasks[i].RunID])
		d.Tasks = append(d.Tasks, td)
	}
	return d
}

// reportSectionKeys names the sections of a worker's report the lead can pull. Done is always there, so it is
// not listed unless it is all there is: a nil list would then read as no report at all. A report that predates
// the format is one unstructured section.
func reportSectionKeys(summary string) []string {
	rep, unstructured := jarvis.ReadWorkerReport(summary)
	if unstructured != "" {
		return []string{jarvis.ReportKeyUnstructured}
	}
	var keys []string
	for _, sec := range jarvis.WorkerReportSections {
		if body, _ := rep.Section(sec.Key); body != "" && sec.Key != jarvis.ReportKeyDone {
			keys = append(keys, sec.Key)
		}
	}
	if len(keys) == 0 && rep.Done != "" {
		return []string{jarvis.ReportKeyDone}
	}
	return keys
}

// withReview adds what the lead reads about a task's outcome: which sections of the worker's report have
// content, and the latest review.
func withReview(td *wshrpc.DagTaskDigest, t *waveobj.TaskNode, worker *waveobj.Run) {
	if worker != nil && worker.Evidence != nil {
		td.ReportSections = reportSectionKeys(worker.Evidence.Summary)
	}
	td.ReviewVerdict, td.ReviewRound = t.ReviewVerdict, t.ReviewRound
	td.ReviewNote, td.ReviewDownstream = t.ReviewNote, t.ReviewDownstream
	td.ReviewUnverified = t.ReviewUnverified
}

// PlanShapeOf is a plan's shape from its tasks. + Run's preview and the run card both read it, so the lanes
// a human approves are the lanes the engine runs.
func PlanShapeOf(tasks []waveobj.TaskNode) wshrpc.DagPlanShape {
	return wshrpc.DagPlanShape{
		Tasks:        len(tasks),
		Lanes:        len(jarvis.Lanes(tasks)),
		LongestChain: jarvis.LongestChain(tasks),
	}
}

// askIndex maps task id -> its pending ask. A child may raise multiple asks (one block at a time); the
// newest ask wins because that is what the child is actually blocked on.
func askIndex(asks []wshrpc.DagAskItem) map[string]wshrpc.DagAskItem {
	out := map[string]wshrpc.DagAskItem{}
	for _, a := range asks {
		if a.TaskId == "" {
			continue
		}
		if cur, ok := out[a.TaskId]; !ok || a.Ts >= cur.Ts {
			out[a.TaskId] = a
		}
	}
	return out
}

// retriedTaskSet returns the task ids that carry a retained task-retried event (recovered-retry proof
// requires the current task be done; the per-task check does that part).
func retriedTaskSet(retained []waveobj.RunEvent) map[string]bool {
	out := map[string]bool{}
	for _, ev := range retained {
		if ev.Kind != waveobj.RunEventKindTaskRetried {
			continue
		}
		if taskID := eventTaskID(ev); taskID != "" {
			out[taskID] = true
		}
	}
	return out
}

// eventTaskID reads the taskid detail key an event carries ("taskid" for task/merge/cleanup kinds).
func eventTaskID(ev waveobj.RunEvent) string {
	if len(ev.Detail) == 0 {
		return ""
	}
	var detail map[string]any
	if err := json.Unmarshal(ev.Detail, &detail); err != nil {
		return ""
	}
	tid, _ := detail["taskid"].(string)
	return tid
}

// MergeGateStaleAfter is how long an open merge gate may sit before the digest reports that nobody
// is acting on it. The gate already OPENS correctly; what was missing is any age on it, so a lead
// that died or drifted stranded finished work indefinitely while health read "healthy". Longer than
// StallThreshold because a live lead legitimately finishes other work before coming back to merge.
const MergeGateStaleAfter = 30 * time.Minute

// mergeGateClock maps each merge-ready lane tip to the start of its gate: the retained task-done boundary. A
// task whose done event has been pruned has no clock and is left out. The stale check and the rendered age both
// read this map, so they cannot disagree on when a gate opened.
func mergeGateClock(g *waveobj.TaskGroup, retained []waveobj.RunEvent) map[string]int64 {
	clock := map[string]int64{}
	for _, id := range mergeReadyIDs(g) {
		if doneTs := firstTaskEventTs(retained, waveobj.RunEventKindTaskDone, id, true); doneTs > 0 {
			clock[id] = doneTs
		}
	}
	return clock
}

// staleMergeGates returns the gates open past MergeGateStaleAfter. A gate with no clock is left out: a missed
// escalation costs a timeout, a fabricated one raises a false alarm on live work.
func staleMergeGates(gateClock map[string]int64, now time.Time) map[string]bool {
	stale := map[string]bool{}
	for id, doneTs := range gateClock {
		if now.UnixMilli()-doneTs > MergeGateStaleAfter.Milliseconds() {
			stale[id] = true
		}
	}
	return stale
}

// leadHolds reports whether the task's pending question is still its lead's: the human's only once the lead
// forwards it or its deadline passes. An ask with no owner could not be queued, so it stays the human's.
func leadHolds(ask wshrpc.DagAskItem) bool {
	return ask.Owner == agentask.AskOwner_Lead
}

func taskAttention(g *waveobj.TaskGroup, t *waveobj.TaskNode, askByTask map[string]wshrpc.DagAskItem, staleGate map[string]bool) bool {
	if ask, ok := askByTask[t.ID]; ok && !leadHolds(ask) {
		return true
	}
	if t.Gate && t.State == TaskState_Done && !t.Released {
		return true
	}
	if t.State == TaskState_Failed || t.State == TaskState_BlockedMerge || t.State == TaskState_VerifyFailed || t.State == TaskState_ReviewFailed {
		return true
	}
	if staleGate[t.ID] {
		return true
	}
	return t.CleanupError != ""
}

func buildCounts(g *waveobj.TaskGroup, askByTask map[string]wshrpc.DagAskItem, retried map[string]bool, staleGate map[string]bool) wshrpc.DagStatusCounts {
	c := wshrpc.DagStatusCounts{Total: len(g.Tasks)}
	for i := range g.Tasks {
		t := &g.Tasks[i]
		switch t.State {
		case TaskState_Done:
			c.Done++
			if retried[t.ID] {
				c.RecoveredRetry++
			}
			if mergeReadyTip(g, t) {
				c.MergeReady++
			}
		case TaskState_Running, TaskState_Reviewing:
			c.Running++
		case TaskState_Stalled:
			c.Stalled++
		}
		if t.State == TaskState_Pending && hasUnsatDep(g, t) {
			c.DependencyWaiting++
		}
		if taskAttention(g, t, askByTask, staleGate) {
			c.Attention++
		}
	}
	return c
}

func hasUnsatDep(g *waveobj.TaskGroup, t *waveobj.TaskNode) bool {
	for _, d := range t.Deps {
		if !depSatisfied(g, t.ID, d) {
			return true
		}
	}
	return false
}

// buildHealth derives aggregate health strictly per spec §5.2 precedence: needs-you (ask, unreleased
// gate, terminal failure, blocked merge, failed cleanup, blocked dag, terminal-with-debt) -> stalled ->
// healthy -> done/cancelled.
func buildHealth(g *waveobj.TaskGroup, owner *waveobj.Run, askByTask map[string]wshrpc.DagAskItem, staleGate map[string]bool) string {
	// a lead can finish its run past a gate or a failed final stage, and nothing moves the dag off it then:
	// the run's end is the dag's, and only a worktree the engine could not remove is still the human's
	if owner != nil && (owner.Status == jarvis.RunStatus_Done || owner.Status == jarvis.RunStatus_Cancelled) {
		if HasCleanupDebt(g) {
			return "needs-you"
		}
		return owner.Status
	}
	if g.Status == DagStatus_Blocked {
		return "needs-you"
	}
	for i := range g.Tasks {
		if taskAttention(g, &g.Tasks[i], askByTask, staleGate) {
			return "needs-you"
		}
	}
	for i := range g.Tasks {
		if g.Tasks[i].State == TaskState_Stalled {
			return "stalled"
		}
	}
	if g.Status == DagStatus_Done || g.Status == DagStatus_Cancelled {
		if HasCleanupDebt(g) {
			return "needs-you"
		}
		if g.Status == DagStatus_Done {
			return "done"
		}
		return "cancelled"
	}
	return "healthy"
}

// mergeReadyBlocking returns the merge-ready tasks that block pending successors, in dag order
// (spec §5.3 step 2: "merge-ready work that blocks successors when MergeRequired is true").
func mergeReadyBlocking(g *waveobj.TaskGroup) []string {
	if !g.MergeRequired {
		return nil
	}
	mergeReady := map[string]bool{}
	for _, id := range mergeReadyIDs(g) {
		mergeReady[id] = true
	}
	if len(mergeReady) == 0 {
		return nil
	}
	// a pending task is blocked-by-merge when its unsat dep chain reaches a merge-ready task
	var out []string
	for i := range g.Tasks {
		t := &g.Tasks[i]
		if t.State == TaskState_Pending && depChainReachesMergeReady(g, t, mergeReady) {
			out = append(out, t.ID)
		}
	}
	return out
}

func depChainReachesMergeReady(g *waveobj.TaskGroup, t *waveobj.TaskNode, mergeReady map[string]bool) bool {
	for _, d := range t.Deps {
		if mergeReady[d] {
			return true
		}
		dn := taskByID(g, d)
		if dn != nil && !depSatisfied(g, t.ID, d) && depChainReachesMergeReady(g, dn, mergeReady) {
			return true
		}
	}
	return false
}

// buildNext derives the highest-priority current condition per spec §5.3 ordering. TaskIds are always
// in dag order; Actions are the complete valid set for the selected condition (never reconstructed).
func buildNext(g *waveobj.TaskGroup, askByTask map[string]wshrpc.DagAskItem) wshrpc.DagNextStep {
	// 1. required human action, ordered: answer -> approve/sendback -> resolve-merge -> retry-cleanup -> retry/skip/escalate
	if ids := tasksWithAsk(g, askByTask, false); len(ids) > 0 {
		return humanActionStep("answer", ids, digestActionAnswer)
	}
	if ids := tasksInState(g, TaskState_ReviewFailed); len(ids) > 0 {
		return humanActionStep("approve/sendback", ids, digestActionReviewFailed)
	}
	if ids := unreleasedGateIDs(g); len(ids) > 0 {
		return humanActionStep("approve/sendback", ids, digestActionApproveSendback)
	}
	if ids := tasksInState(g, TaskState_BlockedMerge); len(ids) > 0 {
		return humanActionStep("resolve-merge", ids, digestActionResolveMerge)
	}
	if ids := tasksInState(g, TaskState_VerifyFailed); len(ids) > 0 {
		return humanActionStep("resolve-verify", ids, digestActionResolveMerge)
	}
	if ids := failedCleanupIDs(g); len(ids) > 0 {
		return humanActionStep("retry-cleanup", ids, digestActionRetryCleanup)
	}
	if ids := tasksInState(g, TaskState_Failed); len(ids) > 0 {
		return humanActionStep("retry/skip/escalate", ids, digestActionRetrySkipEscalate)
	}
	if ids := tasksInState(g, TaskState_Stalled); len(ids) > 0 {
		return humanActionStep("retry/skip/escalate", ids, digestActionRetrySkipEscalate)
	}
	// the circuit-break halted dispatch with no individual task to point at (its failures were already
	// retried or skipped). Ranked last of the human actions — a task in a bad state is the more useful
	// thing to name — but ahead of every wait kind, because no engine move is coming.
	if g.Failures >= MaxConsecutiveFailures {
		return humanActionStep("retry/skip/escalate", ReadyTasks(g), digestActionRetrySkipEscalate)
	}
	// 1b. a question the lead holds: a child is blocked on the lead, not on the human
	if ids := tasksWithAsk(g, askByTask, true); len(ids) > 0 {
		return wshrpc.DagNextStep{Kind: "lead-action", TaskIds: ids, Actions: digestActionAnswer}
	}
	// 2. merge-ready work that blocks successors (merge-required dags only)
	if blocked := mergeReadyBlocking(g); len(blocked) > 0 {
		return mergeReadyStep(mergeReadyIDs(g))
	}
	// 3. tasks the scheduler can dispatch now
	if next := NextToSpawn(g); len(next) > 0 {
		return wshrpc.DagNextStep{Kind: "dispatch", TaskIds: next}
	}
	// 4. parallelism wait: every slot is busy, so the engine's next move waits on one of them. With a slot
	// free, what holds pending work is its dependencies, which step 5 would name, so say that here.
	if busy := busyTaskIDs(g); len(busy) > 0 {
		if len(busy) < g.Parallelism {
			if depWait, blocking := dependencyWait(g); len(depWait) > 0 {
				return wshrpc.DagNextStep{Kind: "dependency-wait", TaskIds: depWait, BlockingTaskIds: blocking}
			}
		}
		return wshrpc.DagNextStep{Kind: "parallelism-wait", BlockingTaskIds: busy}
	}
	// 4b. merge-ready work that blocks nothing: on a flat dag no successor is ever waiting, so step 2
	// never fires and the gate would fall through to terminal. Ranked below dispatch and parallelism
	// so a dag that can still spawn is never reported as needing the lead.
	if ids := mergeReadyIDs(g); len(ids) > 0 {
		return mergeReadyStep(ids)
	}
	// 4c. a merged task's Verify is running; the next merge waits on it
	if ids := tasksInState(g, TaskState_Verifying); len(ids) > 0 {
		return wshrpc.DagNextStep{Kind: "verify-wait", TaskIds: ids}
	}
	// 5. dependency wait on pending tasks with unsatisfied deps
	if depWait, blocking := dependencyWait(g); len(depWait) > 0 {
		return wshrpc.DagNextStep{Kind: "dependency-wait", TaskIds: depWait, BlockingTaskIds: blocking}
	}
	// 5b. the final stage: failed and waiting on the lead's fix round, or still judging the merged result
	if g.Final != nil && g.Final.State == FinalState_Failed {
		return wshrpc.DagNextStep{Kind: "lead-action", Actions: []string{"fix-round"}}
	}
	if g.Status == DagStatus_Finalizing {
		return wshrpc.DagNextStep{Kind: "final-wait"}
	}
	// 6. terminal
	if g.Status == DagStatus_Done || g.Status == DagStatus_Cancelled {
		return wshrpc.DagNextStep{Kind: "terminal", TerminalStatus: g.Status}
	}
	// 7. a running dag with nothing schedulable, waiting, actionable or unmerged left is waiting on
	// worktree cleanup. Never terminal: the lead's stop signal is the terminal kind, and a fabricated
	// one strands the run while the engine's cleanup retry is still working.
	return wshrpc.DagNextStep{Kind: "cleanup-wait", TaskIds: cleanupPendingIDs(g)}
}

func mergeReadyStep(taskIDs []string) wshrpc.DagNextStep {
	return wshrpc.DagNextStep{Kind: "merge-ready", TaskIds: taskIDs, Actions: digestActionMerge}
}

func humanActionStep(_ string, taskIDs, actions []string) wshrpc.DagNextStep {
	return wshrpc.DagNextStep{Kind: "human-action", TaskIds: taskIDs, Actions: actions}
}

// tasksWithAsk lists the tasks whose pending question the lead holds (lead) or the human does (!lead).
func tasksWithAsk(g *waveobj.TaskGroup, askByTask map[string]wshrpc.DagAskItem, lead bool) []string {
	var ids []string
	for i := range g.Tasks {
		if ask, ok := askByTask[g.Tasks[i].ID]; ok && leadHolds(ask) == lead {
			ids = append(ids, g.Tasks[i].ID)
		}
	}
	return ids
}

func unreleasedGateIDs(g *waveobj.TaskGroup) []string {
	var ids []string
	for i := range g.Tasks {
		t := &g.Tasks[i]
		if t.Gate && t.State == TaskState_Done && !t.Released {
			ids = append(ids, t.ID)
		}
	}
	return ids
}

func tasksInState(g *waveobj.TaskGroup, state string) []string {
	var ids []string
	for i := range g.Tasks {
		if g.Tasks[i].State == state {
			ids = append(ids, g.Tasks[i].ID)
		}
	}
	return ids
}

func failedCleanupIDs(g *waveobj.TaskGroup) []string {
	var ids []string
	for i := range g.Tasks {
		if g.Tasks[i].CleanupError != "" {
			ids = append(ids, g.Tasks[i].ID)
		}
	}
	return ids
}

func cleanupPendingIDs(g *waveobj.TaskGroup) []string {
	var ids []string
	for i := range g.Tasks {
		if g.Tasks[i].CleanupPending {
			ids = append(ids, g.Tasks[i].ID)
		}
	}
	return ids
}

func mergeReadyIDs(g *waveobj.TaskGroup) []string {
	var ids []string
	for i := range g.Tasks {
		if mergeReadyTip(g, &g.Tasks[i]) {
			ids = append(ids, g.Tasks[i].ID)
		}
	}
	return ids
}

func busyTaskIDs(g *waveobj.TaskGroup) []string {
	var ids []string
	for i := range g.Tasks {
		if taskInFlight(g.Tasks[i].State) {
			ids = append(ids, g.Tasks[i].ID)
		}
	}
	return ids
}

// dependencyWait returns pending tasks with unsatisfied deps (dag order) and their blocking task ids
// (the unsat deps, dag order, deduped).
func dependencyWait(g *waveobj.TaskGroup) ([]string, []string) {
	var waiting []string
	blockingSet := map[string]bool{}
	for i := range g.Tasks {
		t := &g.Tasks[i]
		if t.State != TaskState_Pending {
			continue
		}
		hasBlock := false
		for _, d := range t.Deps {
			if !depSatisfied(g, t.ID, d) {
				hasBlock = true
				blockingSet[d] = true
			}
		}
		if hasBlock {
			waiting = append(waiting, t.ID)
		}
	}
	var blocking []string
	for i := range g.Tasks {
		if blockingSet[g.Tasks[i].ID] {
			blocking = append(blocking, g.Tasks[i].ID)
		}
	}
	return waiting, blocking
}

func buildTaskDigest(g *waveobj.TaskGroup, t *waveobj.TaskNode, askByTask map[string]wshrpc.DagAskItem, retried map[string]bool, gateClock map[string]int64, now int64) wshrpc.DagTaskDigest {
	td := wshrpc.DagTaskDigest{
		TaskId:      t.ID,
		FreshnessTs: t.LastActivity,
	}
	if t.State == TaskState_Running || t.State == TaskState_Stalled {
		td.Busy = t.BusyTs > 0 && now-t.BusyTs <= BusyWindow.Milliseconds()
		td.LatestTool = t.LatestTool
	}
	if t.State == TaskState_Running && t.SuspectTs > 0 {
		td.Suspect = t.SuspectReason
	}
	if ask, ok := askByTask[t.ID]; ok {
		td.WaitReason = "ask"
		td.HumanActions = digestActionAnswer
		if leadHolds(ask) {
			td.WaitReason, td.HumanActions = "lead-ask", nil
		}
		td.AskId = ask.AskId
		if len(ask.Questions) > 0 {
			td.AskSummary = truncateText(ask.Questions[0].Question, MaxAskSummaryLen)
		}
		td.AskTs = ask.Ts
		td.AskDeadline = ask.Deadline
	} else if t.Gate && t.State == TaskState_Done && !t.Released {
		td.WaitReason = "gate"
		td.HumanActions = digestActionApproveSendback
	} else {
		td.WaitReason = taskWaitReason(g, t)
		td.HumanActions = taskHumanActions(g, t)
		td.BlockingTaskIds = taskBlockingIds(g, t)
	}
	if t.State == TaskState_Verifying {
		// Verify runs outside a block, so this is the only progress it reports. Derived here, once, because
		// the CLI status row and the cockpit row both render it and must not say different things.
		td.VerifyStartedTs = t.VerifyStartedTs
		td.VerifyLastLine = truncateText(lastOutputLine(t.VerifyOutput), MaxVerifyLineLen)
	}
	if t.State == TaskState_Done && retried[t.ID] {
		td.RecoveredRetry = true
	}
	td.MergeState = taskMergeState(g, t)
	td.MergeGateTs = gateClock[t.ID]
	td.CleanupState = taskCleanupState(g, t)
	return td
}

func taskWaitReason(g *waveobj.TaskGroup, t *waveobj.TaskNode) string {
	switch t.State {
	case TaskState_Running:
		return "none"
	case TaskState_Stalled:
		// stalled is its own state (health + counts carry it); the wait-reason enum has no stall value
		return "none"
	case TaskState_Failed:
		return "failure"
	case TaskState_BlockedMerge:
		return "merge"
	case TaskState_Verifying, TaskState_VerifyFailed:
		return "verify"
	case TaskState_Reviewing, TaskState_ReviewFailed:
		return "review"
	case TaskState_Done:
		return "terminal"
	case TaskState_Skipped, TaskState_Cancelled:
		return "terminal"
	case TaskState_Pending:
		if hasUnsatDep(g, t) {
			return "dependency"
		}
		if taskIsParallelismCapped(g, t) {
			return "parallelism"
		}
		return "none"
	default:
		return "none"
	}
}

// taskIsParallelismCapped reports a ready pending task that cannot spawn because every slot is busy.
func taskIsParallelismCapped(g *waveobj.TaskGroup, t *waveobj.TaskNode) bool {
	if len(NextToSpawn(g)) > 0 {
		return false
	}
	busy := 0
	for i := range g.Tasks {
		if taskInFlight(g.Tasks[i].State) {
			busy++
		}
	}
	return busy > 0 && taskReady(g, t)
}

func taskReady(g *waveobj.TaskGroup, t *waveobj.TaskNode) bool {
	for _, d := range t.Deps {
		if !depSatisfied(g, t.ID, d) {
			return false
		}
	}
	return true
}

func taskBlockingIds(g *waveobj.TaskGroup, t *waveobj.TaskNode) []string {
	if t.State != TaskState_Pending || !hasUnsatDep(g, t) {
		return nil
	}
	var out []string
	for _, d := range t.Deps {
		if !depSatisfied(g, t.ID, d) {
			out = append(out, d)
		}
	}
	return out
}

func taskHumanActions(g *waveobj.TaskGroup, t *waveobj.TaskNode) []string {
	switch {
	case t.CleanupError != "":
		return digestActionRetryCleanup
	case t.State == TaskState_ReviewFailed:
		return digestActionReviewFailed
	case t.State == TaskState_Failed || t.State == TaskState_Stalled:
		return digestActionRetrySkipEscalate
	case t.State == TaskState_BlockedMerge || t.State == TaskState_VerifyFailed:
		return digestActionResolveMerge
	case mergeReadyTip(g, t):
		return digestActionMerge
	}
	return nil
}

func taskMergeState(g *waveobj.TaskGroup, t *waveobj.TaskNode) string {
	if !g.MergeRequired {
		return "not-required"
	}
	if t.Merged {
		return "merged"
	}
	if t.State == TaskState_BlockedMerge {
		return "blocked"
	}
	// a lane merges as one, so only its tip reads ready
	if mergeReadyTip(g, t) {
		return "ready"
	}
	return "waiting"
}

func taskCleanupState(g *waveobj.TaskGroup, t *waveobj.TaskNode) string {
	if !g.MergeRequired {
		return "not-required"
	}
	if t.CleanupError != "" {
		return "failed"
	}
	if t.CleanupPending {
		return "pending"
	}
	return "clear"
}

// buildDurations derives durations strictly from persisted boundaries. A missing required boundary
// yields zero and marks the task (and the aggregate) partial — never a fabricated span.
func buildDurations(sn DagDigestSnapshot) wshrpc.DagDurationDigest {
	g := sn.Group
	d := wshrpc.DagDurationDigest{}
	// elapsed: now-created while active; terminal timestamp minus created after dag-done/cancelled
	terminalTs := terminalEventTs(sn.Retained)
	switch {
	case terminalTs > 0:
		d.ElapsedMs = terminalTs - g.CreatedTs
	case g.Status == DagStatus_Done || g.Status == DagStatus_Cancelled:
		// terminal transition happened but its required boundary was pruned
		d.Partial = true
	default:
		d.ElapsedMs = sn.Now.UnixMilli() - g.CreatedTs
	}
	runByID := map[string]*waveobj.Run{}
	for _, r := range sn.Runs {
		if r != nil {
			runByID[r.ID] = r
		}
	}
	for i := range g.Tasks {
		td := taskDuration(g, &g.Tasks[i], runByID, sn.Retained)
		if td == nil {
			continue
		}
		d.Tasks = append(d.Tasks, *td)
		if td.Partial {
			d.Partial = true
		}
	}
	return d
}

// buildReport gathers the run-end numbers. Worker time sums the per-task run time already derived for
// Durations, and the counts are the sealed record's own tally, so neither can disagree.
func buildReport(sn DagDigestSnapshot, durations wshrpc.DagDurationDigest) wshrpc.DagReportDigest {
	g := sn.Group
	r := wshrpc.DagReportDigest{Unverified: !g.MergeRequired || g.Verify == "", Usage: g.Usage}
	for _, td := range durations.Tasks {
		r.WorkerMs += td.RunMs
	}
	runByID := map[string]*waveobj.Run{}
	for _, run := range sn.Runs {
		if run != nil {
			runByID[run.ID] = run
		}
	}
	for i := range g.Tasks {
		t := &g.Tasks[i]
		worker := runByID[t.RunID]
		// a lane lands one squash commit, recorded on its tip; earlier tasks keep the commits they reported
		if t.Merged && worker != nil && worker.EndCommit != "" && laneTip(g, laneOf(g, t.ID)).ID == t.ID {
			r.Commits = append(r.Commits, wshrpc.DagLandedCommit{TaskId: t.ID, Commit: worker.EndCommit})
		}
		for _, c := range taskCaveats(t, worker) {
			r.UnverifiedNotes = append(r.UnverifiedNotes, wshrpc.DagUnverifiedNote{TaskId: t.ID, Text: c})
		}
	}
	tally := jarvis.TallyDagEvents(sn.Retained)
	r.Answered, r.Forwarded = tally.Answered, tally.Forwarded
	return r
}

// taskDuration derives one task's duration row. Tasks without a child run and without merge/cleanup
// events have nothing to report (not dispatched yet) and get no row.
func taskDuration(g *waveobj.TaskGroup, t *waveobj.TaskNode, runByID map[string]*waveobj.Run, retained []waveobj.RunEvent) *wshrpc.DagTaskDuration {
	td := &wshrpc.DagTaskDuration{TaskId: t.ID}
	hasRow := false
	if t.RunID != "" {
		hasRow = true
		if run, ok := runByID[t.RunID]; ok {
			for _, p := range run.Phases {
				if p.StartedTs > 0 && p.DoneTs > 0 {
					td.RunMs += p.DoneTs - p.StartedTs
				} else if p.StartedTs > 0 || p.DoneTs > 0 {
					// a phase with only one bound: still executing or pruned
					td.Partial = true
				}
			}
		} else {
			// the child run exists in the group but did not load this request
			td.Partial = true
		}
	}
	// merge wait: task-done -> first task-merge-started
	if doneTs := firstTaskEventTs(retained, waveobj.RunEventKindTaskDone, t.ID, true); doneTs > 0 {
		hasRow = true
		if startedTs := firstTaskEventTs(retained, waveobj.RunEventKindTaskMergeStarted, t.ID, false); startedTs > 0 {
			td.MergeWaitMs = startedTs - doneTs
		} else {
			td.Partial = true
		}
	}
	// cleanup: task-cleanup-pending -> completed/failed
	if pendingTs := firstTaskEventTs(retained, waveobj.RunEventKindTaskCleanupPending, t.ID, true); pendingTs > 0 {
		hasRow = true
		if termTs := cleanupTerminalTs(retained, t.ID); termTs > 0 {
			td.CleanupMs = termTs - pendingTs
		} else {
			td.Partial = true
		}
	}
	if !hasRow {
		return nil
	}
	return td
}

// firstTaskEventTs returns the earliest (first=true) or latest (first=false) ts of a task-scoped kind,
// 0 when absent.
func firstTaskEventTs(retained []waveobj.RunEvent, kind, taskID string, earliest bool) int64 {
	var best int64
	for _, ev := range retained {
		if ev.Kind != kind || eventTaskID(ev) != taskID {
			continue
		}
		if best == 0 || (earliest && ev.Ts < best) || (!earliest && ev.Ts > best) {
			best = ev.Ts
		}
	}
	return best
}

// cleanupTerminalTs returns the completion/failure ts of a task's cleanup, 0 while still pending.
func cleanupTerminalTs(retained []waveobj.RunEvent, taskID string) int64 {
	completed := firstTaskEventTs(retained, waveobj.RunEventKindTaskCleanupCompleted, taskID, false)
	failed := firstTaskEventTs(retained, waveobj.RunEventKindTaskCleanupFailed, taskID, false)
	if completed > failed {
		return completed
	}
	return failed
}

// terminalEventTs returns the dag-done/dag-cancelled ts, 0 when neither is retained.
func terminalEventTs(retained []waveobj.RunEvent) int64 {
	var best int64
	for _, ev := range retained {
		if ev.Kind != waveobj.RunEventKindDagDone && ev.Kind != waveobj.RunEventKindDagCancelled {
			continue
		}
		if ev.Ts > best {
			best = ev.Ts
		}
	}
	return best
}

// MaxAskSummaryLen caps the ask summary the digest carries (and the ask lifecycle event writer uses).
const MaxAskSummaryLen = 256

// MaxVerifyLineLen bounds the running-Verify line a status row carries.
const MaxVerifyLineLen = 120

func truncateText(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}
