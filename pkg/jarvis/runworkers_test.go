// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"context"
	"slices"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// countIndexLoads counts the worker index's rebuilds for the rest of the test.
func countIndexLoads(t *testing.T) *int {
	t.Helper()
	n := 0
	orig := loadIndexRuns
	loadIndexRuns = func(ctx context.Context) ([]*waveobj.Run, error) {
		n++
		return orig(ctx)
	}
	t.Cleanup(func() { loadIndexRuns = orig })
	return &n
}

// An agent no run lists is looked up on every ask and attention pass: with no run written in between, the
// lookups after the first read no run rows at all. A run written that lists it is seen on the next lookup,
// and a run that drops it from its phases stops resolving it.
func TestUnstampedWorkerLookupReadsTheRunsOnlyAfterARunIsWritten(t *testing.T) {
	ctx := context.Background()
	loads := countIndexLoads(t)
	ch, err := wstore.CreateChannel(ctx, "rw-index", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	worker := waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String()
	if m := ResolveRunWorkerFromMeta(ctx, worker); m != nil {
		t.Fatalf("a worker no run lists resolved to run %s", m.Run.ID)
	}
	before := *loads
	for range 3 {
		if m := ResolveRunWorkerFromMeta(ctx, worker); m != nil {
			t.Fatalf("a worker no run lists resolved to run %s", m.Run.ID)
		}
	}
	if *loads != before {
		t.Fatalf("lookups with no run written read the runs %d more times, want 0", *loads-before)
	}

	runID := uuid.NewString()
	run := waveobj.Run{ID: runID, Goal: "g", Status: "executing", CreatedTs: 4,
		Phases: []waveobj.RunPhase{{Kind: PhaseKind_Plan}, {Kind: PhaseKind_Execute, WorkerOrefs: []string{worker}}}}
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("append run: %v", err)
	}
	m := ResolveRunWorkerFromMeta(ctx, worker)
	if m == nil || m.Run.ID != runID || m.PhaseIdx != 1 || m.Channel.OID != ch.OID {
		t.Fatalf("a run written after the index was built did not resolve: %+v", m)
	}

	if err := wstore.UpdateRun(ctx, ch.OID, runID, func(r *waveobj.Run) error {
		r.Phases[1].WorkerOrefs = nil
		return nil
	}); err != nil {
		t.Fatalf("update run: %v", err)
	}
	if m := ResolveRunWorkerFromMeta(ctx, worker); m != nil {
		t.Fatalf("a worker its run dropped still resolved to run %s", m.Run.ID)
	}
}

// The index lists a worker's runs oldest first, runs created at once in the order they came, and a run that
// lists the worker in two phases once.
func TestIndexRunWorkersListsEachRunOnceOldestFirst(t *testing.T) {
	w := "tab:w"
	run := func(id string, ts int64, phases ...[]string) *waveobj.Run {
		r := &waveobj.Run{OID: id, ID: id, CreatedTs: ts}
		for _, wos := range phases {
			r.Phases = append(r.Phases, waveobj.RunPhase{WorkerOrefs: wos})
		}
		return r
	}
	idx := indexRunWorkers([]*waveobj.Run{
		run("late", 9, []string{w}),
		run("tie-a", 2, []string{w}, []string{w, "tab:other"}),
		run("tie-b", 2, []string{"", w}),
		run("none", 1, []string{"tab:other"}),
	})
	if got, want := idx[w], []string{"tie-a", "tie-b", "late"}; !slices.Equal(got, want) {
		t.Fatalf("runs of %s = %v, want %v", w, got, want)
	}
	if got := idx["tab:other"]; !slices.Equal(got, []string{"none", "tie-a"}) {
		t.Fatalf("runs of tab:other = %v", got)
	}
	if _, ok := idx[""]; ok {
		t.Fatalf("an empty worker oref was indexed")
	}
}
