// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvisstate

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// rrRun is a run for the To review tests: oid, created ts, and the fields that place it in a dag.
func rrRun(oid string, created int64, edit func(r *waveobj.Run)) *waveobj.Run {
	r := &waveobj.Run{OID: oid, ID: oid, ChannelOID: "ch-" + oid, Goal: "goal of " + oid, CreatedTs: created}
	if edit != nil {
		edit(r)
	}
	return r
}

// rrProposed is a proposed chunk whose "proposed" note carries run ("run:<oid>" as written by the server) at ts.
func rrProposed(label, run string, ts int64) waveobj.EffortChunk {
	return waveobj.EffortChunk{
		Label: label, Status: "proposed",
		Notes: []waveobj.EffortNote{{Ts: ts, Text: "proposed", Author: "agent", Session: "agent:tab1", Run: run}},
	}
}

func rrEffort(oid, title, status string, chunks ...waveobj.EffortChunk) *waveobj.Effort {
	return &waveobj.Effort{OID: oid, Title: title, Status: status, Chunks: chunks}
}

func rrLabels(g wshrpc.RunReviewGroup) []string {
	var out []string
	for _, it := range g.Items {
		out = append(out, it.Label)
	}
	return out
}

func TestRunReviewGroupsByRunOldestRunFirst(t *testing.T) {
	runs := []*waveobj.Run{rrRun("newer", 300, nil), rrRun("older", 100, nil)}
	efforts := []*waveobj.Effort{
		rrEffort("e1", "Hand checks", "active",
			rrProposed("late issue of older", "run:older", 250),
			rrProposed("issue of newer", "run:newer", 320),
			rrProposed("early issue of older", "run:older", 150),
		),
	}
	got := RunReview(efforts, runs)
	if len(got) != 2 {
		t.Fatalf("groups = %+v, want 2", got)
	}
	if got[0].RunId != "older" || got[1].RunId != "newer" {
		t.Fatalf("run order = %s, %s; want the oldest run first", got[0].RunId, got[1].RunId)
	}
	if want := []string{"early issue of older", "late issue of older"}; !reflect.DeepEqual(rrLabels(got[0]), want) {
		t.Fatalf("older's items = %v, want %v (oldest proposal first)", rrLabels(got[0]), want)
	}
	if got[0].Goal != "goal of older" || got[0].CreatedTs != 100 || got[0].ChannelId != "ch-older" {
		t.Fatalf("group head = %+v", got[0])
	}
	if got[0].Items[0].ProposedTs != 150 || got[0].Items[1].ProposedTs != 250 {
		t.Fatalf("proposed ts = %d, %d; want the proposed notes' own", got[0].Items[0].ProposedTs, got[0].Items[1].ProposedTs)
	}
}

func TestRunReviewOrdersItemsByProposedTsThenLabel(t *testing.T) {
	runs := []*waveobj.Run{rrRun("r1", 100, nil)}
	efforts := []*waveobj.Effort{
		rrEffort("e1", "A", "active",
			rrProposed("b", "run:r1", 200),
			rrProposed("a", "run:r1", 200),
			rrProposed("first", "run:r1", 100),
		),
	}
	got := RunReview(efforts, runs)
	if want := []string{"first", "a", "b"}; len(got) != 1 || !reflect.DeepEqual(rrLabels(got[0]), want) {
		t.Fatalf("items = %+v, want %v", got, want)
	}
}

func TestRunReviewDagChildrenLandInTheirOwnersGroup(t *testing.T) {
	runs := []*waveobj.Run{
		rrRun("lead", 100, func(r *waveobj.Run) { r.DagORef = "dag1" }),
		rrRun("worker", 110, func(r *waveobj.Run) { r.DagORef = "dag1"; r.TaskId = "t-1" }),
		rrRun("reviewer", 120, func(r *waveobj.Run) { r.DagORef = "dag1"; r.TaskId = "t-1"; r.Review = true }),
		rrRun("verifier", 130, func(r *waveobj.Run) { r.DagORef = "dag1"; r.StageRole = "verifier" }),
		rrRun("planrev", 140, func(r *waveobj.Run) { r.DagORef = "dag1"; r.StageRole = "plan-reviewer" }),
	}
	efforts := []*waveobj.Effort{
		rrEffort("e1", "Hand checks", "active",
			rrProposed("from lead", "run:lead", 200),
			rrProposed("from worker", "run:worker", 210),
			rrProposed("from reviewer", "run:reviewer", 220),
			rrProposed("from verifier", "run:verifier", 230),
			rrProposed("from plan reviewer", "run:planrev", 240),
		),
	}
	got := RunReview(efforts, runs)
	if len(got) != 1 || got[0].RunId != "lead" {
		t.Fatalf("groups = %+v, want one group, the dag owner's", got)
	}
	want := []string{"from lead", "from worker", "from reviewer", "from verifier", "from plan reviewer"}
	if !reflect.DeepEqual(rrLabels(got[0]), want) {
		t.Fatalf("items = %v, want %v", rrLabels(got[0]), want)
	}
	if got[0].Goal != "goal of lead" || got[0].CreatedTs != 100 {
		t.Fatalf("group head = %+v, want the owner's goal and age", got[0])
	}
}

func TestRunReviewParentLeadChildIsItsOwnGroup(t *testing.T) {
	runs := []*waveobj.Run{
		rrRun("lead", 100, func(r *waveobj.Run) { r.DagORef = "dag1" }),
		// a lead's `wsh jarvis run` child owns a dag of its own
		rrRun("child", 200, func(r *waveobj.Run) { r.DagORef = "dag2"; r.ParentLeadORef = "tab:lead-tab" }),
		rrRun("childworker", 210, func(r *waveobj.Run) { r.DagORef = "dag2"; r.TaskId = "t-1" }),
	}
	efforts := []*waveobj.Effort{
		rrEffort("e1", "Hand checks", "active",
			rrProposed("from lead", "run:lead", 300),
			rrProposed("from child", "run:child", 310),
			rrProposed("from child worker", "run:childworker", 320),
		),
	}
	got := RunReview(efforts, runs)
	if len(got) != 2 || got[0].RunId != "lead" || got[1].RunId != "child" {
		t.Fatalf("groups = %+v, want lead and its child apart", got)
	}
	if want := []string{"from lead"}; !reflect.DeepEqual(rrLabels(got[0]), want) {
		t.Fatalf("lead's items = %v, want %v", rrLabels(got[0]), want)
	}
	if want := []string{"from child", "from child worker"}; !reflect.DeepEqual(rrLabels(got[1]), want) {
		t.Fatalf("child's items = %v, want %v (its worker goes to the child, not the parent lead)", rrLabels(got[1]), want)
	}
}

func TestRunReviewLeavesOutProposalsThatNameNoKnownRun(t *testing.T) {
	runs := []*waveobj.Run{
		rrRun("r1", 100, nil),
		// an engine child whose dag owner is not among the runs
		rrRun("orphan", 110, func(r *waveobj.Run) { r.DagORef = "gone"; r.TaskId = "t-1" }),
	}
	noRun := waveobj.EffortChunk{
		Label: "plan from an agent outside any run", Status: "proposed",
		Notes: []waveobj.EffortNote{{Ts: 150, Text: "proposed", Author: "agent", Session: "agent:tab9"}},
	}
	bare := waveobj.EffortChunk{Label: "proposed with no note", Status: "proposed"}
	efforts := []*waveobj.Effort{
		rrEffort("e1", "Hand checks", "active",
			rrProposed("kept", "run:r1", 200),
			noRun,
			bare,
			rrProposed("of a run that is gone", "run:ghost", 210),
			rrProposed("of an orphaned child", "run:orphan", 220),
		),
	}
	got := RunReview(efforts, runs)
	if len(got) != 1 || !reflect.DeepEqual(rrLabels(got[0]), []string{"kept"}) {
		t.Fatalf("groups = %+v, want only the proposal of a known run", got)
	}
}

func TestRunReviewOnlyActiveAndPausedInitiativesCount(t *testing.T) {
	runs := []*waveobj.Run{rrRun("r1", 100, nil)}
	efforts := []*waveobj.Effort{
		rrEffort("e-active", "Active", "active", rrProposed("in active", "run:r1", 200)),
		rrEffort("e-paused", "Paused", "paused", rrProposed("in paused", "run:r1", 210)),
		rrEffort("e-done", "Done", "done", rrProposed("in done", "run:r1", 220)),
		rrEffort("e-archived", "Archived", "archived", rrProposed("in archived", "run:r1", 230)),
		nil,
	}
	got := RunReview(efforts, runs)
	if want := []string{"in active", "in paused"}; len(got) != 1 || !reflect.DeepEqual(rrLabels(got[0]), want) {
		t.Fatalf("groups = %+v, want only the active and paused initiatives' chunks", got)
	}
}

func TestRunReviewLeavesOutChunksNoLongerProposed(t *testing.T) {
	runs := []*waveobj.Run{rrRun("r1", 100, nil)}
	later := rrProposed("moved to pending", "run:r1", 200)
	later.Status = "pending"
	skipped := rrProposed("dropped", "run:r1", 210)
	skipped.Status = "skipped"
	efforts := []*waveobj.Effort{
		rrEffort("e1", "Hand checks", "active", later, skipped, rrProposed("still proposed", "run:r1", 220)),
	}
	got := RunReview(efforts, runs)
	if want := []string{"still proposed"}; len(got) != 1 || !reflect.DeepEqual(rrLabels(got[0]), want) {
		t.Fatalf("groups = %+v, want only the chunk that is still proposed", got)
	}
}

func TestRunReviewItemCarriesTheInitiativesTitleAndProject(t *testing.T) {
	runs := []*waveobj.Run{rrRun("r1", 100, nil)}
	e := rrEffort("e1", "CDP scenarios", "active", rrProposed("fix the flaky shot", "run:r1", 200))
	e.Project = "D:/work/arcterm"
	got := RunReview([]*waveobj.Effort{e}, runs)
	if len(got) != 1 || len(got[0].Items) != 1 {
		t.Fatalf("groups = %+v", got)
	}
	want := wshrpc.RunReviewItem{
		EffortOID: "e1", EffortTitle: "CDP scenarios", Project: "D:/work/arcterm",
		Label: "fix the flaky shot", ProposedTs: 200,
	}
	if got[0].Items[0] != want {
		t.Fatalf("item = %+v, want %+v", got[0].Items[0], want)
	}
}

func TestRunReviewReadsTheNewestProposedNote(t *testing.T) {
	runs := []*waveobj.Run{rrRun("r1", 100, nil), rrRun("r2", 200, nil)}
	c := waveobj.EffortChunk{
		Label: "re-proposed", Status: "proposed",
		Notes: []waveobj.EffortNote{
			{Ts: 300, Text: "proposed", Session: "agent:a", Run: "run:r1"},
			{Ts: 310, Text: "a remark that is not a proposal", Run: "run:r1"},
			{Ts: 400, Text: "proposed", Session: "agent:b", Run: "run:r2"},
		},
	}
	got := RunReview([]*waveobj.Effort{rrEffort("e1", "A", "active", c)}, runs)
	if len(got) != 1 || got[0].RunId != "r2" || got[0].Items[0].ProposedTs != 400 {
		t.Fatalf("groups = %+v, want the chunk under r2 with the newest proposed note's ts", got)
	}
}

func TestRunReviewIsEmptyWithNothingToReview(t *testing.T) {
	if got := RunReview(nil, nil); len(got) != 0 {
		t.Fatalf("RunReview(nil, nil) = %+v, want none", got)
	}
	runs := []*waveobj.Run{rrRun("r1", 100, nil)}
	efforts := []*waveobj.Effort{rrEffort("e1", "A", "active", waveobj.EffortChunk{Label: "x", Status: "pending"})}
	if got := RunReview(efforts, runs); len(got) != 0 {
		t.Fatalf("RunReview = %+v, want none when nothing is proposed", got)
	}
}

func TestFetchWorkStateCarriesRunReviewOnlyWhenRunsAndEffortsAreHealthy(t *testing.T) {
	ctx := context.Background()
	run := rrRun("r1", 100, nil)
	effort := rrEffort("e1", "Hand checks", "active", rrProposed("an issue", "run:r1", 200))
	legs := func() fetchSeams {
		s := emptyLegs()
		s.getChannels = func(ctx context.Context) ([]*waveobj.Channel, error) {
			return []*waveobj.Channel{{OID: "ch-r1"}}, nil
		}
		s.getChannelRuns = func(ctx context.Context, id string) ([]*waveobj.Run, error) { return []*waveobj.Run{run}, nil }
		s.getEfforts = func(ctx context.Context) ([]*waveobj.Effort, error) { return []*waveobj.Effort{effort}, nil }
		return s
	}

	restore := SetFetchSeamsForTest(legs())
	st, err := FetchWorkState(ctx, "", 0)
	restore()
	if err != nil {
		t.Fatalf("FetchWorkState: %v", err)
	}
	if len(st.RunReview) != 1 || st.RunReview[0].RunId != "r1" || len(st.RunReview[0].Items) != 1 {
		t.Fatalf("RunReview = %+v, want r1's one proposal", st.RunReview)
	}

	runsDown := legs()
	runsDown.getChannelRuns = func(ctx context.Context, id string) ([]*waveobj.Run, error) {
		return nil, errors.New("simulated run read failure")
	}
	restore = SetFetchSeamsForTest(runsDown)
	st, err = FetchWorkState(ctx, "", 0)
	restore()
	if err != nil {
		t.Fatalf("FetchWorkState: %v", err)
	}
	if len(st.RunReview) != 0 {
		t.Fatalf("RunReview = %+v, want none while the runs leg is unhealthy", st.RunReview)
	}

	effortsDown := legs()
	effortsDown.getEfforts = func(ctx context.Context) ([]*waveobj.Effort, error) {
		return nil, errors.New("simulated effort read failure")
	}
	restore = SetFetchSeamsForTest(effortsDown)
	st, err = FetchWorkState(ctx, "", 0)
	restore()
	if err != nil {
		t.Fatalf("FetchWorkState: %v", err)
	}
	if len(st.RunReview) != 0 {
		t.Fatalf("RunReview = %+v, want none while the efforts leg is unhealthy", st.RunReview)
	}
}
