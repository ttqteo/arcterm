// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// seedBacklogRun puts an orchestrator run created at created into a channel of its own and returns the run's id.
func seedBacklogRun(t *testing.T, created int64, mutate func(*waveobj.Run)) string {
	t.Helper()
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "backlog-ch", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	run := waveobj.Run{ID: uuid.NewString(), Mode: "orchestrator", CreatedTs: created}
	if mutate != nil {
		mutate(&run)
	}
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatal(err)
	}
	return run.ID
}

// newBacklogEffort is an initiative with the given pending chunks, each added by the op a lead's `wsh effort` writes
// (so it has its chunk-added event, the time the pass dates it by).
func newBacklogEffort(t *testing.T, ws *WshServer, labels ...string) string {
	t.Helper()
	oid := newLinkEffort(t, ws, "backlog "+uuid.NewString()[:8])
	var ops []wshrpc.EffortOp
	for _, l := range labels {
		ops = append(ops, wshrpc.EffortOp{Op: "addChunk", Label: l})
	}
	if _, err := ws.EffortMutateCommand(context.Background(), wshrpc.CommandEffortMutateData{EffortOID: oid, Ops: ops}); err != nil {
		t.Fatal(err)
	}
	return oid
}

func backlogChunk(t *testing.T, oid, label string) waveobj.EffortChunk {
	t.Helper()
	e, err := effortstore.Get(context.Background(), oid)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range e.Chunks {
		if c.Label == label {
			return c
		}
	}
	t.Fatalf("initiative %s has no chunk %q", oid, label)
	return waveobj.EffortChunk{}
}

func TestEffortBackfillProposedMovesTheChunkAndASecondCallChangesNothing(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	runID := seedBacklogRun(t, time.Now().UnixMilli(), nil)
	named := "retry the flaky upload (run " + runID[:8] + ")"
	oid := newBacklogEffort(t, ws, named, "an unrelated chunk")

	rtn, err := ws.EffortBackfillProposedCommand(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if rtn.Chunks != 1 || rtn.Efforts != 1 {
		t.Fatalf("moved %d chunks on %d initiatives, want 1 on 1", rtn.Chunks, rtn.Efforts)
	}
	c := backlogChunk(t, oid, named)
	if c.Status != "proposed" {
		t.Fatalf("chunk status = %q, want proposed", c.Status)
	}
	if got := jarvis.ProposalRun(c); got != "run:"+runID {
		t.Fatalf("ProposalRun = %q, want run:%s", got, runID)
	}
	last := c.Notes[len(c.Notes)-1]
	if last.Text != jarvis.ProposedNote || last.Author != "agent" || last.Run != "run:"+runID || last.Session != "" {
		t.Fatalf("last note = %+v, want an agent's proposed note for run:%s with no session", last, runID)
	}
	if other := backlogChunk(t, oid, "an unrelated chunk"); other.Status != "pending" || len(other.Notes) != 0 {
		t.Fatalf("a chunk naming no run was touched: %+v", other)
	}

	before, err := effortstore.Get(ctx, oid)
	if err != nil {
		t.Fatal(err)
	}
	again, err := ws.EffortBackfillProposedCommand(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if again.Chunks != 0 || again.Efforts != 0 {
		t.Fatalf("a second call moved %d chunks on %d initiatives", again.Chunks, again.Efforts)
	}
	after, err := effortstore.Get(ctx, oid)
	if err != nil {
		t.Fatal(err)
	}
	if after.Version != before.Version || after.UpdatedTs != before.UpdatedTs {
		t.Fatalf("a second call rewrote the initiative: version %d -> %d, updated %d -> %d", before.Version, after.Version, before.UpdatedTs, after.UpdatedTs)
	}
}

// one update per initiative, however many of its chunks move; the pass counts both
func TestEffortBackfillProposedCountsChunksAndInitiatives(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	runA := seedBacklogRun(t, time.Now().UnixMilli(), nil)
	runB := seedBacklogRun(t, time.Now().UnixMilli(), nil)
	a1, a2 := "first (run "+runA[:8]+")", "second (run "+runA[:8]+")"
	b1 := "third (run " + runB[:8] + ")"
	e1 := newBacklogEffort(t, ws, a1, a2)
	e2 := newBacklogEffort(t, ws, b1)
	before, err := effortstore.Get(ctx, e1)
	if err != nil {
		t.Fatal(err)
	}

	chunks, efforts, err := backfillProposed(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if chunks != 3 || efforts != 2 {
		t.Fatalf("moved %d chunks on %d initiatives, want 3 on 2", chunks, efforts)
	}
	after, err := effortstore.Get(ctx, e1)
	if err != nil {
		t.Fatal(err)
	}
	if after.Version != before.Version+1 {
		t.Fatalf("the initiative was updated %d times, want once", after.Version-before.Version)
	}
	for _, c := range []struct{ oid, label, run string }{{e1, a1, runA}, {e1, a2, runA}, {e2, b1, runB}} {
		if got := jarvis.ProposalRun(backlogChunk(t, c.oid, c.label)); got != "run:"+c.run {
			t.Errorf("chunk %q names %q, want run:%s", c.label, got, c.run)
		}
	}
}

func TestEffortBackfillProposedLeavesWhatThePickSkips(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	now := time.Now().UnixMilli()
	old := seedBacklogRun(t, now-time.Hour.Milliseconds(), nil)
	quick := seedBacklogRun(t, now, func(r *waveobj.Run) { r.Mode = "quick" })
	held := seedBacklogRun(t, now, nil)
	oldLabel, quickLabel, heldLabel := "from old (run "+old[:8]+")", "from quick (run "+quick[:8]+")", "held (run "+held[:8]+")"
	oid := newBacklogEffort(t, ws, oldLabel, quickLabel, heldLabel)
	if _, err := ws.EffortMutateCommand(ctx, wshrpc.CommandEffortMutateData{EffortOID: oid, Ops: []wshrpc.EffortOp{
		{Op: "attachWork", Chunk: heldLabel, Kind: "run", ORef: "run:" + uuid.NewString()},
	}}); err != nil {
		t.Fatal(err)
	}

	// a cutoff after the old run, before the others
	chunks, _, err := backfillProposed(ctx, now-time.Minute.Milliseconds())
	if err != nil {
		t.Fatal(err)
	}
	if chunks != 0 {
		t.Fatalf("moved %d chunks, want none", chunks)
	}
	for _, l := range []string{oldLabel, quickLabel, heldLabel} {
		if st := backlogChunk(t, oid, l).Status; st != "pending" {
			t.Errorf("chunk %q is %s, want pending", l, st)
		}
	}
}

// the pick runs again inside the update: a chunk a run took between the read and the write is not moved
func TestEffortBackfillProposedChecksAgainInsideTheUpdate(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	runID := seedBacklogRun(t, time.Now().UnixMilli(), nil)
	label := "follow up (run " + runID[:8] + ")"
	oid := newBacklogEffort(t, ws, label)
	runs, err := backlogRuns(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// the chunk is taken after the picks were made from the earlier read
	if _, err := ws.EffortMutateCommand(ctx, wshrpc.CommandEffortMutateData{EffortOID: oid, Ops: []wshrpc.EffortOp{
		{Op: "attachWork", Chunk: label, Kind: "run", ORef: "run:" + uuid.NewString()},
	}}); err != nil {
		t.Fatal(err)
	}
	n, err := proposeBacklogChunks(ctx, oid, runs, 1)
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("moved %d chunks, want none", n)
	}
	if c := backlogChunk(t, oid, label); c.Status != "pending" || strings.Contains(c.Notes[len(c.Notes)-1].Text, "proposed") {
		t.Fatalf("a chunk a run held was moved: %+v", c)
	}
}
