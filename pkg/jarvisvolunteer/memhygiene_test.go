// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvisvolunteer

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func hygieneProducer(ps []wshrpc.MemHygieneProject) *MemoryHygieneProducer {
	return &MemoryHygieneProducer{listProjects: func() ([]wshrpc.MemHygieneProject, error) { return ps, nil }}
}

func changes(statuses ...string) []wshrpc.MemChange {
	out := make([]wshrpc.MemChange, len(statuses))
	for i, s := range statuses {
		out[i] = wshrpc.MemChange{Status: s}
	}
	return out
}

func TestMemoryHygieneProducerOnePerProjectWithOpenChanges(t *testing.T) {
	ps := []wshrpc.MemHygieneProject{
		{Project: "waveterm", CheckedAt: 1000, Changes: changes("open", "applied", "open", "kept")},
		{Project: "decided", CheckedAt: 2000, Changes: changes("applied", "kept", "conflict")},
		{Project: "empty", CheckedAt: 3000, Changes: []wshrpc.MemChange{}},
		{Project: "single", CheckedAt: 4000, Changes: changes("open")},
	}
	got, err := hygieneProducer(ps).Candidates(context.Background(), &Trigger{Kind: TriggerSweep})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want one candidate per project with open changes (2), got %+v", got)
	}
	want := Candidate{
		Class:      ClassMemoryHygiene,
		ID:         "memory-hygiene:waveterm:1000",
		At:         1000,
		Title:      "waveterm's memory has 2 changes to review",
		SourceType: "memhygiene",
		SourceRef:  "memhygiene:waveterm",
	}
	if got[0] != want {
		t.Fatalf("candidate = %+v, want %+v", got[0], want)
	}
	if got[1].SourceRef != "memhygiene:single" || got[1].Title != "single's memory has 1 change to review" {
		t.Fatalf("second candidate = %+v", got[1])
	}
}

func TestMemoryHygieneCandidateStampedFromCheck(t *testing.T) {
	ps := []wshrpc.MemHygieneProject{{Project: "waveterm", CheckedAt: 1000, Changes: changes("open")}}
	p := hygieneProducer(ps)
	first, _ := p.Candidates(context.Background(), &Trigger{Kind: TriggerSweep})
	second, _ := p.Candidates(context.Background(), &Trigger{Kind: TriggerSweep})
	if len(first) != 1 || len(second) != 1 {
		t.Fatalf("want one candidate per call, got %d and %d", len(first), len(second))
	}
	if first[0].ID != second[0].ID || first[0].At != second[0].At {
		t.Fatalf("unchanged state must re-emit the same pair: %s@%d vs %s@%d", first[0].ID, first[0].At, second[0].ID, second[0].At)
	}
	if first[0].At != 1000 {
		t.Fatalf("At = %d, want the check's time", first[0].At)
	}
}

func TestSweepIncludesMemoryHygieneProducer(t *testing.T) {
	for _, p := range producersFor(&Trigger{Kind: TriggerSweep}) {
		if p.Name() == ClassMemoryHygiene {
			return
		}
	}
	t.Fatal("sweep producers must include memory hygiene")
}
