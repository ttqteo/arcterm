// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// seedDispatchDag builds a one-task dag whose owning run is git-free, so scheduling goes straight to
// the spawn step and any dispatch failure is the only thing that can happen.
func seedDispatchDag(t *testing.T, name string) (context.Context, *waveobj.TaskGroup, string, string) {
	t.Helper()
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, name, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{{ID: "t-0", Label: "a"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	return ctx, &g, ch.OID, owner.ID
}

// seedTwoTaskDispatchDag is seedDispatchDag with two independent ready tasks and parallelism 2, so one
// tick spawns both.
func seedTwoTaskDispatchDag(t *testing.T, name string) (context.Context, *waveobj.TaskGroup, string, string) {
	t.Helper()
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, name, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 2, false, []waveobj.TaskNode{{ID: "t-0", Label: "a"}, {ID: "t-1", Label: "b"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	return ctx, &g, ch.OID, owner.ID
}

// a task that dies before it starts has no child run and no transcript, so the reason must be
// recorded at the dispatch site or it exists nowhere.
func TestScheduleRecordsSpawnFailureReason(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx, g, channelID, runID := seedDispatchDag(t, "dispatch-spawn")
	stubSpawnWorker(t, "", errors.New("no worker slot available"))
	spendDispatchRetries(t, ctx, g.OID)

	if err := ScheduleOnce(ctx, g); err != nil {
		t.Fatal(err)
	}
	got := mustLoadDag(t, ctx, g.OID)
	if got.Tasks[0].State != TaskState_Failed || got.Tasks[0].LastFailureKind != FailureKindSpawn {
		t.Fatalf("spawn failure task = %+v", got.Tasks[0])
	}
	if want := MaxAutoDispatchRetries + 1; got.Tasks[0].Attempts != want {
		t.Fatalf("spawn failure attempts = %d, want %d", got.Tasks[0].Attempts, want)
	}
	detail := eventDetail(t, lifecycleEvents(t, channelID, runID), waveobj.RunEventKindTaskFailed)
	if detail == nil {
		t.Fatal("dispatch failure emitted no task-failed event")
	}
	if detail["lastfailurekind"] != FailureKindSpawn {
		t.Fatalf("event kind = %v, want %q", detail["lastfailurekind"], FailureKindSpawn)
	}
	msg, _ := detail["detail"].(string)
	if !strings.Contains(msg, "no worker slot available") {
		t.Fatalf("event detail %q does not carry the cause", msg)
	}
}

// a worker that spawned but could not be recorded is stopped and its task failed by the schedule
// cleanup, which must leave the same trail as a spawn that never happened.
func TestScheduleRecordsUnrecordedDispatchReason(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx, g, channelID, runID := seedDispatchDag(t, "dispatch-unrecorded")
	stubSpawnWorker(t, "tab:worker-unrecorded", nil)
	oldAppend, oldStop := appendChildRun, stopSpawnedWorker
	appendChildRun = func(context.Context, string, waveobj.Run) error { return errors.New("child run persist failed") }
	stopSpawnedWorker = func(context.Context, string) error { return nil }
	restoreAfterStages(t, func() { appendChildRun, stopSpawnedWorker = oldAppend, oldStop })

	if err := Schedule(ctx, g.OID); err == nil {
		t.Fatal("want the persist failure returned")
	}
	got := mustLoadDag(t, ctx, g.OID)
	if got.Tasks[0].State != TaskState_Failed || got.Tasks[0].LastFailureKind != FailureKindUnrecorded {
		t.Fatalf("unrecorded dispatch task = %+v", got.Tasks[0])
	}
	if got.Tasks[0].Attempts != 1 {
		t.Fatalf("unrecorded dispatch attempts = %d, want 1", got.Tasks[0].Attempts)
	}
	detail := eventDetail(t, lifecycleEvents(t, channelID, runID), waveobj.RunEventKindTaskFailed)
	if detail == nil {
		t.Fatal("unrecorded dispatch emitted no task-failed event")
	}
	if detail["lastfailurekind"] != FailureKindUnrecorded {
		t.Fatalf("event kind = %v, want %q", detail["lastfailurekind"], FailureKindUnrecorded)
	}
	msg, _ := detail["detail"].(string)
	if !strings.Contains(msg, "child run persist failed") {
		t.Fatalf("event detail %q does not carry the cause", msg)
	}
}

func TestScheduleRecordsHarnessFailureReason(t *testing.T) {
	old := validateWorkerHarness
	validateWorkerHarness = func(string) error { return errors.New("pi is not installed") }
	restoreAfterStages(t, func() { validateWorkerHarness = old })
	ctx, g, channelID, runID := seedDispatchDag(t, "dispatch-harness")
	stubSpawnWorker(t, waveobj.MakeORef(waveobj.OType_Tab, "unused").String(), nil)

	if err := ScheduleOnce(ctx, g); err != nil {
		t.Fatal(err)
	}
	got := mustLoadDag(t, ctx, g.OID)
	if got.Tasks[0].LastFailureKind != FailureKindHarness {
		t.Fatalf("harness failure kind = %q", got.Tasks[0].LastFailureKind)
	}
	detail := eventDetail(t, lifecycleEvents(t, channelID, runID), waveobj.RunEventKindTaskFailed)
	msg, _ := detail["detail"].(string)
	if !strings.Contains(msg, "pi is not installed") {
		t.Fatalf("event detail %q does not carry the cause", msg)
	}
}

// a child that exits cleanly without running `wsh jarvis complete` has not completed; the process
// exit says so immediately instead of costing a StallThreshold wait.
func TestHandleChildOutcomeFailsUnreportedWorkerExit(t *testing.T) {
	h := newChildOutcomeHarness(t, 1)
	if err := HandleChildOutcome(h.ctx, h.workers[0], jarvis.OutcomeData{Status: "done", Summary: "session ended"}); err != nil {
		t.Fatal(err)
	}
	got := h.loadDag(t)
	if got.Tasks[0].State != TaskState_Failed || got.Tasks[0].LastFailureKind != FailureKindWorkerExit {
		t.Fatalf("unreported exit task = %+v", got.Tasks[0])
	}
	if got.Status != DagStatus_Blocked {
		t.Fatalf("dag status = %q, want blocked", got.Status)
	}
}

// the child's completion RPC lands just before its process exits, so a clean exit on an already
// completed run must stay a no-op.
func TestHandleChildOutcomeIgnoresExitAfterCompletion(t *testing.T) {
	h := newChildOutcomeHarness(t, 1)
	childRunID := h.loadDag(t).Tasks[0].RunID
	if err := wstore.UpdateRun(h.ctx, h.channel, childRunID, func(r *waveobj.Run) error {
		r.Status = jarvis.RunStatus_Done
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := HandleChildOutcome(h.ctx, h.workers[0], jarvis.OutcomeData{Status: "done"}); err != nil {
		t.Fatal(err)
	}
	got := h.loadDag(t)
	if got.Tasks[0].State == TaskState_Failed || got.Tasks[0].LastFailureKind != "" {
		t.Fatalf("completed child was recorded as a failure: %+v", got.Tasks[0])
	}
}

// a context-window failure is a real failure: the human picks a bigger model, the engine never guesses one.
func TestHandleChildOutcomeFailsContextWindowWithoutRepinning(t *testing.T) {
	h := newChildOutcomeHarness(t, 1)
	data := jarvis.OutcomeData{Status: "failed", Summary: "context window exceeded", ExitCode: 1}
	if err := HandleChildOutcome(h.ctx, h.workers[0], data); err != nil {
		t.Fatal(err)
	}
	got := h.loadDag(t)
	task := got.Tasks[0]
	if task.State != TaskState_Failed || task.Escalations != 0 || task.RunSpec.Runtime != "" || task.RunSpec.Model != "" {
		t.Fatalf("context-window failure = %+v", task)
	}
	if got.Failures != 1 {
		t.Fatalf("a terminal failure must push the failure streak, got %d", got.Failures)
	}
	if len(h.workers) != 1 {
		t.Fatalf("a context-window failure spawned %d workers, want 1", len(h.workers))
	}
}

// cleanup must remove a worktree from the same repo the merge landed in, and merge uses the run.
func TestCleanupProjectPathPrefersOwningRun(t *testing.T) {
	ctx := context.Background()
	channelDir := t.TempDir()
	runDir := t.TempDir()
	ch, err := wstore.CreateChannel(ctx, "cleanup-projectpath", channelDir)
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", runDir, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{{ID: "t-0", Label: "a"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	got, err := cleanupProjectPath(ctx, &g)
	if err != nil {
		t.Fatal(err)
	}
	if got != runDir {
		t.Fatalf("cleanup project path = %q, want the owning run's %q", got, runDir)
	}

	// no owning run row: the channel is the documented fallback
	orphan := g
	orphan.RunID = "missing-run"
	got, err = cleanupProjectPath(ctx, &orphan)
	if err != nil {
		t.Fatal(err)
	}
	if got != channelDir {
		t.Fatalf("fallback project path = %q, want %q", got, channelDir)
	}
}

// the exported lock is what lets the merge handlers (which live outside this package) serialize
// against the engine's whole-object write.
func TestWithDagMutationSerializesAndRequiresID(t *testing.T) {
	if err := WithDagMutation("", func() error { return nil }); err == nil {
		t.Fatal("an empty dag id must be rejected")
	}
	inner := 0
	err := WithDagMutation("dag-1", func() error {
		inner++
		return fmt.Errorf("propagated")
	})
	if err == nil || err.Error() != "propagated" || inner != 1 {
		t.Fatalf("WithDagMutation err=%v inner=%d", err, inner)
	}
}
