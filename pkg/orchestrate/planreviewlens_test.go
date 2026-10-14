// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// writePlanReviewDocs writes the seeded dag's plan and spec into the landing tree and returns their text.
func writePlanReviewDocs(t *testing.T, ctx context.Context, g *waveobj.TaskGroup) (string, string) {
	t.Helper()
	owner := dagOwner(t, ctx, g)
	plan, spec := "# Plan\n\n### Task 1: a\n", "# Spec\n\nship coupons\n"
	for rel, text := range map[string]string{"docs/superpowers/plans/p.md": plan, "docs/superpowers/specs/s.md": spec} {
		path := filepath.Join(owner.ProjectPath, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return plan, spec
}

// stubLeadHandoff gives the dag's run a lead worker and records the handoffs the plan review posts to it.
func stubLeadHandoff(t *testing.T, ctx context.Context, g *waveobj.TaskGroup) *[]string {
	t.Helper()
	if err := wstore.UpdateRun(ctx, g.ChannelId, g.RunID, func(r *waveobj.Run) error {
		r.Phases[0].State = jarvis.PhaseState_Running
		r.Phases[0].WorkerOrefs = []string{"tab:lead-tab"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var handed []string
	restoreAfterStages(t, SetPostHandoffForTest(func(_ context.Context, _, runId string) { handed = append(handed, runId) }))
	return &handed
}

// planReviewedRows are the plan-reviewed events the fake lead recorded.
func planReviewedRows(f *fakeLead) []map[string]any {
	var out []map[string]any
	for _, row := range f.rows {
		if row["eventkind"] == waveobj.RunEventKindPlanReviewed {
			out = append(out, row)
		}
	}
	return out
}

func verdict(t *testing.T, ctx context.Context, dagID, lens, v, text string) {
	t.Helper()
	if err := RecordPlanReviewVerdict(ctx, dagID, reviewerOf(t, ctx, dagID, lens).RunID, v, text, nil); err != nil {
		t.Fatalf("%s %s: %v", lens, v, err)
	}
}

// loseReviewer ends the lens's session twice without a verdict, ticking after each, so the reviewer is lost.
func loseReviewer(t *testing.T, ctx context.Context, dagID, channelId, lens string) {
	t.Helper()
	for range MaxReviewRespawns + 1 {
		endRun(t, ctx, channelId, reviewerOf(t, ctx, dagID, lens).RunID)
		schedule(t, ctx, dagID)
	}
}

func TestPlanReviewRoundOneStartsFiveReviewers(t *testing.T) {
	for _, c := range []struct {
		name  string
		light *waveobj.RoutePin
		want  waveobj.RoutePin
	}{
		{"nil setting", nil, LightPickRoute},
		{"set route", &waveobj.RoutePin{Runtime: "claude", Model: "haiku"}, waveobj.RoutePin{Runtime: "claude", Model: "haiku"}},
	} {
		t.Run(c.name, func(t *testing.T) {
			ctx, dag := seedPlanReviewDag(t)
			if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
				g.LightReviewerRoute = c.light
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			plan, spec := writePlanReviewDocs(t, ctx, dag)
			calls := captureSpawns(t)
			f := newFakeLead(t)
			schedule(t, ctx, dag.OID)
			g := loadDag(t, ctx, dag.OID)
			pr := g.PlanReview
			if len(*calls) != len(planRoundOneLenses) || len(pr.Reviewers) != len(planRoundOneLenses) {
				t.Fatalf("want five reviewers, got %d spawns and %+v", len(*calls), pr.Reviewers)
			}
			if pr.PlanText != plan || pr.SpecText != spec {
				t.Fatalf("the round's docs must be captured, got plan %q spec %q", pr.PlanText, pr.SpecText)
			}
			full := reviewerRoute(dagOwner(t, ctx, g), g)
			for i, r := range pr.Reviewers {
				if r.Lens != planRoundOneLenses[i] || r.State != PlanReviewerState_Reviewing || r.RunID == "" || r.StartedTs == 0 {
					t.Fatalf("reviewer %d = %+v", i, r)
				}
				run, err := wstore.GetRun(ctx, g.ChannelId, r.RunID)
				if err != nil {
					t.Fatal(err)
				}
				want := c.want
				if r.Lens == PlanReviewLens_Full {
					want = full
				}
				if run.StageRole != jarvis.UsageRole_PlanReviewer || run.Runtime != want.Runtime || run.Model != want.Model {
					t.Fatalf("%s runs as %q on %s/%s, want plan-reviewer on %s/%s", r.Lens, run.StageRole, run.Runtime, run.Model, want.Runtime, want.Model)
				}
			}
			var lenses []string
			for _, row := range f.rows {
				if row["eventkind"] == waveobj.RunEventKindStageSessionStarted {
					lenses = append(lenses, fmt.Sprint(row["lens"]))
				}
			}
			if strings.Join(lenses, ",") != strings.Join(planRoundOneLenses, ",") {
				t.Fatalf("each started row names its lens, got %v", lenses)
			}
		})
	}
}

func TestPlanReviewLensPromptsSplitTheChecklist(t *testing.T) {
	g := &waveobj.TaskGroup{RunID: "run-1", SpecPath: "s.md", PlanPath: "p.md", Prototype: "C:/canvas/board.dc.html", ReviewerPicks: true, Tasks: picksTasks()}
	itemText := func(it planReviewItem) string {
		if it.text == planReviewBoardItem {
			return fmt.Sprintf(planReviewBoardItem, DocPath(g, "tree", g.Prototype))
		}
		return it.text
	}
	lenses := planRoundOneLenses[1:]
	prompts := map[string]string{}
	for _, lens := range lenses {
		p := planLensPrompt(g, "tree", lens)
		prompts[lens] = p
		if strings.Contains(p, "--pick") || strings.Contains(p, "t-1") {
			t.Fatalf("%s: a lens picks no models:\n%s", lens, p)
		}
		if !strings.Contains(p, "Yours is "+PlanReviewLensTitle(lens)+".") || !strings.Contains(p, "`wsh jarvis dag planreview pass \"<summary>\"`") {
			t.Fatalf("%s: the brief names its lens and the verdict:\n%s", lens, p)
		}
		for _, other := range lenses {
			if other != lens && !strings.Contains(p, PlanReviewLensTitle(other)) {
				t.Fatalf("%s: the brief names the other lens %q:\n%s", lens, other, p)
			}
		}
		for _, it := range planReviewChecklist {
			if has := strings.Contains(p, itemText(it)); has != (it.lens == lens) {
				t.Fatalf("%s: item %q (lens %s) present = %v:\n%s", lens, itemText(it), it.lens, has, p)
			}
		}
	}
	full := planReviewPrompt(g, "tree")
	checks := full[strings.Index(full, "Check that:\n")+len("Check that:\n") : strings.Index(full, planReviewReadOnly)]
	for _, line := range strings.Split(strings.TrimSuffix(checks, "\n"), "\n") {
		item := strings.TrimPrefix(line, "- ")
		covered := false
		for _, p := range prompts {
			covered = covered || strings.Contains(p, item)
		}
		if !covered {
			t.Fatalf("no lens covers the full prompt's item %q", item)
		}
	}
}

func TestPlanReviewPassesOnlyWhenAllPass(t *testing.T) {
	ctx, dag := seedPlanReviewDag(t)
	captureSpawns(t)
	f := newFakeLead(t)
	handed := stubLeadHandoff(t, ctx, dag)
	schedule(t, ctx, dag.OID)
	for _, lens := range planRoundOneLenses[:4] {
		verdict(t, ctx, dag.OID, lens, ReviewVerdict_Pass, lens+" is fine")
		if g := loadDag(t, ctx, dag.OID); !planReviewHolds(g) || g.PlanReview.State != PlanReviewState_Reviewing {
			t.Fatalf("after %s's pass the review still holds, got %+v", lens, g.PlanReview)
		}
	}
	if len(planReviewedRows(f)) != 0 || len(*handed) != 0 {
		t.Fatalf("a round with a reviewer out has no event and no handoff, got %v and %v", planReviewedRows(f), *handed)
	}
	verdict(t, ctx, dag.OID, PlanReviewLens_Final, ReviewVerdict_Pass, "final is fine")
	g := loadDag(t, ctx, dag.OID)
	if planReviewHolds(g) || g.PlanReview.State != PlanReviewState_Passed || g.PlanReview.Findings != "full is fine" {
		t.Fatalf("the fifth pass clears the hold with the full reviewer's summary, got %+v", g.PlanReview)
	}
	if rows := planReviewedRows(f); len(rows) != 1 || rows[0]["state"] != PlanReviewState_Passed {
		t.Fatalf("want one passed event, got %v", rows)
	}
	if len(*handed) != 1 || (*handed)[0] != g.RunID {
		t.Fatalf("want one handoff to the lead, got %v", *handed)
	}
}

func TestPlanReviewLensFailMergesFindingsWhole(t *testing.T) {
	ctx, dag := seedPlanReviewDag(t)
	captureSpawns(t)
	f := newFakeLead(t)
	handed := stubLeadHandoff(t, ctx, dag)
	schedule(t, ctx, dag.OID)
	fullText, testsText := "F"+strings.Repeat("f", MaxReviewNoteLen-1), "T"+strings.Repeat("t", MaxReviewNoteLen-1)
	verdict(t, ctx, dag.OID, PlanReviewLens_Tests, ReviewVerdict_Fail, testsText)
	verdict(t, ctx, dag.OID, PlanReviewLens_Spec, ReviewVerdict_Pass, "fine")
	verdict(t, ctx, dag.OID, PlanReviewLens_Order, ReviewVerdict_Pass, "fine")
	verdict(t, ctx, dag.OID, PlanReviewLens_Full, ReviewVerdict_Fail, fullText)
	verdict(t, ctx, dag.OID, PlanReviewLens_Final, ReviewVerdict_Pass, "fine")
	want := "[Full review] " + fullText + "\n\n[Tests and commands] " + testsText + "\n\nPassed: Spec coverage, Task order and files, Final coverage."
	pr := loadDag(t, ctx, dag.OID).PlanReview
	if pr.State != PlanReviewState_Failed || pr.Findings != want {
		t.Fatalf("want the attributed list whole, got state %s findings %q", pr.State, pr.Findings)
	}
	rows := planReviewedRows(f)
	if len(rows) != 1 || rows[0]["findings"] != want || rows[0]["state"] != PlanReviewState_Failed {
		t.Fatalf("want one failed event with the list whole, got %v", rows)
	}
	reviewers, _ := rows[0]["reviewers"].([]map[string]any)
	if len(reviewers) != len(planRoundOneLenses) || reviewers[3]["lens"] != PlanReviewLens_Tests || reviewers[3]["state"] != PlanReviewerState_Failed || reviewers[3]["text"] != testsText {
		t.Fatalf("the event lists each reviewer's verdict, got %v", rows[0]["reviewers"])
	}
	if joined := strings.Join(f.sends, "\n"); !strings.Contains(joined, planReviewFailedWake(1, want, false, false)) {
		t.Fatalf("the wake carries the list whole, got %q", f.sends)
	}
	if len(*handed) != 0 {
		t.Fatalf("a failed round hands nothing off, got %v", *handed)
	}
}

func TestPlanReviewLostLensIsDropped(t *testing.T) {
	ctx, dag := seedPlanReviewDag(t)
	captureSpawns(t)
	stubStopRunWorkers(t)
	f := newFakeLead(t)
	handed := stubLeadHandoff(t, ctx, dag)
	schedule(t, ctx, dag.OID)
	for _, lens := range []string{PlanReviewLens_Full, PlanReviewLens_Order, PlanReviewLens_Tests, PlanReviewLens_Final} {
		verdict(t, ctx, dag.OID, lens, ReviewVerdict_Pass, lens+" is fine")
	}
	loseReviewer(t, ctx, dag.OID, dag.ChannelId, PlanReviewLens_Spec)
	pr := loadDag(t, ctx, dag.OID).PlanReview
	if spec := reviewerOf(t, ctx, dag.OID, PlanReviewLens_Spec); spec.State != PlanReviewerState_Lost || spec.Text != "it ended without a verdict" {
		t.Fatalf("the lens is lost with why, got %+v", spec)
	}
	if want := "full is fine\nDid not finish: Spec coverage (it ended without a verdict)."; pr.State != PlanReviewState_Passed || pr.Findings != want {
		t.Fatalf("the round passes on the rest and names the lost lens, got %s %q", pr.State, pr.Findings)
	}
	if rows := planReviewedRows(f); len(rows) != 1 || rows[0]["state"] != PlanReviewState_Passed {
		t.Fatalf("want one passed event, got %v", rows)
	}
	if len(*handed) != 1 {
		t.Fatalf("want one handoff, got %v", *handed)
	}
}

func TestPlanReviewLostFullFailsTheRound(t *testing.T) {
	t.Run("every lens passed: the lost wake", func(t *testing.T) {
		ctx, dag := seedPlanReviewDag(t)
		captureSpawns(t)
		stubStopRunWorkers(t)
		f := newFakeLead(t)
		schedule(t, ctx, dag.OID)
		passLenses(t, ctx, dag.OID)
		loseReviewer(t, ctx, dag.OID, dag.ChannelId, PlanReviewLens_Full)
		pr := loadDag(t, ctx, dag.OID).PlanReview
		want := "[Full review] did not finish: it ended without a verdict\nPassed: Spec coverage, Task order and files, Tests and commands, Final coverage."
		if pr.State != PlanReviewState_Failed || pr.Findings != want {
			t.Fatalf("a lost full reviewer fails the round, got %s %q", pr.State, pr.Findings)
		}
		joined := strings.Join(f.sends, "\n")
		if !strings.Contains(joined, planReviewLostWake(1, "it ended without a verdict", false, false)) || strings.Contains(joined, "plan review failed in round") {
			t.Fatalf("with no findings the lead gets the lost wake, got %q", f.sends)
		}
		if rows := planReviewedRows(f); len(rows) != 1 {
			t.Fatalf("want one event, got %v", rows)
		}
	})
	t.Run("a lens failed too: the failed wake", func(t *testing.T) {
		ctx, dag := seedPlanReviewDag(t)
		captureSpawns(t)
		stubStopRunWorkers(t)
		f := newFakeLead(t)
		schedule(t, ctx, dag.OID)
		verdict(t, ctx, dag.OID, PlanReviewLens_Tests, ReviewVerdict_Fail, "Task 2 names no test")
		passLenses(t, ctx, dag.OID)
		loseReviewer(t, ctx, dag.OID, dag.ChannelId, PlanReviewLens_Full)
		pr := loadDag(t, ctx, dag.OID).PlanReview
		want := "[Tests and commands] Task 2 names no test\n\n[Full review] did not finish: it ended without a verdict\nPassed: Spec coverage, Task order and files, Final coverage."
		if pr.State != PlanReviewState_Failed || pr.Findings != want {
			t.Fatalf("got %s %q, want %q", pr.State, pr.Findings, want)
		}
		joined := strings.Join(f.sends, "\n")
		if !strings.Contains(joined, planReviewFailedWake(1, want, false, false)) || strings.Contains(joined, "the plan reviewer did not finish") {
			t.Fatalf("with findings the lead gets the failed wake, got %q", f.sends)
		}
	})
}

func TestPlanReviewLensPickIsRefused(t *testing.T) {
	ctx, dag := seedPlanReviewDag(t)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks, g.ReviewerPicks = picksTasks(), true
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	captureSpawns(t)
	newFakeLead(t)
	schedule(t, ctx, dag.OID)
	before := loadDag(t, ctx, dag.OID)
	spec := reviewerOf(t, ctx, dag.OID, PlanReviewLens_Spec)
	err := RecordPlanReviewVerdict(ctx, dag.OID, spec.RunID, ReviewVerdict_Pass, "fine", goodPicks())
	if err == nil || err.Error() != "only the full reviewer picks models; send the verdict without --pick" {
		t.Fatalf("want the lens's picks refused, got %v", err)
	}
	after := loadDag(t, ctx, dag.OID)
	if fmt.Sprint(after.PlanReview.Reviewers) != fmt.Sprint(before.PlanReview.Reviewers) || fmt.Sprint(after.Tasks) != fmt.Sprint(before.Tasks) {
		t.Fatalf("a refused verdict changes nothing, got %+v", after.PlanReview.Reviewers)
	}
	// without picks the lens's pass is taken, and the full reviewer's picks apply as before
	verdict(t, ctx, dag.OID, PlanReviewLens_Spec, ReviewVerdict_Pass, "fine")
	passLenses(t, ctx, dag.OID)
	if err := RecordPlanReviewVerdict(ctx, dag.OID, reviewerOf(t, ctx, dag.OID, PlanReviewLens_Full).RunID, ReviewVerdict_Pass, "fine", goodPicks()); err != nil {
		t.Fatal(err)
	}
	g := loadDag(t, ctx, dag.OID)
	if g.PlanReview.State != PlanReviewState_Passed || taskByID(g, "t-1").ModelSource != waveobj.TaskModelSource_Reviewer {
		t.Fatalf("want passed with the full reviewer's picks, got %+v", g.PlanReview)
	}
}

func TestPlanReviewReplacedReviewerVerdictIsRefused(t *testing.T) {
	ctx, dag := seedPlanReviewDag(t)
	captureSpawns(t)
	stubStopRunWorkers(t)
	newFakeLead(t)
	schedule(t, ctx, dag.OID)
	old := reviewerOf(t, ctx, dag.OID, PlanReviewLens_Order).RunID
	endRun(t, ctx, dag.ChannelId, old)
	schedule(t, ctx, dag.OID)
	before := loadDag(t, ctx, dag.OID).PlanReview
	replacement := reviewerOf(t, ctx, dag.OID, PlanReviewLens_Order)
	if replacement.RunID == old || replacement.State != PlanReviewerState_Reviewing {
		t.Fatalf("want a replacement, got %+v", replacement)
	}
	err := RecordPlanReviewVerdict(ctx, dag.OID, old, ReviewVerdict_Fail, "late findings", nil)
	if err == nil || err.Error() != fmt.Sprintf("run %s is not reviewing this dag's plan", old) {
		t.Fatalf("the replaced session's verdict is refused, got %v", err)
	}
	if after := loadDag(t, ctx, dag.OID).PlanReview; fmt.Sprint(after) != fmt.Sprint(before) {
		t.Fatalf("a refused verdict changes nothing, got %+v", after)
	}
	verdict(t, ctx, dag.OID, PlanReviewLens_Order, ReviewVerdict_Pass, "fine")
}

// the last two verdicts land at the same moment: the dag mutation lock lets one of them settle the round
func TestPlanReviewSettlesOnce(t *testing.T) {
	ctx, dag := seedPlanReviewDag(t)
	captureSpawns(t)
	f := newFakeLead(t)
	handed := stubLeadHandoff(t, ctx, dag)
	schedule(t, ctx, dag.OID)
	for _, lens := range planRoundOneLenses[:3] {
		verdict(t, ctx, dag.OID, lens, ReviewVerdict_Pass, "fine")
	}
	last := []waveobj.PlanReviewer{reviewerOf(t, ctx, dag.OID, PlanReviewLens_Tests), reviewerOf(t, ctx, dag.OID, PlanReviewLens_Final)}
	var wg sync.WaitGroup
	errs := make([]error, len(last))
	for i, r := range last {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs[i] = RecordPlanReviewVerdict(ctx, dag.OID, r.RunID, ReviewVerdict_Pass, "fine", nil)
		}()
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if rows := planReviewedRows(f); len(rows) != 1 || len(*handed) != 1 {
		t.Fatalf("want one event and one handoff, got %v and %v", rows, *handed)
	}
	schedule(t, ctx, dag.OID)
	if rows := planReviewedRows(f); len(rows) != 1 {
		t.Fatalf("the next tick settles nothing again, got %v", rows)
	}
}

// after a restart the stored stage is all there is: the tick tends only the reviewers with no verdict yet
func TestPlanReviewResumesMixedStates(t *testing.T) {
	ctx, dag := seedPlanReviewDag(t)
	calls := captureSpawns(t)
	newFakeLead(t)
	stored := []waveobj.PlanReviewer{
		{Lens: PlanReviewLens_Full, State: PlanReviewerState_Passed, Text: "fine", RunID: "gone-full", StartedTs: 1},
		{Lens: PlanReviewLens_Spec, State: PlanReviewerState_Passed, Text: "fine", RunID: "gone-spec", StartedTs: 1},
		{Lens: PlanReviewLens_Order, State: PlanReviewerState_Reviewing},
		{Lens: PlanReviewLens_Tests, State: PlanReviewerState_Reviewing},
		{Lens: PlanReviewLens_Final, State: PlanReviewerState_Reviewing},
	}
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.PlanReview.Reviewers = stored
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	schedule(t, ctx, dag.OID)
	if len(*calls) != 3 {
		t.Fatalf("want the three reviewing ones started, got %d spawns", len(*calls))
	}
	for _, c := range *calls {
		if !strings.Contains(c.prompt, "You are one of 5 plan reviewers") {
			t.Fatalf("only lens reviewers start, got %q", c.opts.Label)
		}
	}
	pr := loadDag(t, ctx, dag.OID).PlanReview
	for i, r := range pr.Reviewers {
		switch {
		case i < 2 && (r.State != PlanReviewerState_Passed || r.RunID != stored[i].RunID || r.Respawns != 0):
			t.Fatalf("a passed reviewer is left alone, got %+v", r)
		case i >= 2 && (r.State != PlanReviewerState_Reviewing || r.RunID == ""):
			t.Fatalf("a reviewing one is started, got %+v", r)
		}
	}
	if pr.State != PlanReviewState_Reviewing {
		t.Fatalf("the round is still out, got %s", pr.State)
	}
}

// a stage stored before reviewers existed has the old session's run id and no reviewers
func TestPlanReviewOldShapeStartsReviewers(t *testing.T) {
	ctx, dag := seedPlanReviewDag(t)
	calls := captureSpawns(t)
	newFakeLead(t)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		return json.Unmarshal([]byte(`{"state":"reviewing","round":1,"runid":"legacy-run","startedts":1}`), g.PlanReview)
	}); err != nil {
		t.Fatal(err)
	}
	schedule(t, ctx, dag.OID)
	pr := loadDag(t, ctx, dag.OID).PlanReview
	if len(*calls) != len(planRoundOneLenses) || len(pr.Reviewers) != len(planRoundOneLenses) {
		t.Fatalf("want the round's five reviewers, got %d spawns and %+v", len(*calls), pr.Reviewers)
	}
	if err := RecordPlanReviewVerdict(ctx, dag.OID, "legacy-run", ReviewVerdict_Pass, "fine", nil); err == nil || !strings.Contains(err.Error(), "is not reviewing") {
		t.Fatalf("the old session's verdict is refused, got %v", err)
	}
}

func TestAcceptPlanReviewClearsDocsAndHandsOff(t *testing.T) {
	ctx, dag := seedPlanReviewDag(t)
	writePlanReviewDocs(t, ctx, dag)
	captureSpawns(t)
	newFakeLead(t)
	handed := stubLeadHandoff(t, ctx, dag)
	reviewer := startPlanReview(t, ctx, dag.OID)
	if err := RecordPlanReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Fail, "no task for 4.1", nil); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.PlanReview.Prior = &waveobj.PlanReviewPrior{Findings: "round 0"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if pr := loadDag(t, ctx, dag.OID).PlanReview; pr.PlanText == "" || pr.SpecText == "" || len(*handed) != 0 {
		t.Fatalf("a failed round keeps its docs for the resubmit and hands nothing off, got %+v and %v", pr, *handed)
	}
	if err := AcceptPlanReview(ctx, dag.OID, "the human said go"); err != nil {
		t.Fatal(err)
	}
	pr := loadDag(t, ctx, dag.OID).PlanReview
	if pr.State != PlanReviewState_Accepted || pr.PlanText != "" || pr.SpecText != "" || pr.Prior != nil {
		t.Fatalf("accept clears the docs, got %+v", pr)
	}
	if len(*handed) != 1 {
		t.Fatalf("want one handoff, got %v", *handed)
	}
}

// the round's event lists the picks off the tasks, so a lens's verdict that settles the round still carries them
func TestPlanReviewEventPicksComeFromTheTasks(t *testing.T) {
	g := &waveobj.TaskGroup{Tasks: picksTasks()}
	applyPicks(g, goodPicks())
	if got := reviewerPicks(g); fmt.Sprint(got) != fmt.Sprint(goodPicks()) {
		t.Fatalf("got %+v, want %+v", got, goodPicks())
	}
	if got := reviewerPicks(&waveobj.TaskGroup{Tasks: picksTasks()}); got != nil {
		t.Fatalf("no picks, got %+v", got)
	}
}
