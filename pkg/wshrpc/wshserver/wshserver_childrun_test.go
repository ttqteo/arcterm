// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/harness"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// the tests share one store, and a lead resolves by scanning every run row for its oref, so each
// test's lead tab is its own
func leadTabORef(ch *waveobj.Channel) string {
	return waveobj.MakeORef(waveobj.OType_Tab, "lead-"+ch.OID).String()
}

func TestCreateChildRunCommand_InheritsAndStampsParent(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "backlog", "/repo")
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	parent := jarvis.NewRun("work the backlog", "ws-1", "/repo",
		waveobj.PrincipleList{{ID: "clean", Text: "be clean"}},
		jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	leadORef := leadTabORef(ch)
	parent.Phases[0].WorkerOrefs = []string{leadORef}
	if err := wstore.AppendRun(ctx, ch.OID, parent); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}

	var spawnedWith runroute.Capability
	origSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(_ context.Context, cap runroute.Capability, _, _, _, _ string, _ jarvis.RunWorkerOptions) (string, error) {
		spawnedWith = cap
		return waveobj.MakeORef(waveobj.OType_Tab, "childtab").String(), nil
	}
	defer func() { jarvis.SpawnRunWorker = origSpawn }()

	ws := &WshServer{}
	rtn, err := ws.CreateChildRunCommand(ctx, wshrpc.CommandCreateChildRunData{ORef: leadORef, Goal: "fix issue 6a"})
	if err != nil {
		t.Fatalf("CreateChildRunCommand: %v", err)
	}
	child, err := wstore.GetRun(ctx, ch.OID, rtn.RunId)
	if err != nil {
		t.Fatalf("GetRun(child): %v", err)
	}
	if child.ParentLeadORef != leadORef {
		t.Errorf("ParentLeadORef = %q, want %q", child.ParentLeadORef, leadORef)
	}
	if child.Goal != "fix issue 6a" {
		t.Errorf("Goal = %q", child.Goal)
	}
	if child.ProjectPath != "/repo" || child.WorkspaceId != "ws-1" {
		t.Errorf("child did not inherit project/workspace: proj=%q ws=%q", child.ProjectPath, child.WorkspaceId)
	}
	if len(child.Principles) != 1 {
		t.Errorf("child did not inherit principles: %+v", child.Principles)
	}
	if child.Mode != jarvis.RunMode_Orchestrator {
		t.Errorf("child Mode = %q, want inherited orchestrator", child.Mode)
	}
	if child.Runtime != "claude" || child.Model != "" {
		t.Errorf("child route = %s/%q, want the claude default", child.Runtime, child.Model)
	}
	if spawnedWith.Runtime != "claude" || spawnedWith.Model != "" {
		t.Errorf("spawned capability = %+v, want the claude default", spawnedWith)
	}
	for i, p := range child.Phases {
		if p.Gate {
			t.Errorf("child phase %d is gated; child runs must be hands-off", i)
		}
	}
}

// A child Run inherits the parent's explicit runtime.
func TestCreateChildRunCommand_InheritsParentRuntime(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "backlog-rt", "/repo")
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	parent := jarvis.NewRun("work the backlog", "ws-1", "/repo",
		nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	parent.Runtime = "pi"
	parent.Model = "opencode/deepseek-v4-pro"
	leadORef := leadTabORef(ch)
	parent.Phases[0].WorkerOrefs = []string{leadORef}
	if err := wstore.AppendRun(ctx, ch.OID, parent); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}

	oldValidate := validateHarness
	validateHarness = func(runtime string, op harness.Operation) (harness.Spec, error) {
		spec, ok := harness.Lookup(runtime)
		if !ok {
			return harness.ValidateInstalled(runtime, op)
		}
		return spec, nil
	}
	t.Cleanup(func() { validateHarness = oldValidate })
	origSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(_ context.Context, cap runroute.Capability, _, _, _, _ string, _ jarvis.RunWorkerOptions) (string, error) {
		return waveobj.MakeORef(waveobj.OType_Tab, "childtab").String(), nil
	}
	defer func() { jarvis.SpawnRunWorker = origSpawn }()

	rtn, err := (&WshServer{}).CreateChildRunCommand(ctx, wshrpc.CommandCreateChildRunData{ORef: leadORef, Goal: "fix 6a"})
	if err != nil {
		t.Fatalf("CreateChildRunCommand: %v", err)
	}
	child, err := wstore.GetRun(ctx, ch.OID, rtn.RunId)
	if err != nil {
		t.Fatalf("GetRun(child): %v", err)
	}
	if child.Runtime != "pi" || child.Model != parent.Model {
		t.Errorf("child route = %s/%q, want the parent's pi model", child.Runtime, child.Model)
	}
}

// A child Run of a legacy parent (empty runtime) persists explicit claude.
func TestCreateChildRunCommand_LegacyParentPersistsClaude(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "backlog-legacy", "/repo")
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	parent := jarvis.NewRun("work the backlog", "ws-1", "/repo",
		nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	leadORef := leadTabORef(ch)
	parent.Phases[0].WorkerOrefs = []string{leadORef}
	if err := wstore.AppendRun(ctx, ch.OID, parent); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}

	oldValidate := validateHarness
	validateHarness = func(runtime string, op harness.Operation) (harness.Spec, error) {
		spec, ok := harness.Lookup(runtime)
		if !ok {
			return harness.ValidateInstalled(runtime, op)
		}
		return spec, nil
	}
	t.Cleanup(func() { validateHarness = oldValidate })
	origSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(_ context.Context, cap runroute.Capability, _, _, _, _ string, _ jarvis.RunWorkerOptions) (string, error) {
		return waveobj.MakeORef(waveobj.OType_Tab, "childtab").String(), nil
	}
	defer func() { jarvis.SpawnRunWorker = origSpawn }()

	rtn, err := (&WshServer{}).CreateChildRunCommand(ctx, wshrpc.CommandCreateChildRunData{ORef: leadORef, Goal: "fix 6a"})
	if err != nil {
		t.Fatalf("CreateChildRunCommand: %v", err)
	}
	child, err := wstore.GetRun(ctx, ch.OID, rtn.RunId)
	if err != nil {
		t.Fatalf("GetRun(child): %v", err)
	}
	if child.Runtime != "claude" || child.Model != "" {
		t.Errorf("child route = %s/%q, want explicit claude with its default model for a legacy parent", child.Runtime, child.Model)
	}
}

func TestCreateChildRunCommand_UnresolvedOrefFails(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	if _, err := ws.CreateChildRunCommand(ctx, wshrpc.CommandCreateChildRunData{ORef: "tab:nope", Goal: "x"}); err == nil {
		t.Fatal("want an error when the oref resolves to no run")
	}
}

func TestChildDoneNotifiesParentLead(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "notify-done", t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	leadORef := waveobj.MakeORef(waveobj.OType_Tab, "leadtab").String()
	child := jarvis.NewRun("fix 6a", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	child.ParentLeadORef = leadORef
	if err := wstore.AppendRun(ctx, ch.OID, child); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}

	origSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(_ context.Context, _ runroute.Capability, _, _, _, _ string, _ jarvis.RunWorkerOptions) (string, error) {
		return waveobj.MakeORef(waveobj.OType_Tab, "x").String(), nil
	}
	defer func() { jarvis.SpawnRunWorker = origSpawn }()

	var gotORef, gotLine string
	origSteer := steerRunLead
	steerRunLead = func(_ context.Context, oref, text string) { gotORef, gotLine = oref, text }
	defer func() { steerRunLead = origSteer }()

	ws := &WshServer{}
	if err := ws.AdvanceRunCommand(ctx, wshrpc.CommandAdvanceRunData{
		ChannelId: ch.OID, RunId: child.ID, PhaseIdx: 0, Action: jarvis.RunAction_Complete,
	}); err != nil {
		t.Fatalf("AdvanceRunCommand: %v", err)
	}
	if gotORef != leadORef {
		t.Errorf("notified oref = %q, want %q", gotORef, leadORef)
	}
	if want := "-> done"; !strings.Contains(gotLine, want) {
		t.Errorf("notify line %q missing %q", gotLine, want)
	}
}

func TestChildCancelNotifiesParentLead(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "notify-cancel", t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	leadORef := waveobj.MakeORef(waveobj.OType_Tab, "leadtab").String()
	child := jarvis.NewRun("fix 6b", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	child.ParentLeadORef = leadORef
	if err := wstore.AppendRun(ctx, ch.OID, child); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}

	var gotORef, gotLine string
	origSteer := steerRunLead
	steerRunLead = func(_ context.Context, oref, text string) { gotORef, gotLine = oref, text }
	defer func() { steerRunLead = origSteer }()

	ws := &WshServer{}
	if err := ws.CancelRunCommand(ctx, wshrpc.CommandCancelRunData{ChannelId: ch.OID, RunId: child.ID}); err != nil {
		t.Fatalf("CancelRunCommand: %v", err)
	}
	if gotORef != leadORef || !strings.Contains(gotLine, "-> cancelled") {
		t.Errorf("cancel notify: oref=%q line=%q", gotORef, gotLine)
	}
}

func TestCancelDagChildDoesNotCancelOwnerOrSpawnReplacement(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "cancel-dag-child", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	child := jarvis.NewRun("child", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	dag, err := orchestrate.NewTaskGroup(owner.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{{ID: "t", Label: "task"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	owner.DagORef = dag.OID
	child.DagORef = dag.OID
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendRun(ctx, ch.OID, child); err != nil {
		t.Fatal(err)
	}
	dag.Tasks[0].State = orchestrate.TaskState_Running
	dag.Tasks[0].RunID = child.ID
	if err := wstore.AppendDag(ctx, &dag); err != nil {
		t.Fatal(err)
	}
	spawnCalls := 0
	oldSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		spawnCalls++
		return "tab:unexpected", nil
	}
	t.Cleanup(func() { jarvis.SpawnRunWorker = oldSpawn })

	if err := (&WshServer{}).CancelRunCommand(ctx, wshrpc.CommandCancelRunData{ChannelId: ch.OID, RunId: child.ID}); err != nil {
		t.Fatal(err)
	}
	gotChild, _ := wstore.GetRun(ctx, ch.OID, child.ID)
	gotOwner, _ := wstore.GetRun(ctx, ch.OID, owner.ID)
	gotDag, _ := wstore.GetDag(ctx, dag.OID)
	if gotChild.Status != jarvis.RunStatus_Cancelled {
		t.Fatalf("child status = %q, want cancelled", gotChild.Status)
	}
	if gotOwner.Status == jarvis.RunStatus_Cancelled {
		t.Fatal("child cancellation invoked owner-wide cancellation")
	}
	if gotDag.Tasks[0].State != orchestrate.TaskState_Cancelled || gotDag.Status != orchestrate.DagStatus_Cancelled {
		t.Fatalf("dag was not derived from child cancellation: status=%q task=%q", gotDag.Status, gotDag.Tasks[0].State)
	}
	if spawnCalls != 0 {
		t.Fatalf("child cancellation spawned %d replacement workers", spawnCalls)
	}
}

func TestParentlessRunDoesNotNotify(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "no-parent", t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	run := jarvis.NewRun("solo", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}
	origSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(_ context.Context, _ runroute.Capability, _, _, _, _ string, _ jarvis.RunWorkerOptions) (string, error) {
		return waveobj.MakeORef(waveobj.OType_Tab, "x").String(), nil
	}
	defer func() { jarvis.SpawnRunWorker = origSpawn }()

	called := false
	origSteer := steerRunLead
	steerRunLead = func(_ context.Context, _, _ string) { called = true }
	defer func() { steerRunLead = origSteer }()

	ws := &WshServer{}
	if err := ws.AdvanceRunCommand(ctx, wshrpc.CommandAdvanceRunData{
		ChannelId: ch.OID, RunId: run.ID, PhaseIdx: 0, Action: jarvis.RunAction_Complete,
	}); err != nil {
		t.Fatalf("AdvanceRunCommand: %v", err)
	}
	if called {
		t.Error("steerRunLead must not fire for a run with no ParentLeadORef")
	}
}

const validWorkerReport = "## Done\nlanded\n\n## Differs from plan\nNone\n\n## Not verified\nNone\n\n## For later tasks\nNone\n\n## Found not fixed\nNone"

// a task worker's report is its seal's summary, so the server refuses its complete without one; a
// reviewer's verdict and a run outside the dag carry their own close
func TestTaskWorkerCompleteRequiresReport(t *testing.T) {
	ctx := context.Background()
	origSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(_ context.Context, _ runroute.Capability, _, _, _, _ string, _ jarvis.RunWorkerOptions) (string, error) {
		return waveobj.MakeORef(waveobj.OType_Tab, "x").String(), nil
	}
	defer func() { jarvis.SpawnRunWorker = origSpawn }()
	origSteer := steerRunLead
	steerRunLead = func(_ context.Context, _, _ string) {}
	defer func() { steerRunLead = origSteer }()

	cases := []struct {
		name    string
		taskId  string
		review  bool
		report  string
		wantErr bool
	}{
		{"a task worker without a report is refused", "t-1", false, "", true},
		{"a whitespace report is no report", "t-1", false, "  \n", true},
		{"a task worker with a valid report completes", "t-1", false, validWorkerReport, false},
		{"a free-form report is refused with the parser's problem", "t-1", false, "did the thing", true},
		{"a reviewer completes without one", "t-1", true, "", false},
		{"a reviewer's free-form report completes", "t-1", true, "verdict: pass", false},
		{"a lead's free-form report completes", "", false, "all landed", false},
		{"a run outside the dag completes without one", "", false, "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ch, err := wstore.CreateChannel(ctx, "report-"+tc.name, t.TempDir())
			if err != nil {
				t.Fatalf("CreateChannel: %v", err)
			}
			run := jarvis.NewRun("task", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
			run.TaskId, run.Review = tc.taskId, tc.review
			if tc.taskId != "" && !tc.review {
				run.DagORef = "dag-1"
			}
			if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
				t.Fatalf("AppendRun: %v", err)
			}
			ws := &WshServer{}
			err = ws.AdvanceRunCommand(ctx, wshrpc.CommandAdvanceRunData{
				ChannelId: ch.OID, RunId: run.ID, PhaseIdx: 0, Action: jarvis.RunAction_Complete, Report: tc.report,
			})
			if !tc.wantErr {
				if err != nil {
					t.Fatalf("AdvanceRunCommand: %v", err)
				}
				if tc.report != "" {
					got, _ := wstore.GetRun(ctx, ch.OID, run.ID)
					if got.Evidence == nil || got.Evidence.Summary != tc.report {
						t.Fatalf("the report must seal into Evidence.Summary unchanged, got %+v", got.Evidence)
					}
				}
				return
			}
			if tc.report == "did the thing" && !strings.Contains(err.Error(), "missing: Done") {
				t.Fatalf("error %q must carry the parser's problems", err)
			}
			if err == nil {
				t.Fatal("complete without a report must be refused")
			}
			path := orchestrate.WorkerReportPath("dag-1", "t-1")
			for _, want := range []string{ErrWorkerReportRequired, "--report", path} {
				if !strings.Contains(err.Error(), want) {
					t.Fatalf("error %q missing %q", err, want)
				}
			}
			if got, _ := wstore.GetRun(ctx, ch.OID, run.ID); got.Status == jarvis.RunStatus_Done {
				t.Fatal("a refused complete must leave the run open")
			}
		})
	}
}
