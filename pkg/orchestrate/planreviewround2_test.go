// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	roundTwoPlanPath = "docs/superpowers/plans/p.md"
	roundTwoSpecPath = "docs/superpowers/specs/s.md"
	roundOneFindings = "Task 1 names no test for 4.1; name TestCoupons."
)

// writePlanDoc rewrites the plan in the dag's landing tree, as the lead does before it resubmits.
func writePlanDoc(t *testing.T, ctx context.Context, g *waveobj.TaskGroup, text string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dagOwner(t, ctx, g).ProjectPath, roundTwoPlanPath), []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

// roundTwo is a Reviewer picks dag whose round 1 failed with the full reviewer's findings and picks.
type roundTwo struct {
	ctx        context.Context
	dag        *waveobj.TaskGroup
	calls      *[]spawnCall
	lead       *fakeLead
	handed     *[]string
	plan, spec string
	findings   string // round 1's merged findings
}

func failRoundOne(t *testing.T, autonomous bool) *roundTwo {
	t.Helper()
	ctx, dag := seedPlanReviewDag(t)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks, g.ReviewerPicks, g.Autonomous = picksTasks(), true, autonomous
		g.LightReviewerRoute = &waveobj.RoutePin{Runtime: "claude", Model: "haiku"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	plan, spec := writePlanReviewDocs(t, ctx, dag)
	r := &roundTwo{ctx: ctx, dag: dag, calls: captureSpawns(t), lead: newFakeLead(t), plan: plan, spec: spec}
	r.handed = stubLeadHandoff(t, ctx, dag)
	full := startPlanReview(t, ctx, dag.OID)
	if err := RecordPlanReviewVerdict(ctx, dag.OID, full, ReviewVerdict_Fail, roundOneFindings, goodPicks()); err != nil {
		t.Fatal(err)
	}
	r.findings = loadDag(t, ctx, dag.OID).PlanReview.Findings
	if !strings.HasPrefix(r.findings, "[Full review] "+roundOneFindings) {
		t.Fatalf("round 1 must fail with the full reviewer's findings, got %q", r.findings)
	}
	// the lead took round 1's wake and is back at its prompt, so round 2's goes out
	wakes, r.lead.sends = newWaker(), nil
	return r
}

// resubmit replaces the proposal with the same tasks, the docs as they now are on disk.
func (r *roundTwo) resubmit(t *testing.T) *waveobj.TaskGroup {
	t.Helper()
	g, err := ReplacePlanReviewProposal(r.ctx, r.dag.OID, &waveobj.TaskGroup{Title: "revised", Parallelism: 1, PlanPath: roundTwoPlanPath, SpecPath: roundTwoSpecPath, Tasks: picksTasks()})
	if err != nil {
		t.Fatal(err)
	}
	return g
}

// startFollowup resubmits and runs the tick that starts round 2, returning the follow-up's brief.
func (r *roundTwo) startFollowup(t *testing.T) string {
	t.Helper()
	r.resubmit(t)
	before := len(*r.calls)
	schedule(t, r.ctx, r.dag.OID)
	if len(*r.calls) != before+1 {
		t.Fatalf("round 2 starts one reviewer, got %d spawns", len(*r.calls)-before)
	}
	return (*r.calls)[before].prompt
}

// diffLines are a diff block's changed lines, without its file headers.
func diffLines(t *testing.T, prompt string) []string {
	t.Helper()
	start := strings.Index(prompt, "```diff\n")
	if start < 0 {
		t.Fatalf("no diff block in:\n%s", prompt)
	}
	block := prompt[start+len("```diff\n"):]
	block = block[:strings.Index(block, "\n```")]
	var out []string
	for _, line := range strings.Split(block, "\n") {
		if (strings.HasPrefix(line, "+") || strings.HasPrefix(line, "-")) && !strings.HasPrefix(line, "+++") && !strings.HasPrefix(line, "---") {
			out = append(out, line)
		}
	}
	return out
}

func TestResubmitKeepsRoundOneFindingsDocsAndPicks(t *testing.T) {
	r := failRoundOne(t, false)
	pr := r.resubmit(t).PlanReview
	if pr.State != PlanReviewState_Reviewing || pr.Round != 2 || len(pr.Reviewers) != 0 || pr.PlanText != "" {
		t.Fatalf("want round 2 reviewing with no reviewers yet, got %+v", pr)
	}
	want := waveobj.PlanReviewPrior{Findings: r.findings, PlanText: r.plan, SpecText: r.spec, Picks: []waveobj.PlanReviewPriorPick{
		{TaskId: "t-1", Title: "thread the field through", Model: PickModel_Sonnet, Reason: "a field threaded through"},
		{TaskId: "t-2", Title: "design the store", Model: PickModel_Lead, Reason: "the store shape is a design choice"},
	}}
	if pr.Prior == nil || fmt.Sprintf("%+v", *pr.Prior) != fmt.Sprintf("%+v", want) {
		t.Fatalf("got prior %+v\nwant %+v", pr.Prior, want)
	}
	if stored := loadDag(t, r.ctx, r.dag.OID).PlanReview.Prior; stored == nil || stored.Findings != r.findings {
		t.Fatalf("the prior must be stored, got %+v", stored)
	}
	if g := loadDag(t, r.ctx, r.dag.OID); taskByID(g, "t-1").ModelSource == waveobj.TaskModelSource_Reviewer {
		t.Fatal("the resubmit replaces the tasks, so their picks live only in the prior")
	}
}

func TestPlanReviewRoundTwoStartsOneFollowup(t *testing.T) {
	r := failRoundOne(t, false)
	revised := "# Plan\n\n### Task 1: a, with TestCoupons\n"
	writePlanDoc(t, r.ctx, r.dag, revised)
	r.startFollowup(t)
	g := loadDag(t, r.ctx, r.dag.OID)
	pr := g.PlanReview
	if len(pr.Reviewers) != 1 || pr.Reviewers[0].Lens != PlanReviewLens_Followup || pr.Reviewers[0].State != PlanReviewerState_Reviewing {
		t.Fatalf("want one follow-up reviewer, got %+v", pr.Reviewers)
	}
	if pr.PlanText != revised || pr.SpecText != r.spec || pr.Prior == nil {
		t.Fatalf("the round's docs are captured and the prior kept, got %+v", pr)
	}
	run, err := wstore.GetRun(r.ctx, g.ChannelId, pr.Reviewers[0].RunID)
	if err != nil {
		t.Fatal(err)
	}
	if run.StageRole != jarvis.UsageRole_PlanReviewer || run.Runtime != "claude" || run.Model != "haiku" {
		t.Fatalf("the follow-up runs as plan-reviewer on the Light reviewers route, got %q on %s/%s", run.StageRole, run.Runtime, run.Model)
	}
	schedule(t, r.ctx, r.dag.OID)
	if n := len(loadDag(t, r.ctx, r.dag.OID).PlanReview.Reviewers); n != 1 {
		t.Fatalf("the next tick adds no reviewer, got %d", n)
	}
}

func TestFollowupPromptCarriesFindingsAndDiff(t *testing.T) {
	r := failRoundOne(t, false)
	writePlanDoc(t, r.ctx, r.dag, "# Plan\n\n### Task 1: a, with TestCoupons\n")
	prompt := r.startFollowup(t)
	for _, want := range []string{
		"This is round 2. Round 1 failed with these findings, and the lead revised the plan to answer them:\n\n" + r.findings + "\n\n",
		"The spec did not change.",
		"confirm the revised plan fixes it, or explicitly and soundly declines it",
		"Check only the changed lines",
		planReviewSpecGap,
		"- t-1: thread the field through (round 1 picked sonnet: a field threaded through)\n",
		"- t-2: design the store (round 1 picked lead: the store shape is a design choice)\n",
		"keep it unless the diff changed that task; a task round 1 did not pick needs a fresh pick",
		`--pick "t-1=<sonnet|lead>: <one-line reason>"`,
		"one line per round-1 finding",
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("the follow-up brief must contain %q:\n%s", want, prompt)
		}
	}
	for _, it := range planReviewChecklist {
		if it.text != planReviewBoardItem && !strings.Contains(prompt, it.text) {
			t.Errorf("the follow-up checks the changed lines against every item, missing %q", it.text)
		}
	}
	if got, want := diffLines(t, prompt), []string{"-### Task 1: a", "+### Task 1: a, with TestCoupons"}; strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("the diff holds exactly the changed lines, got %q", got)
	}
	if strings.Count(prompt, "```diff") != 1 {
		t.Fatalf("an unchanged spec has no diff block:\n%s", prompt)
	}
}

func TestFollowupPromptIdenticalPlanSaysNoChange(t *testing.T) {
	r := failRoundOne(t, false)
	prompt := r.startFollowup(t)
	if !strings.Contains(prompt, "The plan did not change.") || !strings.Contains(prompt, "The spec did not change.") || strings.Contains(prompt, "```diff") {
		t.Fatalf("a byte-identical resubmit says so instead of an empty diff:\n%s", prompt)
	}
}

func TestFollowupPassClearsTheHold(t *testing.T) {
	r := failRoundOne(t, false)
	writePlanDoc(t, r.ctx, r.dag, "# Plan\n\n### Task 1: a, with TestCoupons\n")
	r.startFollowup(t)
	before := len(planReviewedRows(r.lead))
	followup := reviewerOf(t, r.ctx, r.dag.OID, PlanReviewLens_Followup)
	if err := RecordPlanReviewVerdict(r.ctx, r.dag.OID, followup.RunID, ReviewVerdict_Pass, "finding 1 fixed", goodPicks()); err != nil {
		t.Fatal(err)
	}
	g := loadDag(t, r.ctx, r.dag.OID)
	pr := g.PlanReview
	if planReviewHolds(g) || pr.State != PlanReviewState_Passed || pr.Findings != "finding 1 fixed" {
		t.Fatalf("the follow-up's pass clears the hold, got %+v", pr)
	}
	if pr.PlanText != "" || pr.SpecText != "" || pr.Prior != nil {
		t.Fatalf("a pass clears the docs, got %+v", pr)
	}
	rows := planReviewedRows(r.lead)
	if len(rows) != before+1 || rows[len(rows)-1]["state"] != PlanReviewState_Passed || rows[len(rows)-1]["round"] != 2 {
		t.Fatalf("want one passed round-2 event, got %v", rows[before:])
	}
	if len(*r.handed) != 1 {
		t.Fatalf("want one handoff, got %v", *r.handed)
	}
	if taskByID(g, "t-1").ModelSource != waveobj.TaskModelSource_Reviewer {
		t.Fatal("the follow-up's picks apply")
	}
}

func TestFollowupFailIsTheLastRound(t *testing.T) {
	for _, autonomous := range []bool{false, true} {
		t.Run(fmt.Sprintf("autonomous=%v", autonomous), func(t *testing.T) {
			r := failRoundOne(t, autonomous)
			r.startFollowup(t)
			followup := reviewerOf(t, r.ctx, r.dag.OID, PlanReviewLens_Followup)
			if err := RecordPlanReviewVerdict(r.ctx, r.dag.OID, followup.RunID, ReviewVerdict_Fail, "finding 1 not fixed: still no test", nil); err != nil {
				t.Fatal(err)
			}
			want := "[Round-2 follow-up] finding 1 not fixed: still no test"
			pr := loadDag(t, r.ctx, r.dag.OID).PlanReview
			if pr.State != PlanReviewState_Failed || pr.Findings != want {
				t.Fatalf("got %s %q, want %q", pr.State, pr.Findings, want)
			}
			if !strings.Contains(strings.Join(r.lead.sends, "\n"), planReviewFailedWake(2, want, true, autonomous)) {
				t.Fatalf("want the last-round wake, got %q", r.lead.sends)
			}
			if _, err := ReplacePlanReviewProposal(r.ctx, r.dag.OID, &waveobj.TaskGroup{PlanPath: roundTwoPlanPath, Tasks: picksTasks()}); err == nil {
				t.Fatal("a resubmit past the last round is refused")
			}
		})
	}
}

func TestFollowupLostFailsTheRound(t *testing.T) {
	r := failRoundOne(t, false)
	stubStopRunWorkers(t)
	r.startFollowup(t)
	loseReviewer(t, r.ctx, r.dag.OID, r.dag.ChannelId, PlanReviewLens_Followup)
	pr := loadDag(t, r.ctx, r.dag.OID).PlanReview
	if pr.State != PlanReviewState_Failed || pr.Findings != "[Round-2 follow-up] did not finish: it ended without a verdict" {
		t.Fatalf("a lost follow-up fails the round, got %s %q", pr.State, pr.Findings)
	}
	if !strings.Contains(strings.Join(r.lead.sends, "\n"), planReviewLostWake(2, "it ended without a verdict", true, false)) {
		t.Fatalf("want the last-round lost wake, got %q", r.lead.sends)
	}
}

// a round 1 from before the docs were captured leaves none in the prior: the follow-up reviews every line
func TestRoundTwoWithoutPriorDocsDiffsAgainstEmpty(t *testing.T) {
	ctx, dag := seedPlanReviewDag(t)
	plan, _ := writePlanReviewDocs(t, ctx, dag)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.PlanReview = &waveobj.PlanReviewStage{State: PlanReviewState_Failed, Round: 1, Findings: roundOneFindings}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	calls := captureSpawns(t)
	newFakeLead(t)
	if _, err := ReplacePlanReviewProposal(ctx, dag.OID, &waveobj.TaskGroup{PlanPath: roundTwoPlanPath, SpecPath: roundTwoSpecPath, Tasks: []waveobj.TaskNode{{ID: "t-0", Label: "a", State: TaskState_Pending}}}); err != nil {
		t.Fatal(err)
	}
	schedule(t, ctx, dag.OID)
	if len(*calls) != 1 {
		t.Fatalf("round 2 starts the one follow-up, got %d spawns", len(*calls))
	}
	prompt := (*calls)[0].prompt
	if !strings.Contains(prompt, roundOneFindings) {
		t.Fatalf("the findings are still confirmed:\n%s", prompt)
	}
	var want []string
	for _, line := range strings.Split(strings.TrimSuffix(plan, "\n"), "\n") {
		want = append(want, "+"+line)
	}
	if got := diffLines(t, prompt); strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("the plan diffs whole against empty, got %q want %q", got, want)
	}
	if strings.Count(prompt, "```diff") != 2 {
		t.Fatalf("the spec diffs against empty too:\n%s", prompt)
	}
}

func TestDocDiff(t *testing.T) {
	ctx := context.Background()
	if got, err := docDiff(ctx, "a\nb\n", "a\nb\n", "p.md"); err != nil || got != "" {
		t.Fatalf("identical texts give no diff, got %q %v", got, err)
	}
	got, err := docDiff(ctx, "a\nb\nc\n", "a\nB\nc\n", "p.md")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"--- a/round1/p.md\n", "+++ b/round2/p.md\n", "\n-b\n", "\n+B\n"} {
		if !strings.Contains(got, want) {
			t.Fatalf("the diff must contain %q, got:\n%s", want, got)
		}
	}
	if strings.Contains(got, "arc-plandiff") || strings.Contains(got, os.TempDir()) || strings.Contains(got, filepath.ToSlash(os.TempDir())) {
		t.Fatalf("the temp dir is stripped, got:\n%s", got)
	}
	if got, err := docDiff(ctx, "", "x\n", "p.md"); err != nil || !strings.Contains(got, "\n+x") {
		t.Fatalf("an empty old text diffs whole, got %q %v", got, err)
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := docDiff(cancelled, "a\n", "b\n", "p.md"); err == nil {
		t.Fatal("a git that cannot run is an error")
	}
}
