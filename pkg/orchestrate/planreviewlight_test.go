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
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// lightPlan is a fast-track plan: its header prose is the lead's reasoning, which the light pack leaves out.
const lightPlan = "# Coupons\n\nLEAD-REASONING: the lead weighed two stores and chose the cheap one.\n\n" +
	"**Verify:** `go test ./pkg/coupons`\n\n" +
	"### Task 1: the coupon field\n**Files:** `pkg/coupons/field.go`, `pkg/coupons/new.go`\nadd the coupon field to the order\n\n" +
	"### Task 2: the checkout line\n**Depends on:** Task 1 (reads the coupon field)\n**Files:** `pkg/coupons/checkout.go`\nshow the coupon at checkout\n"

const lightSpec = "# Spec\n\nSPEC-TEXT: a coupon takes 10% off.\n"

// seedLightDag is a fast-track dag submitted from lightPlan: its plan and spec are in the landing tree, with one of
// the files its tasks name, and its plan review is open with nothing run.
func seedLightDag(t *testing.T) (context.Context, *waveobj.TaskGroup) {
	t.Helper()
	ctx, dag := seedPlanReviewDag(t)
	plan, err := jarvis.ParsePlan(lightPlan)
	if err != nil {
		t.Fatal(err)
	}
	owner := dagOwner(t, ctx, dag)
	for rel, text := range map[string]string{
		"docs/superpowers/plans/p.md": lightPlan,
		"docs/superpowers/specs/s.md": lightSpec,
		"pkg/coupons/field.go":        "package coupons\n\n// FIELD-CONTENT\n",
	} {
		writeTreeFile(t, owner.ProjectPath, rel, text)
	}
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks, g.Verify, g.Preamble, g.FastTrack = plan.Tasks, plan.Verify, plan.Preamble, true
		for i := range g.Tasks {
			g.Tasks[i].State = TaskState_Pending
		}
		RecomputeDagStatus(g)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return ctx, dag
}

func writeTreeFile(t *testing.T, tree, rel, text string) {
	t.Helper()
	path := filepath.Join(tree, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

// lightReviewer is the round's light reviewer still reviewing, the one a verdict or a loss applies to.
func lightReviewer(t *testing.T, ctx context.Context, dagID string) waveobj.PlanReviewer {
	t.Helper()
	for _, r := range loadDag(t, ctx, dagID).PlanReview.Reviewers {
		if r.Lens == PlanReviewLens_Light && r.State == PlanReviewerState_Reviewing {
			return r
		}
	}
	t.Fatal("the round has no light reviewer reviewing")
	return waveobj.PlanReviewer{}
}

// loseLightReviewer ends the reviewing light reviewer's session until it is lost, ticking after each end.
func loseLightReviewer(t *testing.T, ctx context.Context, dagID, channelId string) {
	t.Helper()
	for range MaxReviewRespawns + 1 {
		endRun(t, ctx, channelId, lightReviewer(t, ctx, dagID).RunID)
		schedule(t, ctx, dagID)
	}
}

// failLightRound starts the light round and records its reviewer's fail.
func failLightRound(t *testing.T, ctx context.Context, dagID string) {
	t.Helper()
	schedule(t, ctx, dagID)
	if err := RecordPlanReviewVerdict(ctx, dagID, lightReviewer(t, ctx, dagID).RunID, ReviewVerdict_Fail, "Task 2 names no scenario step", nil); err != nil {
		t.Fatal(err)
	}
}

// proposalOf is a resubmitted plan of n tasks.
func proposalOf(n int) *waveobj.TaskGroup {
	p := &waveobj.TaskGroup{Title: "revised", Parallelism: 1, PlanPath: "docs/superpowers/plans/p.md"}
	for i := 1; i <= n; i++ {
		p.Tasks = append(p.Tasks, waveobj.TaskNode{ID: fmt.Sprintf("t-%d", i), Label: fmt.Sprintf("task %d", i), State: TaskState_Pending})
	}
	return p
}

func TestLightRoundStartsOneReviewerOnItsRoute(t *testing.T) {
	haiku := &waveobj.RoutePin{Runtime: "claude", Model: "haiku"}
	for _, c := range []struct {
		name   string
		picks  bool
		light  *waveobj.RoutePin
		onFull bool // the reviewer route, as the full reviewer runs
		want   waveobj.RoutePin
	}{
		{"no Light reviewers route", false, nil, false, LightPickRoute},
		{"a Light reviewers route", false, haiku, false, *haiku},
		{"Reviewer picks", true, haiku, true, waveobj.RoutePin{}},
	} {
		t.Run(c.name, func(t *testing.T) {
			ctx, dag := seedLightDag(t)
			if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
				g.ReviewerPicks, g.LightReviewerRoute = c.picks, c.light
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			calls := captureSpawns(t)
			newFakeLead(t)
			schedule(t, ctx, dag.OID)
			g := loadDag(t, ctx, dag.OID)
			pr := g.PlanReview
			if len(*calls) != 1 || len(pr.Reviewers) != 1 || pr.Reviewers[0].Lens != PlanReviewLens_Light || g.Tasks[0].RunID != "" {
				t.Fatalf("want one light reviewer and no worker, got %d spawns and %+v", len(*calls), pr.Reviewers)
			}
			want := c.want
			if c.onFull {
				want = reviewerRoute(dagOwner(t, ctx, g), g)
			}
			run, err := wstore.GetRun(ctx, g.ChannelId, pr.Reviewers[0].RunID)
			if err != nil {
				t.Fatal(err)
			}
			if run.StageRole != jarvis.UsageRole_PlanReviewer || run.Runtime != want.Runtime || run.Model != want.Model {
				t.Fatalf("the light reviewer runs as %q on %s/%s, want plan-reviewer on %s/%s", run.StageRole, run.Runtime, run.Model, want.Runtime, want.Model)
			}
		})
	}
}

func TestLightReviewPicksOnlyOnReviewerPicks(t *testing.T) {
	picks := []wshrpc.DagModelPick{
		{TaskId: "t-1", Model: PickModel_Sonnet, Reason: "a field threaded through"},
		{TaskId: "t-2", Model: PickModel_Lead, Reason: "the checkout line is a design choice"},
	}
	start := func(t *testing.T, reviewerPicks bool) (context.Context, *waveobj.TaskGroup, string) {
		ctx, dag := seedLightDag(t)
		if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
			g.ReviewerPicks = reviewerPicks
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		captureSpawns(t)
		newFakeLead(t)
		schedule(t, ctx, dag.OID)
		return ctx, dag, lightReviewer(t, ctx, dag.OID).RunID
	}
	t.Run("on Reviewer picks a pass needs a pick per task", func(t *testing.T) {
		ctx, dag, reviewer := start(t, true)
		if err := RecordPlanReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Pass, "fine", nil); err == nil || !strings.Contains(err.Error(), "no pick for t-1, t-2") {
			t.Fatalf("a pass without picks must be refused, got %v", err)
		}
		if err := RecordPlanReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Pass, "fine", picks); err != nil {
			t.Fatal(err)
		}
		if g := loadDag(t, ctx, dag.OID); g.PlanReview.State != PlanReviewState_Passed || taskByID(g, "t-1").ModelSource != waveobj.TaskModelSource_Reviewer {
			t.Fatalf("the pass applies its picks, got %+v", g.PlanReview)
		}
	})
	t.Run("off Reviewer picks a pick is refused", func(t *testing.T) {
		ctx, dag, reviewer := start(t, false)
		if err := RecordPlanReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Pass, "fine", picks); err == nil || !strings.Contains(err.Error(), "not on Reviewer picks") {
			t.Fatalf("a pick off Reviewer picks must be refused, got %v", err)
		}
		if err := RecordPlanReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Pass, "fine", nil); err != nil {
			t.Fatal(err)
		}
	})
}

func TestLightBriefIsTheCodeBuiltPack(t *testing.T) {
	ctx, dag := seedLightDag(t)
	calls := captureSpawns(t)
	newFakeLead(t)
	schedule(t, ctx, dag.OID)
	g := loadDag(t, ctx, dag.OID)
	owner := dagOwner(t, ctx, g)
	prompt := (*calls)[0].prompt
	if !strings.HasPrefix(prompt, planReviewerOpener) {
		t.Errorf("the light brief must open as a plan reviewer's, so a launch is placed as one:\n%s", prompt)
	}
	for _, want := range []string{
		g.Tasks[0].Description,
		g.Tasks[1].Description,
		"- t-2 waits for t-1\n",
		"SPEC-TEXT: a coupon takes 10% off.",
		"// FIELD-CONTENT",
		"go test ./pkg/coupons",
		"pkg/coupons/new.go " + lightPackNewFile,
		planReviewScenarioItem,
		planReviewSameFileItem,
		planReviewDependsReasonItem,
		planReviewCallersItem,
		planReviewFilesCoverageItem,
		planReviewSpecGap,
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("the light brief must hold %q:\n%s", want, prompt)
		}
	}
	for _, leaked := range []string{"LEAD-REASONING", "p.md", filepath.Join(owner.ProjectPath, "docs")} {
		if strings.Contains(prompt, leaked) {
			t.Errorf("the light brief must not hold %q:\n%s", leaked, prompt)
		}
	}
	// the checklist items the light review leaves to the full one stay out
	for _, left := range []string{planReviewChecklist[0], planReviewChecklist[4], planReviewManifestItem} {
		if strings.Contains(prompt, left) {
			t.Errorf("the light brief must not hold the full checklist's %q", left)
		}
	}
}

// the spec is the design the plan answers to: with none, a prototype's canvas stands in, and with neither the brief says so
func TestLightPackNamesTheDesignItAnswersTo(t *testing.T) {
	for _, c := range []struct {
		name      string
		spec      string
		specText  string
		prototype string
		want      string
		notWant   string
	}{
		{"a spec read", "docs/superpowers/specs/s.md", "SPEC-BODY\n", "", "The spec:\n\nSPEC-BODY\n", "could not be read"},
		{"a spec that could not be read", "docs/superpowers/specs/s.md", "", "", "The spec could not be read; report that as a finding.", "The spec:"},
		{"a prototype and no spec", "", "", "mock.dc.html", "the design canvas at ", "The spec"},
		{"neither", "", "", "", "There is no spec file.\n", "design canvas"},
	} {
		t.Run(c.name, func(t *testing.T) {
			g := &waveobj.TaskGroup{SpecPath: c.spec, Prototype: c.prototype, PlanReview: &waveobj.PlanReviewStage{SpecText: c.specText}}
			var b strings.Builder
			writeLightDesign(&b, g, t.TempDir())
			if got := b.String(); !strings.Contains(got, c.want) || strings.Contains(got, c.notWant) {
				t.Fatalf("want %q and not %q, got:\n%s", c.want, c.notWant, got)
			}
		})
	}
}

func TestLightPackCutsAtItsCaps(t *testing.T) {
	numbered := func(n int) string {
		var b strings.Builder
		for i := 1; i <= n; i++ {
			fmt.Fprintf(&b, "line %d\n", i)
		}
		return b.String()
	}
	t.Run("a file over its cap", func(t *testing.T) {
		tree := t.TempDir()
		writeTreeFile(t, tree, "big.go", numbered(lightPackFileLines+5))
		var b strings.Builder
		writeLightFiles(&b, tree, []string{"big.go"}, lightPackLines)
		got := b.String()
		if !strings.Contains(got, fmt.Sprintf("line %d\n", lightPackFileLines)) || strings.Contains(got, fmt.Sprintf("line %d\n", lightPackFileLines+1)) {
			t.Fatalf("the file must stop at line %d:\n%s", lightPackFileLines, got[len(got)-300:])
		}
		if !strings.Contains(got, fmt.Sprintf(lightPackCut, 5, "big.go")) {
			t.Fatalf("the cut must name the path and what was left out:\n%s", got[len(got)-300:])
		}
	})
	t.Run("the pack's budget", func(t *testing.T) {
		tree := t.TempDir()
		writeTreeFile(t, tree, "a.go", numbered(30))
		writeTreeFile(t, tree, "b.go", numbered(30))
		var b strings.Builder
		writeLightFiles(&b, tree, []string{"a.go", "b.go"}, 40)
		got := b.String()
		if !strings.Contains(got, "line 30\n") || !strings.Contains(got, fmt.Sprintf(lightPackCut, 20, "b.go")) {
			t.Fatalf("a.go fits whole and b.go gets the budget's last 10 lines, with 20 left out:\n%s", got)
		}
	})
}

// a Files line may name a directory: the pack says so, since reading it as a file fails with a message that means nothing to a reviewer
func TestLightPackNamesADirectoryEntryAndAMissingFile(t *testing.T) {
	tree := t.TempDir()
	if err := os.MkdirAll(filepath.Join(tree, "pkg", "coupons"), 0o755); err != nil {
		t.Fatal(err)
	}
	var b strings.Builder
	writeLightFiles(&b, tree, []string{"pkg/coupons", "pkg/gone.go"}, lightPackLines)
	want := "--- pkg/coupons (a directory: list it in the tree)\n--- pkg/gone.go " + lightPackNewFile + "\n"
	if b.String() != want {
		t.Fatalf("got %q, want %q", b.String(), want)
	}
	b.Reset()
	writeLightFiles(&b, tree, nil, lightPackLines)
	if b.String() != "(none)\n" {
		t.Fatalf("a plan with no Files lines says so, got %q", b.String())
	}
}

func TestLightPassDispatchesAndAFailWakesTheLead(t *testing.T) {
	t.Run("pass", func(t *testing.T) {
		ctx, dag := seedLightDag(t)
		captureSpawns(t)
		newFakeLead(t)
		schedule(t, ctx, dag.OID)
		if err := RecordPlanReviewVerdict(ctx, dag.OID, lightReviewer(t, ctx, dag.OID).RunID, ReviewVerdict_Pass, "fine", nil); err != nil {
			t.Fatal(err)
		}
		schedule(t, ctx, dag.OID)
		if g := loadDag(t, ctx, dag.OID); g.PlanReview.State != PlanReviewState_Passed || g.Tasks[0].RunID == "" {
			t.Fatalf("a light pass dispatches, got %+v with t-1 run %q", g.PlanReview, g.Tasks[0].RunID)
		}
	})
	t.Run("fail", func(t *testing.T) {
		ctx, dag := seedLightDag(t)
		captureSpawns(t)
		f := newFakeLead(t)
		failLightRound(t, ctx, dag.OID)
		g := loadDag(t, ctx, dag.OID)
		want := "[Light review] Task 2 names no scenario step"
		if g.PlanReview.State != PlanReviewState_Failed || g.PlanReview.Findings != want || g.Tasks[0].RunID != "" {
			t.Fatalf("a light fail holds dispatch with its findings, got %+v", g.PlanReview)
		}
		if !strings.Contains(strings.Join(f.sends, "\n"), lightReviewFailedWake(want, false)) {
			t.Fatalf("the lead must get the light failed wake, got %q", f.sends)
		}
	})
}

func TestAmendedResubmitAfterALightFailDispatches(t *testing.T) {
	ctx, dag := seedLightDag(t)
	captureSpawns(t)
	f := newFakeLead(t)
	handed := stubLeadHandoff(t, ctx, dag)
	failLightRound(t, ctx, dag.OID)
	g, err := ReplacePlanReviewProposal(ctx, dag.OID, proposalOf(jarvis.FastTrackMaxTasks))
	if err != nil {
		t.Fatal(err)
	}
	pr := g.PlanReview
	if pr.State != PlanReviewState_Accepted || !pr.Amended || pr.Round != 1 || len(pr.Reviewers) != 1 || !g.FastTrack || len(g.Tasks) != jarvis.FastTrackMaxTasks {
		t.Fatalf("want round 1 accepted as amended with the new tasks, got fasttrack %v, %d tasks, %+v", g.FastTrack, len(g.Tasks), pr)
	}
	rows := planReviewedRows(f)
	if last := rows[len(rows)-1]; last["state"] != PlanReviewState_Accepted || last["amended"] != true {
		t.Fatalf("the amendment records an accepted plan-reviewed event with amended, got %v", rows)
	}
	if len(*handed) != 1 {
		t.Fatalf("the amended plan hands the lead its compaction, got %v", *handed)
	}
	schedule(t, ctx, dag.OID)
	if g := loadDag(t, ctx, dag.OID); g.Tasks[0].RunID == "" {
		t.Fatal("the amended plan dispatches")
	}
}

func TestAcceptAfterALightFailIsNotAnAmendment(t *testing.T) {
	ctx, dag := seedLightDag(t)
	captureSpawns(t)
	newFakeLead(t)
	failLightRound(t, ctx, dag.OID)
	if err := AcceptPlanReview(ctx, dag.OID, "the human said go"); err != nil {
		t.Fatal(err)
	}
	schedule(t, ctx, dag.OID)
	g := loadDag(t, ctx, dag.OID)
	if g.PlanReview.State != PlanReviewState_Accepted || g.PlanReview.Amended || g.Tasks[0].RunID == "" {
		t.Fatalf("accept dispatches the plan unchanged, not as amended, got %+v", g.PlanReview)
	}
}

// a light round does not count toward MaxPlanReviewRounds: past it, the full review still gets its follow-up
func TestResubmitPastFastTrackTakesTheFullReview(t *testing.T) {
	ctx, dag := seedLightDag(t)
	captureSpawns(t)
	newFakeLead(t)
	failLightRound(t, ctx, dag.OID)
	g, err := ReplacePlanReviewProposal(ctx, dag.OID, proposalOf(jarvis.FastTrackMaxTasks+1))
	if err != nil {
		t.Fatal(err)
	}
	if g.FastTrack || g.PlanReview.State != PlanReviewState_Reviewing || g.PlanReview.Prior != nil || g.PlanReview.Amended {
		t.Fatalf("want the fast track cleared and a fresh full round, got fasttrack %v and %+v", g.FastTrack, g.PlanReview)
	}
	schedule(t, ctx, dag.OID)
	var lenses []string
	for _, r := range loadDag(t, ctx, dag.OID).PlanReview.Reviewers {
		lenses = append(lenses, r.Lens)
	}
	if strings.Join(lenses, ",") != strings.Join(planRoundOneLenses, ",") {
		t.Fatalf("want the full review and the second pass, got %v", lenses)
	}
	verdict(t, ctx, dag.OID, PlanReviewLens_Full, ReviewVerdict_Fail, "spec 4.1 has no task")
	passLenses(t, ctx, dag.OID)
	if err := PlanReviewRoundsSpent(loadDag(t, ctx, dag.OID)); err != nil {
		t.Fatalf("the light round must not count toward the limit: %v", err)
	}
	g, err = ReplacePlanReviewProposal(ctx, dag.OID, proposalOf(jarvis.FastTrackMaxTasks+1))
	if err != nil {
		t.Fatal(err)
	}
	if g.PlanReview.Prior == nil {
		t.Fatalf("the full round's fail gets the follow-up, got %+v", g.PlanReview)
	}
	schedule(t, ctx, dag.OID)
	verdict(t, ctx, dag.OID, PlanReviewLens_Followup, ReviewVerdict_Fail, "still no task for 4.1")
	if err := PlanReviewRoundsSpent(loadDag(t, ctx, dag.OID)); err == nil {
		t.Fatal("the follow-up's fail is the last round")
	}
}

func TestLostLightReviewerIsReplacedInTheSameRound(t *testing.T) {
	ctx, dag := seedLightDag(t)
	calls := captureSpawns(t)
	stubStopRunWorkers(t)
	f := newFakeLead(t)
	schedule(t, ctx, dag.OID)
	loseLightReviewer(t, ctx, dag.OID, dag.ChannelId)
	pr := loadDag(t, ctx, dag.OID).PlanReview
	if pr.State != PlanReviewState_Reviewing || len(pr.Reviewers) != 2 || pr.Reviewers[0].State != PlanReviewerState_Lost || pr.Reviewers[1].RunID == "" {
		t.Fatalf("a lost light reviewer gets a fresh one in the round, got %+v", pr)
	}
	loseLightReviewer(t, ctx, dag.OID, dag.ChannelId)
	loseLightReviewer(t, ctx, dag.OID, dag.ChannelId)
	pr = loadDag(t, ctx, dag.OID).PlanReview
	if pr.State != PlanReviewState_Failed || len(pr.Reviewers) != MaxLightReviewers || pr.Round != 1 {
		t.Fatalf("the round settles after %d losses, got %+v", MaxLightReviewers, pr)
	}
	spawned := len(*calls)
	schedule(t, ctx, dag.OID)
	if len(*calls) != spawned {
		t.Fatal("no light reviewer may start past the cap")
	}
	if !strings.Contains(strings.Join(f.sends, "\n"), lightReviewLostWake("it ended without a verdict")) {
		t.Fatalf("the lead must get the light lost wake, got %q", f.sends)
	}
	g, err := ReplacePlanReviewProposal(ctx, dag.OID, proposalOf(len(loadDag(t, ctx, dag.OID).Tasks)))
	if err != nil {
		t.Fatal(err)
	}
	if g.PlanReview.State != PlanReviewState_Reviewing || g.PlanReview.Round != 2 || g.PlanReview.Amended || !g.FastTrack {
		t.Fatalf("a resubmit after the losses opens a new light round, got %+v", g.PlanReview)
	}
	schedule(t, ctx, dag.OID)
	if r := lightReviewer(t, ctx, dag.OID); r.RunID == "" {
		t.Fatal("the new round's light reviewer starts")
	}
}

// a replacement that passes settles the round as a pass, and the loss is named in its summary
func TestLostLightReviewerReplacementCanPassTheRound(t *testing.T) {
	ctx, dag := seedLightDag(t)
	captureSpawns(t)
	stubStopRunWorkers(t)
	newFakeLead(t)
	schedule(t, ctx, dag.OID)
	loseLightReviewer(t, ctx, dag.OID, dag.ChannelId)
	if err := RecordPlanReviewVerdict(ctx, dag.OID, lightReviewer(t, ctx, dag.OID).RunID, ReviewVerdict_Pass, "fine", nil); err != nil {
		t.Fatal(err)
	}
	pr := loadDag(t, ctx, dag.OID).PlanReview
	if want := "fine\nDid not finish: Light review (it ended without a verdict)."; pr.State != PlanReviewState_Passed || pr.Findings != want {
		t.Fatalf("a replacement's pass passes the round, got %q: %q", pr.State, pr.Findings)
	}
}

// light rounds are the lens's only record, and they stay out of the count that ends the review
func TestPlanReviewLastRoundSkipsLightRounds(t *testing.T) {
	light := []waveobj.PlanReviewer{{Lens: PlanReviewLens_Light}}
	full := []waveobj.PlanReviewer{{Lens: PlanReviewLens_Full}, {Lens: PlanReviewLens_Second}}
	followup := []waveobj.PlanReviewer{{Lens: PlanReviewLens_Followup}}
	pastLight := waveobj.PlanReviewRound{Round: 1, Reviewers: light}
	pastFull := waveobj.PlanReviewRound{Round: 1, Reviewers: full}
	for _, c := range []struct {
		name      string
		pr        *waveobj.PlanReviewStage
		wantLight bool
		wantLast  bool
	}{
		{"no review", nil, false, false},
		{"a light round 1", &waveobj.PlanReviewStage{Round: 1, Reviewers: light}, true, false},
		{"a light round after light rounds", &waveobj.PlanReviewStage{Round: 3, Reviewers: light, PastRounds: []waveobj.PlanReviewRound{pastLight, {Round: 2, Reviewers: light}}}, true, false},
		{"full round 1", &waveobj.PlanReviewStage{Round: 1, Reviewers: full}, false, false},
		{"full round 2", &waveobj.PlanReviewStage{Round: 2, Reviewers: followup, PastRounds: []waveobj.PlanReviewRound{pastFull}}, false, true},
		{"the first full round after a light one", &waveobj.PlanReviewStage{Round: 2, Reviewers: full, PastRounds: []waveobj.PlanReviewRound{pastLight}}, false, false},
		{"the full follow-up after a light one", &waveobj.PlanReviewStage{Round: 3, Reviewers: followup, PastRounds: []waveobj.PlanReviewRound{pastLight, {Round: 2, Reviewers: full}}}, false, true},
		{"a stored round that has no reviewers", &waveobj.PlanReviewStage{Round: MaxPlanReviewRounds}, false, true},
	} {
		t.Run(c.name, func(t *testing.T) {
			if got := PlanReviewRoundLight(c.pr); got != c.wantLight {
				t.Errorf("PlanReviewRoundLight = %v, want %v", got, c.wantLight)
			}
			if got := PlanReviewLastRound(c.pr); got != c.wantLast {
				t.Errorf("PlanReviewLastRound = %v, want %v", got, c.wantLast)
			}
		})
	}
}

// a replacement lead of a failed light round is told its amended resubmit dispatches, and is never told it was the last round
func TestLeadAwaitedWakeOnAFailedLightRound(t *testing.T) {
	light := []waveobj.PlanReviewer{{Lens: PlanReviewLens_Light, State: PlanReviewerState_Failed}}
	lost := []waveobj.PlanReviewer{{Lens: PlanReviewLens_Light, State: PlanReviewerState_Lost}}
	failedLight := func(autonomous bool, reviewers []waveobj.PlanReviewer) *waveobj.TaskGroup {
		return &waveobj.TaskGroup{Status: DagStatus_PlanReview, Autonomous: autonomous, FastTrack: true,
			PlanReview: &waveobj.PlanReviewStage{State: PlanReviewState_Failed, Round: MaxPlanReviewRounds, Reviewers: reviewers}}
	}
	for _, autonomous := range []bool{false, true} {
		got := leadAwaitedWake(failedLight(autonomous, light))
		for _, want := range []string{
			"The light plan review did not pass",
			planReviewFindingsCmd,
			fmt.Sprintf("with %d tasks or fewer it dispatches with no second review", jarvis.FastTrackMaxTasks),
			"wsh jarvis dag planreview accept",
		} {
			if !strings.Contains(got, want) {
				t.Errorf("autonomous %v: want %q in %q", autonomous, want, got)
			}
		}
		if strings.Contains(got, "last round") {
			t.Errorf("autonomous %v: a light round is never the last: %q", autonomous, got)
		}
	}
	// no light reviewer gave findings, so the same plan goes again as a fresh light round
	got := leadAwaitedWake(failedLight(false, lost))
	if !strings.Contains(got, "`wsh jarvis dag submit`") || strings.Contains(got, "last round") || strings.Contains(got, "dispatches with no second review") {
		t.Errorf("a lost light round resubmits for a fresh review, got %q", got)
	}
}
