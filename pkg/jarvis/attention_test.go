// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// heldRun is a run that waits on the human by its own row alone: its branch was not merged back.
func heldRun(id, goal string, completedTs int64) *waveobj.Run {
	return &waveobj.Run{
		ID:          id,
		Goal:        goal,
		CompletedTs: completedTs,
		Land:        &waveobj.RunLand{State: "held", Reason: "dirty"},
	}
}

func escalationMsg(id, askORef, workerORef, question string, ts int64) *waveobj.ChannelMessage {
	return escalationMsgFor(id, askORef, "1", workerORef, question, ts)
}

func escalationMsgFor(id, askORef, askId, workerORef, question string, ts int64) *waveobj.ChannelMessage {
	data, _ := json.Marshal(JarvisCardData{AskORef: askORef, AskId: askId, WorkerORef: workerORef, Question: question})
	return &waveobj.ChannelMessage{ID: id, Kind: "jarvis-escalation", Ts: ts, Data: string(data)}
}

func TestBuildAttentionFindsAHeldLandInANonActiveChannel(t *testing.T) {
	in := AttentionInput{Channels: []AttentionChannel{
		{OID: "c1", Name: "alpha", Runs: []*waveobj.Run{heldRun("r1", "refactor auth", 500)}},
	}}
	items := BuildAttention(in)
	if len(items) != 1 {
		t.Fatalf("want 1 item, got %d: %+v", len(items), items)
	}
	got := items[0]
	if got.Kind != AttentionRunLandHeld || got.RunId != "r1" || got.ChannelId != "c1" ||
		got.ChannelName != "alpha" || got.Source != "refactor auth" ||
		got.Action != "Review" || got.WaitingSince != 500 {
		t.Fatalf("wrong held-land item: %+v", got)
	}
}

func TestBuildAttentionIgnoresARunWithNothingWaiting(t *testing.T) {
	run := &waveobj.Run{ID: "r1", Goal: "g", Status: "executing",
		Phases: []waveobj.RunPhase{{State: "running"}}}
	items := BuildAttention(AttentionInput{Channels: []AttentionChannel{{OID: "c1", Runs: []*waveobj.Run{run}}}})
	if len(items) != 0 {
		t.Fatalf("want none, got %+v", items)
	}
}

func TestBuildAttentionCountsAnEscalationOnlyWhileItsAskIsPending(t *testing.T) {
	ch := AttentionChannel{OID: "c1", Name: "alpha",
		Messages: []*waveobj.ChannelMessage{escalationMsg("m1", "block:a", "tab:w", "Which order?", 900)}}

	none := BuildAttention(AttentionInput{Channels: []AttentionChannel{ch}})
	if len(none) != 0 {
		t.Fatalf("an answered escalation must not wait on anyone: %+v", none)
	}

	live := BuildAttention(AttentionInput{
		Channels:    []AttentionChannel{ch},
		PendingAsks: map[string]agentask.PendingAsk{"block:a": {AskId: "1", Ts: 900}},
		AskWorker:   map[string]string{"block:a": "worker-3"},
		AskChannel:  map[string]string{"block:a": "c1"},
	})
	if len(live) != 1 || live[0].Kind != AttentionEscalation || live[0].Text != "Which order?" ||
		live[0].Source != "worker-3" || live[0].WaitingSince != 900 {
		t.Fatalf("wrong escalation item: %+v", live)
	}
}

// an agent raises every ask on its one block oref, so an answered escalation must not come back when the
// same agent asks its next question: that one is waiting, the old card is not
func TestBuildAttentionDropsAnAnsweredEscalationWhenItsAgentAsksAgain(t *testing.T) {
	items := BuildAttention(AttentionInput{
		Channels: []AttentionChannel{{OID: "c1", Name: "alpha",
			Messages: []*waveobj.ChannelMessage{escalationMsgFor("m1", "block:a", "first", "tab:w", "Which landing?", 900)}}},
		PendingAsks: map[string]agentask.PendingAsk{"block:a": {AskId: "second", Ts: 2000,
			Questions: []baseds.AgentAskQuestion{{Question: "Spec review?"}}}},
		AskChannel: map[string]string{"block:a": "c1"},
		AskWorker:  map[string]string{"block:a": "lead"},
	})
	if len(items) != 1 || items[0].Kind != AttentionAsk || items[0].Text != "Spec review?" {
		t.Fatalf("want only the new ask, got %+v", items)
	}
}

// An escalated ask is ONE thing waiting, not two. See "Deviation from the spec" in the plan.
func TestBuildAttentionDoesNotCountAnEscalatedAskTwice(t *testing.T) {
	items := BuildAttention(AttentionInput{
		Channels: []AttentionChannel{{OID: "c1", Name: "alpha",
			Messages: []*waveobj.ChannelMessage{escalationMsg("m1", "block:a", "tab:w", "Q?", 900)}}},
		PendingAsks: map[string]agentask.PendingAsk{"block:a": {AskId: "1", Ts: 900}},
		AskChannel:  map[string]string{"block:a": "c1"},
		AskWorker:   map[string]string{"block:a": "worker-3"},
	})
	if len(items) != 1 || items[0].Kind != AttentionEscalation {
		t.Fatalf("want one escalation, got %+v", items)
	}
}

func TestGatherAttentionDropsAskForDeletedBlock(t *testing.T) {
	oref := waveobj.MakeORef(waveobj.OType_Block, uuid.NewString()).String()
	agentask.GlobalRegistry = agentask.MakeRegistry()
	agentask.GlobalRegistry.Set(oref, agentask.PendingAsk{AskId: "orphan", Ts: 42})

	items, err := GatherAttentionFromLedger(context.Background(), nil, map[string][]*waveobj.Run{})
	if err != nil {
		t.Fatalf("gather attention: %v", err)
	}
	events := wps.Broker.ReadEventHistory(wps.Event_AgentAsk, oref, 1)
	if len(events) != 1 {
		t.Fatalf("deleted block must publish one clear event, got %d", len(events))
	}
	cleared, ok := events[0].Data.(baseds.AgentAskData)
	if !ok || !cleared.Cleared || cleared.AskId != "orphan" {
		t.Fatalf("clear event = %#v", events[0].Data)
	}
	if len(items) != 0 {
		t.Fatalf("deleted block must not remain in attention: %+v", items)
	}
	if _, ok := agentask.GlobalRegistry.Get(oref); ok {
		t.Fatal("deleted block's pending ask must be claimed")
	}
}

func TestBuildAttentionYieldsAStandaloneAskWithNoChannel(t *testing.T) {
	items := BuildAttention(AttentionInput{
		PendingAsks: map[string]agentask.PendingAsk{"block:z": {AskId: "9", Ts: 42}},
		AskWorker:   map[string]string{"block:z": "solo"},
	})
	if len(items) != 1 {
		t.Fatalf("want 1, got %+v", items)
	}
	if items[0].ChannelId != "" || items[0].Kind != AttentionAsk ||
		items[0].Action != "Answer" || items[0].WaitingSince != 42 {
		t.Fatalf("wrong standalone ask: %+v", items[0])
	}
}

func TestBuildAttentionOrdersByKindThenOldestFirst(t *testing.T) {
	in := AttentionInput{
		Channels: []AttentionChannel{{OID: "c1", Name: "alpha", Runs: []*waveobj.Run{
			heldRun("newer", "b", 800),
			heldRun("older", "a", 100),
		}}},
		PendingAsks: map[string]agentask.PendingAsk{"block:z": {AskId: "9", Ts: 50}},
		AskWorker:   map[string]string{"block:z": "solo"},
	}
	items := BuildAttention(in)
	if len(items) != 3 {
		t.Fatalf("want 3, got %+v", items)
	}
	// held lands before asks even though the ask is the oldest thing here
	if items[0].RunId != "older" || items[1].RunId != "newer" || items[2].Kind != AttentionAsk {
		t.Fatalf("wrong order: %+v", items)
	}
}

func TestBuildAttentionResolvesAnAskToItsOwningRun(t *testing.T) {
	run := &waveobj.Run{ID: "r1", Goal: "g", Status: "executing",
		Phases: []waveobj.RunPhase{{State: "running", WorkerOrefs: []string{"tab:w"}}}}
	items := BuildAttention(AttentionInput{
		Channels:      []AttentionChannel{{OID: "c1", Name: "alpha", Runs: []*waveobj.Run{run}}},
		PendingAsks:   map[string]agentask.PendingAsk{"block:a": {AskId: "1", Ts: 5}},
		AskChannel:    map[string]string{"block:a": "c1"},
		AskWorker:     map[string]string{"block:a": "worker-3"},
		AskWorkerORef: map[string]string{"block:a": "tab:w"},
	})
	if len(items) != 1 || items[0].RunId != "r1" {
		t.Fatalf("ask should carry its owning run: %+v", items)
	}
}

func TestAskAndEscalationCarryTheWorkerRunsInitiative(t *testing.T) {
	run := &waveobj.Run{
		ID:        "r9",
		EffortRef: &waveobj.RunEffortRef{EffortOID: "e-2", ChunkLabel: "backfill"},
		Phases:    []waveobj.RunPhase{{State: "running", WorkerOrefs: []string{"tab:w"}}},
	}
	in := AttentionInput{
		Channels: []AttentionChannel{{OID: "c1", Name: "alpha", Runs: []*waveobj.Run{run},
			Messages: []*waveobj.ChannelMessage{escalationMsg("m1", "block:a", "tab:w", "Which order?", 900)}}},
		PendingAsks: map[string]agentask.PendingAsk{
			"block:a": {AskId: "1", Ts: 900},
			"block:b": {AskId: "2", Ts: 950, Questions: []baseds.AgentAskQuestion{{Question: "Which DB?"}}},
		},
		AskChannel:    map[string]string{"block:a": "c1", "block:b": "c1"},
		AskWorker:     map[string]string{"block:a": "worker-3", "block:b": "worker-3"},
		AskWorkerORef: map[string]string{"block:a": "tab:w", "block:b": "tab:w"},
	}
	items := BuildAttention(in)
	if len(items) != 2 {
		t.Fatalf("want an escalation and an ask, got %+v", items)
	}
	esc, ask := items[0], items[1]
	if esc.Kind != AttentionEscalation || ask.Kind != AttentionAsk {
		t.Fatalf("wrong order: %+v", items)
	}
	for _, it := range items {
		if it.EffortOID != "e-2" || it.ChunkLabel != "backfill" || it.RunId != "r9" {
			t.Fatalf("%s lost its worker run's attribution: %+v", it.Kind, it)
		}
	}
	if esc.Why != "Jarvis escalated this instead of answering it; worker-3 is paused until it is decided." {
		t.Fatalf("escalation why-line: %q", esc.Why)
	}
	if ask.Why != "worker-3 is paused until you answer." {
		t.Fatalf("ask why-line: %q", ask.Why)
	}
}

func TestDagGateAndBlockedWhyCountSkippedTasksAsFinished(t *testing.T) {
	tasks := []waveobj.TaskNode{
		{ID: "t-1", State: "done"},
		{ID: "t-2", State: "skipped"},
		{ID: "t-3", Label: "merge", State: "done", Gate: true, LastActivity: 40},
		{ID: "t-4", State: "pending"},
	}
	gate := BuildAttention(AttentionInput{Dags: []*waveobj.TaskGroup{
		{ID: "d1", RunID: "r1", ChannelId: "c1", Status: "awaiting-review", Tasks: tasks, UpdatedTs: 40},
	}})
	if len(gate) != 1 || gate[0].Kind != AttentionDagGate {
		t.Fatalf("want one dag gate, got %+v", gate)
	}
	want := "3 of 4 tasks done. Everything downstream stays queued until this one is released."
	if gate[0].Why != want {
		t.Fatalf("dag-gate why-line:\n got %q\nwant %q", gate[0].Why, want)
	}

	blocked := BuildAttention(AttentionInput{Dags: []*waveobj.TaskGroup{
		{ID: "d1", RunID: "r1", ChannelId: "c1", Status: "blocked", Failures: 3, Tasks: tasks, UpdatedTs: 40},
	}})
	wantBlocked := "3 of 4 tasks done. The group stays stopped until you retry or skip."
	if blocked[0].Why != wantBlocked {
		t.Fatalf("dag-blocked why-line:\n got %q\nwant %q", blocked[0].Why, wantBlocked)
	}
}

func TestBlockedReviewFailedNamesTheReviewAndItsActions(t *testing.T) {
	items := BuildAttention(AttentionInput{Dags: []*waveobj.TaskGroup{{
		ID: "d1", RunID: "r1", ChannelId: "c1", Status: "blocked", UpdatedTs: 5,
		Tasks: []waveobj.TaskNode{
			{ID: "t-1", Label: "Restore the steering RPCs", State: "review-failed", ReviewNote: "reviewer gave no verdict within 20m0s"},
			{ID: "t-2", State: "pending"},
		},
	}}})
	if len(items) != 1 {
		t.Fatalf("items = %+v, want the one blocked dag", items)
	}
	it := items[0]
	if want := "Review of Restore the steering RPCs failed: reviewer gave no verdict within 20m0s"; it.Text != want {
		t.Fatalf("text = %q, want %q", it.Text, want)
	}
	for _, want := range []string{"0 of 2 tasks done.", "wsh jarvis dag approve t-1", "wsh jarvis dag sendback t-1"} {
		if !strings.Contains(it.Why, want) {
			t.Fatalf("why = %q, want %q in it", it.Why, want)
		}
	}
	if strings.Contains(it.Text+it.Why, "consecutive failures") {
		t.Fatalf("a review failure read as a failure count: %q / %q", it.Text, it.Why)
	}
	if it.TaskId != "t-1" || it.Retry {
		t.Fatalf("taskid/retry = %q/%v, want t-1/false", it.TaskId, it.Retry)
	}
}

func TestBlockedReviewFailedOutranksAMerge(t *testing.T) {
	items := BuildAttention(AttentionInput{Dags: []*waveobj.TaskGroup{{
		ID: "d1", RunID: "r1", ChannelId: "c1", Status: "blocked",
		Tasks: []waveobj.TaskNode{{ID: "t-1", State: "blocked-merge"}, {ID: "t-2", State: "review-failed", ReviewNote: "two rounds failed"}},
	}}})
	if !strings.HasPrefix(items[0].Text, "Review of t-2 failed") || items[0].TaskId != "t-2" {
		t.Fatalf("got %q (task %q), want t-2's review first, as the digest ranks it", items[0].Text, items[0].TaskId)
	}
}

func TestBlockedFailedTaskNamesItsFailureNotACount(t *testing.T) {
	items := BuildAttention(AttentionInput{Dags: []*waveobj.TaskGroup{{
		ID: "d1", RunID: "r1", ChannelId: "c1", Status: "blocked", Failures: 1,
		Tasks: []waveobj.TaskNode{{ID: "t-1", State: "failed", LastFailureKind: "exited"}},
	}}})
	if items[0].Text != "t-1 failed: exited" || !strings.Contains(items[0].Why, "wsh jarvis dag retry t-1") || strings.Contains(items[0].Text, "consecutive") {
		t.Fatalf("got %q / %q", items[0].Text, items[0].Why)
	}
}

func TestBlockedWithNoNamedCauseListsTheTasks(t *testing.T) {
	items := BuildAttention(AttentionInput{Dags: []*waveobj.TaskGroup{{
		ID: "d1", RunID: "r1", ChannelId: "c1", Status: "blocked",
		Tasks: []waveobj.TaskNode{{ID: "t-1", State: "done"}, {ID: "t-2", State: "stalled"}},
	}}})
	if items[0].Text != "The group is blocked: t-2 is stalled" || !strings.Contains(items[0].Why, "wsh jarvis dag status") {
		t.Fatalf("got %q / %q", items[0].Text, items[0].Why)
	}
}

func TestBlockedWithNothingToNameSaysSo(t *testing.T) {
	items := BuildAttention(AttentionInput{Dags: []*waveobj.TaskGroup{{
		ID: "d1", RunID: "r1", ChannelId: "c1", Status: "blocked",
		Tasks: []waveobj.TaskNode{{ID: "t-1", State: "done"}, {ID: "t-2", State: "pending"}},
	}}})
	if items[0].Text != "The group is blocked." {
		t.Fatalf("text = %q, want no dangling list", items[0].Text)
	}
}

func TestTriageWhySplitsNewFromRecurring(t *testing.T) {
	dismissed := &waveobj.RadarDisposition{}
	items := BuildAttention(AttentionInput{Radar: []*waveobj.RadarReport{{
		OID: uuid.NewString(), ProjectPath: "/p", ProjectName: "p", Status: radarStatusCompleted, CompletedTs: 7,
		Findings: []waveobj.RadarFinding{
			{Group: radarGroupNew},
			{Group: radarGroupRecurring},
			{Group: radarGroupRecurring},
			{Group: radarGroupNew, Disposition: dismissed},
		},
	}}})
	if len(items) != 1 {
		t.Fatalf("want one triage row, got %+v", items)
	}
	if items[0].Text != "3 findings need triage." {
		t.Fatalf("the total must still exclude the decided finding: %q", items[0].Text)
	}
	if items[0].Why != "1 new and 2 recurring, none of them ruled on yet." {
		t.Fatalf("triage why-line: %q", items[0].Why)
	}
}

func TestBlockedMergeNamesWhereToFixIt(t *testing.T) {
	blocked := func(run *waveobj.Run, state string) string {
		t.Helper()
		items := BuildAttention(AttentionInput{
			Channels: []AttentionChannel{{OID: "c1", Runs: []*waveobj.Run{run}}},
			Dags: []*waveobj.TaskGroup{{
				ID: "d1", RunID: run.ID, ChannelId: "c1", Status: "blocked", UpdatedTs: 5,
				Tasks: []waveobj.TaskNode{{ID: "t-2", State: state}},
			}},
		})
		if len(items) != 1 {
			t.Fatalf("items = %+v, want the one blocked dag", items)
		}
		return items[0].Why
	}
	tree := "/p/.waveterm/worktrees/r1"
	landed := &waveobj.Run{ID: "r1", ProjectPath: "/p", LandPath: tree}
	checkout := &waveobj.Run{ID: "r2", ProjectPath: "/p"}
	if why := blocked(landed, "blocked-merge"); !strings.Contains(why, "Resolve the conflict in "+tree+",") {
		t.Fatalf("why = %q, want it to name the landing tree", why)
	}
	if why := blocked(checkout, "blocked-merge"); !strings.Contains(why, "Resolve the conflict in the project checkout,") {
		t.Fatalf("why = %q, want the project checkout", why)
	}
	// a fix committed on the human's branch would leave the run's Verify failing
	if why := blocked(landed, "verify-failed"); !strings.Contains(why, "Commit a fix in "+tree+",") {
		t.Fatalf("why = %q, want it to name the landing tree", why)
	}
	if why := blocked(checkout, "verify-failed"); !strings.Contains(why, "Commit a fix in the project checkout,") {
		t.Fatalf("why = %q, want the project checkout", why)
	}
}

func TestDagItemsNameTheirTask(t *testing.T) {
	gate := BuildAttention(AttentionInput{Dags: []*waveobj.TaskGroup{{
		ID: "d1", RunID: "r1", ChannelId: "c1", Status: "awaiting-review", UpdatedTs: 5,
		Tasks: []waveobj.TaskNode{{ID: "t-3", State: "done", Gate: true, LastActivity: 5}},
	}}})
	if len(gate) != 1 || gate[0].TaskId != "t-3" {
		t.Fatalf("dag gate = %+v, want TaskId t-3", gate)
	}
	failed := BuildAttention(AttentionInput{Dags: []*waveobj.TaskGroup{{
		ID: "d2", RunID: "r2", ChannelId: "c1", Status: "blocked", Failures: 2, UpdatedTs: 5,
		Tasks: []waveobj.TaskNode{{ID: "t-1", State: "done"}, {ID: "t-4", State: "failed"}},
	}}})
	if failed[0].TaskId != "t-4" || !failed[0].Retry {
		t.Fatalf("circuit break = %+v, want TaskId t-4 and Retry", failed[0])
	}
	merge := BuildAttention(AttentionInput{Dags: []*waveobj.TaskGroup{{
		ID: "d3", RunID: "r3", ChannelId: "c1", Status: "blocked", UpdatedTs: 5,
		Tasks: []waveobj.TaskNode{{ID: "t-2", State: "blocked-merge"}},
	}}})
	if merge[0].TaskId != "t-2" || merge[0].Retry {
		t.Fatalf("merge block = %+v, want TaskId t-2 and no Retry", merge[0])
	}
}

func TestBlockedFinalStageSaysWhatFailed(t *testing.T) {
	items := BuildAttention(AttentionInput{Dags: []*waveobj.TaskGroup{{
		ID: "d1", RunID: "r1", ChannelId: "c1", Status: "blocked", UpdatedTs: 5,
		Tasks: []waveobj.TaskNode{{ID: "t-1", State: "done"}},
		Final: &waveobj.FinalStage{State: "failed", Round: 1, Detail: "Check `go vet ./...` failed (exit 1):\nvet: x.go:3: unreachable code"},
	}}})
	if len(items) != 1 {
		t.Fatalf("items = %+v, want the one blocked dag", items)
	}
	if want := "The final stage failed on the merged result: Check `go vet ./...` failed (exit 1)"; items[0].Text != want {
		t.Fatalf("text = %q, want %q", items[0].Text, want)
	}
	if !strings.Contains(items[0].Why, "wsh jarvis dag submit --round") {
		t.Fatalf("why = %q, want the fix round named", items[0].Why)
	}
}

func TestDagItemsLeaveWithTheirFinishedRun(t *testing.T) {
	dags := []*waveobj.TaskGroup{
		{ID: "d1", RunID: "r1", ChannelId: "c1", Status: "blocked", UpdatedTs: 5,
			Tasks: []waveobj.TaskNode{{ID: "t-1", State: "done"}}, Final: &waveobj.FinalStage{State: "failed", Round: 2}},
		{ID: "d2", RunID: "r2", ChannelId: "c1", Status: "awaiting-review", UpdatedTs: 5,
			Tasks: []waveobj.TaskNode{{ID: "t-1", State: "done", Gate: true}}},
		{ID: "d3", RunID: "r3", ChannelId: "c1", Status: "blocked", UpdatedTs: 5,
			Tasks: []waveobj.TaskNode{{ID: "t-1", State: "failed"}}},
	}
	cancelled := finishedRun("r2", nil, nil)
	cancelled.Status = "cancelled"
	items := BuildAttention(AttentionInput{Dags: dags, Channels: []AttentionChannel{{OID: "c1", Runs: []*waveobj.Run{
		finishedRun("r1", nil, &waveobj.RunLand{State: "landed"}),
		cancelled,
		{ID: "r3", Status: "executing"},
	}}}})
	if len(items) != 1 || items[0].RunId != "r3" {
		t.Fatalf("items = %+v, want only the executing run's blocked dag", items)
	}
}

func finishedRun(id string, ev *waveobj.RunEvidence, land *waveobj.RunLand) *waveobj.Run {
	return &waveobj.Run{ID: id, Goal: "coupon codes", Status: "done", CompletedTs: 40, Evidence: ev, Land: land}
}

func itemsOfKind(items []wshrpc.AttentionItem, kind string) []wshrpc.AttentionItem {
	var out []wshrpc.AttentionItem
	for _, it := range items {
		if it.Kind == kind {
			out = append(out, it)
		}
	}
	return out
}

func TestUnverifiedRunNamesEachReasonUntilAcknowledged(t *testing.T) {
	unverified := &waveobj.RunEvidence{Verification: &waveobj.RunVerification{
		State: "unverified", Reasons: []string{"t-2: the timeout path has no test", "the plan has no Verify"},
	}}
	moved := &waveobj.RunLand{State: "landed", Notes: []string{"merged onto 2 commits that landed on main during the run; the combination was not verified"}}
	passed := &waveobj.RunEvidence{Verification: &waveobj.RunVerification{State: "passed"}}
	acked := finishedRun("r4", unverified, nil)
	acked.VerificationAckTs = 50
	items := BuildAttention(AttentionInput{Channels: []AttentionChannel{{OID: "c1", Name: "alpha", Runs: []*waveobj.Run{
		finishedRun("r1", unverified, nil),
		finishedRun("r2", passed, moved),
		finishedRun("r3", passed, &waveobj.RunLand{State: "landed"}),
		acked,
	}}}})
	got := itemsOfKind(items, AttentionRunUnverified)
	if len(got) != 2 || got[0].RunId != "r1" || got[1].RunId != "r2" {
		t.Fatalf("run-unverified items = %+v, want r1 and r2", got)
	}
	for _, want := range []string{"t-2: the timeout path has no test", "the plan has no Verify"} {
		if !strings.Contains(got[0].Why, want) {
			t.Fatalf("r1 why = %q, want %q named", got[0].Why, want)
		}
	}
	if !strings.Contains(got[1].Why, "merged onto 2 commits") {
		t.Fatalf("r2 why = %q, want the land note named", got[1].Why)
	}
	if got[0].Key != "run-unverified:r1" || got[0].ChannelId != "c1" || got[0].Action != "Acknowledge" || !strings.Contains(got[0].Why, "wsh runs ack r1") {
		t.Fatalf("r1 item = %+v", got[0])
	}
}

func TestHeldLandSaysWhy(t *testing.T) {
	items := BuildAttention(AttentionInput{Channels: []AttentionChannel{{OID: "c1", Name: "alpha", Runs: []*waveobj.Run{
		finishedRun("r1", nil, &waveobj.RunLand{State: "held", Reason: "the checkout is on x, not main"}),
		finishedRun("r2", nil, &waveobj.RunLand{State: "pending"}),
		finishedRun("r3", nil, &waveobj.RunLand{State: "held", Reason: "the merge conflicts with main", Dismissed: true}),
	}}}})
	got := itemsOfKind(items, AttentionRunLandHeld)
	if len(got) != 1 || got[0].RunId != "r1" || got[0].Key != "run-land-held:r1" {
		t.Fatalf("run-land-held items = %+v, want r1", got)
	}
	if !strings.Contains(got[0].Text, "the checkout is on x, not main") || !strings.Contains(got[0].Why, "wsh runs land r1") {
		t.Fatalf("item = %+v, want the reason and the retry named", got[0])
	}
}

func TestHeldLandOnAFailedFinalNamesTheFailingStep(t *testing.T) {
	held := func(id string) *waveobj.Run {
		return finishedRun(id, nil, &waveobj.RunLand{State: "held", Reason: "the final stage failed"})
	}
	dag := func(runID string, final *waveobj.FinalStage) *waveobj.TaskGroup {
		return &waveobj.TaskGroup{OID: "g-" + runID, RunID: runID, Status: "blocked", Final: final}
	}
	shots := &waveobj.FinalStage{State: "failed", Round: 2, Detail: "Final `x` failed (exit 1):\n...", Shots: []waveobj.FinalShot{
		{Name: "launcher", Steps: []waveobj.FinalShotStep{
			{Step: "4. in Project, ArrowDown moves the pick", State: "pass"},
			{Step: "5. Terminal's digit picks it", State: "fail", Detail: "{}"},
			{Step: "9. Escape closes it", State: "fail"},
		}},
		{Name: "launcher-resume", Steps: []waveobj.FinalShotStep{{Step: "1. lists the session", State: "fail"}}},
	}}
	items := BuildAttention(AttentionInput{
		Channels: []AttentionChannel{{OID: "c1", Name: "alpha", Runs: []*waveobj.Run{held("r1"), held("r2"), held("r3")}}},
		Dags: []*waveobj.TaskGroup{
			dag("r1", shots),
			dag("r2", &waveobj.FinalStage{State: "failed", Detail: "Final `go test ./...` failed (exit 1):\n--- FAIL: TestX"}),
		},
	})
	got := itemsOfKind(items, AttentionRunLandHeld)
	if len(got) != 3 {
		t.Fatalf("run-land-held items = %+v, want 3", got)
	}
	byRun := map[string]wshrpc.AttentionItem{}
	for _, it := range got {
		byRun[it.RunId] = it
	}
	if r1 := byRun["r1"]; r1.Text != "The final stage failed at launcher, 5. Terminal's digit picks it (and 2 more steps)" {
		t.Fatalf("r1 text = %q, want the first failing step and the count of the rest", r1.Text)
	}
	if r2 := byRun["r2"]; r2.Text != "The final stage failed: Final `go test ./...` failed (exit 1)" {
		t.Fatalf("r2 text = %q, want the detail's first line without a steps manifest", r2.Text)
	}
	if r3 := byRun["r3"]; r3.Text != "The run's branch was not merged back: the final stage failed" {
		t.Fatalf("r3 text = %q, want the plain reason when the dag is not loaded", r3.Text)
	}
	for _, it := range got {
		// landing again only reads the same failed stage: the way out is the forced land, and no fix clears it
		if !strings.Contains(it.Why, "wsh runs land "+it.RunId+" --force") || strings.Contains(it.Why, "Clear the reason") {
			t.Fatalf("%s why = %q, want the forced land named and no clear-the-reason advice", it.RunId, it.Why)
		}
	}
}

func TestGoalHeadline(t *testing.T) {
	long := strings.Repeat("é", 100)
	cases := []struct{ goal, want string }{
		{"ship coupons", "ship coupons"},
		{"", ""},
		{"Fix five findings\nfrom the doc:\n(1) ...", "Fix five findings"},
		{"\n\n  first real line  \nsecond", "first real line"},
		{long, strings.Repeat("é", attentionSourceMaxLen-1) + "…"},
	}
	for _, c := range cases {
		if got := goalHeadline(c.goal); got != c.want {
			t.Errorf("goalHeadline(%q) = %q, want %q", c.goal, got, c.want)
		}
	}
}

func TestBuildAttentionShortensEveryGoalSource(t *testing.T) {
	goal := "Fix the attention row " + strings.Repeat("and more words ", 20) + "\n(1) a long second line"
	want := goalHeadline(goal)
	held := &waveobj.Run{ID: "r2", Goal: goal, Land: &waveobj.RunLand{State: "held", Reason: "dirty"}}
	unverified := &waveobj.Run{ID: "r3", Goal: goal, Status: RunStatus_Done,
		Evidence: &waveobj.RunEvidence{Verification: &waveobj.RunVerification{State: "unverified", Reasons: []string{"no check"}}}}
	items := BuildAttention(AttentionInput{Channels: []AttentionChannel{
		{OID: "c1", Name: "alpha", Runs: []*waveobj.Run{held, unverified}},
	}})
	if len(items) != 2 {
		t.Fatalf("want 2 items, got %+v", items)
	}
	for _, it := range items {
		if it.Source != want {
			t.Errorf("%s source = %q, want %q", it.Kind, it.Source, want)
		}
	}
}
