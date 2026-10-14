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
