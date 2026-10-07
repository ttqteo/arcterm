// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// storedPipeline is the shape a pipeline run was created with before 5c deleted the mode. The
// multi-phase operations below still run on one, because the store still holds them.
func storedPipeline() []waveobj.RunPhase {
	return []waveobj.RunPhase{
		{Kind: PhaseKind_Brainstorm, Skill: "superpowers:brainstorming", State: PhaseState_Pending},
		{Kind: PhaseKind_Plan, Skill: "superpowers:writing-plans", State: PhaseState_Pending, Gate: true},
		{Kind: PhaseKind_Execute, Skill: "superpowers:executing-plans", State: PhaseState_Pending, FreshCtx: true},
	}
}

func TestNewRunStartsFirstPhaseRunning(t *testing.T) {
	r := NewRun("ship coupons", "ws1", "/repo", nil, RunMode_Pipeline, storedPipeline(), 1717000000000)
	if r.ID == "" {
		t.Fatalf("expected a generated ID")
	}
	if r.Goal != "ship coupons" || r.WorkspaceId != "ws1" || r.ProjectPath != "/repo" || r.CreatedTs != 1717000000000 {
		t.Errorf("unexpected run header: %+v", r)
	}
	if len(r.Phases) != 3 || r.Phases[0].State != PhaseState_Running {
		t.Errorf("phase 0 should be running: %+v", r.Phases)
	}
	if r.Phases[1].State != PhaseState_Pending || r.Phases[2].State != PhaseState_Pending {
		t.Errorf("later phases should be pending: %+v", r.Phases)
	}
	if r.Status != RunStatus_Planning {
		t.Errorf("want planning, got %q", r.Status)
	}
}

func TestNewRunSnapshotsPrinciples(t *testing.T) {
	source := waveobj.PrincipleList{{ID: "simple", Text: "Prefer simple solutions."}}
	r := NewRun("g", "ws", "/r", source, RunMode_Pipeline, storedPipeline(), 1)
	source[0].Text = "changed later"
	if got := r.Principles[0].Text; got != "Prefer simple solutions." {
		t.Fatalf("want snapshotted principles, got %q", got)
	}
}

func TestNewRunCopiesPlaybook(t *testing.T) {
	pb := storedPipeline()
	r := NewRun("g", "ws", "/r", nil, RunMode_Pipeline, pb, 1)
	r.Phases[0].State = PhaseState_Done
	if pb[0].State != PhaseState_Pending {
		t.Errorf("NewRun must not alias the caller's playbook slice")
	}
}

func TestCompletePhaseAdvancesLinear(t *testing.T) {
	r := NewRun("g", "ws", "/r", nil, RunMode_Pipeline, storedPipeline(), 1)
	r, err := CompletePhase(r, 0, []string{"docs/spec.md"}, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if r.Phases[0].State != PhaseState_Done || r.Phases[0].Artifacts[0] != "docs/spec.md" {
		t.Errorf("phase 0 not completed with artifact: %+v", r.Phases[0])
	}
	if r.Phases[1].State != PhaseState_Running {
		t.Errorf("phase 1 should auto-start, got %q", r.Phases[1].State)
	}
	if r.Status != RunStatus_Planning {
		t.Errorf("want planning, got %q", r.Status)
	}
}

func TestCompletePhaseRecordsTimestamps(t *testing.T) {
	r := NewRun("g", "ws", "/p", nil, RunMode_Pipeline, storedPipeline(), 1000)
	if r.Phases[0].StartedTs != 1000 {
		t.Fatalf("first phase StartedTs = %d, want 1000", r.Phases[0].StartedTs)
	}
	r, err := CompletePhase(r, 0, nil, 2000)
	if err != nil {
		t.Fatal(err)
	}
	if r.Phases[0].DoneTs != 2000 {
		t.Fatalf("phase0 DoneTs = %d, want 2000", r.Phases[0].DoneTs)
	}
	if r.Phases[1].StartedTs != 2000 {
		t.Fatalf("phase1 StartedTs = %d, want 2000 (successor start)", r.Phases[1].StartedTs)
	}
}

func TestCompletePhaseRejectsNonRunning(t *testing.T) {
	r := NewRun("g", "ws", "/r", nil, RunMode_Pipeline, storedPipeline(), 1)
	if _, err := CompletePhase(r, 1, nil, 0); err == nil {
		t.Errorf("expected error completing a pending phase")
	}
	if _, err := CompletePhase(r, 9, nil, 0); err == nil {
		t.Errorf("expected error for out-of-range index")
	}
}

func TestCancelRunSkipsOpenPhases(t *testing.T) {
	r := NewRun("g", "ws", "/r", nil, RunMode_Pipeline, storedPipeline(), 1)
	r, _ = CompletePhase(r, 0, nil, 0)
	r = CancelRun(r)
	if r.Status != RunStatus_Cancelled {
		t.Errorf("want cancelled, got %q", r.Status)
	}
	if r.Phases[0].State != PhaseState_Done {
		t.Errorf("completed phase should stay done, got %q", r.Phases[0].State)
	}
	if r.Phases[1].State != PhaseState_Skipped || r.Phases[2].State != PhaseState_Skipped {
		t.Errorf("open phases should be skipped: %+v", r.Phases)
	}
}

// the lead hands the engine a plan, so its one phase names no skill and never gates.
func TestDefaultOrchestratorPlaybook(t *testing.T) {
	pb := DefaultOrchestratorPlaybook()
	if len(pb) != 1 || pb[0].Kind != PhaseKind_Orchestrate {
		t.Fatalf("orchestrator playbook: %+v", pb)
	}
	if pb[0].Gate || pb[0].Skill != "" {
		t.Fatalf("the orchestrate phase must be ungated and skill-less: %+v", pb[0])
	}
}

func TestQuickPlaybook(t *testing.T) {
	pb := QuickPlaybook()
	if len(pb) != 1 {
		t.Fatalf("QuickPlaybook: want 1 phase, got %d", len(pb))
	}
	p := pb[0]
	if p.Kind != PhaseKind_Execute {
		t.Errorf("phase kind = %q, want %q", p.Kind, PhaseKind_Execute)
	}
	if p.Gate {
		t.Errorf("quick phase must not gate")
	}
	if !p.FreshCtx {
		t.Errorf("quick phase should run in fresh context")
	}
	if p.Skill != "" {
		t.Errorf("quick phase must have no skill, got %q", p.Skill)
	}
}

func TestNewRunQuick(t *testing.T) {
	r := NewRun("fix the flake", "ws1", "/repo", nil, RunMode_Quick, QuickPlaybook(), 1000)
	if r.Mode != RunMode_Quick {
		t.Errorf("mode = %q, want quick", r.Mode)
	}
	if len(r.Phases) != 1 || r.Phases[0].State != PhaseState_Running {
		t.Fatalf("expected one running phase, got %+v", r.Phases)
	}
	if r.Status == RunStatus_AwaitingReview {
		t.Errorf("quick run must not await review")
	}
}

func TestBuildQuickPrompt(t *testing.T) {
	// a single legacy-ID principle renders as its bare text (see RenderPrinciples)
	principles := waveobj.PrincipleList{{ID: waveobj.LegacyGlobalPrincipleID, Text: "be tidy"}}
	p := BuildQuickPrompt("add a spinner", principles, "claude")
	for _, want := range []string{
		"add a spinner",
		"be tidy",
		"wsh jarvis complete --commit $(git rev-parse HEAD) --report <that file>",
		"If this turns out to be more than one change or needs a design decision, stop and ask with AskUserQuestion instead of pushing on.",
	} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt missing %q:\n%s", want, p)
		}
	}
	if strings.Contains(p, "skill to work this goal") {
		t.Errorf("quick prompt must not carry a skill directive:\n%s", p)
	}
}

// a pi worker told to call Claude's tool asks in plain text, which never reaches the cockpit
func TestBuildQuickPromptNamesTheRuntimeAskTool(t *testing.T) {
	p := BuildQuickPrompt("add a spinner", nil, "pi")
	if !strings.Contains(p, "stop and ask with ask_user_question instead of pushing on") {
		t.Fatalf("a pi quick worker asks with ask_user_question:\n%s", p)
	}
	if strings.Contains(p, "AskUserQuestion") {
		t.Fatalf("a pi quick worker must not be told to call AskUserQuestion:\n%s", p)
	}
}

func TestParentNotifyLine(t *testing.T) {
	// no parent -> not ok
	if _, ok := ParentNotifyLine(&waveobj.Run{ID: "c1", Status: RunStatus_Done}); ok {
		t.Error("want ok=false when ParentLeadORef is empty")
	}
	// has parent but non-terminal -> not ok
	if _, ok := ParentNotifyLine(&waveobj.Run{ID: "c1", Status: RunStatus_Executing, ParentLeadORef: "tab:lead"}); ok {
		t.Error("want ok=false for a non-terminal status")
	}
	// done with evidence
	line, ok := ParentNotifyLine(&waveobj.Run{
		ID: "c1", Goal: "fix 6a", Status: RunStatus_Done, ParentLeadORef: "tab:lead",
		Evidence: &waveobj.RunEvidence{Files: []waveobj.EvidenceFile{{}, {}}, AddTotal: 12, DelTotal: 3},
	})
	if !ok {
		t.Fatal("want ok=true for a done child with a parent")
	}
	for _, want := range []string{"child c1", "done", "2 files +12/-3"} {
		if !strings.Contains(line, want) {
			t.Errorf("line %q missing %q", line, want)
		}
	}
	if !strings.HasSuffix(line, "\r") {
		t.Errorf("line %q must end with CR so it submits as one PTY line", line)
	}
	// cancelled (no evidence)
	cl, ok := ParentNotifyLine(&waveobj.Run{ID: "c2", Goal: "x", Status: RunStatus_Cancelled, ParentLeadORef: "tab:lead"})
	if !ok || !strings.Contains(cl, "cancelled") {
		t.Errorf("cancelled: line=%q ok=%v", cl, ok)
	}
}

// Nothing in the engine ever wrote PhaseState_Failed, which is why a lead whose process died kept
// reading "executing": status is derived from the phases, and no phase ever failed.
func TestFailPhaseDerivesBlocked(t *testing.T) {
	run := NewRun("goal", "ws-1", "/p", nil, RunMode_Orchestrator, DefaultOrchestratorPlaybook(), 1000)
	if run.Status != RunStatus_Executing {
		t.Fatalf("fixture must start executing, got %q", run.Status)
	}
	idx := RunningPhaseIndex(run)
	if idx < 0 {
		t.Fatal("fixture must have a running phase")
	}
	failed, err := FailPhase(run, idx, 2000)
	if err != nil {
		t.Fatalf("FailPhase: %v", err)
	}
	if failed.Status != RunStatus_Blocked {
		t.Fatalf("a failed phase must derive blocked, got %q", failed.Status)
	}
	if failed.Phases[idx].State != PhaseState_Failed {
		t.Fatalf("phase must be failed, got %q", failed.Phases[idx].State)
	}
	// a duplicate exit report must not fail an already-failed phase again
	if _, err := FailPhase(failed, idx, 3000); err == nil {
		t.Fatal("failing a non-running phase must error rather than double-write")
	}
}

// A run stored before slice 5c can still carry a gated phase. Completing it must release its successor
// like any other phase: nothing can approve a gate any more, so halting there would leave the run with no
// running phase and no verb that starts one.
func TestCompletePhaseReleasesAStoredGate(t *testing.T) {
	r := NewRun("g", "ws", "/p", nil, RunMode_Pipeline, storedPipeline(), 1)
	r, err := CompletePhase(r, 0, nil, 2)
	if err != nil {
		t.Fatalf("complete brainstorm: %v", err)
	}
	if r.Phases[1].State != PhaseState_Running {
		t.Fatalf("the gated plan phase should have started, got %q", r.Phases[1].State)
	}
	r, err = CompletePhase(r, 1, nil, 3)
	if err != nil {
		t.Fatalf("complete the gate: %v", err)
	}
	if !r.Phases[1].Gate {
		t.Fatal("the fixture must still carry the stored gate, or this proves nothing")
	}
	if r.Phases[2].State != PhaseState_Running {
		t.Fatalf("completing a stored gate must release execute, got %q", r.Phases[2].State)
	}
	if r.Status != RunStatus_Executing {
		t.Fatalf("status = %q, want the run to be running its next phase rather than parked", r.Status)
	}
}

func TestAttachReportReplacesTheSealedSummaryOfADoneRun(t *testing.T) {
	r := NewRun("g", "ws", "/r", nil, RunMode_Pipeline, storedPipeline()[:1], 1)
	r, _ = CompletePhase(r, 0, nil, 0)
	r.Evidence = &waveobj.RunEvidence{Summary: "the lead's last chat line"}
	got, err := AttachReport(r, "landed t-1..t-7")
	if err != nil {
		t.Fatalf("AttachReport on a done run: %v", err)
	}
	if got.Report != "landed t-1..t-7" || got.Evidence.Summary != "landed t-1..t-7" {
		t.Errorf("report not attached: Report=%q Summary=%q", got.Report, got.Evidence.Summary)
	}
}

func TestAttachReportRefusesARunStillGoingAndAnEmptyReport(t *testing.T) {
	r := NewRun("g", "ws", "/r", nil, RunMode_Pipeline, storedPipeline(), 1)
	if _, err := AttachReport(r, "report"); err == nil {
		t.Errorf("expected error attaching a report to a run that is not done")
	}
	r = NewRun("g", "ws", "/r", nil, RunMode_Pipeline, storedPipeline()[:1], 1)
	r, _ = CompletePhase(r, 0, nil, 0)
	if _, err := AttachReport(r, "  "); err == nil {
		t.Errorf("expected error attaching an empty report")
	}
}
