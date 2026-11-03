// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// mergeFixture is one owner run plus a persisted merge-required dag over a real git repo.
type mergeFixture struct {
	ctx     context.Context
	channel string
	ownerID string
	dagID   string
	project string
}

func newMergeFixture(t *testing.T, tasks []waveobj.TaskNode) *mergeFixture {
	t.Helper()
	ctx := context.Background()
	project := newGitRepo(t)
	ch, err := wstore.CreateChannel(ctx, "merge-"+t.Name(), project)
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 2, true, tasks, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	owner.DagORef = g.OID
	if err := wstore.UpdateRun(ctx, ch.OID, owner.ID, func(r *waveobj.Run) error {
		r.DagORef = g.OID
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	// the plan gate is what holds an unapproved dag; these fixtures start past it
	g.PlanApprovedTs = 1
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	return &mergeFixture{ctx: ctx, channel: ch.OID, ownerID: owner.ID, dagID: g.OID, project: project}
}

// finish marks a task done with a child run, the state the merge path expects.
func (f *mergeFixture) finish(t *testing.T, taskID string) string {
	t.Helper()
	child := jarvis.NewRun("child goal", "ws-1", f.project, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	if err := wstore.AppendRun(f.ctx, f.channel, child); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		task := taskByID(cur, taskID)
		task.State = TaskState_Done
		task.RunID = child.ID
		RecomputeDagStatus(cur)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return child.ID
}

func (f *mergeFixture) dag(t *testing.T) *waveobj.TaskGroup {
	t.Helper()
	g, err := wstore.GetDag(f.ctx, f.dagID)
	if err != nil {
		t.Fatal(err)
	}
	return g
}

// stubMerge replaces the squash so a test can drive the outcome without a real branch.
func stubMerge(t *testing.T, fn func(ctx context.Context, projectPath, runID, goal string) (string, error)) *int {
	t.Helper()
	calls := 0
	old := mergeWorktree
	mergeWorktree = func(ctx context.Context, projectPath, runID string, lane MergeLane, _ []string) (string, error) {
		calls++
		return fn(ctx, projectPath, runID, lane.Title)
	}
	restoreAfterStages(t, func() { mergeWorktree = old })
	return &calls
}

// c84aa179: the tree's removal held the dag lock 22-39 s, and every exit it caused waited on that lock
func TestMergeRemovesTheTreeWithoutHoldingTheDagLock(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.finish(t, "t-0")
	stubMerge(t, func(context.Context, string, string, string) (string, error) { return "sha-1", nil })
	entered, release := make(chan struct{}), make(chan struct{})
	stubCleanupRemover(t, func(context.Context, string, string) error {
		close(entered)
		<-release
		return nil
	})
	stubStopRunWorkers(t)
	done := make(chan error, 1)
	go func() { done <- MergeTask(f.ctx, f.channel, f.ownerID, "t-0") }()
	<-entered
	ran, err := TryWithDagMutation(f.dagID, func() error { return nil })
	close(release)
	if err != nil || !ran {
		t.Fatalf("the dag lock was held while the tree was removed (ran=%v err=%v)", ran, err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if task := f.dag(t).Tasks[0]; task.CleanupPending || task.CleanupError != "" || !task.Merged {
		t.Fatalf("after removal: merged %v pending %v error %q", task.Merged, task.CleanupPending, task.CleanupError)
	}
}

// a merge RPC whose client gave up still finishes the removal it started
func TestRemovalFinishesAfterTheMergeCallerCancels(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.finish(t, "t-0")
	stubMerge(t, func(context.Context, string, string, string) (string, error) { return "sha-1", nil })
	stubStopRunWorkers(t)
	caller, cancel := context.WithCancel(f.ctx)
	entered, release := make(chan struct{}), make(chan struct{})
	stubCleanupRemover(t, func(ctx context.Context, _, _ string) error {
		close(entered)
		<-release
		return ctx.Err() // a removal on the caller's context would fail here
	})
	done := make(chan error, 1)
	go func() { done <- MergeTask(caller, f.channel, f.ownerID, "t-0") }()
	<-entered
	cancel()
	close(release)
	<-done
	if task := f.dag(t).Tasks[0]; task.CleanupPending || task.CleanupError != "" {
		t.Fatalf("the removal failed with its caller: pending %v error %q", task.CleanupPending, task.CleanupError)
	}
}

// c84aa179: an outcome that arrives while a merge's tree is being removed is recorded, not timed out
func TestAChildOutcomeLandsWhileAMergesTreeIsRemoved(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}, {ID: "t-1", Label: "second"}})
	allowWorkerHarnessForTest(t)
	oldSpawn := spawnWorker
	spawnWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		tabID, blockID := uuid.NewString(), uuid.NewString()
		worker := waveobj.MakeORef(waveobj.OType_Tab, tabID).String()
		if err := wstore.DBInsert(f.ctx, &waveobj.Tab{OID: tabID, BlockIds: []string{blockID}, Meta: waveobj.MetaMapType{}}); err != nil {
			return "", err
		}
		if err := wstore.DBInsert(f.ctx, &waveobj.Block{OID: blockID, ParentORef: worker, Meta: waveobj.MetaMapType{}}); err != nil {
			return "", err
		}
		return worker, nil
	}
	restoreAfterStages(t, func() { spawnWorker = oldSpawn })
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	// t-1's worker: its child run's roster names it
	run, err := wstore.GetRun(f.ctx, f.channel, f.dag(t).Tasks[1].RunID)
	if err != nil {
		t.Fatal(err)
	}
	worker := run.Phases[jarvis.RunningPhaseIndex(*run)].WorkerOrefs[0]
	f.finish(t, "t-0")
	stubMerge(t, func(context.Context, string, string, string) (string, error) { return "sha-1", nil })
	stubStopRunWorkers(t)
	entered, release := make(chan struct{}), make(chan struct{})
	stubCleanupRemover(t, func(context.Context, string, string) error {
		close(entered)
		<-release
		return nil
	})
	merged := make(chan error, 1)
	go func() { merged <- MergeTask(f.ctx, f.channel, f.ownerID, "t-0") }()
	<-entered
	outcome := make(chan error, 1)
	go func() {
		// the exit's real deadline, so this fails only if the removal holds the lock, whether or not Task 2 landed
		exitCtx, cancel := context.WithTimeout(f.ctx, 10*time.Second)
		defer cancel()
		outcome <- HandleChildOutcome(exitCtx, worker, jarvis.OutcomeData{Status: "failed", Summary: "tool call errored: invalid input", ExitCode: 2})
	}()
	select {
	case err := <-outcome:
		if err != nil {
			t.Fatalf("outcome lost while the tree was removed: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the outcome waited on the tree's removal")
	}
	close(release)
	if err := <-merged; err != nil {
		t.Fatal(err)
	}
	if task := f.dag(t).Tasks[1]; task.Attempts != 1 {
		t.Fatalf("t-1's failure not recorded: attempts %d", task.Attempts)
	}
}

func stubSpawn(t *testing.T, spawned *[]string) {
	t.Helper()
	allowWorkerHarnessForTest(t)
	old := spawnWorker
	spawnWorker = func(ctx context.Context, cap runroute.Capability, workspaceId, projectName, cwd, prompt string, _ jarvis.RunWorkerOptions) (string, error) {
		*spawned = append(*spawned, prompt)
		return "tab:worker", nil
	}
	restoreAfterStages(t, func() { spawnWorker = old })
}

// the whole point of the change: a finished task lands and its dependent starts, with nobody asked.
func TestScheduleMergesDoneTaskAndUnblocksDependent(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{
		{ID: "t-0", Label: "first"},
		{ID: "t-1", Label: "second", Deps: []string{"t-0"}},
		// a second dependent makes t-0 a lane of its own, so it lands before either starts
		{ID: "t-2", Label: "third", Deps: []string{"t-0"}},
	})
	child := f.finish(t, "t-0")
	calls := stubMerge(t, func(context.Context, string, string, string) (string, error) { return "sha-1", nil })
	var spawned []string
	stubSpawn(t, &spawned)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}

	g := f.dag(t)
	if !g.Tasks[0].Merged {
		t.Fatal("t-0 must be merged by the schedule tick")
	}
	if *calls != 1 {
		t.Fatalf("want 1 merge, got %d", *calls)
	}
	if g.Tasks[1].State != TaskState_Running {
		t.Fatalf("t-1 must be dispatched once its dep landed, got %s", g.Tasks[1].State)
	}
	run, err := wstore.GetRun(f.ctx, f.channel, child)
	if err != nil {
		t.Fatal(err)
	}
	if run.EndCommit != "sha-1" {
		t.Fatalf("child must carry the merge commit, got %q", run.EndCommit)
	}
}

// the commit a worker reports for a lane that landed nothing is only the tip it started from, so the merge
// clears it: the run report and a dependent's handoff read EndCommit as the work the task landed
func TestMergeThatLandedNothingLeavesNoCommitOnTheChild(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "verify only"}})
	child := f.finish(t, "t-0")
	if err := wstore.UpdateRun(f.ctx, f.channel, child, func(r *waveobj.Run) error {
		r.EndCommit = "tip-it-started-from"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	stubMerge(t, func(context.Context, string, string, string) (string, error) { return "", nil })

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}

	if !f.dag(t).Tasks[0].Merged {
		t.Fatal("a lane that landed nothing is still merged")
	}
	run, err := wstore.GetRun(f.ctx, f.channel, child)
	if err != nil {
		t.Fatal(err)
	}
	if run.EndCommit != "" {
		t.Fatalf("want no commit on the child, got %q", run.EndCommit)
	}
}

// a gate is the human's checkpoint; automatic merging must not step over it.
func TestScheduleLeavesGatedTaskUnmergedUntilReleased(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "gated", Gate: true}})
	f.finish(t, "t-0")
	calls := stubMerge(t, func(context.Context, string, string, string) (string, error) { return "sha-1", nil })

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if *calls != 0 {
		t.Fatalf("a held gate must block the merge, got %d attempts", *calls)
	}
	if f.dag(t).Tasks[0].Merged {
		t.Fatal("gated task must stay unmerged")
	}

	if err := ApplyAction(f.ctx, f.dagID, "t-0", "approve", waveobj.RoutePin{}); err != nil {
		t.Fatal(err)
	}
	if *calls != 1 {
		t.Fatalf("want 1 merge after release, got %d", *calls)
	}
	if !f.dag(t).Tasks[0].Merged {
		t.Fatal("released task must merge")
	}
}

// a conflict is the one thing that still needs a person: it must stop, and stay stopped.
func TestScheduleLeavesConflictBlockedAndDoesNotRetry(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "conflicts"}})
	f.finish(t, "t-0")
	calls := stubMerge(t, func(context.Context, string, string, string) (string, error) { return "", ErrMergeConflict })

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	g := f.dag(t)
	if g.Tasks[0].State != TaskState_BlockedMerge {
		t.Fatalf("want blocked-merge, got %s", g.Tasks[0].State)
	}
	if g.Tasks[0].Merged {
		t.Fatal("a conflicted task must not read as merged")
	}

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if *calls != 1 {
		t.Fatalf("a blocked merge must not be retried every tick, got %d attempts", *calls)
	}
}

// the squash commits the index with no pathspec, so staged edits would land inside the task's commit.
func TestScheduleHoldsMergeWhileProjectIndexIsDirty(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.finish(t, "t-0")
	calls := stubMerge(t, func(context.Context, string, string, string) (string, error) { return "sha-1", nil })

	staged := filepath.Join(f.project, "staged.txt")
	if err := os.WriteFile(staged, []byte("mine\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, f.project, "add", "staged.txt")

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if *calls != 0 {
		t.Fatalf("a dirty index must hold the automatic merge, got %d attempts", *calls)
	}
	if f.dag(t).Tasks[0].Merged {
		t.Fatal("task must stay unmerged while the index is dirty")
	}

	// a human landing it themselves is still allowed — they chose this moment
	if err := MergeTask(f.ctx, f.channel, f.ownerID, "t-0"); err != nil {
		t.Fatal(err)
	}
	if !f.dag(t).Tasks[0].Merged {
		t.Fatal("the explicit merge must land regardless of the index")
	}
}

// an already-merged task is re-entered on every tick; it must not merge twice.
func TestScheduleDoesNotRemergeALandedTask(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.finish(t, "t-0")
	calls := stubMerge(t, func(context.Context, string, string, string) (string, error) { return "sha-1", nil })

	for i := 0; i < 3; i++ {
		if err := Schedule(f.ctx, f.dagID); err != nil {
			t.Fatal(err)
		}
	}
	if *calls != 1 {
		t.Fatalf("want exactly 1 merge across repeated ticks, got %d", *calls)
	}
}

// refusedMergeErr is what git says when something in the project checkout is in the way — the S5b live
// check's actual failure. It is not ErrMergeConflict: nothing was applied and the tree is not mid-merge.
func refusedMergeErr() error {
	return fmt.Errorf("squash merge: error: The following untracked working tree files would be overwritten by merge:\n\tnote.txt")
}

// Below the limit a refusal stays retryable — the S5b case cleared itself when the human removed the
// file — but it must no longer be silent while it does.
func TestRefusedMergeIsReportedAndStillRetryable(t *testing.T) {
	// two dependents make t-0 a lane of its own, so it is merge-ready while they are not
	f := newMergeFixture(t, []waveobj.TaskNode{
		{ID: "t-0", Label: "first"},
		{ID: "t-1", Label: "second", Deps: []string{"t-0"}},
		{ID: "t-2", Label: "third", Deps: []string{"t-0"}},
	})
	f.finish(t, "t-0")
	stubMerge(t, func(context.Context, string, string, string) (string, error) { return "", refusedMergeErr() })

	if err := MergeTask(f.ctx, f.channel, f.ownerID, "t-0"); err == nil {
		t.Fatal("a refused merge must return its error")
	}

	g := f.dag(t)
	if g.Tasks[0].State != TaskState_Done {
		t.Fatalf("one refusal must leave the task retryable, got %s", g.Tasks[0].State)
	}
	if g.Tasks[0].MergeFailures != 1 {
		t.Fatalf("want 1 recorded failure, got %d", g.Tasks[0].MergeFailures)
	}
	if !strings.Contains(g.Tasks[0].MergeError, "untracked working tree files") {
		t.Fatalf("the task must carry git's reason, got %q", g.Tasks[0].MergeError)
	}
	detail := firstEventDetail(t, f.ctx, f.channel, f.ownerID, waveobj.RunEventKindTaskMergeFailed)
	if !strings.Contains(detail["error"].(string), "untracked working tree files") {
		t.Fatalf("the event must carry git's reason, got %v", detail["error"])
	}
	if detail["blocked"] != false {
		t.Fatalf("a first refusal is not blocked, got %v", detail["blocked"])
	}
}

// The actual bug: the scheduler re-claimed a refused merge every tick forever. It must stop, and stop
// somewhere a human or the lead can see.
func TestRefusedMergeBlocksAtTheLimitAndStopsRetrying(t *testing.T) {
	// two dependents make t-0 a lane of its own, so it is merge-ready while they are not
	f := newMergeFixture(t, []waveobj.TaskNode{
		{ID: "t-0", Label: "first"},
		{ID: "t-1", Label: "second", Deps: []string{"t-0"}},
		{ID: "t-2", Label: "third", Deps: []string{"t-0"}},
	})
	f.finish(t, "t-0")
	calls := stubMerge(t, func(context.Context, string, string, string) (string, error) { return "", refusedMergeErr() })
	var spawned []string
	stubSpawn(t, &spawned)

	for i := 0; i < mergeFailureLimit+3; i++ {
		if err := Schedule(f.ctx, f.dagID); err != nil {
			t.Fatalf("tick %d: %v", i, err)
		}
	}

	if *calls != mergeFailureLimit {
		t.Fatalf("the automatic path must stop after %d refusals, got %d attempts", mergeFailureLimit, *calls)
	}
	g := f.dag(t)
	if g.Tasks[0].State != TaskState_BlockedMerge {
		t.Fatalf("want blocked-merge at the limit, got %s", g.Tasks[0].State)
	}
	if n := countEvents(t, f.ctx, f.channel, f.ownerID, waveobj.RunEventKindTaskMergeFailed); n != mergeFailureLimit {
		t.Fatalf("want one reported refusal per attempt, got %d", n)
	}
	// row order is the store's, so the block is identified by its attempt number rather than position
	blockedAt := 0.0
	for _, row := range runEventsOfKind(t, f.ctx, f.channel, f.ownerID, waveobj.RunEventKindTaskMergeFailed) {
		var d map[string]any
		if err := json.Unmarshal(row.Detail, &d); err != nil {
			t.Fatal(err)
		}
		if d["blocked"] == true {
			if blockedAt != 0 {
				t.Fatal("only the refusal that reached the limit reports the block")
			}
			blockedAt = d["attempt"].(float64)
		}
	}
	if int(blockedAt) != mergeFailureLimit {
		t.Fatalf("the block must be reported on attempt %d, got %v", mergeFailureLimit, blockedAt)
	}
}

// --continue on a refusal must re-run the whole squash. Continuing it instead would commit an index the
// merge never touched, which finishMerge reads as an idempotent retry — stamping the task merged with
// none of its content.
func TestContinueRetriesARefusedMerge(t *testing.T) {
	// two dependents make t-0 a lane of its own, so it is merge-ready while they are not
	f := newMergeFixture(t, []waveobj.TaskNode{
		{ID: "t-0", Label: "first"},
		{ID: "t-1", Label: "second", Deps: []string{"t-0"}},
		{ID: "t-2", Label: "third", Deps: []string{"t-0"}},
	})
	f.finish(t, "t-0")
	refuse := true
	stubMerge(t, func(context.Context, string, string, string) (string, error) {
		if refuse {
			return "", refusedMergeErr()
		}
		return "sha-1", nil
	})
	continued := 0
	oldContinue := continueMerge
	continueMerge = func(context.Context, string, string, MergeLane, []string) (string, error) {
		continued++
		return "sha-continue", nil
	}
	restoreAfterStages(t, func() { continueMerge = oldContinue })

	for i := 0; i < mergeFailureLimit; i++ {
		_ = MergeTask(f.ctx, f.channel, f.ownerID, "t-0")
	}
	if f.dag(t).Tasks[0].State != TaskState_BlockedMerge {
		t.Fatal("setup: the task must be blocked before --continue")
	}

	refuse = false
	if err := ContinueMerge(f.ctx, f.channel, f.ownerID, "t-0"); err != nil {
		t.Fatalf("continue after a refusal: %v", err)
	}

	if continued != 0 {
		t.Fatal("a refused merge has no resolved tree to continue; it must re-run the squash")
	}
	g := f.dag(t)
	if !g.Tasks[0].Merged {
		t.Fatal("the retried merge must land")
	}
	if g.Tasks[0].MergeFailures != 0 || g.Tasks[0].MergeError != "" {
		t.Fatalf("a landed merge clears the refusal, got %d / %q", g.Tasks[0].MergeFailures, g.Tasks[0].MergeError)
	}
}

// a lane landing between the resolver's staging of the fix and its --continue would be mixed into the squash
// --continue commits, so a conflict awaiting --continue holds every other merge, automatic or explicit
func TestConflictAwaitingContinueHoldsOtherMerges(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "conflicts"}, {ID: "t-1", Label: "clean"}})
	f.finish(t, "t-0")
	childOfT1 := f.finish(t, "t-1")
	conflictKey := LaneWorktreeKey(f.dag(t), "t-0")
	var cleanMerges int
	stubMerge(t, func(_ context.Context, _, runID, _ string) (string, error) {
		if runID == conflictKey {
			return "", ErrMergeConflict
		}
		cleanMerges++
		return "sha-t1", nil
	})
	oldContinue := continueMerge
	continueMerge = func(context.Context, string, string, MergeLane, []string) (string, error) { return "sha-fix", nil }
	restoreAfterStages(t, func() { continueMerge = oldContinue })

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if got := taskByID(f.dag(t), "t-0").State; got != TaskState_BlockedMerge {
		t.Fatalf("t-0 = %s, want blocked-merge", got)
	}
	if cleanMerges != 0 {
		t.Fatalf("t-1 must wait for t-0's --continue, merged %d times", cleanMerges)
	}
	err := MergeTask(f.ctx, f.channel, f.ownerID, "t-1")
	if !errors.Is(err, errProjectBusy) || !strings.Contains(err.Error(), "t-0") {
		t.Fatalf("an explicit merge must be refused naming t-0, got %v", err)
	}

	if err := ContinueMerge(f.ctx, f.channel, f.ownerID, "t-0"); err != nil {
		t.Fatal(err)
	}
	t0Child, err := wstore.GetRun(f.ctx, f.channel, taskByID(f.dag(t), "t-0").RunID)
	if err != nil {
		t.Fatal(err)
	}
	if t0Child.EndCommit != "sha-fix" {
		t.Fatalf("t-0 credited %q, want the resolver's commit", t0Child.EndCommit)
	}
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if !taskByID(f.dag(t), "t-1").Merged {
		t.Fatal("t-1 must land once t-0 is continued")
	}
	if c, _ := wstore.GetRun(f.ctx, f.channel, childOfT1); c.EndCommit != "sha-t1" {
		t.Fatalf("t-1 credited %q, want its own commit", c.EndCommit)
	}
}

func TestHoldingMergesOnADirtyIndexIsRecordedOncePerHold(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.finish(t, "t-0")
	stubMerge(t, landedSha)
	t.Cleanup(func() { mergesHeld.Delete(f.dagID) })

	// the human is mid-edit in the project checkout: the squash would commit their staged work
	os.WriteFile(filepath.Join(f.project, "mine.txt"), []byte("wip\n"), 0o644)
	gitCmd(t, f.project, "add", "mine.txt")

	AutoMergeReady(f.ctx, f.dagID)
	AutoMergeReady(f.ctx, f.dagID)
	if got := countEvents(t, f.ctx, f.channel, f.ownerID, waveobj.RunEventKindMergeHeld); got != 1 {
		t.Fatalf("a hold is recorded once, not once per tick, got %d events", got)
	}
	if task := f.dag(t).Tasks[0]; task.Merged {
		t.Fatal("a dirty index must hold the merge, not land it")
	}

	// staged work put back: the merge lands and the hold clears, so a later hold is reported again
	gitCmd(t, f.project, "reset", "--", "mine.txt")
	AutoMergeReady(f.ctx, f.dagID)
	if task := f.dag(t).Tasks[0]; !task.Merged {
		t.Fatalf("a clean index lands the merge, got state %s", task.State)
	}
	if mergesHeld.Get(f.dagID) {
		t.Fatal("a landed merge clears the hold")
	}
}

func TestAutoMergeableLandsFirstTheLaneMostPendingTasksWaitOn(t *testing.T) {
	g := mustGroup(t, []waveobj.TaskNode{
		{ID: "t-0", Label: "leaf"},
		{ID: "t-1", Label: "hub"},
		// two dependents keep t-1 a lane of its own; t-4 waits on it through t-2
		{ID: "t-2", Label: "a", Deps: []string{"t-1"}},
		{ID: "t-3", Label: "b", Deps: []string{"t-1"}},
		{ID: "t-4", Label: "c", Deps: []string{"t-2"}},
	})
	g.MergeRequired = true
	for _, id := range []string{"t-0", "t-1"} {
		task := taskByID(g, id)
		task.State, task.RunID = TaskState_Done, "run-"+id
	}
	if got := autoMergeable(g); !reflect.DeepEqual(got, []string{"t-1", "t-0"}) {
		t.Fatalf("want the hub first (3 tasks wait on it), then plan order, got %v", got)
	}
	if n := waitingOn(g, "t-1"); n != 3 {
		t.Fatalf("t-2, t-3 and, through t-2, t-4 wait on t-1; got %d", n)
	}
	// a started task is no longer waiting
	taskByID(g, "t-2").State = TaskState_Running
	if n := waitingOn(g, "t-1"); n != 2 {
		t.Fatalf("t-3 and t-4 still wait; got %d", n)
	}
}
