// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// no-merge fixtures: three independent tasks so tests control state precisely.
func plainTasks() []waveobj.TaskNode {
	return []waveobj.TaskNode{
		{ID: "t-0", Label: "a"},
		{ID: "t-1", Label: "b"},
		{ID: "t-2", Label: "c"},
	}
}

// chainTasks makes t-0 -> t-1 -> t-2 (used for dependency-wait and sequential next tests).
func chainTasks() []waveobj.TaskNode {
	return []waveobj.TaskNode{
		{ID: "t-0", Label: "a"},
		{ID: "t-1", Label: "b", Deps: []string{"t-0"}},
		{ID: "t-2", Label: "c", Deps: []string{"t-1"}},
	}
}

func TestHealthNeedsYouAsk(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Running})
	sn := digestSnapshot(g, nil, []wshrpc.DagAskItem{digestAsk("t-0", "ask-1", 2000)}, nil, digestNow)
	d := BuildDigest(sn)
	if d.Health != "needs-you" {
		t.Fatalf("pending ask must put the dag in needs-you, got %q", d.Health)
	}
}

func TestHealthNeedsYouUnreleasedGate(t *testing.T) {
	tasks := []waveobj.TaskNode{
		{ID: "t-0", Label: "a"},
		{ID: "t-1", Label: "gate", Gate: true},
	}
	g := digestGroup(t, false, tasks)
	setTaskStates(g, map[string]string{"t-1": TaskState_Done}) // done gate, never released
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Health != "needs-you" {
		t.Fatalf("done unreleased gate must put the dag in needs-you, got %q", d.Health)
	}
}

func TestHealthNeedsYouBlockedMerge(t *testing.T) {
	g := digestGroup(t, true, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_BlockedMerge})
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Health != "needs-you" {
		t.Fatalf("blocked merge must put the dag in needs-you, got %q", d.Health)
	}
}

func TestHealthNeedsYouTerminalFailure(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Failed})
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Health != "needs-you" {
		t.Fatalf("terminal failure must put the dag in needs-you, got %q", d.Health)
	}
}

func TestHealthNeedsYouFailedCleanupCancelled(t *testing.T) {
	g := digestGroup(t, true, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Done})
	g.Tasks[0].Merged = true
	g.Tasks[0].CleanupError = "worktree locked"
	g.Status = DagStatus_Cancelled // terminal override, but failed cleanup debt remains
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Health != "needs-you" {
		t.Fatalf("cancelled dag with failed cleanup must stay needs-you, got %q", d.Health)
	}
}

func TestHealthStalled(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Stalled})
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Health != "stalled" {
		t.Fatalf("stalled task with no attention must report stalled, got %q", d.Health)
	}
}

func TestHealthHealthyDependencyWait(t *testing.T) {
	g := digestGroup(t, false, chainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Running}) // t-1/t-2 wait on deps
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Health != "healthy" {
		t.Fatalf("dependency wait only must be healthy, got %q", d.Health)
	}
}

func TestHealthHealthyRunning(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Running, "t-1": TaskState_Running})
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Health != "healthy" {
		t.Fatalf("active workers must be healthy, got %q", d.Health)
	}
}

func TestHealthDone(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	g.Final = &waveobj.FinalStage{State: FinalState_Passed, Round: 1}
	setTaskStates(g, map[string]string{"t-0": TaskState_Done, "t-1": TaskState_Done, "t-2": TaskState_Done})
	if g.Status != DagStatus_Done {
		t.Fatalf("fixture should be done, got %s", g.Status)
	}
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Health != "done" {
		t.Fatalf("terminal dag without debt must be done, got %q", d.Health)
	}
}

func TestHealthCancelled(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Running})
	g.Status = DagStatus_Cancelled
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Health != "cancelled" {
		t.Fatalf("cancelled dag without debt must be cancelled, got %q", d.Health)
	}
}

// --- next-step derivation (spec §5.3 ordering) ---

func TestNextAnswer(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Running})
	sn := digestSnapshot(g, nil, []wshrpc.DagAskItem{digestAsk("t-0", "ask-1", 2000)}, nil, digestNow)
	d := BuildDigest(sn)
	if d.Next.Kind != "human-action" || len(d.Next.Actions) != 1 || d.Next.Actions[0] != "answer" {
		t.Fatalf("next must be answer human-action, got %+v", d.Next)
	}
	if len(d.Next.TaskIds) != 1 || d.Next.TaskIds[0] != "t-0" {
		t.Fatalf("answer next must name the ask task, got %+v", d.Next.TaskIds)
	}
}

// a question the lead holds is the lead's to answer until it forwards it or its deadline passes, so it must
// not read as the human's: acceptance 4's overview said "needs-you ... waiting on you — answer" for one
func TestAQuestionTheLeadHoldsIsNotWaitingOnYou(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Running})
	held := digestAsk("t-0", "ask-1", 2000)
	held.Owner = agentask.AskOwner_Lead
	held.Deadline = 602_000
	d := BuildDigest(digestSnapshot(g, nil, []wshrpc.DagAskItem{held}, nil, digestNow))
	if d.Health != "healthy" || d.Counts.Attention != 0 {
		t.Fatalf("a lead-held question is not the human's: health %q, attention %d", d.Health, d.Counts.Attention)
	}
	if d.Next.Kind != "lead-action" || len(d.Next.Actions) != 1 || d.Next.Actions[0] != "answer" ||
		len(d.Next.TaskIds) != 1 || d.Next.TaskIds[0] != "t-0" {
		t.Fatalf("next must be the lead answering t-0, got %+v", d.Next)
	}
	td := d.Tasks[0]
	if td.WaitReason != "lead-ask" || len(td.HumanActions) != 0 {
		t.Fatalf("t-0 waits on the lead with no human action, got %q %v", td.WaitReason, td.HumanActions)
	}
	// the lead reads its question off `dag status` too
	if td.AskId != "ask-1" || td.AskSummary != "should we ship?" {
		t.Fatalf("t-0 must still carry its question, got %q %q", td.AskId, td.AskSummary)
	}
	// the cockpit counts the lead's time down from it
	if td.AskDeadline != 602_000 {
		t.Fatalf("t-0 must carry the lead's deadline, got %d", td.AskDeadline)
	}
}

func TestAForwardedQuestionOutranksOneTheLeadHolds(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Running, "t-1": TaskState_Running})
	held := digestAsk("t-0", "ask-1", 2000)
	held.Owner = agentask.AskOwner_Lead
	forwarded := digestAsk("t-1", "ask-2", 3000)
	forwarded.Owner = agentask.AskOwner_User
	d := BuildDigest(digestSnapshot(g, nil, []wshrpc.DagAskItem{held, forwarded}, nil, digestNow))
	if d.Health != "needs-you" || d.Counts.Attention != 1 {
		t.Fatalf("the forwarded question is the human's: health %q, attention %d", d.Health, d.Counts.Attention)
	}
	if d.Next.Kind != "human-action" || len(d.Next.TaskIds) != 1 || d.Next.TaskIds[0] != "t-1" {
		t.Fatalf("next must be the human answering t-1, got %+v", d.Next)
	}
}

func TestNextApproveSendback(t *testing.T) {
	tasks := []waveobj.TaskNode{
		{ID: "t-0", Label: "a"},
		{ID: "t-1", Label: "gate", Gate: true},
	}
	g := digestGroup(t, false, tasks)
	setTaskStates(g, map[string]string{"t-1": TaskState_Done})
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Next.Kind != "human-action" || len(d.Next.Actions) != 2 ||
		d.Next.Actions[0] != "approve" || d.Next.Actions[1] != "sendback" {
		t.Fatalf("next must be approve/sendback, got %+v", d.Next)
	}
	if len(d.Next.TaskIds) != 1 || d.Next.TaskIds[0] != "t-1" {
		t.Fatalf("gate next must name the gate, got %+v", d.Next.TaskIds)
	}
}

func TestNextResolveMerge(t *testing.T) {
	g := digestGroup(t, true, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_BlockedMerge})
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Next.Kind != "human-action" || len(d.Next.Actions) != 1 || d.Next.Actions[0] != "resolve-merge" {
		t.Fatalf("next must be resolve-merge, got %+v", d.Next)
	}
}

func TestNextRetryCleanup(t *testing.T) {
	g := digestGroup(t, true, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Done})
	g.Tasks[0].Merged = true
	g.Tasks[0].CleanupError = "worktree locked"
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Next.Kind != "human-action" || len(d.Next.Actions) != 1 || d.Next.Actions[0] != "retry-cleanup" {
		t.Fatalf("next must be retry-cleanup, got %+v", d.Next)
	}
}

func TestNextRetrySkipEscalate(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Failed})
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	want := []string{"retry", "skip", "escalate"}
	if d.Next.Kind != "human-action" || !sameStrings(d.Next.Actions, want) {
		t.Fatalf("failed task next must be retry/skip/escalate, got %+v", d.Next)
	}
}

func TestNextStalled(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Stalled})
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Next.Kind != "human-action" {
		t.Fatalf("stalled task must still be a human action, got kind %q", d.Next.Kind)
	}
}

func TestNextMergeReady(t *testing.T) {
	// t-0 has two dependents, so it is a lane of its own: done and unmerged, it blocks both
	g := digestGroup(t, true, []waveobj.TaskNode{
		{ID: "t-0", Label: "a"},
		{ID: "t-1", Label: "b", Deps: []string{"t-0"}},
		{ID: "t-2", Label: "c", Deps: []string{"t-0"}},
	})
	setTaskStates(g, map[string]string{"t-0": TaskState_Done})
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Next.Kind != "merge-ready" {
		t.Fatalf("merge-required dag with unmerged blocking task must be merge-ready, got %q", d.Next.Kind)
	}
	if len(d.Next.TaskIds) != 1 || d.Next.TaskIds[0] != "t-0" {
		t.Fatalf("merge-ready must name the unmerged task, got %+v", d.Next.TaskIds)
	}
}

func TestNextMergeReadyNoBlocker(t *testing.T) {
	g := digestGroup(t, true, plainTasks()) // no deps: t-0 unmerged blocks nothing
	setTaskStates(g, map[string]string{"t-0": TaskState_Done})
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Next.Kind != "dispatch" {
		t.Fatalf("unmerged task that blocks nothing must not preempt dispatch, got %q", d.Next.Kind)
	}
}

// A flat dag has no pending successors, so nothing is ever blocked by an unmerged task and the merge
// gate would otherwise fall through to a bare terminal step — telling the lead to stop with every
// child unmerged.
func TestNextMergeReadyFlatDag(t *testing.T) {
	g := digestGroup(t, true, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Done, "t-1": TaskState_Done, "t-2": TaskState_Done})
	if g.Status != DagStatus_Running {
		t.Fatalf("unmerged tasks must keep the dag running, got %q", g.Status)
	}
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Next.Kind != "merge-ready" {
		t.Fatalf("flat dag with every task done and unmerged must be merge-ready, got %+v", d.Next)
	}
	if !sameStrings(d.Next.TaskIds, []string{"t-0", "t-1", "t-2"}) {
		t.Fatalf("merge-ready must name every unmerged task in dag order, got %+v", d.Next.TaskIds)
	}
	if !sameStrings(d.Next.Actions, []string{"merge"}) {
		t.Fatalf("merge-ready must offer merge, got %+v", d.Next.Actions)
	}
}

// Unmerged work must not preempt the engine's own next move: with every slot busy the lead has
// nothing to do yet, and reporting merge-ready here would wake it on every child that finishes.
func TestNextMergeReadyDoesNotPreemptRunningWork(t *testing.T) {
	g := digestGroup(t, true, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Done, "t-1": TaskState_Running, "t-2": TaskState_Running})
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Next.Kind != "parallelism-wait" {
		t.Fatalf("unmerged task with both slots busy must stay parallelism-wait, got %+v", d.Next)
	}
}

// Cleanup keeps the dag running after the last merge; reporting terminal there is the same
// fabricated stop signal as the flat-dag gate, and worktree removal is exactly what hangs on Windows.
func TestNextCleanupPendingIsNotTerminal(t *testing.T) {
	g := digestGroup(t, true, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Done, "t-1": TaskState_Done, "t-2": TaskState_Done})
	for i := range g.Tasks {
		g.Tasks[i].Merged = true
	}
	g.Tasks[1].CleanupPending = true
	RecomputeDagStatus(g)
	if g.Status != DagStatus_Running {
		t.Fatalf("pending cleanup must keep the dag running, got %q", g.Status)
	}
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Next.Kind == "terminal" {
		t.Fatalf("a running dag must never report terminal, got %+v", d.Next)
	}
	if d.Next.Kind != "cleanup-wait" || !sameStrings(d.Next.TaskIds, []string{"t-1"}) {
		t.Fatalf("merged dag with pending cleanup must be cleanup-wait on t-1, got %+v", d.Next)
	}
	if len(d.Next.Actions) != 0 {
		t.Fatalf("cleanup is the engine's work, not the lead's, got actions %+v", d.Next.Actions)
	}
}

func TestNextDispatch(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{}) // all pending, nothing busy
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Next.Kind != "dispatch" {
		t.Fatalf("ready tasks must dispatch, got %q", d.Next.Kind)
	}
	if len(d.Next.TaskIds) != 2 || d.Next.TaskIds[0] != "t-0" || d.Next.TaskIds[1] != "t-1" {
		t.Fatalf("dispatch must name ready tasks in dag order (capped by parallelism), got %+v", d.Next.TaskIds)
	}
}

func TestNextParallelismWait(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Running, "t-1": TaskState_Running}) // both slots busy
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Next.Kind != "parallelism-wait" {
		t.Fatalf("full parallel slots with ready work must wait, got %q", d.Next.Kind)
	}
	if len(d.Next.BlockingTaskIds) != 2 {
		t.Fatalf("parallelism wait must name the slot-holding tasks, got %+v", d.Next.BlockingTaskIds)
	}
}

func TestNextDependencyWait(t *testing.T) {
	g := digestGroup(t, false, chainTasks())
	// exercise a dependency-only snapshot: the blocker cannot dispatch and no worker is active.
	setTaskStates(g, map[string]string{"t-0": TaskState_Cancelled, "t-1": TaskState_Pending})
	g.Status = DagStatus_Running
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Next.Kind != "dependency-wait" {
		t.Fatalf("dependency hold with no active tasks must be dependency-wait, got %q", d.Next.Kind)
	}
	if len(d.Next.TaskIds) != 2 || d.Next.TaskIds[0] != "t-1" || d.Next.TaskIds[1] != "t-2" {
		t.Fatalf("dependency wait must name the waiting tasks in dag order, got %+v", d.Next.TaskIds)
	}
	if len(d.Next.BlockingTaskIds) != 2 || d.Next.BlockingTaskIds[0] != "t-0" || d.Next.BlockingTaskIds[1] != "t-1" {
		t.Fatalf("dependency wait must name the unsat deps in dag order, got %+v", d.Next.BlockingTaskIds)
	}
}

// with a slot free, a pending task waits on its dependency, not on the parallelism limit
func TestNextDependencyWaitWhenASlotIsFree(t *testing.T) {
	g := digestGroup(t, false, chainTasks()) // parallelism 2
	setTaskStates(g, map[string]string{"t-0": TaskState_Running})
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Next.Kind != "dependency-wait" {
		t.Fatalf("1 of 2 slots busy with dependency holds must be dependency-wait, got %q", d.Next.Kind)
	}
	if !sameStrings(d.Next.TaskIds, []string{"t-1", "t-2"}) || !sameStrings(d.Next.BlockingTaskIds, []string{"t-0", "t-1"}) {
		t.Fatalf("dependency wait must name the waiting tasks and their blockers, got %+v", d.Next)
	}
}

// every slot busy: the parallelism limit is what holds the rest, whatever else they wait on
func TestNextParallelismWaitWhenEverySlotIsBusy(t *testing.T) {
	g := digestGroup(t, false, []waveobj.TaskNode{
		{ID: "t-0", Label: "a"},
		{ID: "t-1", Label: "b"},
		{ID: "t-2", Label: "c", Deps: []string{"t-0"}},
	})
	setTaskStates(g, map[string]string{"t-0": TaskState_Running, "t-1": TaskState_Running})
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Next.Kind != "parallelism-wait" || !sameStrings(d.Next.BlockingTaskIds, []string{"t-0", "t-1"}) {
		t.Fatalf("2 of 2 slots busy must be parallelism-wait on both, got %+v", d.Next)
	}
}

func TestNextDependencyWaitBlocking(t *testing.T) {
	g := digestGroup(t, false, []waveobj.TaskNode{
		{ID: "t-0", Label: "a"},
		{ID: "t-1", Label: "b", Deps: []string{"t-0"}},
		{ID: "t-2", Label: "c", Deps: []string{"t-1"}},
	})
	setTaskStates(g, map[string]string{"t-0": TaskState_Cancelled, "t-1": TaskState_Pending})
	g.Status = DagStatus_Running
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Next.Kind != "dependency-wait" {
		t.Fatalf("no active tasks and dependency holds must be dependency-wait, got %q", d.Next.Kind)
	}
	if len(d.Next.BlockingTaskIds) != 2 || d.Next.BlockingTaskIds[0] != "t-0" || d.Next.BlockingTaskIds[1] != "t-1" {
		t.Fatalf("dependency wait must name the blocking tasks, got %+v", d.Next.BlockingTaskIds)
	}
}

func TestNextTerminal(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	g.Final = &waveobj.FinalStage{State: FinalState_Passed, Round: 1}
	setTaskStates(g, map[string]string{"t-0": TaskState_Done, "t-1": TaskState_Done, "t-2": TaskState_Done})
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Next.Kind != "terminal" || d.Next.TerminalStatus != DagStatus_Done {
		t.Fatalf("done dag must be terminal next, got %+v", d.Next)
	}
}

// buildNext's terminal step is the lead's stop signal and always names the status the dag ended in; a
// consumer that finds it empty reports a contract error rather than inventing one (R15).
func TestNextTerminalCancelledCarriesItsStatus(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Cancelled, "t-1": TaskState_Cancelled, "t-2": TaskState_Cancelled})
	g.Status = DagStatus_Cancelled
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Next.Kind != "terminal" || d.Next.TerminalStatus != DagStatus_Cancelled {
		t.Fatalf("cancelled dag must be terminal next with its status, got %+v", d.Next)
	}
}

// --- counts ---

func TestCountsOverlapSemantics(t *testing.T) {
	g := digestGroup(t, true, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Done, "t-1": TaskState_Running})
	g.Tasks[0].Merged = true // done + merged: no longer merge-ready, no cleanup debt
	sn := digestSnapshot(g, nil, []wshrpc.DagAskItem{digestAsk("t-1", "ask-1", 2000)}, nil, digestNow)
	d := BuildDigest(sn)
	c := d.Counts
	if c.Total != 3 || c.Done != 1 || c.Running != 1 {
		t.Fatalf("basic counts wrong: %+v", c)
	}
	if c.Attention != 1 {
		t.Fatalf("attention must count the ask (merged done task carries none), got %d", c.Attention)
	}
	if c.MergeReady != 0 {
		t.Fatalf("merged task is not merge-ready, got %d", c.MergeReady)
	}
}

func TestCountsMergeReadyUnmerged(t *testing.T) {
	g := digestGroup(t, true, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Done})
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Counts.MergeReady != 1 {
		t.Fatalf("done unmerged task in merge-required dag must count merge-ready, got %d", d.Counts.MergeReady)
	}
	if d.Counts.Done != 1 {
		t.Fatalf("done count includes unmerged done, got %d", d.Counts.Done)
	}
}

func TestCountsStallNotAttention(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Stalled})
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.Counts.Stalled != 1 {
		t.Fatalf("stall count wrong: %d", d.Counts.Stalled)
	}
	if d.Counts.Attention != 0 {
		t.Fatalf("ordinary stall must not count attention, got %d", d.Counts.Attention)
	}
}

func TestCountsDependencyWaiting(t *testing.T) {
	g := digestGroup(t, false, chainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Running})
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	// t-1 waits on t-0 (running, unsat); t-2 waits on t-1 (pending, unsat)
	if d.Counts.DependencyWaiting != 2 {
		t.Fatalf("both t-1 and t-2 wait on unsatisfied deps, got %d", d.Counts.DependencyWaiting)
	}
}

func TestCountsRecoveredRetry(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Done})
	retained := []waveobj.RunEvent{
		retainedEvent(waveobj.RunEventKindTaskRetried, "t-0", 5000),
		retainedEvent(waveobj.RunEventKindTaskRetried, "t-1", 6000),
	}
	d := BuildDigest(digestSnapshot(g, nil, nil, retained, digestNow))
	if d.Counts.RecoveredRetry != 1 {
		t.Fatalf("recovered retry counts done tasks with a retried event, got %d", d.Counts.RecoveredRetry)
	}
	if len(d.Tasks) != 3 || !d.Tasks[0].RecoveredRetry || d.Tasks[1].RecoveredRetry {
		t.Fatalf("recovered retry must mark the right tasks: %+v", d.Tasks)
	}
}

// --- task digests ---

func TestTaskWaitReasonDependencyAndBlocking(t *testing.T) {
	g := digestGroup(t, false, chainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Pending, "t-1": TaskState_Pending})
	sn := digestSnapshot(g, nil, nil, nil, digestNow)
	d := BuildDigest(sn)
	byId := map[string]wshrpc.DagTaskDigest{}
	for _, td := range d.Tasks {
		byId[td.TaskId] = td
	}
	if byId["t-1"].WaitReason != "dependency" {
		t.Fatalf("t-1 must wait on dependency, got %q", byId["t-1"].WaitReason)
	}
	if len(byId["t-1"].BlockingTaskIds) != 1 || byId["t-1"].BlockingTaskIds[0] != "t-0" {
		t.Fatalf("t-1 must name its unsat dep t-0, got %+v", byId["t-1"].BlockingTaskIds)
	}
}

func TestTaskWaitReasonAsk(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Running})
	sn := digestSnapshot(g, nil, []wshrpc.DagAskItem{digestAsk("t-0", "ask-1", 2000)}, nil, digestNow)
	d := BuildDigest(sn)
	td := d.Tasks[0]
	if td.WaitReason != "ask" || td.AskId != "ask-1" || td.AskTs != 2000 || td.AskSummary == "" {
		t.Fatalf("ask task digest wrong: %+v", td)
	}
}

func TestTaskMergeCleanupStates(t *testing.T) {
	g := digestGroup(t, true, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Done})
	g.Tasks[0].Merged = false // unmerged: merge-ready, cleanup clear
	sn := digestSnapshot(g, nil, nil, nil, digestNow)
	d := BuildDigest(sn)
	td := d.Tasks[0]
	if td.MergeState != "ready" || td.CleanupState != "clear" {
		t.Fatalf("merge-ready task states wrong: %+v", td)
	}

	g2 := digestGroup(t, true, plainTasks())
	setTaskStates(g2, map[string]string{"t-0": TaskState_Done})
	g2.Tasks[0].Merged = true
	g2.Tasks[0].CleanupPending = true
	d2 := BuildDigest(digestSnapshot(g2, nil, nil, nil, digestNow))
	td2 := d2.Tasks[0]
	if td2.MergeState != "merged" || td2.CleanupState != "pending" {
		t.Fatalf("pending-cleanup states wrong: %+v", td2)
	}

	g3 := digestGroup(t, true, plainTasks())
	setTaskStates(g3, map[string]string{"t-0": TaskState_Done})
	g3.Tasks[0].Merged = true
	g3.Tasks[0].CleanupError = "locked"
	d3 := BuildDigest(digestSnapshot(g3, nil, nil, nil, digestNow))
	if d3.Tasks[0].CleanupState != "failed" {
		t.Fatalf("failed-cleanup state wrong: %+v", d3.Tasks[0])
	}
}

func TestTaskNotMergeRequiredStates(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Done})
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	td := d.Tasks[0]
	if td.MergeState != "not-required" || td.CleanupState != "not-required" {
		t.Fatalf("non-merge dag task states must be not-required, got %+v", td)
	}
}

// --- durations ---

func TestDurationRunMsComplete(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Done})
	run := childRun("run-t-0", []waveobj.RunPhase{
		phase("execute", 2000, 5000),
		phase("execute", 6000, 7000),
	})
	sn := digestSnapshot(g, []*waveobj.Run{run}, nil, nil, digestNow)
	d := BuildDigest(sn)
	td := d.Durations.Tasks[0]
	if td.RunMs != 4000 || td.Partial {
		t.Fatalf("complete run must sum phase spans exactly, got %+v", td)
	}
}

func TestDurationRunMsPartialRunningPhase(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Running})
	run := childRun("run-t-0", []waveobj.RunPhase{phase("execute", 2000, 0)}) // no done bound
	sn := digestSnapshot(g, []*waveobj.Run{run}, nil, nil, digestNow)
	d := BuildDigest(sn)
	td := d.Durations.Tasks[0]
	if td.RunMs != 0 || !td.Partial {
		t.Fatalf("running phase without done bound must be partial with zero duration, got %+v", td)
	}
}

func TestDurationMergeWait(t *testing.T) {
	g := digestGroup(t, true, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Done})
	g.Tasks[0].Merged = true
	retained := []waveobj.RunEvent{
		retainedEvent("task-merge-started", "t-0", 6000),
		retainedEvent("task-done", "t-0", 5000),
	}
	sn := digestSnapshot(g, []*waveobj.Run{childRun("run-t-0", nil)}, nil, retained, digestNow)
	d := BuildDigest(sn)
	td := d.Durations.Tasks[0]
	if td.MergeWaitMs != 1000 || td.Partial {
		t.Fatalf("merge wait spans task-done to first task-merge-started, got %+v", td)
	}
}

func TestDurationMergeWaitMissingBoundary(t *testing.T) {
	g := digestGroup(t, true, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Done})
	g.Tasks[0].Merged = true
	retained := []waveobj.RunEvent{
		retainedEvent("task-done", "t-0", 5000), // merged but merge-started pruned
	}
	sn := digestSnapshot(g, nil, nil, retained, digestNow)
	d := BuildDigest(sn)
	td := d.Durations.Tasks[0]
	if td.MergeWaitMs != 0 || !td.Partial {
		t.Fatalf("pruned merge boundary must be partial with zero duration, got %+v", td)
	}
}

func TestDurationCleanup(t *testing.T) {
	g := digestGroup(t, true, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Done})
	g.Tasks[0].Merged = true
	retained := []waveobj.RunEvent{
		retainedEvent("task-cleanup-completed", "t-0", 7000),
		retainedEvent("task-cleanup-pending", "t-0", 6500),
	}
	sn := digestSnapshot(g, []*waveobj.Run{childRun("run-t-0", nil)}, nil, retained, digestNow)
	d := BuildDigest(sn)
	td := d.Durations.Tasks[0]
	if td.CleanupMs != 500 || td.Partial {
		t.Fatalf("cleanup spans pending to terminal, got %+v", td)
	}
}

func TestDurationAggregatePartial(t *testing.T) {
	g := digestGroup(t, true, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Done})
	g.Tasks[0].Merged = true
	retained := []waveobj.RunEvent{
		retainedEvent("task-merge-started", "t-0", 6000),
		retainedEvent("task-done", "t-0", 5000),
		retainedEvent("task-cleanup-completed", "t-0", 7000),
	}
	sn := digestSnapshot(g, nil, nil, retained, digestNow)
	d := BuildDigest(sn)
	// cleanup-pending pruned -> task partial -> aggregate partial
	if !d.Durations.Partial {
		t.Fatalf("pruned cleanup-pending must mark the aggregate partial, got %+v", d.Durations)
	}
}

func TestDurationElapsedActive(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Running})
	sn := digestSnapshot(g, []*waveobj.Run{childRun("run-t-0", nil)}, nil, nil, digestNow) // created 1000, now 10000
	d := BuildDigest(sn)
	if d.Durations.ElapsedMs != 9000 || d.Durations.Partial {
		t.Fatalf("active elapsed is now-created, got %+v", d.Durations)
	}
}

func TestDurationElapsedTerminal(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Done, "t-1": TaskState_Done, "t-2": TaskState_Done})
	retained := []waveobj.RunEvent{retainedDagEvent(waveobj.RunEventKindDagDone, 8000)}
	runs := []*waveobj.Run{
		childRun("run-t-0", nil),
		childRun("run-t-1", nil),
		childRun("run-t-2", nil),
	}
	sn := digestSnapshot(g, runs, nil, retained, digestNow)
	d := BuildDigest(sn)
	if d.Durations.ElapsedMs != 7000 || d.Durations.Partial {
		t.Fatalf("terminal elapsed is dag-done - created, got %+v", d.Durations)
	}
}

func TestDurationElapsedTerminalPruned(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Done, "t-1": TaskState_Done, "t-2": TaskState_Done})
	sn := digestSnapshot(g, nil, nil, nil, digestNow) // terminal but dag-done pruned
	d := BuildDigest(sn)
	if !d.Durations.Partial {
		t.Fatalf("pruned terminal boundary must mark elapsed partial, got %+v", d.Durations)
	}
}

// --- version/stability ---

func TestDigestVersionMatchesGroup(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	g.Version = 42
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if d.DagVersion != 42 {
		t.Fatalf("digest version must equal group version, got %d", d.DagVersion)
	}
}

func TestChangedAskProducesNewDigest(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Running})
	noAsk := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	withAsk := BuildDigest(digestSnapshot(g, nil, []wshrpc.DagAskItem{digestAsk("t-0", "ask-2", 4000)}, nil, digestNow))
	if noAsk.DagVersion != withAsk.DagVersion {
		t.Fatalf("fixture must share the dag version")
	}
	if noAsk.Tasks[0].AskId == withAsk.Tasks[0].AskId || withAsk.Tasks[0].AskId != "ask-2" {
		t.Fatalf("same version with changed ask state must change the digest ask id")
	}
	if noAsk.Next.Kind == withAsk.Next.Kind {
		t.Fatalf("ask presence must change the next step (want dispatch vs human-action)")
	}
}

func sameStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// The merge gate opens correctly; what was missing was any age on it. A gate nobody has acted on
// past MergeGateStaleAfter must stop reading "healthy", or a lead that died at the gate strands
// finished work indefinitely with nothing escalating.
func TestStaleMergeGateNeedsYou(t *testing.T) {
	g := digestGroup(t, true, []waveobj.TaskNode{{ID: "t-0", Label: "a"}})
	setTaskStates(g, map[string]string{"t-0": TaskState_Done})
	now := time.Now()
	doneTs := now.Add(-MergeGateStaleAfter - time.Minute).UnixMilli()

	d := BuildDigest(DagDigestSnapshot{
		Group:    g,
		Retained: []waveobj.RunEvent{retainedEvent(waveobj.RunEventKindTaskDone, "t-0", doneTs)},
		Now:      now,
	})
	if d.Health != "needs-you" {
		t.Fatalf("a merge gate open past the threshold must read needs-you, got %q", d.Health)
	}
	if d.Counts.Attention != 1 {
		t.Fatalf("stale gate must count as attention, got %d", d.Counts.Attention)
	}
	// the gate itself is still reported the same way: this adds an age, it does not change the step
	if d.Next.Kind != "merge-ready" {
		t.Fatalf("next step must stay merge-ready, got %q", d.Next.Kind)
	}
}

// A gate that just opened is a lead's normal working window, not an escalation.
func TestFreshMergeGateStaysHealthy(t *testing.T) {
	g := digestGroup(t, true, []waveobj.TaskNode{{ID: "t-0", Label: "a"}})
	setTaskStates(g, map[string]string{"t-0": TaskState_Done})
	now := time.Now()

	d := BuildDigest(DagDigestSnapshot{
		Group:    g,
		Retained: []waveobj.RunEvent{retainedEvent(waveobj.RunEventKindTaskDone, "t-0", now.Add(-time.Minute).UnixMilli())},
		Now:      now,
	})
	if d.Health != "healthy" {
		t.Fatalf("a just-opened merge gate must stay healthy, got %q", d.Health)
	}
	if d.Counts.Attention != 0 {
		t.Fatalf("fresh gate must not count as attention, got %d", d.Counts.Attention)
	}
}

// Run events are pruned by volume, so a long-parked gate can lose the boundary it ages from. With no
// clock, the gate is left alone: a missed escalation costs a timeout, a fabricated one raises a false
// alarm on work that may be perfectly live.
func TestMergeGateWithoutDoneEventIsNotStale(t *testing.T) {
	g := digestGroup(t, true, []waveobj.TaskNode{{ID: "t-0", Label: "a"}})
	setTaskStates(g, map[string]string{"t-0": TaskState_Done})

	d := BuildDigest(DagDigestSnapshot{Group: g, Now: time.Now()})
	if d.Health != "healthy" {
		t.Fatalf("a gate with no done boundary has no age; want healthy, got %q", d.Health)
	}
}

// The gate's age is rendered by the CLI and the cockpit, so the digest carries the clock it is aged from:
// the same retained task-done boundary the stale check reads, and only on the lane tip that is the gate.
func TestMergeGateTsIsTheDoneBoundaryOfTheGate(t *testing.T) {
	g := digestGroup(t, true, []waveobj.TaskNode{{ID: "t-0", Label: "a"}, {ID: "t-1", Label: "b"}})
	setTaskStates(g, map[string]string{"t-0": TaskState_Done, "t-1": TaskState_Done})
	g.Tasks[1].Merged = true
	now := time.Now()
	doneTs := now.Add(-34 * time.Minute).UnixMilli()
	d := BuildDigest(DagDigestSnapshot{
		Group: g,
		Retained: []waveobj.RunEvent{
			retainedEvent(waveobj.RunEventKindTaskDone, "t-0", doneTs),
			retainedEvent(waveobj.RunEventKindTaskDone, "t-1", doneTs),
		},
		Now: now,
	})
	if d.Tasks[0].MergeGateTs != doneTs {
		t.Fatalf("an open gate carries its done boundary, got %d want %d", d.Tasks[0].MergeGateTs, doneTs)
	}
	if d.Tasks[1].MergeGateTs != 0 {
		t.Fatalf("a merged task has no open gate, got %d", d.Tasks[1].MergeGateTs)
	}
}

// Pruned history leaves the gate with no clock: no timestamp, so nothing renders an age from the epoch.
func TestMergeGateTsIsZeroWithoutADoneEvent(t *testing.T) {
	g := digestGroup(t, true, []waveobj.TaskNode{{ID: "t-0", Label: "a"}})
	setTaskStates(g, map[string]string{"t-0": TaskState_Done})
	d := BuildDigest(DagDigestSnapshot{Group: g, Now: time.Now()})
	if d.Tasks[0].MergeState != "ready" || d.Tasks[0].MergeGateTs != 0 {
		t.Fatalf("a ready gate with no done event has no clock, got state %q ts %d", d.Tasks[0].MergeState, d.Tasks[0].MergeGateTs)
	}
}

// A lane merges as one at its tip; an earlier task in the lane is not a gate and carries no clock.
func TestMergeGateTsOnlyOnTheLaneTip(t *testing.T) {
	g := digestGroup(t, true, []waveobj.TaskNode{{ID: "t-0", Label: "a"}, {ID: "t-1", Label: "b", Deps: []string{"t-0"}}})
	setTaskStates(g, map[string]string{"t-0": TaskState_Done, "t-1": TaskState_Done})
	now := time.Now()
	d := BuildDigest(DagDigestSnapshot{
		Group: g,
		Retained: []waveobj.RunEvent{
			retainedEvent(waveobj.RunEventKindTaskDone, "t-0", now.Add(-40*time.Minute).UnixMilli()),
			retainedEvent(waveobj.RunEventKindTaskDone, "t-1", now.Add(-5*time.Minute).UnixMilli()),
		},
		Now: now,
	})
	if d.Tasks[0].MergeGateTs != 0 {
		t.Fatalf("a non-tip lane task is not the gate, got ts %d", d.Tasks[0].MergeGateTs)
	}
	if d.Tasks[1].MergeGateTs == 0 {
		t.Fatalf("the lane tip is the gate and carries its clock")
	}
}

func TestDigestBusyIsARecentBusySample(t *testing.T) {
	now := time.UnixMilli(10_000_000)
	cases := []struct {
		name   string
		state  string
		busyTs int64
		want   bool
	}{
		{"busy 30s ago", TaskState_Running, now.UnixMilli() - 30_000, true},
		{"busy 60s ago", TaskState_Running, now.UnixMilli() - 60_000, false},
		{"a done task", TaskState_Done, now.UnixMilli() - 30_000, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			g := digestGroup(t, false, []waveobj.TaskNode{{ID: "t-0", Label: "a"}})
			g.Tasks[0].State = c.state
			g.Tasks[0].BusyTs = c.busyTs
			d := BuildDigest(DagDigestSnapshot{Group: g, Now: now})
			if d.Tasks[0].Busy != c.want {
				t.Fatalf("Busy = %v, want %v", d.Tasks[0].Busy, c.want)
			}
		})
	}
}

func TestDigestSuspectOnlyWhileFlagged(t *testing.T) {
	now := time.UnixMilli(10_000_000)
	cases := []struct {
		name      string
		state     string
		suspectTs int64
		want      string
	}{
		{"flagged", TaskState_Running, now.UnixMilli() - 60_000, "worktree unchanged 22m while active"},
		{"re-armed", TaskState_Running, 0, ""},
		{"a done task", TaskState_Done, now.UnixMilli() - 60_000, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			g := digestGroup(t, false, []waveobj.TaskNode{{ID: "t-0", Label: "a"}})
			g.Tasks[0].State = c.state
			g.Tasks[0].SuspectTs = c.suspectTs
			g.Tasks[0].SuspectReason = "worktree unchanged 22m while active"
			d := BuildDigest(DagDigestSnapshot{Group: g, Now: now})
			if d.Tasks[0].Suspect != c.want {
				t.Fatalf("Suspect = %q, want %q", d.Tasks[0].Suspect, c.want)
			}
		})
	}
}

func TestDigestCarriesTheWorkersResultAndReview(t *testing.T) {
	g := digestGroup(t, false, []waveobj.TaskNode{{ID: "t-1", Label: "a"}})
	g.Tasks[0].State = TaskState_Done
	g.Tasks[0].RunID = "run-1"
	g.Tasks[0].ReviewVerdict = ReviewVerdict_Pass
	g.Tasks[0].ReviewNote = "adds fmtDate"
	g.Tasks[0].ReviewDownstream = "fmtDate lives in util/date.go"
	run := childRun("run-1", nil)
	run.Evidence = &waveobj.RunEvidence{Summary: digestTestReport}
	d := BuildDigest(digestSnapshot(g, []*waveobj.Run{run}, nil, nil, time.UnixMilli(10_000)))
	td := d.Tasks[0]
	if td.ReviewVerdict != ReviewVerdict_Pass || td.ReviewNote != "adds fmtDate" || td.ReviewDownstream != "fmtDate lives in util/date.go" {
		t.Fatalf("the lead must read the latest review, got %+v", td)
	}
	if want := []string{"differs", "found-not-fixed"}; !slices.Equal(td.ReportSections, want) {
		t.Fatalf("the digest names the sections with content, Done aside: want %v, got %v", want, td.ReportSections)
	}
}

const digestTestReport = `## Done
Added fmtDate and its tests.

## Differs from plan
Put it in util/date.go.

## Not verified
None

## For later tasks
None.

## Found not fixed
TestOld fails on main.`

func TestReportSectionKeys(t *testing.T) {
	doneOnly := strings.NewReplacer("Put it in util/date.go.", "None", "TestOld fails on main.", "None").Replace(digestTestReport)
	cases := []struct {
		name    string
		summary string
		want    []string
	}{
		{"legacy report", "Added fmtDate and its tests.", []string{"unstructured"}},
		{"done only", doneOnly, []string{"done"}},
		{"no evidence text", "", nil},
	}
	for _, c := range cases {
		if got := reportSectionKeys(c.summary); !slices.Equal(got, c.want) {
			t.Errorf("%s: want %v, got %v", c.name, c.want, got)
		}
	}
}

// a reviewer's caveat reaches the lead whole, on the task and in the run-end report it writes from
func TestDigestCarriesAReviewersUnverifiedCaveat(t *testing.T) {
	g := digestGroup(t, false, []waveobj.TaskNode{{ID: "t-1", Label: "a"}, {ID: "t-7", Label: "b"}})
	g.Tasks[0].State = TaskState_Done
	g.Tasks[1].State = TaskState_Done
	g.Tasks[1].ReviewVerdict = ReviewVerdict_Pass
	g.Tasks[1].ReviewUnverified = "no screenshot of the run card was taken"
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, time.UnixMilli(10_000)))
	if d.Tasks[0].ReviewUnverified != "" || d.Tasks[1].ReviewUnverified != "no screenshot of the run card was taken" {
		t.Fatalf("the task digest must carry the caveat, got %+v", d.Tasks)
	}
	want := []wshrpc.DagUnverifiedNote{{TaskId: "t-7", Text: "reviewer: no screenshot of the run card was taken"}}
	if !reflect.DeepEqual(d.Report.UnverifiedNotes, want) {
		t.Fatalf("the report must list the caveat, got %+v", d.Report.UnverifiedNotes)
	}
}

// caveatTestReport is digestTestReport with something the worker could not verify
var caveatTestReport = strings.Replace(digestTestReport, "## Not verified\nNone", "## Not verified\nThe CRLF path has no test.", 1)

// the run-end report lists each landed task's caveats in dag order: the worker's own (a legacy report whole, since
// its caveats can't be told apart), then the reviewer's addition. A task that did not land has none.
func TestDigestReportListsTheWorkersAndTheReviewersCaveats(t *testing.T) {
	g := digestGroup(t, false, []waveobj.TaskNode{{ID: "t-1", Label: "a"}, {ID: "t-2", Label: "b"}, {ID: "t-3", Label: "c"}})
	setTaskStates(g, map[string]string{"t-1": TaskState_Done, "t-2": TaskState_Done})
	g.Tasks[2].State, g.Tasks[2].RunID = TaskState_Skipped, "run-t-3"
	g.Tasks[0].ReviewUnverified = "no screenshot of the run card was taken"
	runs := []*waveobj.Run{
		{ID: "run-t-1", Evidence: &waveobj.RunEvidence{Summary: caveatTestReport}},
		{ID: "run-t-2", Evidence: &waveobj.RunEvidence{Summary: "Added fmtDate; did not run the e2e."}},
		{ID: "run-t-3", Evidence: &waveobj.RunEvidence{Summary: caveatTestReport}},
	}
	d := BuildDigest(digestSnapshot(g, runs, nil, nil, time.UnixMilli(10_000)))
	want := []wshrpc.DagUnverifiedNote{
		{TaskId: "t-1", Text: "The CRLF path has no test."},
		{TaskId: "t-1", Text: "reviewer: no screenshot of the run card was taken"},
		{TaskId: "t-2", Text: "Added fmtDate; did not run the e2e."},
	}
	if !reflect.DeepEqual(d.Report.UnverifiedNotes, want) {
		t.Fatalf("want %+v, got %+v", want, d.Report.UnverifiedNotes)
	}
}

// the report's counts and the told list come from the one tally the sealed record uses
func TestDigestCountsAnswersForwardsAndTold(t *testing.T) {
	g := digestGroup(t, false, []waveobj.TaskNode{{ID: "t-1", Label: "a"}})
	told := retainedEvent(waveobj.RunEventKindTaskTold, "t-1", 50)
	told.Detail = []byte(`{"taskid":"t-1","text":"stop and commit"}`)
	retained := []waveobj.RunEvent{
		told,
		retainedDagEvent(waveobj.RunEventKindChildAnswered, 40),
		retainedDagEvent(waveobj.RunEventKindChildAnswered, 30),
		retainedEvent(waveobj.RunEventKindTaskForwarded, "t-1", 20),
	}
	d := BuildDigest(digestSnapshot(g, nil, nil, retained, time.UnixMilli(10_000)))
	if d.Report.Answered != 2 || d.Report.Forwarded != 1 {
		t.Fatalf("want 2 answered and 1 forwarded, got %+v", d.Report)
	}
	if want := []wshrpc.DagTold{{TaskId: "t-1", Ts: 50, Text: "stop and commit"}}; !reflect.DeepEqual(d.Told, want) {
		t.Fatalf("want %+v, got %+v", want, d.Told)
	}
}

func TestDigestNamesAFailedReviewForJudgment(t *testing.T) {
	g := digestGroup(t, false, []waveobj.TaskNode{{ID: "t-1", Label: "a"}, {ID: "t-2", Label: "b", Deps: []string{"t-1"}}})
	g.Tasks[0].State = TaskState_ReviewFailed
	RecomputeDagStatus(g)
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, time.UnixMilli(10_000)))
	if d.Next.Kind != "human-action" || strings.Join(d.Next.Actions, ",") != "approve,sendback,retry,skip,escalate" {
		t.Fatalf("want the review-failed actions, got %+v", d.Next)
	}
	if d.Tasks[0].WaitReason != "review" || d.Health != "needs-you" || d.Counts.Attention != 1 {
		t.Fatalf("a failed review needs judgment, got %+v health %s", d.Tasks[0], d.Health)
	}
}

func TestDigestCountsAReviewingTaskAsBusy(t *testing.T) {
	g := digestGroup(t, false, []waveobj.TaskNode{{ID: "t-1", Label: "a"}})
	g.Tasks[0].State = TaskState_Reviewing
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, time.UnixMilli(10_000)))
	if d.Counts.Running != 1 || d.Next.Kind != "parallelism-wait" || d.Tasks[0].WaitReason != "review" {
		t.Fatalf("a review in flight is busy work, got counts %+v next %+v task %+v", d.Counts, d.Next, d.Tasks[0])
	}
}

func TestNextWaitsOnTheFinalStage(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Done, "t-1": TaskState_Done, "t-2": TaskState_Done})
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if g.Status != DagStatus_Finalizing || d.Next.Kind != "final-wait" || d.Health != "healthy" {
		t.Fatalf("every task landed: want finalizing, final-wait and healthy, got %s / %+v / %s", g.Status, d.Next, d.Health)
	}
}

func TestAFailedFinalStageWaitsOnTheLeadsFixRound(t *testing.T) {
	g := digestGroup(t, false, plainTasks())
	g.Final = &waveobj.FinalStage{State: FinalState_Failed, Round: 1, Detail: "Check `go vet ./...` failed (exit 1):\nx.go:3"}
	setTaskStates(g, map[string]string{"t-0": TaskState_Done, "t-1": TaskState_Done, "t-2": TaskState_Done})
	d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow))
	if g.Status != DagStatus_Blocked || BlockingKind(g) != BlockingKindFinalFailed {
		t.Fatalf("want blocked on final-failed, got %s / %q", g.Status, BlockingKind(g))
	}
	if d.Health != "needs-you" || d.Next.Kind != "lead-action" || !reflect.DeepEqual(d.Next.Actions, []string{"fix-round"}) {
		t.Fatalf("want the lead's fix round next, got %s / %+v", d.Health, d.Next)
	}
	if d.Final == nil || d.Final.Detail != g.Final.Detail {
		t.Fatalf("the digest carries the final stage whole, got %+v", d.Final)
	}
}

func TestHealthFollowsAFinishedRunPastItsParkedDag(t *testing.T) {
	failedFinal := func() *waveobj.TaskGroup {
		g := digestGroup(t, false, plainTasks())
		g.Final = &waveobj.FinalStage{State: FinalState_Failed, Round: 1}
		setTaskStates(g, map[string]string{"t-0": TaskState_Done, "t-1": TaskState_Done, "t-2": TaskState_Done})
		return g
	}
	openGate := func() *waveobj.TaskGroup {
		tasks := plainTasks()
		tasks[0].Gate = true
		g := digestGroup(t, false, tasks)
		setTaskStates(g, map[string]string{"t-0": TaskState_Done})
		return g
	}
	cleanupDebt := failedFinal()
	cleanupDebt.Tasks[0].CleanupError = "worktree locked"
	cases := []struct {
		name      string
		g         *waveobj.TaskGroup
		dagStatus string
		runStatus string
		want      string
	}{
		{"failed final, run executing", failedFinal(), DagStatus_Blocked, "executing", "needs-you"},
		{"failed final, run done", failedFinal(), DagStatus_Blocked, "done", "done"},
		{"failed final, run cancelled", failedFinal(), DagStatus_Blocked, "cancelled", "cancelled"},
		{"open gate, run done", openGate(), DagStatus_AwaitingReview, "done", "done"},
		{"cleanup debt, run done", cleanupDebt, DagStatus_Blocked, "done", "needs-you"},
	}
	for _, c := range cases {
		if c.g.Status != c.dagStatus {
			t.Fatalf("%s: dag status = %q, want %q", c.name, c.g.Status, c.dagStatus)
		}
		sn := digestSnapshot(c.g, nil, nil, nil, digestNow)
		sn.Owner = &waveobj.Run{ID: "run-1", Status: c.runStatus}
		if got := BuildDigest(sn).Health; got != c.want {
			t.Errorf("%s: health = %q, want %q", c.name, got, c.want)
		}
	}
}
