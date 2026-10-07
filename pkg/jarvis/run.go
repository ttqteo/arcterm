// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// Run statuses.
const (
	RunStatus_Planning       = "planning"
	RunStatus_AwaitingReview = "awaiting-review"
	RunStatus_Executing      = "executing"
	RunStatus_Blocked        = "blocked"
	RunStatus_Done           = "done"
	RunStatus_Cancelled      = "cancelled"
)

// Phase states.
const (
	PhaseState_Pending = "pending"
	PhaseState_Running = "running"
	PhaseState_Blocked = "blocked"
	PhaseState_Done    = "done"
	PhaseState_Failed  = "failed"
	PhaseState_Skipped = "skipped"
)

// Run modes.
const (
	RunMode_Quick = "quick"
	// historical: 5c stopped anything from starting one; stored runs still carry it.
	RunMode_Pipeline     = "pipeline"
	RunMode_Orchestrator = "orchestrator"
)

// Orchestration_Engine is the machine every orchestrator lead drives: it hands pkg/orchestrate a
// plan file and the engine runs the dag. It is still written to Run.Orchestration and read back.
const Orchestration_Engine = "engine"

// IsEngineRun reports whether a run's lead drives pkg/orchestrate. Every orchestrator started since
// slice 5c carries Orchestration_Engine; an empty orchestration predates the control, where the runtime
// decided and only pi led an engine run. A stored adaptive lead ran its own subagents, so it has no
// scheduler to read or reconfigure. The frontend's sheetFace applies this same rule.
func IsEngineRun(r *waveobj.Run) bool {
	if r == nil {
		return false
	}
	if r.Orchestration != "" {
		return r.Orchestration == Orchestration_Engine
	}
	return r.Runtime == "pi"
}

// Phase kinds.
const (
	PhaseKind_Brainstorm  = "brainstorm"
	PhaseKind_Plan        = "plan"
	PhaseKind_Execute     = "execute"
	PhaseKind_Orchestrate = "orchestrate"
	PhaseKind_Custom      = "custom"
)

// AdvanceRun action (carried on CommandAdvanceRunData.Action).
const (
	RunAction_Complete = "complete"
	RunAction_Resume   = "resume" // restart a failed phase's worker in its own session
)

// DefaultOrchestratorPlaybook is the orchestrator's single phase: the lead brainstorms the goal with the
// human and hands pkg/orchestrate a plan file. No skill names it — the launch prompt is the protocol.
func DefaultOrchestratorPlaybook() []waveobj.RunPhase {
	return []waveobj.RunPhase{
		{Kind: PhaseKind_Orchestrate, State: PhaseState_Pending},
	}
}

// QuickPlaybook is a single bare execute phase: one worker, no plan gate, fresh context, no skill
// scaffolding. The worker is prompted (BuildQuickPrompt) to do the goal directly and self-report.
func QuickPlaybook() []waveobj.RunPhase {
	return []waveobj.RunPhase{
		{Kind: PhaseKind_Execute, State: PhaseState_Pending, FreshCtx: true},
	}
}

// ParentNotifyLine builds the single line a child run steers back into its parent orchestrator lead when the
// child reaches a terminal state. ok is false unless the run has a parent (ParentLeadORef) AND a terminal
// status — done or cancelled, the only two the backend produces (there is no automatic blocked). The line
// ends in \r so it submits as one input line into the lead's PTY. The lead reads ONLY this line, never the
// child's transcript/diff/evidence — that is what keeps the driver's context small.
func ParentNotifyLine(run *waveobj.Run) (string, bool) {
	if run == nil || run.ParentLeadORef == "" {
		return "", false
	}
	short := run.Goal
	if r := []rune(short); len(r) > 60 {
		short = string(r[:57]) + "..."
	}
	switch run.Status {
	case RunStatus_Done:
		summary := ""
		if run.Evidence != nil {
			summary = fmt.Sprintf(" (%d files +%d/-%d)", len(run.Evidence.Files), run.Evidence.AddTotal, run.Evidence.DelTotal)
		}
		return fmt.Sprintf("[jarvis] child %s %q -> done%s\r", run.ID, short, summary), true
	case RunStatus_Cancelled:
		return fmt.Sprintf("[jarvis] child %s %q -> cancelled\r", run.ID, short), true
	default:
		return "", false
	}
}

// NewRun builds a run from a playbook: deep-copies the phases, marks the first phase running, derives
// status. ts is supplied by the caller (mirrors NewChannelMessage) for testability.
func NewRun(goal, workspaceId, projectPath string, principles waveobj.PrincipleList, mode string, playbook []waveobj.RunPhase, ts int64) waveobj.Run {
	phases := make([]waveobj.RunPhase, len(playbook))
	copy(phases, playbook)
	principlesSnapshot := append(waveobj.PrincipleList(nil), principles...)
	if len(phases) > 0 {
		phases[0].State = PhaseState_Running
		phases[0].StartedTs = ts
	}
	r := waveobj.Run{
		ID:          uuid.NewString(),
		Goal:        goal,
		Mode:        mode,
		WorkspaceId: workspaceId,
		ProjectPath: projectPath,
		Principles:  principlesSnapshot,
		Status:      RunStatus_Planning,
		Phases:      phases,
		CreatedTs:   ts,
	}
	recomputeStatus(&r)
	return r
}

// recomputeStatus derives run.Status from phase states. Single source of truth: never set Status
// directly outside this function (except CancelRun, a terminal override).
func recomputeStatus(r *waveobj.Run) {
	firstOpen := -1
	for i, p := range r.Phases {
		if p.State != PhaseState_Done && p.State != PhaseState_Skipped {
			firstOpen = i
			break
		}
	}
	if firstOpen == -1 {
		r.Status = RunStatus_Done
		return
	}
	cur := r.Phases[firstOpen]
	if cur.State == PhaseState_Blocked || cur.State == PhaseState_Failed {
		r.Status = RunStatus_Blocked
		return
	}
	// orchestrate is a single phase: a running lead is actively working = executing.
	if cur.Kind == PhaseKind_Execute || cur.Kind == PhaseKind_Orchestrate {
		r.Status = RunStatus_Executing
		return
	}
	r.Status = RunStatus_Planning
}

// CompletePhase marks phaseIdx done, records the reported artifacts, and starts its successor. A stored
// phase may still carry Gate from before slice 5c deleted the plan gate; it no longer halts here, because
// nothing can approve it any more and a halted phase would strand the run. Completion is reported in by
// the caller (UI action or the ~/.claude hook) — the engine does not detect it.
func CompletePhase(run waveobj.Run, phaseIdx int, artifacts []string, ts int64) (waveobj.Run, error) {
	if phaseIdx < 0 || phaseIdx >= len(run.Phases) {
		return run, fmt.Errorf("phase index %d out of range", phaseIdx)
	}
	if run.Phases[phaseIdx].State != PhaseState_Running {
		return run, fmt.Errorf("phase %d is %q, not running", phaseIdx, run.Phases[phaseIdx].State)
	}
	run.Phases[phaseIdx].State = PhaseState_Done
	run.Phases[phaseIdx].DoneTs = ts
	run.Phases[phaseIdx].Artifacts = append(run.Phases[phaseIdx].Artifacts, artifacts...)
	if phaseIdx+1 < len(run.Phases) {
		run.Phases[phaseIdx+1].State = PhaseState_Running
		run.Phases[phaseIdx+1].StartedTs = ts
	}
	recomputeStatus(&run)
	return run, nil
}

// AttachReport records a lead's report on a run that is already done. The engine closes a plan run
// itself when the DAG finishes and the lead cannot be woken, sealing the lead's last chat line as the
// summary; without this, the lead's later `complete --report` is refused and the report is lost. The
// report replaces that fallback summary, the one field of the sealed evidence a report owns.
func AttachReport(run waveobj.Run, report string) (waveobj.Run, error) {
	if run.Status != RunStatus_Done {
		return run, fmt.Errorf("run is %q, not done: complete it instead", run.Status)
	}
	if strings.TrimSpace(report) == "" {
		return run, fmt.Errorf("report is empty")
	}
	run.Report = report
	if run.Evidence != nil {
		ev := *run.Evidence
		ev.Summary = report
		run.Evidence = &ev
	}
	return run, nil
}

// FailPhase marks a running phase failed so recomputeStatus derives blocked. Nothing else in the
// engine ever writes PhaseState_Failed, which is why a lead whose process died kept reading as
// executing: the status is derived from the phases, and no phase ever failed. Out of range /
// not-running fail safe, so a duplicate exit report is a no-op.
func FailPhase(run waveobj.Run, phaseIdx int, ts int64) (waveobj.Run, error) {
	if phaseIdx < 0 || phaseIdx >= len(run.Phases) {
		return run, fmt.Errorf("phase index %d out of range", phaseIdx)
	}
	if run.Phases[phaseIdx].State != PhaseState_Running {
		return run, fmt.Errorf("phase %d is %q, not running", phaseIdx, run.Phases[phaseIdx].State)
	}
	run.Phases[phaseIdx].State = PhaseState_Failed
	run.Phases[phaseIdx].DoneTs = ts
	recomputeStatus(&run)
	return run, nil
}

// ResumePhase puts a failed phase back to running, for a worker restarted in its own session.
func ResumePhase(run waveobj.Run, phaseIdx int) (waveobj.Run, error) {
	if phaseIdx < 0 || phaseIdx >= len(run.Phases) {
		return run, fmt.Errorf("phase index %d out of range", phaseIdx)
	}
	if run.Phases[phaseIdx].State != PhaseState_Failed {
		return run, fmt.Errorf("phase %d is %q, not failed", phaseIdx, run.Phases[phaseIdx].State)
	}
	run.Phases[phaseIdx].State = PhaseState_Running
	run.Phases[phaseIdx].DoneTs = 0
	recomputeStatus(&run)
	return run, nil
}

// RunningPhaseIndex returns the index of the run's current running phase, or -1.
func RunningPhaseIndex(run waveobj.Run) int {
	for i := range run.Phases {
		if run.Phases[i].State == PhaseState_Running {
			return i
		}
	}
	return -1
}

// CancelRun terminally cancels a run: open phases become skipped, completed phases are preserved.
func CancelRun(run waveobj.Run) waveobj.Run {
	for i := range run.Phases {
		if run.Phases[i].State == PhaseState_Pending || run.Phases[i].State == PhaseState_Running {
			run.Phases[i].State = PhaseState_Skipped
		}
	}
	run.Status = RunStatus_Cancelled
	return run
}

// BuildQuickPrompt is the worker prompt for a quick run: headless guidance and no skill directive — just
// do the goal directly and report completion. A quick goal that turns
// out to need a plan stops and asks rather than improvising one, and runtime names the tool it asks with.
func BuildQuickPrompt(goal string, principles waveobj.PrincipleList, runtime string) string {
	tool := AskTool(runtime)
	var b strings.Builder
	if rendered := RenderPrinciples(principles); rendered != "" {
		fmt.Fprintf(&b, "Work by these principles:\n%s\n\n", rendered)
	}
	fmt.Fprintf(&b, "You are running headless with no human at your terminal. Make reasonable assumptions for low-stakes or easily-reversible choices and keep going — do not ask about them. Only when a decision is genuinely consequential and a wrong assumption would waste real work, pause and use the %s tool (it reaches the human in the cockpit); otherwise proceed to the deliverable.\n", tool)
	fmt.Fprintf(&b, "If this turns out to be more than one change or needs a design decision, stop and ask with %s instead of pushing on.\n", tool)
	fmt.Fprintf(&b, "Goal: %s\n", goal)
	// the report goes in with complete: the seal runs then, and with none it takes the last line written before it
	b.WriteString("When the goal is fully accomplished, commit your work, then write your final report (what you did, and what you could not verify and why) with your file-writing tool to a file in the system temp directory, not in the repository. Then run `wsh jarvis complete --commit $(git rev-parse HEAD) --report <that file>` from your working tree (the SHA of your own final commit), so the run's evidence reflects exactly your changes and its summary is your report.\n")
	b.WriteString(NoAttributionRule + "\n")
	b.WriteString(SubagentCapRule + "\n")
	return strings.TrimRight(b.String(), "\n")
}

// BuildOrchestratePrompt is the lead's initial prompt for an orchestrator run: it brainstorms the goal
// with the human and hands pkg/orchestrate a plan file. Runtime names the ask tool.
func BuildOrchestratePrompt(goal string, principles waveobj.PrincipleList, runtime string) string {
	var b strings.Builder
	if rendered := RenderPrinciples(principles); rendered != "" {
		fmt.Fprintf(&b, "Work by these principles, and propagate them into every subagent you dispatch:\n%s\n%s\n\n", rendered, ContractWinsLine)
	}
	writeLaunchPrompt(&b, goal, runtime)
	return strings.TrimRight(b.String(), "\n")
}
