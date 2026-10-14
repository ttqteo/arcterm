// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// stubDagSpawns counts the sessions the engine starts and keeps them off the real terminal.
func stubDagSpawns(t *testing.T) *[]jarvis.RunWorkerOptions {
	t.Helper()
	var spawned []jarvis.RunWorkerOptions
	orig := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(_ context.Context, _ runroute.Capability, _, _, _, _ string, opts jarvis.RunWorkerOptions) (string, error) {
		spawned = append(spawned, opts)
		return waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String(), nil
	}
	t.Cleanup(func() { jarvis.SpawnRunWorker = orig })
	t.Cleanup(orchestrate.SetValidateWorkerHarnessForTest(func(string) error { return nil }))
	return &spawned
}

// recordRound records a verdict from every reviewer of the dag's round: full gives fullVerdict, every lens passes.
func recordRound(t *testing.T, ctx context.Context, dagID, fullVerdict string) {
	t.Helper()
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range g.PlanReview.Reviewers {
		v, text := orchestrate.ReviewVerdict_Pass, "fine"
		if r.Lens == orchestrate.PlanReviewLens_Full && fullVerdict == orchestrate.ReviewVerdict_Fail {
			v, text = fullVerdict, "spec 4.1 has no task"
		}
		if err := orchestrate.RecordPlanReviewVerdict(ctx, dagID, r.RunID, v, text, nil); err != nil {
			t.Fatalf("%s: %v", r.Lens, err)
		}
	}
}

// reviewerRunIDs are the run ids of the round's reviewers, full first.
func reviewerRunIDs(g *waveobj.TaskGroup) []string {
	var out []string
	for _, r := range g.PlanReview.Reviewers {
		out = append(out, r.RunID)
	}
	return out
}

func TestDagSubmitReviewsThePlanBeforeAnyWorkerStarts(t *testing.T) {
	ctx := context.Background()
	newRun := func(t *testing.T) (string, string) {
		t.Helper()
		ch, err := wstore.CreateChannel(ctx, "dag-planreview-test", t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		run := jarvis.NewRun("ship coupons", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
		run.Status = jarvis.RunStatus_Planning
		if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
			t.Fatal(err)
		}
		return ch.OID, run.ID
	}
	writePlan := func(t *testing.T, src string) string {
		t.Helper()
		path := filepath.Join(t.TempDir(), "plan.md")
		if err := os.WriteFile(path, []byte(src), 0o644); err != nil {
			t.Fatal(err)
		}
		return path
	}
	const plan = "# Coupons\n\n### Task 1: input\nadd the field\n"
	const revised = "# Coupons\n\n### Task 1: input\nadd the field\n\n### Task 2: spec 4.1\n**Depends on:** Task 1\n"
	submit := func(channelId, runId, planPath string) (*waveobj.TaskGroup, error) {
		return (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{ChannelId: channelId, RunId: runId, PlanPath: planPath})
	}

	t.Run("a plan file opens round 1 and dispatches nothing but the reviewer", func(t *testing.T) {
		spawned := stubDagSpawns(t)
		channelId, runId := newRun(t)
		g, err := submit(channelId, runId, writePlan(t, plan))
		if err != nil {
			t.Fatal(err)
		}
		if g.PlanReview == nil || g.PlanReview.State != orchestrate.PlanReviewState_Reviewing || g.PlanReview.Round != 1 || g.Status != orchestrate.DagStatus_PlanReview {
			t.Fatalf("want round 1 reviewing, got status %s review %+v", g.Status, g.PlanReview)
		}
		if g.Tasks[0].RunID != "" || len(*spawned) != 5 || len(g.PlanReview.Reviewers) != 5 {
			t.Fatalf("only the plan reviewers may start, got %+v", *spawned)
		}
		for _, opts := range *spawned {
			if opts.TaskId != "" {
				t.Fatalf("only the plan reviewers may start, got %+v", *spawned)
			}
		}
	})

	t.Run("a JSON dag has no plan review", func(t *testing.T) {
		stubDagSpawns(t)
		channelId, runId := newRun(t)
		g, err := (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{ChannelId: channelId, RunId: runId, Title: "t", Parallelism: 1, Tasks: []waveobj.TaskNode{{ID: "t-1", Label: "a"}}})
		if err != nil {
			t.Fatal(err)
		}
		if g.PlanReview != nil || g.Status == orchestrate.DagStatus_PlanReview {
			t.Fatalf("want no plan review, got status %s review %+v", g.Status, g.PlanReview)
		}
	})

	t.Run("a revised plan replaces one whose review failed, and is reviewed again", func(t *testing.T) {
		spawned := stubDagSpawns(t)
		channelId, runId := newRun(t)
		g, err := submit(channelId, runId, writePlan(t, plan))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := submit(channelId, runId, writePlan(t, revised)); err == nil || !strings.Contains(err.Error(), "dag conflict") {
			t.Fatalf("a resubmit while the plan is under review must conflict, got %v", err)
		}
		if err := (&WshServer{}).DagActionCommand(ctx, wshrpc.CommandDagActionData{ChannelId: channelId, RunId: runId, Action: "planreview-accept", Notes: "go"}); err == nil {
			t.Fatal("accept while the reviewer works must be refused")
		}
		recordRound(t, ctx, g.OID, orchestrate.ReviewVerdict_Fail)
		g2, err := submit(channelId, runId, writePlan(t, revised))
		if err != nil {
			t.Fatal(err)
		}
		if g2.OID != g.OID || len(g2.Tasks) != 2 || g2.PlanReview.Round != 2 || g2.PlanReview.State != orchestrate.PlanReviewState_Reviewing {
			t.Fatalf("want the same dag with the revised tasks in round 2, got %d tasks and %+v", len(g2.Tasks), g2.PlanReview)
		}
		first, second := reviewerRunIDs(g), reviewerRunIDs(g2)
		if len(second) == 0 || second[0] == "" || second[0] == first[0] || len(*spawned) != len(first)+len(second) {
			t.Fatalf("round 2 gets fresh reviewers, got %+v after %d spawns", g2.PlanReview, len(*spawned))
		}
	})

	t.Run("a resubmit after the plan passed keeps the conflict", func(t *testing.T) {
		stubDagSpawns(t)
		channelId, runId := newRun(t)
		g, err := submit(channelId, runId, writePlan(t, plan))
		if err != nil {
			t.Fatal(err)
		}
		recordRound(t, ctx, g.OID, orchestrate.ReviewVerdict_Pass)
		if _, err := submit(channelId, runId, writePlan(t, revised)); err == nil || !strings.Contains(err.Error(), "dag conflict") {
			t.Fatalf("want dag conflict, got %v", err)
		}
	})
}

// A run started from a canvas (Build this…) carries the human's prototype; a lead revising its plan after a
// failed review must not swap it for the one its plan names.
func TestPlanReviewResubmitKeepsTheRunsPrototype(t *testing.T) {
	ctx := context.Background()
	stubDagSpawns(t)
	ch, err := wstore.CreateChannel(ctx, "dag-planreview-prototype", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	run := jarvis.NewRun("ship coupons", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	run.Status = jarvis.RunStatus_Planning
	run.Prototype = "C:/canvas/Main.dc.html"
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatal(err)
	}
	submit := func(src string) (*waveobj.TaskGroup, error) {
		path := filepath.Join(t.TempDir(), "plan.md")
		if err := os.WriteFile(path, []byte(src), 0o644); err != nil {
			t.Fatal(err)
		}
		return (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{ChannelId: ch.OID, RunId: run.ID, PlanPath: path})
	}
	g, err := submit("**Prototype:** .superpowers/design/first/Main.dc.html\n\n### Task 1: input\n")
	if err != nil {
		t.Fatal(err)
	}
	recordRound(t, ctx, g.OID, orchestrate.ReviewVerdict_Fail)
	g2, err := submit("**Prototype:** .superpowers/design/other/Main.dc.html\n\n### Task 1: input\n\n### Task 2: spec 4.1\n")
	if err != nil {
		t.Fatal(err)
	}
	if g2.OID != g.OID || g2.PlanReview.Round != 2 {
		t.Fatalf("want the same dag in round 2, got %s round %d", g2.OID, g2.PlanReview.Round)
	}
	stored, err := wstore.GetDag(ctx, g.OID)
	if err != nil {
		t.Fatal(err)
	}
	if g2.Prototype != run.Prototype || stored.Prototype != run.Prototype {
		t.Fatalf("prototype = %q (stored %q), want the run's %q", g2.Prototype, stored.Prototype, run.Prototype)
	}
}

// A lead compacts when its plan is handed over for good: once the review passes or the human accepts it,
// never at submit, when a failed review would send the plan back to a lead that had dropped its context.
func TestPlanReviewHandsOffOnlyOnceThePlanClears(t *testing.T) {
	ctx := context.Background()
	const plan = "# Coupons\n\n### Task 1: input\nadd the field\n"
	var handed []string
	stub := func(_ context.Context, channelId, runId string) { handed = append(handed, channelId+"/"+runId) }
	old := postHandoff
	postHandoff = stub
	t.Cleanup(func() { postHandoff = old })
	t.Cleanup(orchestrate.SetPostHandoffForTest(stub))
	ws := &WshServer{}

	submit := func(t *testing.T) (string, string, *waveobj.TaskGroup) {
		t.Helper()
		ch, err := wstore.CreateChannel(ctx, "dag-planreview-handoff", t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		lead := jarvis.NewRun("ship coupons", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
		lead.Status = jarvis.RunStatus_Planning
		lead.Phases[0].WorkerOrefs = []string{"tab:lead-tab"}
		if err := wstore.AppendRun(ctx, ch.OID, lead); err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(t.TempDir(), "plan.md")
		if err := os.WriteFile(path, []byte(plan), 0o644); err != nil {
			t.Fatal(err)
		}
		g, err := ws.DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{ChannelId: ch.OID, RunId: lead.ID, PlanPath: path})
		if err != nil {
			t.Fatal(err)
		}
		return ch.OID, lead.ID, g
	}
	act := func(t *testing.T, channelId, runId, action string) {
		t.Helper()
		if err := ws.DagActionCommand(ctx, wshrpc.CommandDagActionData{ChannelId: channelId, RunId: runId, Action: action, Notes: "because"}); err != nil {
			t.Fatalf("%s: %v", action, err)
		}
	}
	// the action's tick runs inline, so it has finished before the action returns and never outlives the temp dirs
	origSchedule := scheduleDag
	scheduleDag = func(dagID string) {
		if err := orchestrate.Schedule(ctx, dagID); err != nil {
			t.Errorf("schedule %s: %v", dagID, err)
		}
	}
	t.Cleanup(func() { scheduleDag = origSchedule })
	assertDispatched := func(t *testing.T, dagID string) {
		t.Helper()
		if g, err := wstore.GetDag(ctx, dagID); err != nil || g.Tasks[0].RunID == "" {
			t.Fatalf("the action's tick did not dispatch the first task (err %v)", err)
		}
	}

	t.Run("a passed round hands off; the submit and a lone reviewer's pass do not", func(t *testing.T) {
		stubDagSpawns(t)
		handed = nil
		channelId, leadId, g := submit(t)
		if len(handed) != 0 {
			t.Fatalf("a plan under review must not be handed off at submit, got %v", handed)
		}
		reviewers := reviewerRunIDs(g)
		act(t, channelId, reviewers[0], "planreview-pass")
		if len(handed) != 0 {
			t.Fatalf("a lone reviewer's pass leaves the round out, got handoffs %v", handed)
		}
		for _, runId := range reviewers[1:] {
			act(t, channelId, runId, "planreview-pass")
		}
		assertDispatched(t, g.OID)
		if want := []string{channelId + "/" + leadId}; !reflect.DeepEqual(handed, want) {
			t.Fatalf("handoffs = %v, want %v", handed, want)
		}
	})

	t.Run("a fail does not hand off; the human's accept does", func(t *testing.T) {
		stubDagSpawns(t)
		handed = nil
		channelId, leadId, g := submit(t)
		reviewers := reviewerRunIDs(g)
		act(t, channelId, reviewers[0], "planreview-fail")
		for _, runId := range reviewers[1:] {
			act(t, channelId, runId, "planreview-pass")
		}
		if len(handed) != 0 {
			t.Fatalf("a failed review goes back to the lead to revise, got handoffs %v", handed)
		}
		act(t, channelId, leadId, "planreview-accept")
		assertDispatched(t, g.OID)
		if want := []string{channelId + "/" + leadId}; !reflect.DeepEqual(handed, want) {
			t.Fatalf("handoffs = %v, want %v", handed, want)
		}
	})
}

// the Light reviewers route is the human's: a submit carries the run's onto the group, and a resubmit keeps the
// group's, as it keeps the reviewer route
func TestDagSubmitCarriesLightReviewerRoute(t *testing.T) {
	ctx := context.Background()
	stubDagSpawns(t)
	ch, err := wstore.CreateChannel(ctx, "dag-planreview-light", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	route := &waveobj.RoutePin{Runtime: "claude", Model: "haiku"}
	run := jarvis.NewRun("ship coupons", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	run.Status = jarvis.RunStatus_Planning
	run.LightReviewerRoute = route
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatal(err)
	}
	submit := func(src string) *waveobj.TaskGroup {
		t.Helper()
		path := filepath.Join(t.TempDir(), "plan.md")
		if err := os.WriteFile(path, []byte(src), 0o644); err != nil {
			t.Fatal(err)
		}
		g, err := (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{ChannelId: ch.OID, RunId: run.ID, PlanPath: path})
		if err != nil {
			t.Fatal(err)
		}
		return g
	}
	g := submit("### Task 1: input\n")
	if g.LightReviewerRoute == nil || *g.LightReviewerRoute != *route {
		t.Fatalf("the group must hold the run's Light reviewers route, got %+v", g.LightReviewerRoute)
	}
	for _, r := range g.PlanReview.Reviewers {
		child, err := wstore.GetRun(ctx, ch.OID, r.RunID)
		if err != nil {
			t.Fatal(err)
		}
		if r.Lens != orchestrate.PlanReviewLens_Full && (child.Runtime != route.Runtime || child.Model != route.Model) {
			t.Fatalf("the %s lens runs on %s/%s, want the Light reviewers route", r.Lens, child.Runtime, child.Model)
		}
	}
	recordRound(t, ctx, g.OID, orchestrate.ReviewVerdict_Fail)
	g2 := submit("### Task 1: input\n\n### Task 2: spec 4.1\n")
	stored, err := wstore.GetDag(ctx, g.OID)
	if err != nil {
		t.Fatal(err)
	}
	if g2.PlanReview.Round != 2 || stored.LightReviewerRoute == nil || *stored.LightReviewerRoute != *route {
		t.Fatalf("the route survives a resubmit, got round %d route %+v", g2.PlanReview.Round, stored.LightReviewerRoute)
	}
}
