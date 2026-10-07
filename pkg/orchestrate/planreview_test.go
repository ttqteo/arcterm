// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// seedPlanReviewDag is a one-task dag submitted from a plan file: its plan review is open and nothing has run.
func seedPlanReviewDag(t *testing.T) (context.Context, *waveobj.TaskGroup) {
	t.Helper()
	ctx, dag := seedPendingDag(t)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.PlanPath, g.SpecPath = "docs/superpowers/plans/p.md", "docs/superpowers/specs/s.md"
		g.PlanReview = NewPlanReview()
		RecomputeDagStatus(g)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return ctx, dag
}

// the review dialog sends an approval with quoted notes as text, which a lead not told otherwise takes for a
// change request.
func TestPlanReviewAskMentionsQuotedNotes(t *testing.T) {
	for _, want := range []string{
		"the human can quote passages of the plan with a note on each",
		"an answer that starts with `Accept all and proceed` is an approval",
		"its `> ` quoted notes are applied before proceeding",
		"any other text is a change request",
	} {
		if !strings.Contains(proceedPastPlanReview, want) {
			t.Fatalf("plan review ask missing %q:\n%s", want, proceedPastPlanReview)
		}
	}
}

func loadDag(t *testing.T, ctx context.Context, dagID string) *waveobj.TaskGroup {
	t.Helper()
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		t.Fatal(err)
	}
	return g
}

// startPlanReview runs the first tick, which spawns the plan reviewer, and returns its run id.
func startPlanReview(t *testing.T, ctx context.Context, dagID string) string {
	t.Helper()
	schedule(t, ctx, dagID)
	runID := loadDag(t, ctx, dagID).PlanReview.RunID
	if runID == "" {
		t.Fatal("the first tick must spawn the plan reviewer")
	}
	return runID
}

func TestPlanReviewHoldsDispatchAndSpawnsOneReviewerInTheLandingTree(t *testing.T) {
	ctx, dag := seedPlanReviewDag(t)
	calls := captureSpawns(t)
	newFakeLead(t)
	schedule(t, ctx, dag.OID)
	schedule(t, ctx, dag.OID)
	g := loadDag(t, ctx, dag.OID)
	if g.Status != DagStatus_PlanReview || g.Tasks[0].State != TaskState_Pending || g.Tasks[0].RunID != "" {
		t.Fatalf("nothing may dispatch during plan review, got status %s task %s run %q", g.Status, g.Tasks[0].State, g.Tasks[0].RunID)
	}
	if len(*calls) != 1 {
		t.Fatalf("want one plan reviewer across two ticks, got %d spawns", len(*calls))
	}
	owner, err := wstore.GetRun(ctx, g.ChannelId, g.RunID)
	if err != nil {
		t.Fatal(err)
	}
	c := (*calls)[0]
	if c.cwd != owner.ProjectPath || c.opts.TaskId != "" {
		t.Fatalf("the reviewer runs in the landing tree with no task, got cwd %q task %q", c.cwd, c.opts.TaskId)
	}
	for _, want := range []string{
		"plan reviewer for run " + g.RunID,
		filepath.Join(owner.ProjectPath, "docs/superpowers/specs/s.md"),
		filepath.Join(owner.ProjectPath, "docs/superpowers/plans/p.md"),
		"every requirement in the spec has a task",
		"no two tasks edit the same file without a Depends",
		"the same names in every task",
		"each task states its acceptance criteria and names the tests that prove them",
		"the commands the plan names",
		"Only read: never edit, stage or commit, and ask no questions",
		"`wsh jarvis dag planreview pass \"<summary>\"`",
		"`wsh jarvis dag planreview fail \"<findings",
	} {
		if !strings.Contains(c.prompt, want) {
			t.Errorf("the brief must contain %q:\n%s", want, c.prompt)
		}
	}
	reviewer, err := wstore.GetRun(ctx, g.ChannelId, g.PlanReview.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if reviewer.StageRole != jarvis.UsageRole_PlanReviewer || reviewer.SessionId == "" || reviewer.DagORef != g.OID || reviewer.TaskId != "" {
		t.Fatalf("the reviewer's run must carry its role, session and dag and no task, got %+v", reviewer)
	}
}

func TestPlanReviewPassStartsDispatch(t *testing.T) {
	ctx, dag := seedPlanReviewDag(t)
	calls := captureSpawns(t)
	newFakeLead(t)
	reviewer := startPlanReview(t, ctx, dag.OID)
	if err := RecordPlanReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Pass, "every requirement has a task", nil); err != nil {
		t.Fatal(err)
	}
	if pr := loadDag(t, ctx, dag.OID).PlanReview; pr.State != PlanReviewState_Passed || pr.Findings != "every requirement has a task" {
		t.Fatalf("want passed with the summary, got %+v", pr)
	}
	schedule(t, ctx, dag.OID)
	g := loadDag(t, ctx, dag.OID)
	if g.Tasks[0].State != TaskState_Running || len(*calls) != 2 || (*calls)[1].opts.TaskId != "t-0" {
		t.Fatalf("a pass dispatches the first layer, got task %s after %d spawns", g.Tasks[0].State, len(*calls))
	}
	if g.Status != DagStatus_Running {
		t.Fatalf("status = %s, want running", g.Status)
	}
}

func TestPlanReviewFailWakesTheLeadWithTheFindingsWhole(t *testing.T) {
	ctx, dag := seedPlanReviewDag(t)
	calls := captureSpawns(t)
	f := newFakeLead(t)
	reviewer := startPlanReview(t, ctx, dag.OID)
	findings := "Task 2 and Task 3 both edit engine.go with no Depends between them; add Depends on: Task 2 to Task 3. " +
		strings.Repeat("The spec's section 4.1 has no task. ", 20)
	if err := RecordPlanReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Fail, findings, nil); err != nil {
		t.Fatal(err)
	}
	pr := loadDag(t, ctx, dag.OID).PlanReview
	if pr.State != PlanReviewState_Failed || pr.Findings != strings.TrimSpace(findings) {
		t.Fatalf("want failed with the findings whole, got %+v", pr)
	}
	joined := strings.Join(f.sends, "\n")
	if !strings.Contains(joined, flatLine(findings)) || !strings.Contains(joined, "run `wsh jarvis dag submit` again") {
		t.Fatalf("the wake must carry the findings whole and the resubmit, got %q", f.sends)
	}
	schedule(t, ctx, dag.OID)
	if g := loadDag(t, ctx, dag.OID); g.Status != DagStatus_PlanReview || g.Tasks[0].RunID != "" || len(*calls) != 1 {
		t.Fatalf("a failed review dispatches nothing, got status %s after %d spawns", g.Status, len(*calls))
	}
}

func TestPlanReviewAfterTheLastRoundGoesToTheHuman(t *testing.T) {
	ctx, dag := seedPlanReviewDag(t)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.PlanReview.Round = MaxPlanReviewRounds
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	calls := captureSpawns(t)
	f := newFakeLead(t)
	reviewer := startPlanReview(t, ctx, dag.OID)
	if err := AcceptPlanReview(ctx, dag.OID, "the human said go"); err == nil || !strings.Contains(err.Error(), "reviewing") {
		t.Fatalf("accept while the reviewer works must be refused, got %v", err)
	}
	if err := RecordPlanReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Fail, "still no task for 4.1", nil); err != nil {
		t.Fatal(err)
	}
	if want := "Put it to the human; " + proceedPastPlanReview; !strings.Contains(strings.Join(f.sends, "\n"), want) {
		t.Fatalf("after the last round the wake must say to forward, got %q", f.sends)
	}
	// the lead carries the accepted findings in while every task still waits: accept spawns the first ones (run 6c7652be)
	taskID := loadDag(t, ctx, dag.OID).Tasks[0].ID
	if err := AmendTask(ctx, dag.OID, taskID, "also cover 4.1"); err != nil {
		t.Fatalf("amend must reach a task while the plan review holds: %v", err)
	}
	if _, err := ReplacePlanReviewProposal(ctx, dag.OID, &waveobj.TaskGroup{PlanPath: "p.md", Tasks: []waveobj.TaskNode{{ID: "t-0", Label: "a", State: TaskState_Pending}}}); err == nil || !strings.Contains(err.Error(), "put it to the human") {
		t.Fatalf("a resubmit past the last round must be refused, got %v", err)
	}
	if err := AcceptPlanReview(ctx, dag.OID, " "); err == nil {
		t.Fatal("accept needs the human's reason")
	}
	if err := AcceptPlanReview(ctx, dag.OID, "the human said 4.1 is out of scope"); err != nil {
		t.Fatal(err)
	}
	schedule(t, ctx, dag.OID)
	g := loadDag(t, ctx, dag.OID)
	if g.PlanReview.State != PlanReviewState_Accepted || g.Tasks[0].State != TaskState_Running || len(*calls) != 2 {
		t.Fatalf("accept starts dispatch, got review %s task %s after %d spawns", g.PlanReview.State, g.Tasks[0].State, len(*calls))
	}
	if len(g.Tasks[0].LeadNotes) != 1 || g.Tasks[0].LeadNotes[0] != "also cover 4.1" {
		t.Fatalf("the spawned task must carry the note amended before accept, got %q", g.Tasks[0].LeadNotes)
	}
	if err := AcceptPlanReview(ctx, dag.OID, "again"); err == nil {
		t.Fatal("an accepted review cannot be accepted again")
	}
}

func TestResubmitReplacesAFailedPlanAndOpensTheNextRound(t *testing.T) {
	ctx, dag := seedPlanReviewDag(t)
	captureSpawns(t)
	newFakeLead(t)
	reviewer := startPlanReview(t, ctx, dag.OID)
	if PlanReviewReplaceable(loadDag(t, ctx, dag.OID)) {
		t.Fatal("a plan under review is not replaceable")
	}
	if err := RecordPlanReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Fail, "no task for 4.1", nil); err != nil {
		t.Fatal(err)
	}
	if !PlanReviewReplaceable(loadDag(t, ctx, dag.OID)) {
		t.Fatal("a failed review with nothing dispatched is replaceable")
	}
	revised := &waveobj.TaskGroup{Title: "revised", Parallelism: 1, PlanPath: "docs/superpowers/plans/p2.md", Verify: "go test ./...",
		Tasks: []waveobj.TaskNode{{ID: "t-1", Label: "a", State: TaskState_Pending}, {ID: "t-2", Label: "b", State: TaskState_Pending, Deps: []string{"t-1"}}}}
	if _, err := ReplacePlanReviewProposal(ctx, dag.OID, &waveobj.TaskGroup{Tasks: revised.Tasks}); err == nil {
		t.Fatal("a resubmit with no plan file would skip the review")
	}
	g, err := ReplacePlanReviewProposal(ctx, dag.OID, revised)
	if err != nil {
		t.Fatal(err)
	}
	if g.Title != "revised" || len(g.Tasks) != 2 || g.PlanPath != revised.PlanPath || g.Verify != "go test ./..." {
		t.Fatalf("the revision must replace the proposal, got %+v", g)
	}
	if pr := g.PlanReview; pr.State != PlanReviewState_Reviewing || pr.Round != 2 || pr.RunID != "" || pr.Findings != "" {
		t.Fatalf("want round 2 reviewing afresh, got %+v", pr)
	}
	if stored := loadDag(t, ctx, dag.OID); stored.Status != DagStatus_PlanReview || len(stored.Tasks) != 2 {
		t.Fatalf("the replacement must be stored, got status %s with %d tasks", stored.Status, len(stored.Tasks))
	}
}

func TestPlanReviewerThatEndsWithoutAVerdictIsReplacedOnceThenFails(t *testing.T) {
	ctx, dag := seedPlanReviewDag(t)
	calls := captureSpawns(t)
	stubStopRunWorkers(t)
	f := newFakeLead(t)
	first := startPlanReview(t, ctx, dag.OID)
	endRun(t, ctx, dag.ChannelId, first)
	schedule(t, ctx, dag.OID)
	pr := loadDag(t, ctx, dag.OID).PlanReview
	if len(*calls) != 2 || pr.RunID == "" || pr.RunID == first || pr.Respawns != 1 || pr.State != PlanReviewState_Reviewing {
		t.Fatalf("want one replacement reviewer, got %d spawns and %+v", len(*calls), pr)
	}
	// the second one goes silent past the timeout
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.PlanReview.StartedTs = time.Now().Add(-ReviewTimeout - time.Minute).UnixMilli()
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	schedule(t, ctx, dag.OID)
	pr = loadDag(t, ctx, dag.OID).PlanReview
	if len(*calls) != 2 || pr.State != PlanReviewState_Failed || !strings.Contains(pr.Findings, "the plan reviewer did not finish") {
		t.Fatalf("the second loss fails the review, got %d spawns and %+v", len(*calls), pr)
	}
	if !strings.Contains(strings.Join(f.sends, "\n"), "wake: the plan reviewer did not finish in round 1 (it gave no verdict within") {
		t.Fatalf("the lead must be woken, got %q", f.sends)
	}
}

func TestPlanReviewVerdictsAreRefusedWhenTheyCannotApply(t *testing.T) {
	ctx, dag := seedPlanReviewDag(t)
	captureSpawns(t)
	newFakeLead(t)
	reviewer := startPlanReview(t, ctx, dag.OID)
	cases := []struct{ name, run, verdict, text string }{
		{"not the reviewer", "some-other-run", ReviewVerdict_Pass, "ok"},
		{"unknown verdict", reviewer, "maybe", "ok"},
		{"no text", reviewer, ReviewVerdict_Fail, "  "},
		{"too long", reviewer, ReviewVerdict_Fail, strings.Repeat("x", MaxReviewNoteLen+1)},
	}
	for _, c := range cases {
		if err := RecordPlanReviewVerdict(ctx, dag.OID, c.run, c.verdict, c.text, nil); err == nil {
			t.Errorf("%s: want refused", c.name)
		}
	}
	if pr := loadDag(t, ctx, dag.OID).PlanReview; pr.State != PlanReviewState_Reviewing {
		t.Fatalf("a refused verdict changes nothing, got %+v", pr)
	}
	if err := RecordPlanReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Pass, "fine", nil); err != nil {
		t.Fatal(err)
	}
	if err := RecordPlanReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Fail, "second thoughts", nil); err == nil {
		t.Fatal("a second verdict must be refused")
	}
}

// the watchdog never ticks a cancelled dag, so cancel itself must stop a live plan reviewer
func TestCancelStopsTheLivePlanReviewer(t *testing.T) {
	ctx, dag := seedPlanReviewDag(t)
	captureSpawns(t)
	newFakeLead(t)
	reviewer := startPlanReview(t, ctx, dag.OID)
	var stopped []string
	old := stopRunWorkers
	stopRunWorkers = func(_ context.Context, r *waveobj.Run) error {
		stopped = append(stopped, r.ID)
		return nil
	}
	restoreAfterStages(t, func() { stopRunWorkers = old })
	if err := Cancel(ctx, dag.OID); err != nil {
		t.Fatal(err)
	}
	run, err := wstore.GetRun(ctx, dag.ChannelId, reviewer)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != jarvis.RunStatus_Cancelled {
		t.Fatalf("the plan reviewer's run must be cancelled, got %q", run.Status)
	}
	if !strings.Contains(strings.Join(stopped, ","), reviewer) {
		t.Fatalf("the plan reviewer's session must be stopped, stopped %q", stopped)
	}
}

// a dag submitted as JSON has no plan to review, so it dispatches on its first tick as before
func TestADagWithNoPlanReviewDispatchesAtOnce(t *testing.T) {
	ctx, dag := seedPendingDag(t)
	calls := captureSpawns(t)
	schedule(t, ctx, dag.OID)
	if g := loadDag(t, ctx, dag.OID); g.PlanReview != nil || g.Tasks[0].State != TaskState_Running || len(*calls) != 1 {
		t.Fatalf("want the task dispatched, got review %+v task %s", g.PlanReview, g.Tasks[0].State)
	}
}
