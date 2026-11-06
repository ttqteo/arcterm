// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentmsg"
	"github.com/wavetermdev/waveterm/pkg/brainstormcheck"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// the arc-view mod draws these prompts' transcript rows by reading them back (claude/arc-view-mod/hooks/prompt-core.ts),
// and its vitest suite parses these same files. A wording change here fails this test first: rewrite the files with
// ARC_UPDATE_VIEWMOD_FIXTURES=1, then make the mod's suite pass on them.
const (
	viewModFixtureDir = "../../claude/arc-view-mod/testdata"
	updateFixturesEnv = "ARC_UPDATE_VIEWMOD_FIXTURES"
)

func checkViewModFixture(t *testing.T, name, text string) {
	t.Helper()
	// a worker's report path sits under this machine's temp dir: pin it, so the files match on any machine and
	// carry no local path
	text = strings.ReplaceAll(text, filepath.ToSlash(os.TempDir()), "C:/tmp")
	path := filepath.Join(viewModFixtureDir, name+".txt")
	if os.Getenv(updateFixturesEnv) == "1" {
		if err := os.MkdirAll(viewModFixtureDir, 0o755); err != nil {
			t.Fatalf("creating %s: %v", viewModFixtureDir, err)
		}
		if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
			t.Fatalf("writing %s: %v", path, err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading %s: %v (run with %s=1 to write it)", path, err, updateFixturesEnv)
	}
	if string(want) != text {
		t.Errorf("%s no longer matches what the engine sends; rerun with %s=1 and check the arc-view mod still draws it:\n%s", path, updateFixturesEnv, text)
	}
}

// absolute on every OS, so DocPath returns them as written and the files match on any machine
const (
	fixtureSpec = "C:/work/app/docs/superpowers/specs/2026-11-04-coach-design.md"
	fixturePlan = "C:/work/app/docs/superpowers/plans/2026-11-04-coach.md"
)

var fixturePrinciples = waveobj.PrincipleList{
	{ID: "p1", Text: "Prefer simple, direct solutions over enterprise over-engineering."},
	{ID: "p2", Text: "Handle errors at boundaries and never silently swallow them."},
}

func fixtureGroup() *waveobj.TaskGroup {
	return &waveobj.TaskGroup{
		RunID:    "run-1234",
		PlanPath: fixturePlan,
		SpecPath: fixtureSpec,
		Check:    "npm run lint",
		Verify:   "node scripts/verify.mjs ./pkg/coach",
		FinalCmd: "node scripts/cdp/final-verify.mjs coach",
		Tasks: []waveobj.TaskNode{
			{ID: "t-3", Label: "Question bank store", Description: "Owns pkg/coach/bank.go.", ReviewBase: "abc1234"},
			{ID: "t-4", Label: "Practice view"},
		},
	}
}

// TestViewModFixtures pins the wording the arc-view mod's prompt cards read, one file per kind of prompt the engine
// and the cockpit put into a session. A kind this tree has no builder for (a design session, a design-approved lead,
// the workflow scan's picks line, the council's seats) has no file here.
func TestViewModFixtures(t *testing.T) {
	quick := jarvis.BuildQuickPrompt("fix the flaky parser test", fixturePrinciples, "claude")
	checkViewModFixture(t, "quick", quick)

	const goal = "Build Interview practice app. Make a new dir for this project"
	checkViewModFixture(t, "lead-goal", jarvis.BuildOrchestratePrompt(goal, fixturePrinciples, "claude", false))
	checkViewModFixture(t, "lead-goal-autonomous", jarvis.BuildOrchestratePrompt(goal, fixturePrinciples, "claude", true))

	wake := composeWake([]string{taskFailedWake("t-3", FailureKindUnrecorded, "the worker exited")}, "wake: 1 question waiting. wsh jarvis dag asks", nil, nil)
	checkViewModFixture(t, "plan-lead", jarvis.PlanLeadPrompt(fixturePrinciples, "run-1234", fixtureSpec, fixturePlan, "eff-9", false, wake))
	replacement := replacementLeadWake([]string{reviewFailedWake("t-4", "the view never loads")})
	checkViewModFixture(t, "plan-lead-replacement", jarvis.PlanLeadPrompt(nil, "run-1234", "", fixturePlan, "", true, replacement))

	g := fixtureGroup()
	owner := &waveobj.Run{Goal: "Build Interview practice app"}
	checkViewModFixture(t, "worker", taskPrompt(g, &g.Tasks[0], owner, "claude", "", "", nil))
	noPlan := &waveobj.TaskGroup{Preamble: "Never edit docs/.\n\nKeep the store in one file."}
	checkViewModFixture(t, "worker-dag", taskPrompt(noPlan, &waveobj.TaskNode{ID: "t-2", Label: "add fmtDate"}, owner, "pi", "", "", nil))

	worker := &waveobj.Run{EndCommit: "def5678", Evidence: &waveobj.RunEvidence{Summary: "## Done\nthe bank store"}}
	checkViewModFixture(t, "reviewer", reviewPrompt(g, &g.Tasks[0], worker, nil, nil))

	checkViewModFixture(t, "plan-reviewer", planReviewPrompt(g, ""))
	checkViewModFixture(t, "plan-reviewer-second", planSecondPassPrompt(g, ""))

	final := fixtureGroup()
	final.Final = &waveobj.FinalStage{Round: 1, Tree: "C:/work/app-final", Commit: "0123456789abcdef", OutDir: "C:/work/out"}
	checkViewModFixture(t, "verifier", verifierPrompt(context.Background(), final, &waveobj.Run{BaseCommit: "abc1234"}))

	checkViewModFixture(t, "builder-check", brainstormcheck.Prompt(fixtureSpec, "C:/work/app/.superpowers/brainstorm/coach/check.md"))
	judge := brainstormcheck.JudgeInput{
		Question:   "Where do the questions come from?",
		Approaches: []brainstormcheck.Approach{{Name: "Bundled bank", Description: "a JSON file in the repo"}, {Name: "Model-written", Description: "generated per session"}},
	}
	noShuffle := func(int, func(i, j int)) {}
	checkViewModFixture(t, "judge", brainstormcheck.JudgePrompt(judge, "brainstorm: judged", "C:/work/app/.superpowers/brainstorm/coach/judge.json", noShuffle))

	// what the cockpit sends over the mod's stream
	checkViewModFixture(t, "agent-message", agentmsg.Envelope("design lead", "tab-1234", "rename the helper\nand rerun the tests"))
	child := &waveobj.Run{ID: "run-77", ParentLeadORef: "tab:t1", Goal: "split the channel blob into per-run records", Status: jarvis.RunStatus_Done,
		Evidence: &waveobj.RunEvidence{Files: make([]waveobj.EvidenceFile, 3), AddTotal: 40, DelTotal: 2}}
	childLine, _ := jarvis.ParentNotifyLine(child)
	// steerRunLead drops the \r the line carried when it was typed
	checkViewModFixture(t, "child-done", strings.TrimRight(childLine, "\r"))
	child.Status = jarvis.RunStatus_Cancelled
	childLine, _ = jarvis.ParentNotifyLine(child)
	checkViewModFixture(t, "child-cancelled", strings.TrimRight(childLine, "\r"))
	checkViewModFixture(t, "autonomous-on", jarvis.AutonomousOnWake)
	checkViewModFixture(t, "autonomous-off", jarvis.AutonomousOffWake)
	checkViewModFixture(t, "builder-questions", brainstormcheck.Line("C:/work/app/.superpowers/brainstorm/coach/check.md"))
	checkViewModFixture(t, "judged", brainstormcheck.JudgedLine("C:/work/app/.superpowers/brainstorm/coach/judge.json"))
	checkViewModFixture(t, "judge-failed", brainstormcheck.JudgeFailedLine("the judge wrote no report."))
	checkViewModFixture(t, "for-later", forLaterTyped("t-3", sectionHeading(jarvis.ReportKeyForLater), "the bank's Load takes a context now"))
	checkViewModFixture(t, "review-note", reviewNoteTyped("t-3", "keep the empty-bank message"))
	checkViewModFixture(t, "wake", wake)
}
