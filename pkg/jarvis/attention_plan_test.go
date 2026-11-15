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
// of the newest one, so its review opens that agent, an engine worker included.
func TestPlanReviewNamesTheProposer(t *testing.T) {
	e := dueEffort("e1", "active", dueChunk("A", "done", ""))
	if err := ApplyEffortOpsAs(e, []wshrpc.EffortOp{{Op: "addChunk", Label: "P1", Status: "proposed"}}, "", 100,
		NoteAuthor{Who: "agent", Session: "agent:lead", Run: "run:r1"}); err != nil {
		t.Fatal(err)
	}
	if err := ApplyEffortOpsAs(e, []wshrpc.EffortOp{{Op: "addChunk", Label: "P2", Status: "proposed"}}, "", 200,
		NoteAuthor{Who: "agent", Session: "agent:worker", Run: "run:r2"}); err != nil {
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
