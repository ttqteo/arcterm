// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// useVerifier puts the real verifier back for one test; TestMain skips it for every other test.
func useVerifier(t *testing.T) {
	t.Helper()
	startVerifier = startVerifierSession
	restoreAfterStages(t, func() { startVerifier = skipVerifier })
}

// verifyingFixture is a checkout-landed dag whose final stage runs only a passing Verify: its verifier is
// working in the detached final tree. It returns the verifier's run id.
func verifyingFixture(t *testing.T) (*mergeFixture, *fakeLead, string) {
	t.Helper()
	useVerifier(t)
	captureSpawns(t)
	lead := newFakeLead(t)
	f := finalFixture(t, passVerify, "", "")
	g := runFinal(t, f)
	if g.Final.State != FinalState_Verifying || g.Final.VerifierRunID == "" {
		t.Fatalf("want a verifier at work, got %+v", g.Final)
	}
	return f, lead, g.Final.VerifierRunID
}

func TestTheVerifierJudgesTheMergedResultOnceTheStepsPass(t *testing.T) {
	useVerifier(t)
	calls := captureSpawns(t)
	newFakeLead(t)
	f := finalFixture(t, passVerify, "", "echo shot")
	base := gitCmd(t, f.project, "rev-parse", "HEAD")
	spec, plan := filepath.Join(f.project, "spec.md"), filepath.Join(f.project, "plan.md")
	if err := wstore.UpdateRun(f.ctx, f.channel, f.ownerID, func(r *waveobj.Run) error {
		r.BaseCommit = base
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.SpecPath, cur.PlanPath, cur.Prototype = spec, plan, ".superpowers/design/board.dc.html"
		cur.Tasks[0].ReviewUnverified = "the empty state was not screenshotted"
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	g := runFinal(t, f)

	if g.Final.State != FinalState_Verifying || g.Status != DagStatus_Finalizing || len(*calls) != 1 {
		t.Fatalf("passing steps hand the result to one verifier, got %s / %s after %d spawns", g.Final.State, g.Status, len(*calls))
	}
	c := (*calls)[0]
	if c.cwd != g.Final.Tree || g.Final.Tree != worktreeDir(f.project, f.ownerID+"-final") {
		t.Fatalf("the verifier works in the detached final tree, got cwd %q tree %q", c.cwd, g.Final.Tree)
	}
	verifier, err := wstore.GetRun(f.ctx, f.channel, g.Final.VerifierRunID)
	if err != nil {
		t.Fatal(err)
	}
	if verifier.StageRole != jarvis.UsageRole_Verifier || verifier.TaskId != "" || verifier.DagORef != f.dagID {
		t.Fatalf("the verifier's run carries its role and dag and no task, got %+v", verifier)
	}
	for _, want := range []string{
		"final verifier for run " + g.RunID,
		spec,
		plan,
		"`git diff " + base + ".." + g.Final.Commit + "`",
		g.Final.OutDir,
		filepath.Join(f.project, ".superpowers/design/board.dc.html"),
		"t-0: reviewer: the empty state was not screenshotted",
		"structurally: which elements are there, their order, their copy, and the controls at that width",
		"Do not compare pixels",
		"allowed, when the spec's Deviations section lists it, or as a defect",
		"Only read: never edit, stage or commit",
		"`wsh jarvis dag final pass \"<summary>\"`",
		"`--unverified \"<what you could not verify, and why>\"`",
		"`wsh jarvis dag final fail \"<defects",
	} {
		if !strings.Contains(c.prompt, want) {
			t.Errorf("the brief must contain %q:\n%s", want, c.prompt)
		}
	}
	if _, err := os.Stat(g.Final.Tree); err != nil {
		t.Fatalf("the tree stays while the verifier reads it: %v", err)
	}

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if len(*calls) != 1 {
		t.Fatalf("a working verifier is not replaced, got %d spawns", len(*calls))
	}
}

func TestFinalVerdicts(t *testing.T) {
	defects := "board-layout: the Diff surface lists files before the summary; swap them in files.tsx. " + strings.Repeat("x", 1500)
	cases := []struct {
		name, verdict, text, unverified string
		wantState                       string
		wantUnverified                  []string
	}{
		{"pass", ReviewVerdict_Pass, "the change does what the spec asks", "", FinalState_Passed, nil},
		{"pass unverified", ReviewVerdict_Pass, "the change does what the spec asks", "no screenshot of the empty state", FinalState_Unverified, []string{"verifier: no screenshot of the empty state"}},
		{"fail", ReviewVerdict_Fail, defects, "", FinalState_Failed, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f, lead, runID := verifyingFixture(t)
			tree := f.dag(t).Final.Tree

			if err := RecordFinalVerdict(f.ctx, f.dagID, runID, c.verdict, c.text, c.unverified); err != nil {
				t.Fatal(err)
			}

			g := f.dag(t)
			if g.Final.State != c.wantState || !slices.Equal(g.Final.Unverified, c.wantUnverified) {
				t.Fatalf("want %s with %q, got %s with %q", c.wantState, c.wantUnverified, g.Final.State, g.Final.Unverified)
			}
			if c.verdict == ReviewVerdict_Fail {
				if g.Final.Detail != defects || g.Status != DagStatus_Blocked {
					t.Fatalf("a fail keeps the defects whole and blocks the dag, got %s / %q", g.Status, g.Final.Detail)
				}
				if len(lead.sends) != 1 || !strings.Contains(lead.sends[0], defects) {
					t.Fatalf("the lead is woken with the defects whole, got %q", lead.sends)
				}
			} else if g.Status != DagStatus_Done {
				t.Fatalf("a pass makes the dag done, got %s", g.Status)
			}
			if _, err := os.Stat(tree); !os.IsNotExist(err) {
				t.Fatalf("the detached final tree is removed once the verdict is in, stat err %v", err)
			}
		})
	}
}

func TestAVerifierLostTwiceLeavesTheResultUnverified(t *testing.T) {
	f, _, first := verifyingFixture(t)
	tree := f.dag(t).Final.Tree
	endRun(t, f.ctx, f.channel, first)
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	second := f.dag(t).Final.VerifierRunID
	if second == "" || second == first {
		t.Fatalf("a lost verifier is replaced once, got %q after %q", second, first)
	}
	endRun(t, f.ctx, f.channel, second)
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}

	g := f.dag(t)
	if g.Final.State != FinalState_Unverified || g.Status != DagStatus_Done || len(g.Final.Unverified) != 1 || !strings.HasPrefix(g.Final.Unverified[0], "the verifier did not finish") {
		t.Fatalf("want done and unverified because the verifier did not finish, got %s / %+v", g.Status, g.Final)
	}
	if _, err := os.Stat(tree); !os.IsNotExist(err) {
		t.Fatalf("the detached final tree is removed once the stage gives up, stat err %v", err)
	}
}

func TestRefusedFinalVerdicts(t *testing.T) {
	f, _, runID := verifyingFixture(t)
	cases := []struct {
		name, runID, verdict, text, unverified, want string
	}{
		{"fail with unverified", runID, ReviewVerdict_Fail, "d", "u", "--unverified goes with a pass"},
		{"another run", "not-the-verifier", ReviewVerdict_Pass, "s", "", "is not verifying this dag's result"},
		{"no text", runID, ReviewVerdict_Pass, " ", "", "needs its text"},
		{"long text", runID, ReviewVerdict_Fail, strings.Repeat("d", MaxReviewNoteLen+1), "", "the limit is 2000"},
		{"long unverified", runID, ReviewVerdict_Pass, "s", strings.Repeat("u", MaxReviewNoteLen+1), "the --unverified note is"},
	}
	for _, c := range cases {
		err := RecordFinalVerdict(f.ctx, f.dagID, c.runID, c.verdict, c.text, c.unverified)
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: want an error with %q, got %v", c.name, c.want, err)
		}
	}
	if g := f.dag(t); g.Final.State != FinalState_Verifying || g.Final.Detail != "" {
		t.Fatalf("a refused verdict changes nothing, got %+v", g.Final)
	}
}

// the dag's PlanPath stays the original plan, so a fix round's verifier finds the fix plan through its tasks
func TestAFixRoundVerifierIsToldTheFixTasks(t *testing.T) {
	g := &waveobj.TaskGroup{
		RunID: "run-1",
		Final: &waveobj.FinalStage{Round: 2, Tree: "/tree"},
		Tasks: []waveobj.TaskNode{
			{ID: "t-1", Label: "build", Description: "Build the thing."},
			{ID: "t-2", Label: "fix order", Description: "Fix round 2: this is task 1 of the fix plan at docs/fix.md; re-read it there before you start."},
		},
	}
	p := verifierPrompt(context.Background(), g, &waveobj.Run{ProjectPath: "/project"})
	if !strings.Contains(p, "This is fix round 2") || !strings.Contains(p, "- t-2 fix order: Fix round 2: this is task 1 of the fix plan at docs/fix.md\n") || strings.Contains(p, "t-1 build") {
		t.Fatalf("the brief must name the fix tasks and their plan, and only them:\n%s", p)
	}
	if first := verifierPrompt(context.Background(), &waveobj.TaskGroup{Final: &waveobj.FinalStage{Round: 1}}, &waveobj.Run{}); strings.Contains(first, "fix round") {
		t.Fatalf("a first round has no fix tasks:\n%s", first)
	}
}

// the verifier checks what the workers and their reviewers could not, then what the stage's own steps could not
func TestTheVerifierBriefListsTheTasksCaveats(t *testing.T) {
	ctx, g := caveatDag(t)
	g.Final = &waveobj.FinalStage{Round: 1, Tree: "/tree", Unverified: []string{"no dev app: cargo missing"}}
	prompt := verifierPrompt(ctx, g, &waveobj.Run{})
	var want strings.Builder
	want.WriteString("Earlier checks could not verify these; check them here where you can:\n")
	for _, l := range append(slices.Clone(caveatDagLines), "no dev app: cargo missing") {
		want.WriteString("- " + l + "\n")
	}
	if !strings.Contains(prompt, want.String()) {
		t.Fatalf("the brief must list\n%s\ngot:\n%s", want.String(), prompt)
	}
}

// cancelling the dag must stop a working verifier like any other child
func TestChildRunIDsIncludesTheVerifier(t *testing.T) {
	g := &waveobj.TaskGroup{Final: &waveobj.FinalStage{VerifierRunID: "verifier-run"}}
	if got := childRunIDs(g); !slices.Equal(got, []string{"verifier-run"}) {
		t.Fatalf("childRunIDs = %q", got)
	}
}

// the one-named-test guidance applies whatever the plan has, so both briefs carry it
const verifierSuiteGuidance = "Do not run any whole package or test suite. Read the diff. To settle a specific doubt about behavior, run one named test with `-run '^TestName$'` (or its vitest equivalent)."

func TestTheVerifierBriefNamesWhatPassedAndItsBudget(t *testing.T) {
	g := &waveobj.TaskGroup{
		RunID: "run-1", Check: "go vet ./...", Verify: "node scripts/verify.mjs ./pkg/...", FinalCmd: "node scripts/cdp/final-verify.mjs",
		Final: &waveobj.FinalStage{Round: 1, Tree: "/tree", Commit: "0123456789abcdef", OutDir: "/out"},
	}
	prompt := verifierPrompt(context.Background(), g, &waveobj.Run{BaseCommit: "base"})
	for _, want := range []string{
		"Before you started, the engine ran Check `go vet ./...`, Verify `node scripts/verify.mjs ./pkg/...` and Final `node scripts/cdp/final-verify.mjs` on `0123456`, and they passed, apart from anything listed below as not verified. Do not run them again.",
		verifierSuiteGuidance,
		fmt.Sprintf("You have %s from your start to give a verdict. A session that gives none is stopped and replaced once, and then the result is left unverified.", ReviewTimeout),
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("the brief must contain %q:\n%s", want, prompt)
		}
	}
}

// the brief told the verifier not to run suites and also to list what it could not check, so it disclaimed the former
func TestTheVerifierBriefBoundsWhatMayBeReportedUnverified(t *testing.T) {
	g := &waveobj.TaskGroup{RunID: "run-1", Final: &waveobj.FinalStage{Round: 1, Tree: "/tree"}}
	prompt := verifierPrompt(context.Background(), g, &waveobj.Run{})
	for _, want := range []string{
		"only for a behavior of this change that no check exercised and reading could not settle",
		"Never use it for a command or suite the engine already ran or this brief told you not to run",
		"or for a file or screenshot you did not open",
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("the brief must contain %q:\n%s", want, prompt)
		}
	}
	// the limit sits with the finishing commands, after the flag it bounds
	if strings.Index(prompt, "--unverified") > strings.Index(prompt, "Never use it") {
		t.Errorf("the bound must follow the flag it limits:\n%s", prompt)
	}
}

func TestTheVerifierBriefCarriesTheFindingsAnAcceptedPlanReviewLeftOpen(t *testing.T) {
	const finding = "Task 6 interactions with no scenario step"
	for _, c := range []struct {
		name  string
		state string
		want  bool
	}{
		{"accepted", PlanReviewState_Accepted, true},
		{"passed", PlanReviewState_Passed, false},
		{"failed", PlanReviewState_Failed, false},
	} {
		t.Run(c.name, func(t *testing.T) {
			g := &waveobj.TaskGroup{RunID: "run-1", Final: &waveobj.FinalStage{Round: 1, Tree: "/tree"}, PlanReview: &waveobj.PlanReviewStage{State: c.state, Round: 2, Findings: finding}}
			prompt := verifierPrompt(context.Background(), g, &waveobj.Run{})
			if got := strings.Contains(prompt, finding); got != c.want {
				t.Fatalf("findings in the brief = %v, want %v:\n%s", got, c.want, prompt)
			}
			if c.want && !strings.Contains(prompt, "accepted at plan review, not in `--unverified`") {
				t.Fatalf("the brief must say where an accepted gap goes:\n%s", prompt)
			}
		})
	}
	if p := verifierPrompt(context.Background(), &waveobj.TaskGroup{Final: &waveobj.FinalStage{Round: 1}}, &waveobj.Run{}); strings.Contains(p, "plan review failed") {
		t.Fatalf("a plan with no review has no findings to carry:\n%s", p)
	}
}

func TestTheVerifierBriefNamesNoCommandsWhenThePlanHasNone(t *testing.T) {
	g := &waveobj.TaskGroup{RunID: "run-1", Final: &waveobj.FinalStage{Round: 1, Tree: "/tree", Commit: "0123456789abcdef"}}
	prompt := verifierPrompt(context.Background(), g, &waveobj.Run{})
	if strings.Contains(prompt, "the engine ran") || strings.Contains(prompt, "Do not run them again") {
		t.Fatalf("a plan with no commands ran none:\n%s", prompt)
	}
	if !strings.Contains(prompt, verifierSuiteGuidance) {
		t.Fatalf("the suite guidance is stated whatever ran:\n%s", prompt)
	}
	if !strings.Contains(prompt, fmt.Sprintf("You have %s", ReviewTimeout)) {
		t.Fatalf("the budget is stated whatever ran:\n%s", prompt)
	}
}

func TestTheVerifierBriefNamesOnlyThePlansCommands(t *testing.T) {
	g := &waveobj.TaskGroup{RunID: "run-1", Verify: "task test", Final: &waveobj.FinalStage{Round: 1, Tree: "/tree", Commit: "0123456789abcdef"}}
	prompt := verifierPrompt(context.Background(), g, &waveobj.Run{})
	if !strings.Contains(prompt, "the engine ran Verify `task test` on `0123456`") || strings.Contains(prompt, "Check `") {
		t.Fatalf("only the plan's own commands are named:\n%s", prompt)
	}
}
