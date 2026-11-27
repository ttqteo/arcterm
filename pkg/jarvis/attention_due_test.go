// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func dueEffort(oid, status string, chunks ...waveobj.EffortChunk) *waveobj.Effort {
	return &waveobj.Effort{OID: oid, Title: "Nav rail", Status: status, Chunks: chunks}
}

func dueChunk(label, status, due string) waveobj.EffortChunk {
	return waveobj.EffortChunk{Label: label, Status: status, Due: due}
}

func dueKeys(in AttentionInput) []string {
	var out []string
	for _, it := range BuildAttention(in) {
		if it.Kind == AttentionChunkDue {
			out = append(out, it.Key)
		}
	}
	return out
}

func TestChunkDueComesDueOnItsDay(t *testing.T) {
	e := dueEffort("e1", "active",
		dueChunk("re-measure", "pending", "2026-10-20"),
		dueChunk("later", "pending", "2026-10-21"),
		dueChunk("undated", "pending", ""),
	)
	if got := dueKeys(AttentionInput{Efforts: []*waveobj.Effort{e}, Today: "2026-10-19"}); len(got) != 0 {
		t.Fatalf("the day before: %v", got)
	}
	got := dueKeys(AttentionInput{Efforts: []*waveobj.Effort{e}, Today: "2026-10-20"})
	if len(got) != 1 || got[0] != "chunk-due:e1:re-measure:2026-10-20" {
		t.Fatalf("on the day: %v", got)
	}
	// still waiting the days after: nothing fires at the date, it stays until the chunk is dealt with
	if got := dueKeys(AttentionInput{Efforts: []*waveobj.Effort{e}, Today: "2026-11-02"}); len(got) != 2 {
		t.Fatalf("weeks later: %v", got)
	}
}

func TestChunkDueLeavesWhenDealtWith(t *testing.T) {
	for _, status := range []string{"done", "deferred", "skipped"} {
		e := dueEffort("e1", "active", dueChunk("re-measure", status, "2026-10-20"))
		if got := dueKeys(AttentionInput{Efforts: []*waveobj.Effort{e}, Today: "2026-10-20"}); len(got) != 0 {
			t.Fatalf("%s chunk still due: %v", status, got)
		}
	}
	for _, status := range []string{"pending", "active", "blocked"} {
		e := dueEffort("e1", "active", dueChunk("re-measure", status, "2026-10-20"))
		if got := dueKeys(AttentionInput{Efforts: []*waveobj.Effort{e}, Today: "2026-10-20"}); len(got) != 1 {
			t.Fatalf("%s chunk not due: %v", status, got)
		}
	}
}

// a later chunk never needs you, whatever its date: the Later section shows its due chip instead
func TestChunkDueSkipsLater(t *testing.T) {
	later := dueChunk("decide which parser takes the logs", "pending", "2026-10-20")
	later.Later = true
	plan := dueChunk("re-measure", "pending", "2026-10-20")
	e := dueEffort("e1", "active", later, plan)
	got := dueKeys(AttentionInput{Efforts: []*waveobj.Effort{e}, Today: "2026-11-02"})
	if len(got) != 1 || got[0] != "chunk-due:e1:re-measure:2026-10-20" {
		t.Fatalf("keys: %v, want only the plan chunk's", got)
	}
	for _, status := range []string{"pending", "active", "blocked"} {
		c := dueChunk("saved", status, "2026-10-20")
		c.Later = true
		if got := dueKeys(AttentionInput{Efforts: []*waveobj.Effort{dueEffort("e1", "active", c)}, Today: "2026-11-02"}); len(got) != 0 {
			t.Fatalf("a %s later chunk came due: %v", status, got)
		}
	}
	// "Not later" puts it back where a due chunk belongs
	later.Later = false
	if got := dueKeys(AttentionInput{Efforts: []*waveobj.Effort{dueEffort("e1", "active", later)}, Today: "2026-11-02"}); len(got) != 1 {
		t.Fatalf("a chunk that is no longer later: %v", got)
	}
}

func TestChunkDueOnlyInInitiativesInPlay(t *testing.T) {
	for status, want := range map[string]int{"active": 1, "paused": 1, "done": 0, "archived": 0} {
		e := dueEffort("e1", status, dueChunk("re-measure", "pending", "2026-10-20"))
		if got := dueKeys(AttentionInput{Efforts: []*waveobj.Effort{e}, Today: "2026-10-20"}); len(got) != want {
			t.Fatalf("%s initiative: %v, want %d", status, got, want)
		}
	}
}

func TestChunkDueItemShape(t *testing.T) {
	e := dueEffort("e1", "active", dueChunk("re-measure", "pending", "2026-10-20"))
	items := BuildAttention(AttentionInput{Efforts: []*waveobj.Effort{e}, Today: "2026-10-21"})
	if len(items) != 1 {
		t.Fatalf("items: %+v", items)
	}
	it := items[0]
	if it.Source != "Nav rail" || it.Text != "re-measure" || it.Action != "Open" || it.Why != "Due 2026-10-20." {
		t.Fatalf("row text: %+v", it)
	}
	if it.ORef != "effort:e1" || it.EffortOID != "e1" || it.ChunkLabel != "re-measure" || it.ChannelId != "" {
		t.Fatalf("address: %+v", it)
	}
	if it.WaitingSince == 0 {
		t.Fatal("WaitingSince: want the due day's local midnight")
	}
}

// moving the date on and letting it come due again is a new key, so the bubble fires again
func TestChunkDueKeyCarriesTheDate(t *testing.T) {
	a := dueKeys(AttentionInput{Efforts: []*waveobj.Effort{dueEffort("e1", "active", dueChunk("m", "pending", "2026-10-20"))}, Today: "2026-11-30"})
	b := dueKeys(AttentionInput{Efforts: []*waveobj.Effort{dueEffort("e1", "active", dueChunk("m", "pending", "2026-11-03"))}, Today: "2026-11-30"})
	if len(a) != 1 || len(b) != 1 || a[0] == b[0] {
		t.Fatalf("keys: %v %v", a, b)
	}
}

func TestChunkDueNeedsToday(t *testing.T) {
	e := dueEffort("e1", "active", dueChunk("re-measure", "pending", "2026-10-20"))
	if got := dueKeys(AttentionInput{Efforts: []*waveobj.Effort{e}}); len(got) != 0 {
		t.Fatalf("no Today: %v", got)
	}
}

// a due chunk is a date you set yourself, behind even a finished run's unverified outcome, the kind just ahead of it
func TestChunkDueSortsLast(t *testing.T) {
	unverified := &waveobj.RunEvidence{Verification: &waveobj.RunVerification{State: "unverified", Reasons: []string{"no check"}}}
	in := AttentionInput{
		Channels: []AttentionChannel{{OID: "c1", Name: "alpha", Runs: []*waveobj.Run{finishedRun("r1", unverified, nil)}}},
		Efforts:  []*waveobj.Effort{dueEffort("e1", "active", dueChunk("m", "pending", "2026-01-01"))},
		Today:    "2026-10-20",
	}
	items := BuildAttention(in)
	if len(items) != 2 || items[0].Kind != AttentionRunUnverified || items[1].Kind != AttentionChunkDue {
		t.Fatalf("order: %+v", items)
	}
}
