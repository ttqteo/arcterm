// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// seedReviewFailedDag is a task whose second review failed: the lead's to judge.
func seedReviewFailedDag(t *testing.T) (context.Context, *waveobj.TaskGroup, waveobj.Run) {
	t.Helper()
	ctx, dag, worker := seedReviewDag(t)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		task := &g.Tasks[0]
		task.State = TaskState_ReviewFailed
		task.ReviewRound = MaxReviewRounds
		task.ReviewVerdict = ReviewVerdict_Fail
		task.ReviewNote = "misses the empty-input case"
		task.ReviewCommit = worker.EndCommit
		RecomputeDagStatus(g)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return ctx, dag, worker
}

// seedRunningTask is a task whose worker is still at work.
func seedRunningTask(t *testing.T) (context.Context, *waveobj.TaskGroup) {
	t.Helper()
	ctx, dag := seedPendingDag(t)
	worker := jarvis.NewRun("worker goal", "ws-1", t.TempDir(), nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	worker.DagORef = dag.OID
	if err := wstore.AppendRun(ctx, dag.ChannelId, worker); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].State = TaskState_Running
		g.Tasks[0].RunID = worker.ID
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return ctx, dag
}

func TestApproveOverrulesAFailedReview(t *testing.T) {
	ctx, dag, _ := seedReviewFailedDag(t)
	f := newFakeLead(t)
	if err := ApplyAction(ctx, dag.OID, "t-0", "approve", waveobj.RoutePin{}); err != nil {
		t.Fatal(err)
	}
	if got := firstTask(t, ctx, dag.OID).State; got != TaskState_Done {
		t.Fatalf("approve lands the task as it is, got %s", got)
	}
	if f.countKind(waveobj.RunEventKindReviewOverruled) != 1 {
		t.Fatal("want one review-overruled row")
	}
}

func TestSendBackRunsAnotherRoundWithTheLeadsGuidance(t *testing.T) {
	ctx, dag, _ := seedReviewFailedDag(t)
	calls := captureSpawns(t)
	if err := SendBack(ctx, dag.OID, "t-0", "reuse parseDate"); err != nil {
		t.Fatal(err)
	}
	task := firstTask(t, ctx, dag.OID)
	if task.State != TaskState_Running || task.ReviewRound != MaxReviewRounds || task.LeadGuidance != "reuse parseDate" {
		t.Fatalf("sendback dispatches with the round kept, got %+v", task)
	}
	p := (*calls)[0].prompt
	for _, want := range []string{"misses the empty-input case", "The lead's guidance: reuse parseDate"} {
		if !strings.Contains(p, want) {
			t.Fatalf("worker prompt missing %q: %q", want, p)
		}
	}
}

func TestRetryAfterAFailedReviewResetsTheRound(t *testing.T) {
	ctx, dag, worker := seedReviewFailedDag(t)
	calls := captureSpawns(t)
	if err := ApplyAction(ctx, dag.OID, "t-0", "retry", waveobj.RoutePin{}); err != nil {
		t.Fatal(err)
	}
	task := firstTask(t, ctx, dag.OID)
	if task.State != TaskState_Running || task.ReviewRound != 0 || len(*calls) != 1 {
		t.Fatalf("retry starts the rounds over, got %+v after %d spawns", task, len(*calls))
	}
	run, err := wstore.GetRun(ctx, dag.ChannelId, worker.ID)
	if err != nil || run.Status != jarvis.RunStatus_Done {
		t.Fatalf("the rejected worker's run keeps its done status, got %v %v", run.Status, err)
	}
}

func TestSkipAFailedReviewKeepsTheWorkersRun(t *testing.T) {
	ctx, dag, worker := seedReviewFailedDag(t)
	if err := ApplyAction(ctx, dag.OID, "t-0", "skip", waveobj.RoutePin{}); err != nil {
		t.Fatal(err)
	}
	if got := firstTask(t, ctx, dag.OID).State; got != TaskState_Skipped {
		t.Fatalf("want skipped, got %s", got)
	}
	run, err := wstore.GetRun(ctx, dag.ChannelId, worker.ID)
	if err != nil || run.Status != jarvis.RunStatus_Done {
		t.Fatalf("skip must not rewrite a finished run, got %v %v", run.Status, err)
	}
}

func TestForwardAcceptsAFailedReview(t *testing.T) {
	ctx, dag, _ := seedReviewFailedDag(t)
	if err := ForwardTask(ctx, dag.OID, "t-0", "the reviewer and the spec disagree on empty input"); err != nil {
		t.Fatal(err)
	}
}

func TestAmendReachesOnlyATaskNotStarted(t *testing.T) {
	ctx, dag := seedPendingDag(t)
	f := newFakeLead(t)
	if err := AmendTask(ctx, dag.OID, "t-0", "fmtDate moved to util/date.go"); err != nil {
		t.Fatal(err)
	}
	if got := firstTask(t, ctx, dag.OID).LeadNotes; len(got) != 1 || got[0] != "fmtDate moved to util/date.go" {
		t.Fatalf("want the note kept, got %q", got)
	}
	if f.countKind(waveobj.RunEventKindTaskAmended) != 1 {
		t.Fatal("want one task-amended row")
	}
	// longer than a task-told row keeps, and still whole in the prompt
	long := strings.Repeat("x", MaxToldLen+1)
	if err := AmendTask(ctx, dag.OID, "t-0", long); err != nil {
		t.Fatal(err)
	}
	if got := firstTask(t, ctx, dag.OID).LeadNotes; len(got) != 2 || got[1] != long {
		t.Fatalf("want the long note kept whole, got %d notes", len(got))
	}
	if err := AmendTask(ctx, dag.OID, "t-0", strings.Repeat("x", MaxReviewNoteLen+1)); err == nil || !strings.Contains(err.Error(), "limit") {
		t.Fatalf("a note past the limit must be refused, got %v", err)
	}
	if got := firstTask(t, ctx, dag.OID).LeadNotes; len(got) != 2 {
		t.Fatalf("a refused note must not be kept, got %d notes", len(got))
	}
	ctx2, running := seedRunningTask(t)
	err := AmendTask(ctx2, running.OID, "t-0", "too late")
	if err == nil || !strings.Contains(err.Error(), "dag tell") {
		t.Fatalf("amending a running task must point at tell, got %v", err)
	}
}

func TestTellTypesIntoTheRunningWorker(t *testing.T) {
	ctx, dag := seedRunningTask(t)
	f := newFakeLead(t)
	old := runBlockORefs
	runBlockORefs = func(context.Context, *waveobj.Run) []string {
		return []string{waveobj.MakeORef(waveobj.OType_Block, wakeLeadBlock).String()}
	}
	restoreAfterStages(t, func() { runBlockORefs = old })
	if err := TellTask(ctx, dag.OID, "t-0", "use fmtDate from t-1"); err != nil {
		t.Fatal(err)
	}
	if len(f.sends) != 1 || f.sends[0] != "use fmtDate from t-1" {
		t.Fatalf("want the text typed into the worker, got %q", f.sends)
	}
	if got := firstTask(t, ctx, dag.OID).LeadTold; len(got) != 1 {
		t.Fatalf("the text must wait for the told scan, got %q", got)
	}
	if f.countKind(waveobj.RunEventKindTaskLeadTold) != 1 {
		t.Fatal("want one task-lead-told row")
	}
}

// what the lead typed into a reviewer was for that review round: a later reviewer's brief must not present it
// as something the worker was told
func TestToldToTaskLeavesOutWhatWasTypedToAReviewer(t *testing.T) {
	ctx, dag := seedRunningTask(t)
	realAppend := appendRunEvent
	newFakeLead(t)
	appendRunEvent = realAppend
	old := runBlockORefs
	runBlockORefs = func(context.Context, *waveobj.Run) []string {
		return []string{waveobj.MakeORef(waveobj.OType_Block, wakeLeadBlock).String()}
	}
	restoreAfterStages(t, func() { runBlockORefs = old })
	if err := TellTask(ctx, dag.OID, "t-0", "use fmtDate from t-1"); err != nil {
		t.Fatal(err)
	}
	reviewer := jarvis.NewRun("reviewer goal", "ws-1", t.TempDir(), nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 2)
	reviewer.DagORef = dag.OID
	if err := wstore.AppendRun(ctx, dag.ChannelId, reviewer); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].State = TaskState_Reviewing
		g.Tasks[0].ReviewRunID = reviewer.ID
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := TellTask(ctx, dag.OID, "t-0", "check the timezone edge case too"); err != nil {
		t.Fatal(err)
	}
	if got := toldToTask(ctx, mustLoadDag(t, ctx, dag.OID), "t-0"); !slices.Equal(got, []string{"use fmtDate from t-1"}) {
		t.Fatalf("want only what the worker was told, got %q", got)
	}
}

func TestTellRefusesATaskNotRunning(t *testing.T) {
	ctx, dag := seedPendingDag(t)
	err := TellTask(ctx, dag.OID, "t-0", "hello")
	if err == nil || !strings.Contains(err.Error(), "dag amend") {
		t.Fatalf("telling a task not started must point at amend, got %v", err)
	}
}

func TestTakeLeadToldConsumesTheLeadsText(t *testing.T) {
	task := &waveobj.TaskNode{LeadTold: []string{"use fmtDate"}}
	if !takeLeadTold(task, " use fmtDate \n") || len(task.LeadTold) != 0 {
		t.Fatalf("the lead's text must be matched once, left %q", task.LeadTold)
	}
	if takeLeadTold(task, "use fmtDate") {
		t.Fatal("a second identical message is the human's")
	}
}

func TestTaskPromptCarriesLeadNotes(t *testing.T) {
	owner := jarvis.NewRun("owner", "ws-1", "/p", nil, jarvis.RunMode_Orchestrator, nil, 1)
	task := &waveobj.TaskNode{ID: "t-2", Label: "use fmtDate", LeadNotes: []string{"fmtDate moved to util/date.go"}}
	p := taskPrompt(&waveobj.TaskGroup{}, task, &owner, "claude", "", "")
	if !strings.Contains(p, "The lead added after earlier tasks landed:\n- fmtDate moved to util/date.go") {
		t.Fatalf("prompt missing the lead's note: %q", p)
	}
}

func TestSkipAFailedReviewDropsTheRejectedCommit(t *testing.T) {
	ctx, dag, worker := seedReviewFailedDag(t)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].ReviewBase = worker.BaseCommit
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var resetTo []string
	old := resetReviewTree
	resetReviewTree = func(_ context.Context, wt, commit string) error {
		resetTo = append(resetTo, wt+"@"+commit)
		return nil
	}
	restoreAfterStages(t, func() { resetReviewTree = old })
	if err := ApplyAction(ctx, dag.OID, "t-0", "skip", waveobj.RoutePin{}); err != nil {
		t.Fatal(err)
	}
	if len(resetTo) != 1 || resetTo[0] != worker.ProjectPath+"@"+worker.BaseCommit {
		t.Fatalf("a skipped rejection must leave the lane before the task, got resets %q", resetTo)
	}
}

func TestRetryRefusesATaskUnderReview(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	stubReviewTree(t, worker.EndCommit)
	captureSpawns(t)
	schedule(t, ctx, dag.OID)
	err := ApplyAction(ctx, dag.OID, "t-0", "retry", waveobj.RoutePin{})
	if err == nil || !strings.Contains(err.Error(), "under review") {
		t.Fatalf("retry must wait for the review, got %v", err)
	}
	run, err := wstore.GetRun(ctx, dag.ChannelId, worker.ID)
	if err != nil || run.Status != jarvis.RunStatus_Done {
		t.Fatalf("the reviewed worker's run keeps its done status, got %v %v", run.Status, err)
	}
}
