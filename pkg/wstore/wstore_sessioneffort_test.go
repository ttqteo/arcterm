// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// seedEffortTab stores an agent block naming transcript and returns an unsaved tab holding it with tabMeta
func seedEffortTab(t *testing.T, tabMeta waveobj.MetaMapType, transcript string) *waveobj.Tab {
	t.Helper()
	tab := &waveobj.Tab{OID: uuid.NewString(), Meta: tabMeta}
	block := &waveobj.Block{OID: uuid.NewString(), ParentORef: "tab:" + tab.OID, Meta: waveobj.MetaMapType{}}
	if transcript != "" {
		block.Meta[waveobj.MetaKey_AgentTranscriptPath] = transcript
	}
	if err := DBInsert(context.Background(), block); err != nil {
		t.Fatal(err)
	}
	tab.BlockIds = []string{block.OID}
	return tab
}

// sessionEffortsFor is every stored row for transcript
func sessionEffortsFor(t *testing.T, transcript string) []SessionEffort {
	t.Helper()
	all, err := GetSessionEfforts(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var out []SessionEffort
	for _, se := range all {
		if se.Transcript == transcript {
			out = append(out, se)
		}
	}
	return out
}

// a re-tagged session keeps one row, naming the later initiative by its bare oid
func TestRecordTabSessionEffortUpserts(t *testing.T) {
	ctx := context.Background()
	transcript := "/projects/C--repo/" + uuid.NewString() + ".jsonl"
	tab := seedEffortTab(t, waveobj.MetaMapType{
		waveobj.MetaKey_SessionAgent: "claude", waveobj.MetaKey_SessionEffort: "effort:first",
	}, transcript)
	if err := RecordTabSessionEffort(ctx, tab); err != nil {
		t.Fatal(err)
	}
	tab.Meta[waveobj.MetaKey_SessionEffort] = "effort:second"
	if err := RecordTabSessionEffort(ctx, tab); err != nil {
		t.Fatal(err)
	}
	got := sessionEffortsFor(t, transcript)
	if len(got) != 1 || got[0].Harness != "claude" || got[0].EffortOID != "second" || got[0].Ts == 0 {
		t.Fatalf("want one claude row for effort second, got %+v", got)
	}
}

// a tab whose agent wrote no transcript, or that has no tag or agent, records nothing and does not fail
func TestRecordTabSessionEffortSkipsNoTranscript(t *testing.T) {
	ctx := context.Background()
	transcript := "/projects/C--repo/" + uuid.NewString() + ".jsonl"
	cases := []*waveobj.Tab{
		seedEffortTab(t, waveobj.MetaMapType{waveobj.MetaKey_SessionAgent: "claude", waveobj.MetaKey_SessionEffort: "effort:e"}, ""),
		seedEffortTab(t, waveobj.MetaMapType{waveobj.MetaKey_SessionAgent: "claude"}, transcript),
		seedEffortTab(t, waveobj.MetaMapType{waveobj.MetaKey_SessionEffort: "effort:e"}, transcript),
		{OID: uuid.NewString(), Meta: waveobj.MetaMapType{waveobj.MetaKey_SessionAgent: "claude", waveobj.MetaKey_SessionEffort: "effort:e"}},
	}
	before, err := GetSessionEfforts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for i, tab := range cases {
		if err := RecordTabSessionEffort(ctx, tab); err != nil {
			t.Fatalf("case %d: %v", i, err)
		}
	}
	after, err := GetSessionEfforts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(before) {
		t.Fatalf("want no new rows, got %d before and %d after", len(before), len(after))
	}
}

// the agent's block need not be first: with it closed under its dock terminal, or a terminal ahead of it, the tab's
// first block names no transcript
func TestRecordTabSessionEffortFindsTheAgentBlock(t *testing.T) {
	ctx := context.Background()
	transcript := "/projects/C--repo/" + uuid.NewString() + ".jsonl"
	tab := seedEffortTab(t, waveobj.MetaMapType{
		waveobj.MetaKey_SessionAgent: "claude", waveobj.MetaKey_SessionEffort: "effort:dock",
	}, transcript)
	dock := &waveobj.Block{OID: uuid.NewString(), ParentORef: "tab:" + tab.OID, Meta: waveobj.MetaMapType{}}
	if err := DBInsert(ctx, dock); err != nil {
		t.Fatal(err)
	}
	tab.BlockIds = append([]string{dock.OID}, tab.BlockIds...)
	if err := RecordTabSessionEffort(ctx, tab); err != nil {
		t.Fatal(err)
	}
	if got := sessionEffortsFor(t, transcript); len(got) != 1 || got[0].EffortOID != "dock" {
		t.Fatalf("want one row for effort dock, got %+v", got)
	}
}

// a block recorded on its own, as DeleteBlock does before the tab loses it
func TestRecordBlockSessionEffort(t *testing.T) {
	ctx := context.Background()
	transcript := "/projects/C--repo/" + uuid.NewString() + ".jsonl"
	tab := &waveobj.Tab{OID: uuid.NewString(), Meta: waveobj.MetaMapType{
		waveobj.MetaKey_SessionAgent: "claude", waveobj.MetaKey_SessionEffort: "effort:last",
	}}
	block := &waveobj.Block{OID: uuid.NewString(), Meta: waveobj.MetaMapType{waveobj.MetaKey_AgentTranscriptPath: transcript}}
	if err := RecordBlockSessionEffort(ctx, tab, block); err != nil {
		t.Fatal(err)
	}
	if got := sessionEffortsFor(t, transcript); len(got) != 1 || got[0].EffortOID != "last" {
		t.Fatalf("want one row for effort last, got %+v", got)
	}
}
