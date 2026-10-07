// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// picksTasks is a plan with two tasks for the reviewer to pick and one the plan pinned with a Model line.
func picksTasks() []waveobj.TaskNode {
	return []waveobj.TaskNode{
		{ID: "t-1", Label: "thread the field through", State: TaskState_Pending},
		{ID: "t-2", Label: "design the store", State: TaskState_Pending},
		{ID: "t-3", Label: "pinned by the plan", State: TaskState_Pending, RunSpec: waveobj.RunSpec{Model: "opus"}, ModelSource: waveobj.TaskModelSource_Plan},
	}
}

// seedPicksDag is a plan review dag with picksTasks, on Reviewer picks when picks is set, with its reviewer running.
func seedPicksDag(t *testing.T, picks bool) (context.Context, *waveobj.TaskGroup, string) {
	t.Helper()
	ctx, dag := seedPlanReviewDag(t)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks, g.ReviewerPicks = picksTasks(), picks
		RecomputeDagStatus(g)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	captureSpawns(t)
	newFakeLead(t)
	allowWorkerHarnessForTest(t)
	return ctx, dag, startPlanReview(t, ctx, dag.OID)
}

func goodPicks() []wshrpc.DagModelPick {
	return []wshrpc.DagModelPick{
		{TaskId: "t-1", Model: PickModel_Sonnet, Reason: "a field threaded through"},
		{TaskId: "t-2", Model: PickModel_Lead, Reason: "the store shape is a design choice"},
	}
}

func TestPlanReviewPromptAsksForPicks(t *testing.T) {
	g := &waveobj.TaskGroup{RunID: "run-1", PlanPath: "p.md", ReviewerPicks: true, Tasks: picksTasks()}
	prompt := planReviewPrompt(g, "tree")
	for _, want := range []string{
		"t-1: thread the field through",
		"t-2: design the store",
		"`sonnet` only for a mechanical, tightly specified task",
		"`lead` for anything with a design choice",
		`--pick "t-1=<sonnet|lead>: <one-line reason>" --pick "t-2=<sonnet|lead>: <one-line reason>"`,
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("the brief must contain %q:\n%s", want, prompt)
		}
	}
	if strings.Contains(prompt, "t-3") {
		t.Errorf("a task with a Model line is not the reviewer's to pick:\n%s", prompt)
	}
}

func TestPlanReviewPromptUnchangedWithoutPicks(t *testing.T) {
	g := &waveobj.TaskGroup{RunID: "run-1", SpecPath: "s.md", PlanPath: "p.md", Tasks: picksTasks()}
	want := "You are the plan reviewer for run run-1. Before any worker starts, judge whether the plan can be run as written.\n" +
		"Read the spec at " + DocPath(g, "tree", "s.md") + ", the plan at " + DocPath(g, "tree", "p.md") + ", and the files they name.\n" +
		"Check that:\n" +
		"- every requirement in the spec has a task;\n" +
		"- no two tasks edit the same file without a Depends between them, since tasks with nothing between them run at the same time. Submit already refused any path two such tasks both list on their Files lines, so look for what those lines leave out: a task with no Files line, and a file a task's text edits that its Files line omits;\n" +
		"- types, functions and flags have the same names in every task that mentions them;\n" +
		"- each task states its acceptance criteria and names the tests that prove them;\n" +
		"- the commands the plan names (its Verify, Setup, Check and Final lines, and those in its tasks) exist;\n" +
		"- the Final command checks the running app: every task that adds or changes a rendered view, a visual state (loading, empty, error, gone) or an interaction names in its acceptance the scenario step that shows that view or performs that interaction, and Final runs that scenario. A scenario that only opens the surface or panel the view sits in does not count. A check left to a person has no owner in a run, so a plan that leaves one is a finding.\n" +
		"Also report gaps in the spec, and places where the spec and the plan contradict each other.\n" +
		"Only read: never edit, stage or commit, and ask no questions, since nobody answers a reviewer.\n" +
		"Finish with exactly one command, which ends your session:\n" +
		"- `wsh jarvis dag planreview pass \"<summary>\"`;\n" +
		"- `wsh jarvis dag planreview fail \"<findings: each problem, where it is, and the fix>\"`.\n" +
		fmt.Sprintf("Keep the text within %d characters; a longer one is refused.", MaxReviewNoteLen)
	if got := planReviewPrompt(g, "tree"); got != want {
		t.Fatalf("a group not on Reviewer picks gets today's brief:\n%s\nwant:\n%s", got, want)
	}
	zero := &waveobj.TaskGroup{RunID: "run-1", SpecPath: "s.md", PlanPath: "p.md"}
	if planReviewPrompt(zero, "tree") != want {
		t.Fatal("the tasks must not change the brief of a group not on Reviewer picks")
	}
}

// a mockup-driven plan comes with no spec: the canvas is the design the reviewer checks the plan against
func TestPlanReviewPromptReadsTheCanvasWhenThereIsNoSpec(t *testing.T) {
	// absolute on the host, so the brief names it as is rather than inside the tree
	canvas := "/repo/.superpowers/design/x/board.dc.html"
	if runtime.GOOS == "windows" {
		canvas = "C:" + canvas
	}
	g := &waveobj.TaskGroup{RunID: "run-1", PlanPath: "p.md", Prototype: canvas}
	prompt := planReviewPrompt(g, "tree")
	if !strings.Contains(prompt, "There is no spec file: the design canvas at "+canvas+" is the spec. Read it, the plan at") {
		t.Fatalf("the brief must send the reviewer to the canvas:\n%s", prompt)
	}
	if !strings.Contains(prompt, "- every `.dc.html` board in the folder of "+canvas+" has a step in a scenario Final runs") {
		t.Fatalf("with a canvas the reviewer maps every board to a Final scenario step:\n%s", prompt)
	}
	bare := planReviewPrompt(&waveobj.TaskGroup{RunID: "run-1", PlanPath: "p.md"}, "tree")
	if !strings.Contains(bare, "There is no spec file. Read the plan at") {
		t.Fatalf("with neither spec nor canvas the brief reads the plan alone:\n%s", bare)
	}
	if strings.Contains(bare, "`.dc.html` board") {
		t.Fatalf("with no canvas there are no boards to map:\n%s", bare)
	}
}

func TestPlanReviewPassAppliesPicks(t *testing.T) {
	ctx, dag, reviewer := seedPicksDag(t, true)
	if err := RecordPlanReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Pass, "fine", goodPicks()); err != nil {
		t.Fatal(err)
	}
	g := loadDag(t, ctx, dag.OID)
	if g.PlanReview.State != PlanReviewState_Passed {
		t.Fatalf("want passed, got %+v", g.PlanReview)
	}
	t1, t2, t3 := taskByID(g, "t-1"), taskByID(g, "t-2"), taskByID(g, "t-3")
	if t1.RunSpec.Runtime != LightPickRoute.Runtime || t1.RunSpec.Model != LightPickRoute.Model ||
		t1.ModelSource != waveobj.TaskModelSource_Reviewer || t1.PickReason != "a field threaded through" {
		t.Fatalf("a sonnet pick puts the task on the light route, got %+v", t1)
	}
	if t2.RunSpec.Runtime != "" || t2.RunSpec.Model != "" ||
		t2.ModelSource != waveobj.TaskModelSource_Reviewer || t2.PickReason != "the store shape is a design choice" {
		t.Fatalf("a lead pick leaves the task on the lead's route, got %+v", t2)
	}
	if t3.RunSpec.Model != "opus" || t3.ModelSource != waveobj.TaskModelSource_Plan || t3.PickReason != "" {
		t.Fatalf("a task with a Model line keeps it, got %+v", t3)
	}
}

func TestPlanReviewPassRefusesBadPicks(t *testing.T) {
	with := func(edit func(p []wshrpc.DagModelPick) []wshrpc.DagModelPick) []wshrpc.DagModelPick {
		return edit(goodPicks())
	}
	cases := []struct {
		name    string
		picks   bool
		verdict string
		sent    []wshrpc.DagModelPick
		harness error
		want    string
	}{
		{"missing", true, ReviewVerdict_Pass, with(func(p []wshrpc.DagModelPick) []wshrpc.DagModelPick { return p[:1] }), nil, "t-2"},
		{"extra for a Model-line task", true, ReviewVerdict_Pass, with(func(p []wshrpc.DagModelPick) []wshrpc.DagModelPick {
			return append(p, wshrpc.DagModelPick{TaskId: "t-3", Model: PickModel_Lead, Reason: "x"})
		}), nil, "t-3"},
		{"unknown", true, ReviewVerdict_Pass, with(func(p []wshrpc.DagModelPick) []wshrpc.DagModelPick {
			return append(p, wshrpc.DagModelPick{TaskId: "t-9", Model: PickModel_Lead, Reason: "x"})
		}), nil, "t-9"},
		{"repeated", true, ReviewVerdict_Pass, with(func(p []wshrpc.DagModelPick) []wshrpc.DagModelPick { return append(p, p[0]) }), nil, "t-1"},
		{"bad model", true, ReviewVerdict_Pass, with(func(p []wshrpc.DagModelPick) []wshrpc.DagModelPick { p[0].Model = "opus"; return p }), nil, "opus"},
		{"empty reason", true, ReviewVerdict_Pass, with(func(p []wshrpc.DagModelPick) []wshrpc.DagModelPick { p[0].Reason = "  "; return p }), nil, "t-1"},
		{"multiline reason", true, ReviewVerdict_Pass, with(func(p []wshrpc.DagModelPick) []wshrpc.DagModelPick { p[0].Reason = "one\ntwo"; return p }), nil, "t-1"},
		{"overlong reason", true, ReviewVerdict_Pass, with(func(p []wshrpc.DagModelPick) []wshrpc.DagModelPick {
			p[0].Reason = strings.Repeat("é", MaxPickReasonLen+1)
			return p
		}), nil, "t-1"},
		{"sonnet the harness cannot run", true, ReviewVerdict_Pass, goodPicks(), errors.New("claude is not installed"), "pick lead"},
		{"picks on a non-picks group", false, ReviewVerdict_Pass, goodPicks(), nil, "Reviewer picks"},
		{"unknown on a fail", true, ReviewVerdict_Fail, with(func(p []wshrpc.DagModelPick) []wshrpc.DagModelPick {
			return append(p, wshrpc.DagModelPick{TaskId: "t-9", Model: PickModel_Lead, Reason: "x"})
		}), nil, "t-9"},
		{"picks on a failed non-picks group", false, ReviewVerdict_Fail, goodPicks(), nil, "Reviewer picks"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ctx, dag, reviewer := seedPicksDag(t, c.picks)
			before := loadDag(t, ctx, dag.OID).Tasks
			if c.harness != nil {
				validateWorkerHarness = func(string) error { return c.harness }
			}
			err := RecordPlanReviewVerdict(ctx, dag.OID, reviewer, c.verdict, "the text", c.sent)
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("want refused naming %q, got %v", c.want, err)
			}
			g := loadDag(t, ctx, dag.OID)
			if g.PlanReview.State != PlanReviewState_Reviewing || !reflect.DeepEqual(g.Tasks, before) {
				t.Fatalf("a refused verdict changes nothing, got %+v with tasks %+v", g.PlanReview, g.Tasks)
			}
		})
	}
}

// a fail may pick for only some tasks; the picks wait on the held tasks, and an accept dispatches on them
func TestPlanReviewFailKeepsItsPicksThroughAccept(t *testing.T) {
	ctx, dag, reviewer := seedPicksDag(t, true)
	var details []map[string]any
	old := appendRunEvent
	appendRunEvent = func(_ context.Context, _, _, kind string, _ *int, detail any) {
		if d, ok := detail.(map[string]any); ok && kind == waveobj.RunEventKindPlanReviewed {
			details = append(details, d)
		}
	}
	restoreAfterStages(t, func() { appendRunEvent = old })
	partial := goodPicks()[:1]
	if err := RecordPlanReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Fail, "the findings", partial); err != nil {
		t.Fatal(err)
	}
	if len(details) != 1 || details[0]["state"] != PlanReviewState_Failed || !reflect.DeepEqual(details[0]["picks"], partial) {
		t.Fatalf("the fail event must carry its picks, got %+v", details)
	}
	onLight := func(when string) {
		t.Helper()
		g := loadDag(t, ctx, dag.OID)
		t1, t2 := taskByID(g, "t-1"), taskByID(g, "t-2")
		if t1.RunSpec.Runtime != LightPickRoute.Runtime || t1.RunSpec.Model != LightPickRoute.Model || t1.ModelSource != waveobj.TaskModelSource_Reviewer {
			t.Fatalf("%s: the picked task is on the light route, got %+v", when, t1)
		}
		if t2.RunSpec.Model != "" || t2.ModelSource != "" || t2.PickReason != "" {
			t.Fatalf("%s: a task the fail left out stays on the lead, got %+v", when, t2)
		}
	}
	onLight("after the fail")
	if g := loadDag(t, ctx, dag.OID); g.PlanReview.State != PlanReviewState_Failed || !planReviewHolds(g) {
		t.Fatalf("a fail with picks still holds every worker, got %+v", g.PlanReview)
	}
	if err := AcceptPlanReview(ctx, dag.OID, "the human said to go on"); err != nil {
		t.Fatal(err)
	}
	onLight("after the accept")
	if g := loadDag(t, ctx, dag.OID); g.PlanReview.State != PlanReviewState_Accepted {
		t.Fatalf("want accepted, got %+v", g.PlanReview)
	}
}

func TestPlanReviewPassRecordsPicksEvent(t *testing.T) {
	ctx, dag, reviewer := seedPicksDag(t, true)
	var details []map[string]any
	old := appendRunEvent
	appendRunEvent = func(_ context.Context, _, _, kind string, _ *int, detail any) {
		if d, ok := detail.(map[string]any); ok && kind == waveobj.RunEventKindPlanReviewed {
			details = append(details, d)
		}
	}
	restoreAfterStages(t, func() { appendRunEvent = old })
	if err := RecordPlanReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Pass, "fine", goodPicks()); err != nil {
		t.Fatal(err)
	}
	if len(details) != 1 || details[0]["state"] != PlanReviewState_Passed {
		t.Fatalf("want one plan-reviewed pass event, got %+v", details)
	}
	if got := details[0]["picks"]; !reflect.DeepEqual(got, goodPicks()) {
		t.Fatalf("the pass event must carry the picks, got %#v", got)
	}
}

func TestPlanReviewPassWithoutPicksRecordsNoPicks(t *testing.T) {
	ctx, dag, reviewer := seedPicksDag(t, false)
	before := loadDag(t, ctx, dag.OID).Tasks
	var details []map[string]any
	old := appendRunEvent
	appendRunEvent = func(_ context.Context, _, _, kind string, _ *int, detail any) {
		if d, ok := detail.(map[string]any); ok && kind == waveobj.RunEventKindPlanReviewed {
			details = append(details, d)
		}
	}
	restoreAfterStages(t, func() { appendRunEvent = old })
	if err := RecordPlanReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Pass, "fine", nil); err != nil {
		t.Fatal(err)
	}
	if len(details) != 1 {
		t.Fatalf("want one plan-reviewed event, got %+v", details)
	}
	if _, ok := details[0]["picks"]; ok {
		t.Fatalf("a pass with no picks omits them, got %+v", details[0])
	}
	if g := loadDag(t, ctx, dag.OID); !reflect.DeepEqual(g.Tasks, before) {
		t.Fatalf("a pass off Reviewer picks leaves the tasks alone, got %+v", g.Tasks)
	}
}

// run-sheet edits reach the group only, and the resubmitted proposal carries the run's launch snapshot
func TestReplaceProposalKeepsReviewerSettings(t *testing.T) {
	ctx, dag, reviewer := seedPicksDag(t, true)
	route := &waveobj.RoutePin{Runtime: "claude", Model: "opus"}
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.ReviewerRoute, g.WorkerRoute = route, nil
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := RecordPlanReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Fail, "no task for 4.1", nil); err != nil {
		t.Fatal(err)
	}
	proposed := &waveobj.TaskGroup{Title: "revised", Parallelism: 1, PlanPath: "p2.md", Tasks: picksTasks(),
		WorkerRoute: &waveobj.RoutePin{Runtime: "claude", Model: "haiku"}, ReviewerPicks: false, ReviewerRoute: nil}
	g, err := ReplacePlanReviewProposal(ctx, dag.OID, proposed)
	if err != nil {
		t.Fatal(err)
	}
	stored := loadDag(t, ctx, dag.OID)
	for _, got := range []*waveobj.TaskGroup{g, stored} {
		if !got.ReviewerPicks || got.WorkerRoute != nil || got.ReviewerRoute == nil || *got.ReviewerRoute != *route {
			t.Fatalf("the group keeps its workers setting and reviewer route, got picks=%v workers=%+v reviewer=%+v",
				got.ReviewerPicks, got.WorkerRoute, got.ReviewerRoute)
		}
	}
	if stored.Title != "revised" || stored.PlanReview.Round != 2 {
		t.Fatalf("the proposal is still replaced, got %q round %d", stored.Title, stored.PlanReview.Round)
	}
	if prompt := planReviewPrompt(stored, "tree"); !strings.Contains(prompt, "--pick") {
		t.Fatalf("the next round's reviewer is asked for picks again:\n%s", prompt)
	}
}
