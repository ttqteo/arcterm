package orchestrate

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestChildOutcomeHookRegistered(t *testing.T) {
	if jarvis.ChildOutcomeHook == nil {
		t.Fatal("orchestrate must register the child outcome hook")
	}
}

type childOutcomeHarness struct {
	ctx     context.Context
	dagID   string
	channel string
	runID   string
	workers []string
}

func newChildOutcomeHarness(t *testing.T, taskCount int) *childOutcomeHarness {
	t.Helper()
	allowWorkerHarnessForTest(t)
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "child-outcome", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	owner.Runtime = "claude"
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	tasks := make([]waveobj.TaskNode, taskCount)
	for i := range tasks {
		tasks[i] = waveobj.TaskNode{ID: fmt.Sprintf("t-%d", i), Label: fmt.Sprintf("task %d", i)}
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "outcomes", taskCount, false, tasks, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	h := &childOutcomeHarness{ctx: ctx, dagID: g.OID, channel: ch.OID, runID: owner.ID}
	oldSpawn := spawnWorker
	spawnWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		tabID := uuid.NewString()
		blockID := uuid.NewString()
		worker := waveobj.MakeORef(waveobj.OType_Tab, tabID).String()
		if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: tabID, BlockIds: []string{blockID}, Meta: waveobj.MetaMapType{}}); err != nil {
			return "", err
		}
		if err := wstore.DBInsert(ctx, &waveobj.Block{OID: blockID, ParentORef: worker, Meta: waveobj.MetaMapType{}}); err != nil {
			return "", err
		}
		h.workers = append(h.workers, worker)
		return worker, nil
	}
	restoreAfterStages(t, func() { spawnWorker = oldSpawn })
	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if len(h.workers) != taskCount {
		t.Fatalf("spawned workers = %d, want %d", len(h.workers), taskCount)
	}
	return h
}

func (h *childOutcomeHarness) loadDag(t *testing.T) *waveobj.TaskGroup {
	t.Helper()
	g, err := wstore.GetDag(h.ctx, h.dagID)
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func TestHandleChildOutcomeImmediatelyRespawnsFirstToolFailure(t *testing.T) {
	h := newChildOutcomeHarness(t, 1)
	before := h.loadDag(t)
	oldRunID := before.Tasks[0].RunID
	if err := HandleChildOutcome(h.ctx, h.workers[0], jarvis.OutcomeData{Status: "failed", Summary: "tool call errored: invalid input", ExitCode: 2}); err != nil {
		t.Fatal(err)
	}
	got := h.loadDag(t)
	task := got.Tasks[0]
	if task.State != TaskState_Running || task.RunID == "" || task.RunID == oldRunID {
		t.Fatalf("replacement task = %+v, old run %q", task, oldRunID)
	}
	if taskByRunID(got, oldRunID) != nil {
		t.Fatalf("old child run %q still owns a task", oldRunID)
	}
	if task.Attempts != 1 || task.LastFailureKind != FailureKindToolError {
		t.Fatalf("failure state = attempts %d kind %q", task.Attempts, task.LastFailureKind)
	}
	if got.Status != DagStatus_Running || got.Failures != 0 {
		t.Fatalf("dag status=%q failures=%d", got.Status, got.Failures)
	}
}

func TestHandleChildOutcomeBlocksSecondConsecutiveToolFailure(t *testing.T) {
	h := newChildOutcomeHarness(t, 1)
	data := jarvis.OutcomeData{Status: "failed", Summary: "tool call errored", ExitCode: 2}
	if err := HandleChildOutcome(h.ctx, h.workers[0], data); err != nil {
		t.Fatal(err)
	}
	if len(h.workers) != 2 {
		t.Fatalf("first failure spawned %d workers, want 2", len(h.workers))
	}
	if err := HandleChildOutcome(h.ctx, h.workers[1], data); err != nil {
		t.Fatal(err)
	}
	got := h.loadDag(t)
	task := got.Tasks[0]
	if task.State != TaskState_Failed || task.Attempts != 2 || got.Status != DagStatus_Blocked {
		t.Fatalf("second failure task=%+v dag=%q", task, got.Status)
	}
}

func TestHandleChildOutcomeBlocksTimeoutOnFirstFailure(t *testing.T) {
	h := newChildOutcomeHarness(t, 1)
	if err := HandleChildOutcome(h.ctx, h.workers[0], jarvis.OutcomeData{Status: "failed", Summary: "request timed out", ExitCode: 1}); err != nil {
		t.Fatal(err)
	}
	got := h.loadDag(t)
	task := got.Tasks[0]
	if task.State != TaskState_Failed || task.Attempts != 1 || task.LastFailureKind != FailureKindTimeout || got.Status != DagStatus_Blocked {
		t.Fatalf("timeout outcome task=%+v dag=%q", task, got.Status)
	}
}

func TestHandleChildOutcomeNoOpsForStaleWorkerOwnership(t *testing.T) {
	h := newChildOutcomeHarness(t, 1)
	data := jarvis.OutcomeData{Status: "failed", Summary: "tool call errored", ExitCode: 2}
	if err := HandleChildOutcome(h.ctx, h.workers[0], data); err != nil {
		t.Fatal(err)
	}
	if len(h.workers) != 2 {
		t.Fatalf("first failure spawned %d workers, want 2", len(h.workers))
	}
	before := h.loadDag(t)
	if err := HandleChildOutcome(h.ctx, h.workers[0], data); err != nil {
		t.Fatal(err)
	}
	after := h.loadDag(t)
	if after.Tasks[0].RunID != before.Tasks[0].RunID || after.Tasks[0].Attempts != before.Tasks[0].Attempts || after.Failures != before.Failures || len(h.workers) != 2 {
		t.Fatalf("stale worker mutated dag: before=%+v after=%+v workers=%d", before.Tasks[0], after.Tasks[0], len(h.workers))
	}
}

func TestHandleChildOutcomeResetsAttemptCountWhenKindChanges(t *testing.T) {
	h := newChildOutcomeHarness(t, 1)
	if err := HandleChildOutcome(h.ctx, h.workers[0], jarvis.OutcomeData{Status: "failed", Summary: "request timed out", ExitCode: 1}); err != nil {
		t.Fatal(err)
	}
	if err := ApplyAction(h.ctx, h.dagID, "t-0", "retry", waveobj.RoutePin{}); err != nil {
		t.Fatal(err)
	}
	if len(h.workers) != 2 {
		t.Fatalf("human retry spawned %d workers, want 2", len(h.workers))
	}
	if err := HandleChildOutcome(h.ctx, h.workers[1], jarvis.OutcomeData{Status: "failed", Summary: "tool call errored", ExitCode: 2}); err != nil {
		t.Fatal(err)
	}
	got := h.loadDag(t)
	if got.Tasks[0].Attempts != 1 || got.Tasks[0].LastFailureKind != FailureKindToolError {
		t.Fatalf("changed kind did not reset count: %+v", got.Tasks[0])
	}
}

func TestHandleChildOutcomeUsesStampedUndispatchedRunWorker(t *testing.T) {
	h := newChildOutcomeHarness(t, 1)
	worker := h.workers[0]
	msgs, err := wstore.GetMessagesByRef(h.ctx, worker)
	if err != nil {
		t.Fatal(err)
	}
	for _, msg := range msgs {
		if msg.Kind == "dispatch" {
			t.Fatal("run worker unexpectedly has a dispatch message")
		}
	}
	if err := HandleChildOutcome(h.ctx, worker, jarvis.OutcomeData{Status: "failed", Summary: "request timed out", ExitCode: 1}); err != nil {
		t.Fatal(err)
	}
	if got := h.loadDag(t); got.Tasks[0].LastFailureKind != FailureKindTimeout {
		t.Fatalf("stamped undispatched worker was ignored: %+v", got.Tasks[0])
	}
}

func TestHandleChildOutcomePreservesCircuitBreakerCount(t *testing.T) {
	h := newChildOutcomeHarness(t, MaxConsecutiveFailures)
	for _, task := range h.loadDag(t).Tasks {
		if task.State != TaskState_Running {
			t.Fatalf("parallel task %s state = %q, want running", task.ID, task.State)
		}
	}
	for i := 0; i < MaxConsecutiveFailures; i++ {
		if err := HandleChildOutcome(h.ctx, h.workers[i], jarvis.OutcomeData{Status: "failed", Summary: "request timed out", ExitCode: 1}); err != nil {
			t.Fatal(err)
		}
	}
	got := h.loadDag(t)
	if got.Failures != MaxConsecutiveFailures {
		t.Fatalf("failures = %d, want %d", got.Failures, MaxConsecutiveFailures)
	}
}

func latestBlockedDetail(t *testing.T, h *childOutcomeHarness) struct {
	Failures int    `json:"failures"`
	Kind     string `json:"kind"`
} {
	t.Helper()
	events, err := wstore.QueryRunEvents(h.ctx, h.channel, h.runID, 50)
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range events {
		if event.Kind != waveobj.RunEventKindDagBlocked {
			continue
		}
		var detail struct {
			Failures int    `json:"failures"`
			Kind     string `json:"kind"`
		}
		if err := json.Unmarshal(event.Detail, &detail); err != nil {
			t.Fatal(err)
		}
		return detail
	}
	t.Fatal("missing persisted dag-blocked event")
	return struct {
		Failures int    `json:"failures"`
		Kind     string `json:"kind"`
	}{}
}

func TestBlockedRunEventIncludesSingleFailureKind(t *testing.T) {
	h := newChildOutcomeHarness(t, 1)
	if err := HandleChildOutcome(h.ctx, h.workers[0], jarvis.OutcomeData{Status: "failed", Summary: "request timed out", ExitCode: 1}); err != nil {
		t.Fatal(err)
	}
	detail := latestBlockedDetail(t, h)
	if detail.Kind != FailureKindTimeout {
		t.Fatalf("blocked event kind = %q, want %q", detail.Kind, FailureKindTimeout)
	}
}

func TestBlockedRunEventUsesMixedForDistinctKinds(t *testing.T) {
	h := newChildOutcomeHarness(t, 2)
	if err := HandleChildOutcome(h.ctx, h.workers[0], jarvis.OutcomeData{Status: "failed", Summary: "request timed out", ExitCode: 1}); err != nil {
		t.Fatal(err)
	}
	if err := HandleChildOutcome(h.ctx, h.workers[1], jarvis.OutcomeData{Status: "failed", Summary: "tests: TestFoo still failing", ExitCode: 1}); err != nil {
		t.Fatal(err)
	}
	detail := latestBlockedDetail(t, h)
	if detail.Kind != "mixed" {
		t.Fatalf("blocked event kind = %q, want mixed", detail.Kind)
	}
}

// newLeadExitRun stores an orchestrator run whose lead tab is "tab:lead-tab", and captures run events.
func newLeadExitRun(t *testing.T, mutate func(*waveobj.Run)) (context.Context, string, *waveobj.Run, *[]map[string]any) {
	t.Helper()
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "lead-exit", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	run := jarvis.NewRun("goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	run.Phases[0].WorkerOrefs = []string{"tab:lead-tab"}
	if mutate != nil {
		mutate(&run)
	}
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatal(err)
	}
	rows := &[]map[string]any{}
	oldOwner, oldAppend := workerOwnerOf, appendRunEvent
	workerOwnerOf = func(context.Context, string) (string, string, error) {
		return waveobj.MakeORef(waveobj.OType_Run, run.ID).String(), waveobj.MakeORef(waveobj.OType_Channel, ch.OID).String(), nil
	}
	appendRunEvent = func(_ context.Context, _, _, kind string, _ *int, detail any) {
		row := map[string]any{"eventkind": kind}
		if d, ok := detail.(map[string]any); ok {
			for k, v := range d {
				row[k] = v
			}
		}
		*rows = append(*rows, row)
	}
	restoreAfterStages(t, func() { workerOwnerOf, appendRunEvent = oldOwner, oldAppend })
	return ctx, ch.OID, &run, rows
}

func TestLeadExitBeforeSubmitFailsTheRunWithAReason(t *testing.T) {
	ctx, channelId, run, rows := newLeadExitRun(t, nil)
	if err := HandleRunWorkerExit(ctx, "tab:lead-tab", jarvis.WorkerExit{}); err != nil {
		t.Fatal(err)
	}
	got, err := wstore.GetRun(ctx, channelId, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != jarvis.RunStatus_Blocked || got.Phases[0].State != jarvis.PhaseState_Failed {
		t.Fatalf("run status=%q phase=%q, want blocked and failed", got.Status, got.Phases[0].State)
	}
	if len(*rows) != 1 || (*rows)[0]["eventkind"] != waveobj.RunEventKindLeadExited || (*rows)[0]["reason"] != leadExitedNote {
		t.Fatalf("want one lead-exited row with the reason, got %+v", *rows)
	}
}

func TestLeadExitLeavesOtherRunsAlone(t *testing.T) {
	for name, mutate := range map[string]func(*waveobj.Run){
		// G8: after submit the engine keeps running the dag, and the wake adapter hands judgment to the human
		"submitted": func(r *waveobj.Run) { r.DagORef = "dag-1" },
		// a spike or bounded lead completes before it exits. a failed CompletePhase leaves the run
		// executing, which the status check below then catches
		"finished": func(r *waveobj.Run) {
			next, _ := jarvis.CompletePhase(*r, 0, nil, 2)
			*r = next
		},
	} {
		t.Run(name, func(t *testing.T) {
			ctx, channelId, run, rows := newLeadExitRun(t, mutate)
			before := run.Status
			if err := HandleRunWorkerExit(ctx, "tab:lead-tab", jarvis.WorkerExit{}); err != nil {
				t.Fatal(err)
			}
			got, err := wstore.GetRun(ctx, channelId, run.ID)
			if err != nil {
				t.Fatal(err)
			}
			if got.Status != before || len(*rows) != 0 {
				t.Fatalf("status %q -> %q, rows %+v: a %s run is not the lead-exit case", before, got.Status, *rows, name)
			}
		})
	}
}

func TestWorkerExitFailsAQuickOrPipelineRun(t *testing.T) {
	for name, mode := range map[string]string{"quick": jarvis.RunMode_Quick, "pipeline": jarvis.RunMode_Pipeline} {
		t.Run(name, func(t *testing.T) {
			ctx, channelId, run, rows := newLeadExitRun(t, func(r *waveobj.Run) { r.Mode = mode })
			if err := HandleRunWorkerExit(ctx, "tab:lead-tab", jarvis.WorkerExit{}); err != nil {
				t.Fatal(err)
			}
			got, err := wstore.GetRun(ctx, channelId, run.ID)
			if err != nil {
				t.Fatal(err)
			}
			if got.Phases[0].State != jarvis.PhaseState_Failed {
				t.Fatalf("phase %q, want failed: a %s worker that exits without completing ends its phase", got.Phases[0].State, name)
			}
			if len(*rows) != 1 || (*rows)[0]["eventkind"] != waveobj.RunEventKindWorkerExited {
				t.Fatalf("want one worker-exited row, got %+v", *rows)
			}
		})
	}
}

func TestWorkerExitIgnoresAWorkerOutsideTheRunningPhase(t *testing.T) {
	ctx, channelId, run, rows := newLeadExitRun(t, func(r *waveobj.Run) {
		r.Mode = jarvis.RunMode_Pipeline
		r.Phases[0].WorkerOrefs = []string{"tab:next-phase-worker"}
	})
	// the exiting tab belonged to an earlier phase; its late exit must not fail the phase now running
	if err := HandleRunWorkerExit(ctx, "tab:lead-tab", jarvis.WorkerExit{}); err != nil {
		t.Fatal(err)
	}
	got, _ := wstore.GetRun(ctx, channelId, run.ID)
	if got.Phases[0].State == jarvis.PhaseState_Failed || len(*rows) != 0 {
		t.Fatalf("a stale worker's exit failed the running phase: %q %+v", got.Phases[0].State, *rows)
	}
}

// c84aa179: a merge's cleanup held the dag lock 22-39 s and the exit's 10 s context expired while the outcome waited
func TestHandleChildOutcomeOutlivesTheExitDeadline(t *testing.T) {
	h := newChildOutcomeHarness(t, 1)
	held := make(chan struct{})
	release := make(chan struct{})
	go WithDagMutation(h.dagID, func() error {
		close(held)
		<-release
		return nil
	})
	<-held
	time.AfterFunc(200*time.Millisecond, func() { close(release) })
	short, cancel := context.WithTimeout(h.ctx, 50*time.Millisecond)
	defer cancel()
	if err := HandleChildOutcome(short, h.workers[0], jarvis.OutcomeData{Status: "failed", Summary: "tool call errored: invalid input", ExitCode: 2}); err != nil {
		t.Fatalf("outcome lost behind the lock: %v", err)
	}
	if task := h.loadDag(t).Tasks[0]; task.Attempts != 1 || task.LastFailureKind != FailureKindToolError {
		t.Fatalf("outcome not recorded: attempts %d kind %q", task.Attempts, task.LastFailureKind)
	}
}

// a worker that exits non-zero while its run is open leaves its last output on that run: the tab and its
// terminal are deleted with the exit. A worker the engine stopped exits non-zero too, after its run closed.
func TestWorkerExitRecordsAFailingWorkersOutputOnItsRun(t *testing.T) {
	exit := jarvis.WorkerExit{ExitCode: 1, Output: "Error: session id already in use"}
	cases := []struct {
		name   string
		mutate func(*waveobj.Run)
		exit   jarvis.WorkerExit
		want   bool
	}{
		{name: "a dag child still working", mutate: func(r *waveobj.Run) { r.Mode = jarvis.RunMode_Quick; r.DagORef = "dag-1" }, exit: exit, want: true},
		{name: "a clean exit", mutate: func(r *waveobj.Run) { r.Mode = jarvis.RunMode_Quick; r.DagORef = "dag-1" }, exit: jarvis.WorkerExit{}, want: false},
		{name: "a worker stopped after its run was cancelled", mutate: func(r *waveobj.Run) {
			r.Mode = jarvis.RunMode_Quick
			r.DagORef = "dag-1"
			*r = jarvis.CancelRun(*r)
		}, exit: exit, want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, _, _, rows := newLeadExitRun(t, tc.mutate)
			if err := HandleRunWorkerExit(ctx, "tab:lead-tab", tc.exit); err != nil {
				t.Fatal(err)
			}
			var outputs []map[string]any
			for _, row := range *rows {
				if row["eventkind"] == waveobj.RunEventKindWorkerOutput {
					outputs = append(outputs, row)
				}
			}
			if !tc.want {
				if len(outputs) != 0 {
					t.Fatalf("want no worker-output row, got %+v", outputs)
				}
				return
			}
			if len(outputs) != 1 || outputs[0]["exitcode"] != 1 || outputs[0]["output"] != exit.Output || outputs[0]["worker"] != "tab:lead-tab" {
				t.Fatalf("want one worker-output row with the exit code and the output, got %+v", outputs)
			}
		})
	}
}
