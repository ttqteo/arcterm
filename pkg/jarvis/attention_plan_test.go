// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func planItems(in AttentionInput) []wshrpc.AttentionItem {
	var out []wshrpc.AttentionItem
	for _, it := range BuildAttention(in) {
		if it.Kind == AttentionPlanReview {
			out = append(out, it)
		}
	}
	return out
}

func TestPlanReviewOnePerInitiative(t *testing.T) {
	e := dueEffort("e1", "active", dueChunk("A", "done", ""),
		waveobj.EffortChunk{Label: "P1", Status: "proposed", UpdatedTs: 20},
		waveobj.EffortChunk{Label: "P2", Status: "proposed", UpdatedTs: 10})
	got := planItems(AttentionInput{Efforts: []*waveobj.Effort{e}})
	if len(got) != 1 || got[0].Key != "plan-review:e1" || got[0].Text != "2 proposed" ||
		got[0].ORef != "effort:e1" || got[0].EffortOID != "e1" || got[0].WaitingSince != 10 {
		t.Fatalf("items: %+v", got)
	}
}

// A chunk an agent proposes from its terminal keeps its session in a "proposed" note, and the item names the session
// of the newest one, so its review opens that agent. These agents are outside any run: a proposal that names a run
// is To review's, not Needs you's (TestPlanReviewSkipsRunProposals).
func TestPlanReviewNamesTheProposer(t *testing.T) {
	e := dueEffort("e1", "active", dueChunk("A", "done", ""))
	if err := ApplyEffortOpsAs(e, []wshrpc.EffortOp{{Op: "addChunk", Label: "P1", Status: "proposed"}}, "", 100,
		NoteAuthor{Who: "agent", Session: "agent:lead"}); err != nil {
		t.Fatal(err)
	}
	if err := ApplyEffortOpsAs(e, []wshrpc.EffortOp{{Op: "addChunk", Label: "P2", Status: "proposed"}}, "", 200,
		NoteAuthor{Who: "agent", Session: "agent:worker"}); err != nil {
		t.Fatal(err)
	}
	got := planItems(AttentionInput{Efforts: []*waveobj.Effort{e}})
	if len(got) != 1 || got[0].ProposerORef != "agent:worker" {
		t.Fatalf("items: %+v", got)
	}
	// a chunk proposed with no session (the cockpit, a script) names nobody, and adds no note
	plain := dueEffort("e2", "active", dueChunk("A", "done", ""))
	if err := ApplyEffortOpsAs(plain, []wshrpc.EffortOp{{Op: "addChunk", Label: "P", Status: "proposed"}}, "", 100,
		NoteAuthor{}); err != nil {
		t.Fatal(err)
	}
	if n := len(plain.Chunks[1].Notes); n != 0 {
		t.Fatalf("a proposal with no session wrote %d notes", n)
	}
	if got := planItems(AttentionInput{Efforts: []*waveobj.Effort{plain}}); len(got) != 1 || got[0].ProposerORef != "" {
		t.Fatalf("items: %+v", got)
	}
}

// proposeBy adds a proposed chunk the way `chunk add --proposed` does, written by author at ts.
func proposeBy(t *testing.T, e *waveobj.Effort, label string, ts int64, author NoteAuthor) {
	t.Helper()
	if err := ApplyEffortOpsAs(e, []wshrpc.EffortOp{{Op: "addChunk", Label: label, Status: "proposed"}}, "", ts, author); err != nil {
		t.Fatal(err)
	}
}

// A proposal whose "proposed" note names a run is that run's leftover: it shows in To review only, so Needs you does
// not count it. Any Run value does: a lead's, a worker's or reviewer's (a dag child), whatever its form.
func TestPlanReviewSkipsRunProposals(t *testing.T) {
	for name, note := range map[string]waveobj.EffortNote{
		"a lead's run":      {Ts: 100, Text: "proposed", Author: "agent", Session: "agent:lead", Run: "run:r1"},
		"a dag child's run": {Ts: 100, Text: "proposed", Author: "agent", Session: "agent:worker", Run: "run:r1-child"},
		"a bare run id":     {Ts: 100, Text: "proposed", Author: "agent", Session: "agent:lead", Run: "r1"},
		// the backlog pass writes a run and no session
		"the backlog's shape": {Ts: 100, Text: "proposed", Author: "agent", Run: "run:0123abcd"},
	} {
		e := dueEffort("e1", "active", dueChunk("A", "done", ""),
			waveobj.EffortChunk{Label: "P1", Status: "proposed", UpdatedTs: 100, Notes: []waveobj.EffortNote{note}})
		if got := planItems(AttentionInput{Efforts: []*waveobj.Effort{e}}); len(got) != 0 {
			t.Errorf("%s: a run's proposal raised %+v", name, got)
		}
	}
}

// An initiative raises "N proposed" for the proposals that name no run only: the run's ones are not counted, are not the
// proposer, and do not set how long it has waited.
func TestPlanReviewCountsOnlyProposalsWithNoRun(t *testing.T) {
	e := dueEffort("e1", "active", dueChunk("A", "done", ""))
	// the run's proposal is older and newer than the plain one: neither its session nor its time may show
	proposeBy(t, e, "from a run, older", 50, NoteAuthor{Who: "agent", Session: "agent:lead", Run: "run:r1"})
	proposeBy(t, e, "plain", 100, NoteAuthor{Who: "agent", Session: "agent:plain"})
	proposeBy(t, e, "from a run, newer", 200, NoteAuthor{Who: "agent", Session: "agent:worker", Run: "run:r2"})
	// a proposal with no session or note at all (the cockpit, a script) stays Needs you's, as before
	e.Chunks = append(e.Chunks, waveobj.EffortChunk{Label: "no note", Status: "proposed", UpdatedTs: 300})
	got := planItems(AttentionInput{Efforts: []*waveobj.Effort{e}})
	if len(got) != 1 {
		t.Fatalf("items: %+v", got)
	}
	if got[0].Text != "2 proposed" || got[0].ProposerORef != "agent:plain" || got[0].WaitingSince != 100 {
		t.Fatalf("item: %+v", got[0])
	}
}

// An initiative whose proposals are all a run's raises nothing, and the Jarvis badge, Sidecar and palette read the
// same list.
func TestPlanReviewRaisesNothingForOnlyRunProposals(t *testing.T) {
	e := dueEffort("e1", "active", dueChunk("A", "done", ""))
	proposeBy(t, e, "P1", 100, NoteAuthor{Who: "agent", Session: "agent:lead", Run: "run:r1"})
	proposeBy(t, e, "P2", 200, NoteAuthor{Who: "agent", Session: "agent:lead", Run: "run:r1"})
	if got := planItems(AttentionInput{Efforts: []*waveobj.Effort{e}}); len(got) != 0 {
		t.Fatalf("items: %+v", got)
	}
	for _, it := range BuildAttention(AttentionInput{Efforts: []*waveobj.Effort{e}}) {
		if it.EffortOID == "e1" {
			t.Fatalf("a run's proposals raised %+v", it)
		}
	}
}

func TestPlanReviewLeavesWhenDecided(t *testing.T) {
	e := dueEffort("e1", "active", dueChunk("A", "pending", ""))
	if got := planItems(AttentionInput{Efforts: []*waveobj.Effort{e}}); len(got) != 0 {
		t.Fatalf("items: %+v", got)
	}
}

func TestPlanReviewOnlyInPlay(t *testing.T) {
	e := dueEffort("e1", "archived", waveobj.EffortChunk{Label: "P", Status: "proposed"})
	if got := planItems(AttentionInput{Efforts: []*waveobj.Effort{e}}); len(got) != 0 {
		t.Fatalf("items: %+v", got)
	}
}
