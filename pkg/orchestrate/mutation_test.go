package orchestrate

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func seedPendingDag(t *testing.T) (context.Context, *waveobj.TaskGroup) {
	t.Helper()
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "mutation-seed", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{
		{ID: "t-0", Label: "a"},
	}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	return ctx, &g
}

func TestScheduleSerializesSameDag(t *testing.T) {
	ctx, dag := seedPendingDag(t)
	allowWorkerHarnessForTest(t)

	entered := make(chan struct{})
	duplicateEntered := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32
	old := spawnWorker
	spawnWorker = func(ctx context.Context, cap runroute.Capability, workspaceId, projectName, cwd, prompt string, _ jarvis.RunWorkerOptions) (string, error) {
		switch calls.Add(1) {
		case 1:
			close(entered)
			<-release
		case 2:
			close(duplicateEntered)
		}
		return waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String(), nil
	}
	restoreAfterStages(t, func() { spawnWorker = old })

	errs := make(chan error, 2)
	go func() { errs <- Schedule(ctx, dag.OID) }()
	<-entered
	secondStarted := make(chan struct{})
	go func() {
		close(secondStarted)
		errs <- Schedule(ctx, dag.OID)
	}()
	<-secondStarted
	select {
	case <-duplicateEntered:
		t.Fatal("second scheduler entered spawn while the first still held the DAG")
	case <-time.After(50 * time.Millisecond):
	}
	close(release)
	if err := <-errs; err != nil {
		t.Fatal(err)
	}
	if err := <-errs; err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatalf("spawn calls = %d, want 1", calls.Load())
	}
}

func seedFailedDag(t *testing.T) (context.Context, *waveobj.TaskGroup, waveobj.Run) {
	t.Helper()
	ctx, dag := seedPendingDag(t)
	child := jarvis.NewRun("child goal", "ws-1", t.TempDir(), nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	child.Status = jarvis.RunStatus_Blocked
	if err := wstore.AppendRun(ctx, dag.ChannelId, child); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].State = TaskState_Running
		g.Tasks[0].RunID = child.ID
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return ctx, dag, child
}

func TestScheduleRetainsFailedChildOwnershipForRetry(t *testing.T) {
	ctx, dag, child := seedFailedDag(t)

	if err := Schedule(ctx, dag.OID); err != nil {
		t.Fatal(err)
	}
	got, err := wstore.GetDag(ctx, dag.OID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Tasks[0].State != TaskState_Failed || got.Tasks[0].RunID != child.ID {
		t.Fatalf("failed task ownership = state %q run %q, want failed/%q", got.Tasks[0].State, got.Tasks[0].RunID, child.ID)
	}
}

func TestRetryKeepsFailedOwnershipWhenWorkerStopFails(t *testing.T) {
	ctx, dag, child := seedFailedDag(t)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].State = TaskState_Failed
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	oldStop := stopRunWorkers
	stopRunWorkers = func(context.Context, *waveobj.Run) error { return errors.New("stop failed") }
	restoreAfterStages(t, func() { stopRunWorkers = oldStop })

	err := ApplyAction(ctx, dag.OID, dag.Tasks[0].ID, "retry", waveobj.RoutePin{})
	if err == nil || !strings.Contains(err.Error(), "stop failed") {
		t.Fatalf("retry error = %v, want stop failure", err)
	}
	got, getErr := wstore.GetDag(ctx, dag.OID)
	if getErr != nil {
		t.Fatal(getErr)
	}
	if got.Tasks[0].State != TaskState_Failed || got.Tasks[0].RunID != child.ID {
		t.Fatalf("failed task ownership = state %q run %q, want failed/%q", got.Tasks[0].State, got.Tasks[0].RunID, child.ID)
	}
}

// The retry cancelled the worker's run before its stop failed: the next tick must fail the task for the lead, not
// read the cancelled run as the dag cancelled while its siblings keep running.
func TestFailedRetryFailsTheTaskNotTheDag(t *testing.T) {
	ctx, dag, _, _ := seedRunningDag(t)
	oldStop := stopRunWorkers
	stopRunWorkers = func(context.Context, *waveobj.Run) error { return errors.New("stop failed") }
	restoreAfterStages(t, func() { stopRunWorkers = oldStop })

	if err := ApplyAction(ctx, dag.OID, dag.Tasks[0].ID, "retry", waveobj.RoutePin{}); err == nil {
		t.Fatal("retry with a failing stop succeeded")
	}
	if err := Schedule(ctx, dag.OID); err != nil {
		t.Fatal(err)
	}
	got := mustLoadDag(t, ctx, dag.OID)
	if got.Status == DagStatus_Cancelled {
		t.Fatal("a failed retry cancelled the dag")
	}
	if task := got.Tasks[0]; task.State != TaskState_Failed || task.LastFailureKind != FailureKindWorkerStopped {
		t.Fatalf("task = %s (%s), want failed (%s)", task.State, task.LastFailureKind, FailureKindWorkerStopped)
	}
	if got.Failures != 0 {
		t.Fatalf("failures = %d: a stopped worker is no failed attempt", got.Failures)
	}
}

// A retry re-runs the task from pending, so from a state that already landed or holds a merge it would lose work:
// a merged task's new commit never merges, a blocked merge leaves its conflicted squash in the checkout, and a
// failed Verify lets later merges land on the failing commit. Each refusal names what to do instead.
func TestRetryRefusesStatesItWouldLoseWorkFrom(t *testing.T) {
	cases := []struct {
		state string
		gate  bool
		hint  string
	}{
		{TaskState_Done, false, "dag amend"},
		{TaskState_Done, true, "dag approve t-0"},
		{TaskState_BlockedMerge, false, "dag merge t-0 --continue"},
		{TaskState_Verifying, false, "wait for it"},
		{TaskState_VerifyFailed, false, "dag merge t-0 --continue"},
		{TaskState_Skipped, false, "stays skipped"},
		{TaskState_Pending, false, "has not started"},
	}
	for _, tc := range cases {
		name := tc.state
		if tc.gate {
			name += "-gate"
		}
		t.Run(name, func(t *testing.T) {
			ctx, dag, child := seedFailedDag(t)
			if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
				g.Tasks[0].State = tc.state
				g.Tasks[0].Gate = tc.gate
				g.Tasks[0].Merged = tc.state != TaskState_BlockedMerge && tc.state != TaskState_Pending && tc.state != TaskState_Skipped
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			err := ApplyAction(ctx, dag.OID, dag.Tasks[0].ID, "retry", waveobj.RoutePin{})
			if err == nil || !strings.Contains(err.Error(), "cannot be retried") || !strings.Contains(err.Error(), tc.hint) {
				t.Fatalf("retry from %s: err = %v, want a refusal that says %q", name, err, tc.hint)
			}
			if got := mustLoadDag(t, ctx, dag.OID).Tasks[0]; got.State != tc.state || got.RunID != child.ID {
				t.Fatalf("refused retry moved the task: state %s run %s", got.State, got.RunID)
			}
			if run, err := wstore.GetRun(ctx, dag.ChannelId, child.ID); err != nil || run.Status == jarvis.RunStatus_Cancelled {
				t.Fatalf("refused retry cancelled the task's run: %v", err)
			}
		})
	}
}

// the states a retry starts over from are still accepted: a live worker (running or stalled), a failure, and a failed
// review
func TestRetryAcceptsTheStatesItStartsOverFrom(t *testing.T) {
	for _, state := range []string{TaskState_Running, TaskState_Stalled, TaskState_Failed, TaskState_ReviewFailed} {
		t.Run(state, func(t *testing.T) {
			ctx, dag, _ := seedFailedDag(t)
			allowEscalationSchedule(t)
			if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
				g.Tasks[0].State = state
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if err := ApplyAction(ctx, dag.OID, dag.Tasks[0].ID, "retry", waveobj.RoutePin{}); err != nil {
				t.Fatalf("retry from %s: %v", state, err)
			}
		})
	}
}

// a stopped worker was not judged, and the dag it belonged to goes on: its siblings keep running, and the dag is
// blocked on the one failed task rather than cancelled
func TestCancelledRunOfALiveDagFailsOnlyItsTask(t *testing.T) {
	g, err := NewTaskGroup("run-1", "ch-1", "g", 2, false, []waveobj.TaskNode{
		{ID: "t-0", Label: "a"},
		{ID: "t-1", Label: "b"},
	}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	g.Tasks[0].State, g.Tasks[0].RunID = TaskState_Running, "r-0"
	g.Tasks[1].State, g.Tasks[1].RunID = TaskState_Running, "r-1"
	DeriveTaskStates(&g, map[string]*waveobj.Run{
		"r-0": {ID: "r-0", Status: jarvis.RunStatus_Cancelled},
		"r-1": {ID: "r-1", Status: jarvis.RunStatus_Executing},
	})
	RecomputeDagStatus(&g)
	if g.Tasks[0].State != TaskState_Failed || g.Tasks[0].LastFailureKind != FailureKindWorkerStopped {
		t.Fatalf("t-0 = %s (%s), want failed (%s)", g.Tasks[0].State, g.Tasks[0].LastFailureKind, FailureKindWorkerStopped)
	}
	if g.Tasks[1].State != TaskState_Running {
		t.Fatalf("t-1 = %s: a sibling keeps running", g.Tasks[1].State)
	}
	if g.Status == DagStatus_Cancelled {
		t.Fatal("one cancelled run cancelled the whole dag: only Cancel does that")
	}
}

// a task Cancel moved is already cancelled, and a cancelled run does not turn it into a failure
func TestCancelGroupLeavesItsTasksCancelled(t *testing.T) {
	g := groupWith(TaskState_Running, TaskState_Pending)
	g.Tasks[0].RunID = "r-0"
	CancelGroup(g)
	DeriveTaskStates(g, map[string]*waveobj.Run{"r-0": {ID: "r-0", Status: jarvis.RunStatus_Cancelled}})
	RecomputeDagStatus(g)
	if g.Tasks[0].State != TaskState_Cancelled || g.Status != DagStatus_Cancelled {
		t.Fatalf("a cancelled dag keeps its cancelled task: task %s, dag %s", g.Tasks[0].State, g.Status)
	}
}

func TestSkipRejectsRunningTaskWithoutClearingOwnership(t *testing.T) {
	ctx, dag, _, child := seedRunningDag(t)
	if err := ApplyAction(ctx, dag.OID, dag.Tasks[0].ID, "skip", waveobj.RoutePin{}); err == nil {
		t.Fatal("running task accepted skip")
	}
	got, err := wstore.GetDag(ctx, dag.OID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Tasks[0].State != TaskState_Running || got.Tasks[0].RunID != child.ID {
		t.Fatalf("running task ownership changed: state=%q run=%q", got.Tasks[0].State, got.Tasks[0].RunID)
	}
}

func TestSkipStopsStalledChildBeforeClearingOwnership(t *testing.T) {
	ctx, dag, _, child := seedRunningDag(t)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].State = TaskState_Stalled
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	oldStop := stopRunWorkers
	stopped := false
	stopRunWorkers = func(_ context.Context, run *waveobj.Run) error {
		stopped = run.ID == child.ID
		return nil
	}
	restoreAfterStages(t, func() { stopRunWorkers = oldStop })

	if err := ApplyAction(ctx, dag.OID, dag.Tasks[0].ID, "skip", waveobj.RoutePin{}); err != nil {
		t.Fatal(err)
	}
	gotDag, _ := wstore.GetDag(ctx, dag.OID)
	gotChild, _ := wstore.GetRun(ctx, dag.ChannelId, child.ID)
	if !stopped || gotChild.Status != jarvis.RunStatus_Cancelled {
		t.Fatalf("stalled child stop=%v status=%q, want stopped/cancelled", stopped, gotChild.Status)
	}
	if gotDag.Tasks[0].State != TaskState_Skipped || gotDag.Tasks[0].RunID != "" {
		t.Fatalf("skipped task = state %q run %q", gotDag.Tasks[0].State, gotDag.Tasks[0].RunID)
	}
}

// a skip drops only a task nothing of has landed: done, blocked-merge and the Verify states have landed or are landing
func TestSkipRefusesALandedOrLandingTask(t *testing.T) {
	for _, state := range []string{TaskState_Done, TaskState_BlockedMerge, TaskState_Verifying, TaskState_VerifyFailed} {
		t.Run(state, func(t *testing.T) {
			ctx, dag, child := seedFailedDag(t)
			if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
				g.Tasks[0].State = state
				g.Tasks[0].Merged = state != TaskState_BlockedMerge
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			err := ApplyAction(ctx, dag.OID, dag.Tasks[0].ID, "skip", waveobj.RoutePin{})
			if err == nil || !strings.Contains(err.Error(), "cannot be skipped") {
				t.Fatalf("skip from %s: err = %v, want a refusal", state, err)
			}
			if got := mustLoadDag(t, ctx, dag.OID).Tasks[0]; got.State != state || got.RunID != child.ID {
				t.Fatalf("refused skip moved the task: state %s run %s", got.State, got.RunID)
			}
			if run, err := wstore.GetRun(ctx, dag.ChannelId, child.ID); err != nil || run.Status == jarvis.RunStatus_Cancelled {
				t.Fatalf("refused skip cancelled the task's run: %v", err)
			}
		})
	}
}

// a failed review's reviewer already ended: skipping it stops no process, as it did before a reviewing task could be
// skipped, and leaves the reviewer's run as it finished
func TestSkipAReviewFailedTaskStopsNoReviewer(t *testing.T) {
	ctx, dag, worker := seedReviewFailedDag(t)
	reviewer := jarvis.NewRun("review", "ws-1", t.TempDir(), nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	reviewer.Review = true
	reviewer.Status = jarvis.RunStatus_Done
	reviewer.DagORef = dag.OID
	if err := wstore.AppendRun(ctx, dag.ChannelId, reviewer); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].ReviewBase = worker.BaseCommit
		g.Tasks[0].ReviewRunID = reviewer.ID
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	stubReviewTree(t, worker.EndCommit)
	stopped := recordStops(t)

	if err := ApplyAction(ctx, dag.OID, dag.Tasks[0].ID, "skip", waveobj.RoutePin{}); err != nil {
		t.Fatal(err)
	}
	if len(*stopped) != 0 {
		t.Fatalf("a failed review's skip stops no worker or reviewer, stopped %v", *stopped)
	}
	if run, err := wstore.GetRun(ctx, dag.ChannelId, reviewer.ID); err != nil || run.Status != jarvis.RunStatus_Done {
		t.Fatalf("the ended reviewer's run is left as it finished, got %+v err %v", run, err)
	}
	if got := mustLoadDag(t, ctx, dag.OID).Tasks[0]; got.State != TaskState_Skipped || got.ReviewRunID != reviewer.ID {
		t.Fatalf("skipped task = state %q reviewer %q, want skipped and the reviewer link kept", got.State, got.ReviewRunID)
	}
}

func TestRetryKeepsOwnershipWhenCancelledChildCannotReload(t *testing.T) {
	ctx, dag, child := seedFailedDag(t)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].State = TaskState_Failed
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	const trigger = "delete_retry_child_after_update"
	if err := wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		tx.Exec(fmt.Sprintf(`CREATE TEMP TRIGGER %s AFTER UPDATE ON db_run WHEN NEW.oid = '%s' BEGIN DELETE FROM db_run WHERE oid = NEW.oid; END`, trigger, child.ID))
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = wstore.WithTx(context.Background(), func(tx *wstore.TxWrap) error {
			tx.Exec("DROP TRIGGER IF EXISTS " + trigger)
			return nil
		})
	})

	err := ApplyAction(ctx, dag.OID, dag.Tasks[0].ID, "retry", waveobj.RoutePin{})
	if err == nil || !strings.Contains(err.Error(), "loading old run") {
		t.Fatalf("retry error = %v, want child reload failure", err)
	}
	got, getErr := wstore.GetDag(ctx, dag.OID)
	if getErr != nil {
		t.Fatal(getErr)
	}
	if got.Tasks[0].State != TaskState_Failed || got.Tasks[0].RunID != child.ID {
		t.Fatalf("failed task ownership = state %q run %q, want failed/%q", got.Tasks[0].State, got.Tasks[0].RunID, child.ID)
	}
}

func seedRunningDag(t *testing.T) (context.Context, *waveobj.TaskGroup, *waveobj.Run, waveobj.Run) {
	t.Helper()
	ctx, dag := seedPendingDag(t)
	owner, err := wstore.GetRun(ctx, dag.ChannelId, dag.RunID)
	if err != nil {
		t.Fatal(err)
	}
	child := jarvis.NewRun("child", "ws-1", t.TempDir(), nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	child.Phases[0].WorkerOrefs = []string{"tab:worker"}
	if err := wstore.AppendRun(ctx, dag.ChannelId, child); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].State = TaskState_Running
		g.Tasks[0].RunID = child.ID
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return ctx, dag, owner, child
}

func seedEscalationDag(t *testing.T, runtime, state string, escalations int) (context.Context, *waveobj.TaskGroup, waveobj.Run, string) {
	t.Helper()
	ctx, dag := seedPendingDag(t)
	if err := wstore.UpdateRun(ctx, dag.ChannelId, dag.RunID, func(owner *waveobj.Run) error {
		owner.Runtime = runtime
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	worker := waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String()
	child := jarvis.NewRun("child", "ws-1", t.TempDir(), nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	child.Status = jarvis.RunStatus_Blocked
	child.Phases[0].WorkerOrefs = []string{worker}
	if err := wstore.AppendRun(ctx, dag.ChannelId, child); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].State = state
		g.Tasks[0].RunID = child.ID
		g.Tasks[0].Attempts = 2
		g.Tasks[0].LastFailureKind = FailureKindTimeout
		g.Tasks[0].Escalations = escalations
		RecomputeDagStatus(g)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return ctx, dag, child, worker
}

func mustLoadDag(t *testing.T, ctx context.Context, dagID string) *waveobj.TaskGroup {
	t.Helper()
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func allowEscalationSchedule(t *testing.T) {
	t.Helper()
	allowWorkerHarnessForTest(t)
	oldStop := stopRunWorkers
	stopRunWorkers = func(context.Context, *waveobj.Run) error { return nil }
	restoreAfterStages(t, func() { stopRunWorkers = oldStop })
	oldStamp := stampSpawnedWorker
	stampSpawnedWorker = func(context.Context, string, string, string) error { return nil }
	restoreAfterStages(t, func() { stampSpawnedWorker = oldStamp })
	stubSpawnWorker(t, waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String(), nil)
}

func assertEscalationRejectedWithoutCancelling(t *testing.T, ctx context.Context, dag *waveobj.TaskGroup, child waveobj.Run, worker string, target waveobj.RoutePin) {
	t.Helper()
	if err := ApplyAction(ctx, dag.OID, "t-0", "escalate", target); err == nil {
		t.Fatal("want escalation rejection")
	}
	got, err := wstore.GetRun(ctx, dag.ChannelId, child.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != jarvis.RunStatus_Blocked || len(got.Phases) == 0 || len(got.Phases[0].WorkerOrefs) != 1 || got.Phases[0].WorkerOrefs[0] != worker {
		t.Fatalf("rejected escalation mutated child: %+v", got)
	}
}

func TestEscalateRejectsEmptyTarget(t *testing.T) {
	ctx, dag, _, _ := seedEscalationDag(t, "claude", TaskState_Failed, 0)
	allowEscalationSchedule(t)
	// a judged hop requires an explicit model
	if err := ApplyAction(ctx, dag.OID, "t-0", "escalate", waveobj.RoutePin{}); err == nil {
		t.Fatal("empty escalate target must be rejected")
	}
	got := mustLoadDag(t, ctx, dag.OID)
	task := got.Tasks[0]
	if task.RunSpec.Runtime != "" || task.RunSpec.Model != "" || task.Escalations != 0 || task.State != TaskState_Failed {
		t.Fatalf("rejected escalation mutated task route/state = %+v", task)
	}
}

// a runtime alone names no escalation target: the human picks the model
func TestEscalateRequiresModelWithoutCancellingRun(t *testing.T) {
	ctx, dag, child, worker := seedEscalationDag(t, "claude", TaskState_Failed, 0)
	assertEscalationRejectedWithoutCancelling(t, ctx, dag, child, worker, waveobj.RoutePin{Runtime: "claude"})
}

func TestEscalateRepinsToModel(t *testing.T) {
	ctx, dag, _, _ := seedEscalationDag(t, "claude", TaskState_Failed, 0)
	allowEscalationSchedule(t)
	if err := ApplyAction(ctx, dag.OID, "t-0", "escalate", waveobj.RoutePin{Model: "opus"}); err != nil {
		t.Fatal(err)
	}
	got := mustLoadDag(t, ctx, dag.OID)
	if got.Tasks[0].RunSpec.Runtime != "claude" || got.Tasks[0].RunSpec.Model != "opus" || got.Tasks[0].Escalations != 1 {
		t.Fatalf("model escalation = %+v", got.Tasks[0])
	}
}

func TestEscalateRejectsSecondHopWithoutCancellingRun(t *testing.T) {
	ctx, dag, child, worker := seedEscalationDag(t, "claude", TaskState_Failed, 1)
	assertEscalationRejectedWithoutCancelling(t, ctx, dag, child, worker, waveobj.RoutePin{Model: "opus"})
}

func TestEscalateRejectsUnsupportedRouteWithoutCancellingRun(t *testing.T) {
	ctx, dag, child, worker := seedEscalationDag(t, "claude", TaskState_Failed, 0)
	assertEscalationRejectedWithoutCancelling(t, ctx, dag, child, worker, waveobj.RoutePin{Runtime: "claude", Model: "gpt-5.4"})
}

// a blocked merge's worker finished: a fresh worker would leave the conflicted squash in the checkout, holding
// later merges, and lose the lane's commit. The conflict is resolved and continued, not escalated.
func TestEscalateRejectsBlockedMergeWithoutCancellingRun(t *testing.T) {
	ctx, dag, child, worker := seedEscalationDag(t, "claude", TaskState_BlockedMerge, 0)
	err := ApplyAction(ctx, dag.OID, "t-0", "escalate", waveobj.RoutePin{Model: "opus"})
	if err == nil || !strings.Contains(err.Error(), "cannot be escalated") || !strings.Contains(err.Error(), "dag merge t-0 --continue") {
		t.Fatalf("escalate from blocked-merge: err = %v, want a refusal that names `dag merge t-0 --continue`", err)
	}
	assertEscalationRejectedWithoutCancelling(t, ctx, dag, child, worker, waveobj.RoutePin{Model: "opus"})
	if got := mustLoadDag(t, ctx, dag.OID).Tasks[0]; got.State != TaskState_BlockedMerge || got.RunID != child.ID || got.Escalations != 0 {
		t.Fatalf("rejected escalation moved the task: %+v", got)
	}
}

// a retry, skip or escalate leaves a row naming who acted, so the timeline tells the human's own actions from the
// lead's (Kael c408b2cd1). ApplyAction keeps its signature and means the human.
func TestActionWritesItsRunEventWithTheActor(t *testing.T) {
	cases := []struct {
		action, kind string
		target       waveobj.RoutePin
		want         map[string]any
	}{
		{"retry", waveobj.RunEventKindTaskRetried, waveobj.RoutePin{}, map[string]any{"auto": false}},
		{"skip", waveobj.RunEventKindTaskSkipped, waveobj.RoutePin{}, map[string]any{}},
		{"escalate", waveobj.RunEventKindTaskEscalated, waveobj.RoutePin{Model: "opus"}, map[string]any{"model": "opus", "runtime": "claude"}},
	}
	for _, c := range cases {
		for _, by := range []string{ActionByHuman, ActionByLead} {
			t.Run(c.action+"-"+by, func(t *testing.T) {
				ctx, dag, _, _ := seedEscalationDag(t, "claude", TaskState_Failed, 0)
				allowEscalationSchedule(t)
				if err := ApplyActionBy(ctx, dag.OID, "t-0", c.action, by, c.target); err != nil {
					t.Fatal(err)
				}
				rows := runEventsOfKind(t, ctx, dag.ChannelId, dag.RunID, c.kind)
				if len(rows) != 1 {
					t.Fatalf("want one %s row, got %d", c.kind, len(rows))
				}
				detail := firstEventDetail(t, ctx, dag.ChannelId, dag.RunID, c.kind)
				if detail["taskid"] != "t-0" || detail["by"] != by {
					t.Fatalf("want taskid t-0 by %s, got %v", by, detail)
				}
				for k, v := range c.want {
					if detail[k] != v {
						t.Fatalf("want %s=%v, got %v", k, v, detail)
					}
				}
			})
		}
	}
}

// the existing entry point keeps its signature and records the human, which is who the cockpit and `wsh runs` are
func TestApplyActionRecordsTheHuman(t *testing.T) {
	ctx, dag, _, _ := seedEscalationDag(t, "claude", TaskState_Failed, 0)
	allowEscalationSchedule(t)
	if err := ApplyAction(ctx, dag.OID, "t-0", "skip", waveobj.RoutePin{}); err != nil {
		t.Fatal(err)
	}
	if detail := firstEventDetail(t, ctx, dag.ChannelId, dag.RunID, waveobj.RunEventKindTaskSkipped); detail["by"] != ActionByHuman {
		t.Fatalf("ApplyAction records the human, got %v", detail)
	}
}

// only the lead's CLI names itself on the wire; a missing or unknown By is the human
func TestActionByFromWire(t *testing.T) {
	for in, want := range map[string]string{"": ActionByHuman, "lead": ActionByLead, "human": ActionByHuman, "something": ActionByHuman} {
		if got := ActionByFromWire(in); got != want {
			t.Errorf("ActionByFromWire(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestEscalateRejectsPendingTask(t *testing.T) {
	ctx, dag := seedPendingDag(t)
	if err := wstore.UpdateRun(ctx, dag.ChannelId, dag.RunID, func(owner *waveobj.Run) error {
		owner.Runtime = "claude"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := ApplyAction(ctx, dag.OID, "t-0", "escalate", waveobj.RoutePin{Model: "opus"}); err == nil {
		t.Fatal("pending task accepted escalation")
	}
	got := mustLoadDag(t, ctx, dag.OID)
	if got.Tasks[0].State != TaskState_Pending || got.Tasks[0].RunID != "" {
		t.Fatalf("rejected pending escalation mutated task: %+v", got.Tasks[0])
	}
}

func TestCancelPersistsBeforeStoppingWorkersAndIsIdempotent(t *testing.T) {
	ctx, dag, owner, child := seedRunningDag(t)
	oldStop := stopRunWorkers
	stopCalls := 0
	stopObservedCancelled := true
	stopRunWorkers = func(ctx context.Context, _ *waveobj.Run) error {
		stopCalls++
		gotDag, dagErr := wstore.GetDag(ctx, dag.OID)
		gotOwner, ownerErr := wstore.GetRun(ctx, dag.ChannelId, owner.ID)
		gotChild, childErr := wstore.GetRun(ctx, dag.ChannelId, child.ID)
		stopObservedCancelled = stopObservedCancelled && dagErr == nil && ownerErr == nil && childErr == nil &&
			gotDag.Status == DagStatus_Cancelled && gotDag.Tasks[0].State == TaskState_Cancelled &&
			gotOwner.Status == jarvis.RunStatus_Cancelled && gotChild.Status == jarvis.RunStatus_Cancelled
		return nil
	}
	restoreAfterStages(t, func() { stopRunWorkers = oldStop })

	if err := Cancel(ctx, dag.OID); err != nil {
		t.Fatal(err)
	}
	if err := Cancel(ctx, dag.OID); err != nil {
		t.Fatal(err)
	}
	if !stopObservedCancelled {
		t.Fatal("worker stop ran before terminal state committed")
	}
	if stopCalls != 4 {
		t.Fatalf("stop calls = %d, want owner and child on each cancellation", stopCalls)
	}
}

// a task that already landed keeps its worker run done: cancelling abandons only the unfinished work, the
// way CancelGroup leaves the done task itself alone. its worker is still stopped.
func TestCancelKeepsALandedTaskRunDone(t *testing.T) {
	ctx, dag, owner, child := seedRunningDag(t)
	landed := jarvis.NewRun("landed", "ws-1", t.TempDir(), nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	landed.Status = jarvis.RunStatus_Done
	landed.Phases[0].WorkerOrefs = []string{"tab:landed"}
	if err := wstore.AppendRun(ctx, dag.ChannelId, landed); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks = append(g.Tasks, waveobj.TaskNode{ID: "t-1", Label: "b", State: TaskState_Done, RunID: landed.ID})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	oldStop := stopRunWorkers
	stopped := map[string]bool{}
	stopRunWorkers = func(_ context.Context, run *waveobj.Run) error {
		stopped[run.ID] = true
		return nil
	}
	restoreAfterStages(t, func() { stopRunWorkers = oldStop })

	if err := Cancel(ctx, dag.OID); err != nil {
		t.Fatal(err)
	}
	gotLanded, _ := wstore.GetRun(ctx, dag.ChannelId, landed.ID)
	gotChild, _ := wstore.GetRun(ctx, dag.ChannelId, child.ID)
	gotOwner, _ := wstore.GetRun(ctx, dag.ChannelId, owner.ID)
	if gotLanded.Status != jarvis.RunStatus_Done {
		t.Fatalf("landed run status = %q, want done", gotLanded.Status)
	}
	if gotChild.Status != jarvis.RunStatus_Cancelled || gotOwner.Status != jarvis.RunStatus_Cancelled {
		t.Fatalf("unfinished runs: child=%q owner=%q, want cancelled", gotChild.Status, gotOwner.Status)
	}
	if !stopped[landed.ID] {
		t.Fatal("landed run's worker was not stopped")
	}
}

func TestCancelDetachesWorkerCleanupFromCallerContext(t *testing.T) {
	baseCtx, dag, _, _ := seedRunningDag(t)
	ctx, cancel := context.WithCancel(baseCtx)
	oldTx, oldStop := withMutationTx, stopRunWorkers
	withMutationTx = func(ctx context.Context, fn func(*wstore.TxWrap) error) error {
		err := wstore.WithTx(ctx, fn)
		cancel()
		return err
	}
	stopCalls := 0
	stopRunWorkers = func(ctx context.Context, _ *waveobj.Run) error {
		stopCalls++
		if ctx.Err() != nil {
			return fmt.Errorf("cleanup context is cancelled: %w", ctx.Err())
		}
		return nil
	}
	restoreAfterStages(t, func() { withMutationTx, stopRunWorkers = oldTx, oldStop })

	if err := Cancel(ctx, dag.OID); err != nil {
		t.Fatal(err)
	}
	if stopCalls != 2 {
		t.Fatalf("stop calls = %d, want owner and child", stopCalls)
	}
}

// the dag lock can be held for minutes (Setup), and the wait for it spent the caller's rpc budget, so the
// cancelled state's write failed with "context deadline exceeded" and the run kept going
func TestCancelLandsAfterTheCallerDeadlinePassesWaitingForTheLock(t *testing.T) {
	baseCtx, dag, owner, _ := seedRunningDag(t)
	oldStop := stopRunWorkers
	stopRunWorkers = func(context.Context, *waveobj.Run) error { return nil }
	restoreAfterStages(t, func() { stopRunWorkers = oldStop })

	held, release := make(chan struct{}), make(chan struct{})
	go func() {
		_ = WithDagMutation(dag.OID, func() error {
			close(held)
			<-release
			return nil
		})
	}()
	<-held
	ctx, cancel := context.WithTimeout(baseCtx, 50*time.Millisecond)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- Cancel(ctx, dag.OID) }()
	<-ctx.Done()
	close(release)

	if err := <-done; err != nil {
		t.Fatalf("cancel after the caller's deadline: %v", err)
	}
	if got := mustLoadDag(t, baseCtx, dag.OID); got.Status != DagStatus_Cancelled {
		t.Fatalf("dag status = %q, want cancelled", got.Status)
	}
	if got, _ := wstore.GetRun(baseCtx, dag.ChannelId, owner.ID); got.Status != jarvis.RunStatus_Cancelled {
		t.Fatalf("owner run status = %q, want cancelled", got.Status)
	}
}

func TestCancelReturnsStopFailureWithoutRevertingState(t *testing.T) {
	ctx, dag, _, child := seedRunningDag(t)
	oldStop := stopRunWorkers
	stopRunWorkers = func(_ context.Context, run *waveobj.Run) error {
		if run.ID == child.ID {
			return errors.New("worker stop failed")
		}
		return nil
	}
	restoreAfterStages(t, func() { stopRunWorkers = oldStop })

	err := Cancel(ctx, dag.OID)
	if err == nil || !strings.Contains(err.Error(), child.ID) || !strings.Contains(err.Error(), "worker stop failed") {
		t.Fatalf("cancel error = %v, want contextual child stop failure", err)
	}
	gotDag, _ := wstore.GetDag(ctx, dag.OID)
	gotChild, _ := wstore.GetRun(ctx, dag.ChannelId, child.ID)
	if gotDag.Status != DagStatus_Cancelled || gotChild.Status != jarvis.RunStatus_Cancelled {
		t.Fatalf("stop failure reverted cancellation: dag=%q child=%q", gotDag.Status, gotChild.Status)
	}
}

func TestCancelPersistsCleanupDebtAndRetry(t *testing.T) {
	ctx := context.Background()
	projectDir := newGitRepo(t)
	ch, err := wstore.CreateChannel(ctx, "cancel-cleanup", projectDir)
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", projectDir, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	owner.BaseCommit = gitCmd(t, projectDir, "rev-parse", "HEAD")
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 1, true, []waveobj.TaskNode{{ID: "t-0", Label: "a"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := EnsureRunWorktree(ctx, projectDir, TaskWorktreeKey(owner.ID, "t-0"), owner.BaseCommit); err != nil {
		t.Fatal(err)
	}

	oldRemover := RemoveTaskWorktree
	persistedPending := false
	RemoveTaskWorktree = func(cleanupCtx context.Context, _, _ string) error {
		stored, loadErr := wstore.GetDag(cleanupCtx, g.OID)
		persistedPending = loadErr == nil && stored.Status == DagStatus_Cancelled && stored.Tasks[0].CleanupPending
		return errors.New("locked")
	}
	restoreAfterStages(t, func() { RemoveTaskWorktree = oldRemover })

	if err := Cancel(ctx, g.OID); err == nil || !strings.Contains(err.Error(), "locked") {
		t.Fatalf("cancel error = %v, want cleanup failure", err)
	}
	if !persistedPending {
		t.Fatal("cancelled cleanup pending must persist before removal")
	}
	stored, err := wstore.GetDag(ctx, g.OID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != DagStatus_Cancelled || stored.Tasks[0].CleanupPending || stored.Tasks[0].CleanupError == "" {
		t.Fatalf("cancelled cleanup debt = status %q pending %v error %q", stored.Status, stored.Tasks[0].CleanupPending, stored.Tasks[0].CleanupError)
	}

	RemoveTaskWorktree = func(context.Context, string, string) error { return nil }
	RetryCleanupDebt(ctx, g.OID)
	if stored, err = wstore.GetDag(ctx, g.OID); err != nil {
		t.Fatal(err)
	}
	if stored.Status != DagStatus_Cancelled || HasCleanupDebt(stored) {
		t.Fatalf("cleanup retry reopened or retained debt: status %q debt %v", stored.Status, HasCleanupDebt(stored))
	}
}

func TestCancelRollsBackAllStateBeforeWorkerStop(t *testing.T) {
	ctx, dag, owner, child := seedRunningDag(t)
	const trigger = "fail_cancel_run_update"
	if err := wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		tx.Exec(`CREATE TEMP TRIGGER fail_cancel_run_update BEFORE UPDATE ON db_run BEGIN SELECT RAISE(ABORT, 'forced cancel failure'); END`)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = wstore.WithTx(context.Background(), func(tx *wstore.TxWrap) error {
			tx.Exec("DROP TRIGGER IF EXISTS " + trigger)
			return nil
		})
	})
	oldStop := stopRunWorkers
	stopCalls := 0
	stopRunWorkers = func(context.Context, *waveobj.Run) error { stopCalls++; return nil }
	restoreAfterStages(t, func() { stopRunWorkers = oldStop })

	if err := Cancel(ctx, dag.OID); err == nil {
		t.Fatal("want forced cancellation transaction failure")
	}
	gotDag, _ := wstore.GetDag(ctx, dag.OID)
	gotOwner, _ := wstore.GetRun(ctx, dag.ChannelId, owner.ID)
	gotChild, _ := wstore.GetRun(ctx, dag.ChannelId, child.ID)
	if gotDag.Status == DagStatus_Cancelled || gotOwner.Status == jarvis.RunStatus_Cancelled || gotChild.Status == jarvis.RunStatus_Cancelled {
		t.Fatalf("cancellation partially committed: dag=%q owner=%q child=%q", gotDag.Status, gotOwner.Status, gotChild.Status)
	}
	if stopCalls != 0 {
		t.Fatalf("worker stop called %d times before transaction committed", stopCalls)
	}
}

func TestMarkBlockedMergeChangesOnlyOwningTask(t *testing.T) {
	ctx, dag := seedPendingDag(t)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks = append(g.Tasks, waveobj.TaskNode{ID: "t-1", Label: "b", State: TaskState_Running, RunID: "child-1"})
		g.Tasks[0].State = TaskState_Running
		g.Tasks[0].RunID = "child-0"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := MarkBlockedMerge(ctx, dag.OID, "child-1"); err != nil {
		t.Fatal(err)
	}
	got, _ := wstore.GetDag(ctx, dag.OID)
	if got.Tasks[0].State != TaskState_Running || got.Tasks[1].State != TaskState_BlockedMerge {
		t.Fatalf("merge block changed wrong tasks: %+v", got.Tasks)
	}
}

func TestCancelledDagRejectsFurtherMutations(t *testing.T) {
	ctx, dag, _, child := seedRunningDag(t)
	oldStop, oldSpawn := stopRunWorkers, spawnWorker
	stopRunWorkers = func(context.Context, *waveobj.Run) error { return nil }
	spawnCalls := 0
	spawnWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		spawnCalls++
		return "tab:unexpected", nil
	}
	restoreAfterStages(t, func() { stopRunWorkers, spawnWorker = oldStop, oldSpawn })
	if err := Cancel(ctx, dag.OID); err != nil {
		t.Fatal(err)
	}

	for _, action := range []string{"approve", "sendback", "retry", "skip", "escalate"} {
		if err := ApplyAction(ctx, dag.OID, dag.Tasks[0].ID, action, waveobj.RoutePin{}); err == nil {
			t.Fatalf("cancelled DAG accepted %q", action)
		}
	}
	if err := MarkBlockedMerge(ctx, dag.OID, child.ID); err == nil {
		t.Fatal("cancelled DAG accepted blocked-merge mutation")
	}
	got, err := wstore.GetDag(ctx, dag.OID)
	if err != nil {
		t.Fatal(err)
	}
	RecomputeDagStatus(got)
	if got.Status != DagStatus_Cancelled || got.Tasks[0].State != TaskState_Cancelled || spawnCalls != 0 {
		t.Fatalf("cancelled DAG reopened: status=%q task=%q spawns=%d", got.Status, got.Tasks[0].State, spawnCalls)
	}
}

func TestCancelHoldsDagAuthorityThroughWorkerCleanup(t *testing.T) {
	ctx, dag, _, _ := seedRunningDag(t)
	oldStop := stopRunWorkers
	entered := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32
	stopRunWorkers = func(context.Context, *waveobj.Run) error {
		if calls.Add(1) == 1 {
			close(entered)
			<-release
		}
		return nil
	}
	restoreAfterStages(t, func() { stopRunWorkers = oldStop })

	cancelDone := make(chan error, 1)
	go func() { cancelDone <- Cancel(ctx, dag.OID) }()
	<-entered
	actionDone := make(chan error, 1)
	go func() { actionDone <- ApplyAction(ctx, dag.OID, dag.Tasks[0].ID, "retry", waveobj.RoutePin{}) }()
	select {
	case err := <-actionDone:
		t.Fatalf("action escaped cancellation authority before worker cleanup: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	close(release)
	if err := <-cancelDone; err != nil {
		t.Fatal(err)
	}
	if err := <-actionDone; err == nil {
		t.Fatal("cancelled DAG accepted retry after cleanup")
	}
}

func TestCancelWaitsForSpawnAndStopsAttachedWorker(t *testing.T) {
	ctx, dag := seedPendingDag(t)
	allowWorkerHarnessForTest(t)
	entered := make(chan struct{})
	release := make(chan struct{})
	worker := waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String()
	oldSpawn, oldStamp, oldStop := spawnWorker, stampSpawnedWorker, stopRunWorkers
	spawnWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		close(entered)
		<-release
		return worker, nil
	}
	stampSpawnedWorker = func(context.Context, string, string, string) error { return nil }
	stoppedAttachedWorker := false
	stopRunWorkers = func(_ context.Context, run *waveobj.Run) error {
		for _, phase := range run.Phases {
			for _, oref := range phase.WorkerOrefs {
				if oref == worker {
					stoppedAttachedWorker = true
				}
			}
		}
		return nil
	}
	restoreAfterStages(t, func() { spawnWorker, stampSpawnedWorker, stopRunWorkers = oldSpawn, oldStamp, oldStop })

	scheduleDone := make(chan error, 1)
	go func() { scheduleDone <- Schedule(ctx, dag.OID) }()
	<-entered
	cancelDone := make(chan error, 1)
	go func() { cancelDone <- Cancel(ctx, dag.OID) }()
	select {
	case err := <-cancelDone:
		t.Fatalf("cancellation returned before bounded spawn completed: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	close(release)
	if err := <-scheduleDone; err != nil {
		t.Fatal(err)
	}
	if err := <-cancelDone; err != nil {
		t.Fatal(err)
	}
	if !stoppedAttachedWorker {
		t.Fatal("cancellation did not stop the worker attached during spawn")
	}
}

func TestScheduleDifferentDagsProceedConcurrently(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx1, dag1 := seedPendingDag(t)
	ctx2, dag2 := seedPendingDag(t)
	// ctx is shared; both dags use background context, but we need to block dag1's spawn
	entered := make(chan struct{})
	release := make(chan struct{})
	var callsDag1 atomic.Int32
	var callsDag2 atomic.Int32
	old := spawnWorker
	spawnWorker = func(ctx context.Context, cap runroute.Capability, workspaceId, projectName, cwd, prompt string, _ jarvis.RunWorkerOptions) (string, error) {
		// We can't easily know which dag is calling; use a simple counter and block only first call.
		// Instead we separate by using dag1's spawn path: block first spawn, let second dag proceed.
		if callsDag1.Load() == 0 && callsDag2.Load() == 0 {
			// first overall spawn -> dag1 blocked
			callsDag1.Add(1)
			close(entered)
			<-release
			return waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String(), nil
		}
		callsDag2.Add(1)
		return waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String(), nil
	}
	restoreAfterStages(t, func() { spawnWorker = old })

	errs := make(chan error, 2)
	go func() { errs <- Schedule(ctx1, dag1.OID) }()
	<-entered
	// while dag1 is blocked, dag2 should be able to complete
	done := make(chan error, 1)
	go func() { done <- Schedule(ctx2, dag2.OID) }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("dag2 schedule failed: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("different DAG was blocked by unrelated scheduling")
	}
	close(release)
	if err := <-errs; err != nil {
		t.Fatal(err)
	}
	// dag2 already done; ensure counts
	if callsDag1.Load() != 1 {
		t.Fatalf("dag1 spawn calls = %d, want 1", callsDag1.Load())
	}
	if callsDag2.Load() != 1 {
		t.Fatalf("dag2 spawn calls = %d, want 1", callsDag2.Load())
	}
}

// TestCancelSweepsTaskWorktrees: cancelling a dag removes every task's worktree (dumping dirty
// state to a recovery patch first) so abandoned trees and branches don't accumulate in the project.
func TestCancelSweepsTaskWorktrees(t *testing.T) {
	ctx, dag := seedPendingDag(t)
	allowWorkerHarnessForTest(t)

	ch, err := wstore.DBMustGet[*waveobj.Channel](ctx, dag.ChannelId)
	if err != nil {
		t.Fatal(err)
	}
	newGitRepoAt(t, ch.ProjectPath)
	base := gitCmd(t, ch.ProjectPath, "rev-parse", "HEAD")
	if err := wstore.UpdateRun(ctx, ch.OID, dag.RunID, func(r *waveobj.Run) error {
		r.BaseCommit = base
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	old := spawnWorker
	spawnWorker = func(ctx context.Context, cap runroute.Capability, workspaceId, projectName, cwd, prompt string, _ jarvis.RunWorkerOptions) (string, error) {
		return waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String(), nil
	}
	defer func() { spawnWorker = old }()
	oldStop := stopRunWorkers
	stopRunWorkers = func(ctx context.Context, r *waveobj.Run) error { return nil }
	defer func() { stopRunWorkers = oldStop }()

	if err := ScheduleOnce(ctx, dag); err != nil {
		t.Fatal(err)
	}
	key := TaskWorktreeKey(dag.RunID, "t-0")
	wtPath := worktreeDir(ch.ProjectPath, key)
	if _, err := os.Stat(wtPath); err != nil {
		t.Fatalf("expected spawned task worktree at %s: %v", wtPath, err)
	}
	os.WriteFile(filepath.Join(wtPath, "uncommitted.txt"), []byte("wip"), 0o644)

	if err := Cancel(ctx, dag.OID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(wtPath); !os.IsNotExist(err) {
		t.Fatalf("cancel must sweep the task worktree, stat err = %v", err)
	}
	if gitCmd(t, ch.ProjectPath, "branch", "--list", "wave/"+key) != "" {
		t.Fatal("cancel must delete the task branch")
	}
	patch, err := os.ReadFile(filepath.Join(ch.ProjectPath, ".waveterm", "recovery", key+".patch"))
	if err != nil {
		t.Fatalf("dirty state must be dumped before the sweep: %v", err)
	}
	if !strings.Contains(string(patch), "uncommitted.txt") {
		t.Fatalf("patch must capture uncommitted work:\n%s", patch)
	}
}

func TestEscalationTargetModel(t *testing.T) {
	task := &waveobj.TaskNode{ID: "t-1", State: TaskState_Failed, RunSpec: waveobj.RunSpec{Runtime: "pi", Model: "opencode/deepseek-v4-flash"}}
	owner := &waveobj.Run{Runtime: "pi"}
	target, err := escalationTarget(task, owner, nil, waveobj.RoutePin{Runtime: "claude", Model: "opus"})
	if err != nil {
		t.Fatal(err)
	}
	if target.Runtime != "claude" || target.Model != "opus" {
		t.Fatalf("cross-runtime model escalation failed: %+v", target)
	}
}

func TestEscalationTargetRequiresValidModel(t *testing.T) {
	task := &waveobj.TaskNode{ID: "t-1", State: TaskState_Failed, RunSpec: waveobj.RunSpec{Runtime: "pi"}}
	owner := &waveobj.Run{Runtime: "pi"}
	if _, err := escalationTarget(task, owner, nil, waveobj.RoutePin{Runtime: "claude", Model: "gpt-5.4"}); err == nil {
		t.Fatal("cross-namespace model must be rejected")
	}
	if _, err := escalationTarget(task, owner, nil, waveobj.RoutePin{}); err == nil {
		t.Fatal("empty target must be rejected")
	}
}

func TestEscalationTargetCapHolds(t *testing.T) {
	task := &waveobj.TaskNode{ID: "t-1", State: TaskState_Stalled, Escalations: 1, RunSpec: waveobj.RunSpec{Runtime: "pi"}}
	owner := &waveobj.Run{Runtime: "pi"}
	if _, err := escalationTarget(task, owner, nil, waveobj.RoutePin{Runtime: "pi", Model: "opencode/deepseek-v4-pro"}); err == nil {
		t.Fatal("escalations cap must refuse a second hop")
	}
}

func TestEffectiveTaskRouteModel(t *testing.T) {
	task := &waveobj.TaskNode{RunSpec: waveobj.RunSpec{Runtime: "", Model: "opencode/claude-opus-4-8"}}
	owner := &waveobj.Run{Runtime: "pi"}
	got := effectiveTaskRoute(task, owner, nil)
	if got.Model != "opencode/claude-opus-4-8" || got.Runtime != "pi" {
		t.Fatalf("model RunSpec must inherit owner runtime: %+v", got)
	}
	ownerWithModel := &waveobj.Run{Runtime: "pi", Model: "opencode/deepseek-v4-pro"}
	inherited := effectiveTaskRoute(&waveobj.TaskNode{}, ownerWithModel, nil)
	if inherited.Model != "opencode/deepseek-v4-pro" || inherited.Runtime != "pi" {
		t.Fatalf("owner model must flow to tasks without a route: %+v", inherited)
	}
}

// stubStop scripts what `stop` does outside the store: the worker's stop and its tab's close. It returns the runs
// stopped and the tabs closed ("<workspace>/<tab>"), in order, and fails the close with closeErr when set.
func stubStop(t *testing.T, closeErr error) (*[]string, *[]string) {
	t.Helper()
	oldStop, oldDelete := stopRunWorkers, deleteLeadTab
	var stopped, closed []string
	stopRunWorkers = func(_ context.Context, run *waveobj.Run) error {
		stopped = append(stopped, run.ID)
		return nil
	}
	deleteLeadTab = func(_ context.Context, workspaceId, tabId string) error {
		if len(stopped) == 0 {
			t.Error("the tab closed before its worker was stopped")
		}
		closed = append(closed, workspaceId+"/"+tabId)
		return closeErr
	}
	restoreAfterStages(t, func() { stopRunWorkers, deleteLeadTab = oldStop, oldDelete })
	return &stopped, &closed
}

func TestStopEndsARunningTaskWithoutARetry(t *testing.T) {
	ctx, dag, _, child := seedRunningDag(t)
	stopped, closed := stubStop(t, nil)

	if err := ApplyAction(ctx, dag.OID, dag.Tasks[0].ID, "stop", waveobj.RoutePin{}); err != nil {
		t.Fatal(err)
	}
	gotChild, _ := wstore.GetRun(ctx, dag.ChannelId, child.ID)
	if len(*stopped) != 1 || (*stopped)[0] != child.ID || gotChild.Status != jarvis.RunStatus_Cancelled {
		t.Fatalf("workers stopped %v, run status %q; want %s stopped and cancelled", *stopped, gotChild.Status, child.ID)
	}
	// seedRunningDag's worker runs in tab "worker" of workspace "ws-1"
	if len(*closed) != 1 || (*closed)[0] != "ws-1/worker" {
		t.Fatalf("tabs closed = %v, want the worker's tab ws-1/worker", *closed)
	}
	got, _ := wstore.GetDag(ctx, dag.OID)
	task := got.Tasks[0]
	if task.State != TaskState_Failed || task.LastFailureKind != FailureKindStopped || task.RunID != "" {
		t.Fatalf("stopped task = state %q kind %q run %q, want failed/%s/none", task.State, task.LastFailureKind, task.RunID, FailureKindStopped)
	}
	if got.Status == DagStatus_Cancelled {
		t.Fatal("stopping one task must not cancel the dag")
	}
	if err := Schedule(ctx, dag.OID); err != nil {
		t.Fatal(err)
	}
	again, _ := wstore.GetDag(ctx, dag.OID)
	if again.Tasks[0].State != TaskState_Failed || again.Tasks[0].RunID != "" {
		t.Fatalf("after a tick = state %q run %q; a stopped task must not be dispatched again", again.Tasks[0].State, again.Tasks[0].RunID)
	}
}

func TestStopAlsoStopsAStalledTask(t *testing.T) {
	ctx, dag, _, _ := seedRunningDag(t)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].State = TaskState_Stalled
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	_, closed := stubStop(t, nil)
	if err := ApplyAction(ctx, dag.OID, dag.Tasks[0].ID, "stop", waveobj.RoutePin{}); err != nil {
		t.Fatal(err)
	}
	got, _ := wstore.GetDag(ctx, dag.OID)
	if got.Tasks[0].State != TaskState_Failed || len(*closed) != 1 {
		t.Fatalf("stalled task after stop = %q, tabs closed %v; want failed and its tab closed", got.Tasks[0].State, *closed)
	}
}

// the close comes after the task is recorded: a tab that will not close fails the action with its reason, and the
// task stays stopped rather than running with a cancelled run, which would cancel the whole dag
func TestStopKeepsTheTaskStoppedWhenItsTabWillNotClose(t *testing.T) {
	ctx, dag, _, _ := seedRunningDag(t)
	stubStop(t, errors.New("workspace gone"))
	err := ApplyAction(ctx, dag.OID, dag.Tasks[0].ID, "stop", waveobj.RoutePin{})
	if err == nil || !strings.Contains(err.Error(), "workspace gone") {
		t.Fatalf("stop with a tab that will not close = %v, want its reason", err)
	}
	got, _ := wstore.GetDag(ctx, dag.OID)
	if got.Tasks[0].State != TaskState_Failed || got.Tasks[0].LastFailureKind != FailureKindStopped || got.Status == DagStatus_Cancelled {
		t.Fatalf("task %q kind %q dag %q; want the task stopped and the dag not cancelled", got.Tasks[0].State, got.Tasks[0].LastFailureKind, got.Status)
	}
}

func TestAStoppedTaskCanBeSkipped(t *testing.T) {
	ctx, dag, _, _ := seedRunningDag(t)
	stubStop(t, nil)
	if err := ApplyAction(ctx, dag.OID, dag.Tasks[0].ID, "stop", waveobj.RoutePin{}); err != nil {
		t.Fatal(err)
	}
	if err := ApplyAction(ctx, dag.OID, dag.Tasks[0].ID, "skip", waveobj.RoutePin{}); err != nil {
		t.Fatalf("skip after stop: %v", err)
	}
	got, _ := wstore.GetDag(ctx, dag.OID)
	if got.Tasks[0].State != TaskState_Skipped {
		t.Fatalf("state = %q, want skipped", got.Tasks[0].State)
	}
}

func TestStopRefusesATaskWithNoWorker(t *testing.T) {
	for _, state := range []string{TaskState_Pending, TaskState_Done, TaskState_Skipped, TaskState_Reviewing} {
		t.Run(state, func(t *testing.T) {
			ctx, dag, _, child := seedRunningDag(t)
			if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
				g.Tasks[0].State = state
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			stopped, closed := stubStop(t, nil)
			err := ApplyAction(ctx, dag.OID, dag.Tasks[0].ID, "stop", waveobj.RoutePin{})
			if err == nil || !strings.Contains(err.Error(), "cannot be stopped") {
				t.Fatalf("stop from %s = %v, want a refusal", state, err)
			}
			if len(*stopped) != 0 || len(*closed) != 0 {
				t.Fatalf("a refused stop stopped %v and closed %v", *stopped, *closed)
			}
			got, _ := wstore.GetDag(ctx, dag.OID)
			gotChild, _ := wstore.GetRun(ctx, dag.ChannelId, child.ID)
			if got.Tasks[0].State != state || gotChild.Status == jarvis.RunStatus_Cancelled {
				t.Fatalf("a refused stop changed the task (%q) or cancelled its run (%q)", got.Tasks[0].State, gotChild.Status)
			}
		})
	}
}

func TestTheLeadIsToldToLeaveAStoppedTask(t *testing.T) {
	if !strings.Contains(jarvis.OrchestrationRules("r1", "", "", "", false), FailureKindStopped) {
		t.Fatalf("the lead's rules must name %q", FailureKindStopped)
	}
}

func TestSlowLockLogNamesItsCaller(t *testing.T) {
	var logged bytes.Buffer
	log.SetOutput(&logged)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	under := slowDagLock - time.Millisecond
	logSlowDagLock("fast", under, under, nil)
	logSlowDagLock("held", 0, slowDagLock, nil)
	logSlowDagLock("waited", slowDagLock, 0, nil)
	out := logged.String()
	if strings.Contains(out, "dag fast") {
		t.Errorf("a wait and hold under the rpc budget must not log:\n%s", out)
	}
	for _, id := range []string{"held", "waited"} {
		if !strings.Contains(out, "dag "+id+" lock") {
			t.Errorf("dag %s must log:\n%s", id, out)
		}
	}
	if !strings.Contains(out, "by orchestrate.TestSlowLockLogNamesItsCaller (mutation_test.go:") {
		t.Errorf("the log must name the caller, not the lock's own frames:\n%s", out)
	}
	if strings.Contains(out, "slowest") {
		t.Errorf("a slow lock with no timings must read as before:\n%s", out)
	}
}

func TestSlowPhasesNamesTheLongestInOrder(t *testing.T) {
	timings := []phaseTiming{
		{"load", 200 * time.Millisecond},
		{"merge", 3 * time.Second},
		{"liveness", 9800 * time.Millisecond},
		{"review", 12100 * time.Millisecond},
		{"dispatch", 40 * time.Millisecond},
	}
	if got, want := slowPhases(timings, 3), "review 12.1s, liveness 9.8s, merge 3.0s"; got != want {
		t.Errorf("slowPhases = %q, want %q", got, want)
	}
	if got, want := slowPhases(timings[:2], 3), "merge 3.0s, load 0.2s"; got != want {
		t.Errorf("fewer phases than asked for = %q, want %q", got, want)
	}
	if got := slowPhases(nil, 3); got != "" {
		t.Errorf("no timings = %q, want empty", got)
	}
	if timings[0].name != "load" {
		t.Errorf("slowPhases reordered the caller's slice: %v", timings)
	}
}

func TestSlowLockLogCarriesItsPhases(t *testing.T) {
	var logged bytes.Buffer
	log.SetOutput(&logged)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	phases := []phaseTiming{{"dispatch", time.Second}, {"review", 12 * time.Second}}
	logSlowDagLock("held", 0, slowDagLock, phases)
	logSlowDagLock("fast", time.Millisecond, time.Millisecond, phases)
	out := logged.String()
	if !strings.Contains(out, "by orchestrate.TestSlowLockLogCarriesItsPhases (mutation_test.go:") ||
		!strings.Contains(out, "review 12.0s, dispatch 1.0s") {
		t.Errorf("the log must name the caller and, after it, the slow phases:\n%s", out)
	}
	if strings.Contains(out, "dag fast") {
		t.Errorf("a fast lock must not log, whatever it timed:\n%s", out)
	}
}

// withSlowDagLock lowers the slow-lock bar so a test's lock can pass it without sleeping the rpc budget
func withSlowDagLock(t *testing.T, bar time.Duration) *bytes.Buffer {
	t.Helper()
	old := slowDagLock
	slowDagLock = bar
	var logged bytes.Buffer
	log.SetOutput(&logged)
	t.Cleanup(func() {
		slowDagLock = old
		log.SetOutput(os.Stderr)
	})
	return &logged
}

func TestDagLockHandsItsHoldersPhasesToTheLog(t *testing.T) {
	logged := withSlowDagLock(t, 10*time.Millisecond)
	for _, tc := range []struct {
		name string
		hold func(dagID string, fn func() error) error
	}{
		{"WithDagMutation", WithDagMutation},
		{"TryWithDagMutation", func(dagID string, fn func() error) error { _, err := TryWithDagMutation(dagID, fn); return err }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			logged.Reset()
			dagID := "phased-" + tc.name
			if err := tc.hold(dagID, func() error {
				recordLockPhase(dagID, "first-phase", 12*time.Second)
				time.Sleep(15 * time.Millisecond)
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(logged.String(), "first-phase 12.0s") {
				t.Errorf("the holder's phase must reach the slow-lock line:\n%s", logged.String())
			}
			// the next holder has its own phases: the first's must be gone, not carried over
			logged.Reset()
			if err := tc.hold(dagID, func() error {
				time.Sleep(15 * time.Millisecond)
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if out := logged.String(); !strings.Contains(out, "dag "+dagID+" lock") || strings.Contains(out, "first-phase") {
				t.Errorf("a holder that timed nothing must log without the previous holder's phases:\n%s", out)
			}
			if left := takeLockPhases(dagID); left != nil {
				t.Errorf("the holder's phases outlived its lock: %v", left)
			}
		})
	}
}

// A holder's phases are taken before it unlocks: the waiter that takes the lock next starts its own entry at once, and
// a holder that took after the unlock would carry off that entry, or leave the waiter's phases to be dropped.
func TestAHolderKeepsItsPhasesFromTheWaiterBehindIt(t *testing.T) {
	logged := withSlowDagLock(t, 0)
	const rounds = 300
	for i := range rounds {
		dagID := fmt.Sprintf("handoff-%d", i)
		waiter := make(chan error, 1)
		if err := WithDagMutation(dagID, func() error {
			recordLockPhase(dagID, "holder-phase", 12*time.Second)
			go func() {
				waiter <- WithDagMutation(dagID, func() error {
					recordLockPhase(dagID, "waiter-phase", 12*time.Second)
					return nil
				})
			}()
			// long enough for the waiter to be parked on the lock
			time.Sleep(time.Millisecond)
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		if err := <-waiter; err != nil {
			t.Fatal(err)
		}
	}
	holders, waiters, mixed := 0, 0, 0
	for line := range strings.SplitSeq(logged.String(), "\n") {
		if !strings.Contains(line, "handoff-") {
			continue
		}
		h, w := strings.Contains(line, "holder-phase"), strings.Contains(line, "waiter-phase")
		switch {
		case h && w:
			mixed++
		case h:
			holders++
		case w:
			waiters++
		}
	}
	if holders != rounds || waiters != rounds || mixed != 0 {
		t.Errorf("over %d hand-offs, %d lines named only the holder's phase, %d only the waiter's, %d both; want %d, %d, 0", rounds, holders, waiters, mixed, rounds, rounds)
	}
}

// peekLockPhases reads the current holder's phases without taking them
func peekLockPhases(dagID string) []phaseTiming {
	lockPhases.mu.Lock()
	defer lockPhases.mu.Unlock()
	return append([]phaseTiming(nil), lockPhases.m[dagID]...)
}

func TestLockPhasesAreRecordedOnlyWhileTheLockIsHeld(t *testing.T) {
	recordLockPhase("unheld-dag", "stray", time.Second)
	if err := WithDagMutation("unheld-dag", func() error {
		if got := peekLockPhases("unheld-dag"); len(got) != 0 {
			t.Errorf("a phase recorded with no holder reached the next holder: %v", got)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestScheduleTimesItsPhasesUnderTheLock(t *testing.T) {
	ctx, dag, _ := seedFailedDag(t)
	var phases []phaseTiming
	if err := withDagMutation(dag.OID, func() error {
		var stalled []stalledTask
		var recovered []askRecovery
		err := scheduleLocked(ctx, dag.OID, &stalled, &recovered)
		phases = peekLockPhases(dag.OID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, p := range phases {
		names = append(names, p.name)
	}
	want := []string{"liveness", "review", "plan review", "base check", "dispatch", "final", "commit"}
	next := 0
	for _, n := range names {
		if next < len(want) && n == want[next] {
			next++
		}
	}
	if next != len(want) {
		t.Errorf("scheduleLocked timed %v, want %v among them in that order", names, want)
	}
}
