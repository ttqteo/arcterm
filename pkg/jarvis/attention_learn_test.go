// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/learn"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestLearnItemsTurnsASkillProposalIntoACard(t *testing.T) {
	got := learnItems([]learn.Proposal{{
		ID: "skill:notes#notes-vi", Target: "skill:notes", Key: "notes-vi",
		Text: "Always write notes in Vietnamese.", Since: 1700,
		Quotes: []learn.Quote{{Quote: "q1"}, {Quote: "q2"}}, Sessions: 2,
	}})
	want := []wshrpc.AttentionItem{{
		Kind: AttentionLearnProposal, Key: "learn:skill:notes#notes-vi", LearnID: "skill:notes#notes-vi",
		Source: "Skill · notes", Text: "Always write notes in Vietnamese.", Action: "Accept",
		WaitingSince: 1700, Why: "“q1” · “q2”",
	}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v\nwant %+v", got, want)
	}
}

func TestLearnItemsNamesAMemoryByItsProject(t *testing.T) {
	for cwd, want := range map[string]string{
		`C:\Users\k\arcterm`: "Memory · arcterm",
		"/home/k/arcterm/":   "Memory · arcterm",
		"arcterm":            "Memory · arcterm",
	} {
		got := learnItems([]learn.Proposal{{
			ID: "memory:" + cwd + "#tabs", Target: "memory:" + cwd, Key: "tabs", Text: "Use tabs.", Since: 1,
		}})
		if len(got) != 1 || got[0].Source != want {
			t.Fatalf("cwd %q: source %+v, want %q", cwd, got, want)
		}
		if got[0].Why != "" {
			t.Fatalf("a proposal with no quotes has no Why: %q", got[0].Why)
		}
	}
}

func TestBuildAttentionIncludesLearnProposalsLast(t *testing.T) {
	in := AttentionInput{
		Channels: []AttentionChannel{{OID: "c1", Name: "alpha", Runs: nil}},
		Learn: []learn.Proposal{
			{ID: "skill:notes#b", Target: "skill:notes", Key: "b", Text: "B.", Since: 20},
			{ID: "skill:notes#a", Target: "skill:notes", Key: "a", Text: "A.", Since: 10},
		},
	}
	in.Channels[0].Runs = append(in.Channels[0].Runs, heldRun("r1", "ship it", 500))
	items := BuildAttention(in)
	if len(items) != 3 {
		t.Fatalf("want a held land and two proposals, got %+v", items)
	}
	if items[0].Kind != AttentionRunLandHeld {
		t.Fatalf("a proposal is the weakest claim, so it comes after a held land: %+v", items)
	}
	if items[1].LearnID != "skill:notes#a" || items[2].LearnID != "skill:notes#b" {
		t.Fatalf("proposals are oldest first: %+v", items[1:])
	}
}
