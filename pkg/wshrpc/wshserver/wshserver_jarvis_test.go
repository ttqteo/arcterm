// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestListDetachedEdgesRequiresAnId(t *testing.T) {
	ws := &WshServer{}
	if _, err := ws.ListDetachedEdgesCommand(context.Background(), wshrpc.CommandListDetachedEdgesData{}); err == nil {
		t.Fatal("an unfiltered detached-edge read must be rejected, not answered with every correction ever made")
	}
}

func TestDossierEdgeCommandsRequireBothIds(t *testing.T) {
	ws := &WshServer{}
	ctx := context.Background()
	if err := ws.DetachDossierEdgeCommand(ctx, wshrpc.CommandDossierEdgeData{RunORef: "run:r1"}); err == nil {
		t.Fatal("detach without a dossierid must be rejected")
	}
	if err := ws.AcceptDossierEdgeCommand(ctx, wshrpc.CommandDossierEdgeData{DossierId: "task-a"}); err == nil {
		t.Fatal("accept without a runoref must be rejected")
	}
}

func TestJarvisStateCommandReturnsFixtureRun(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	ch, err := wstore.CreateChannel(ctx, "rpc", "/p/one")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if err := wstore.AppendRun(ctx, ch.OID, waveobj.Run{OID: "r-ledger-1", ID: "r-ledger-1", Goal: "ship the ledger", Status: "done", ProjectPath: "/p/one", CreatedTs: 100}); err != nil {
		t.Fatalf("append run: %v", err)
	}
	// Seal evidence the way the server does at completion.
	if err := wstore.UpdateRun(ctx, ch.OID, "r-ledger-1", func(r *waveobj.Run) error {
		r.CompletedTs = 500
		r.Evidence = &waveobj.RunEvidence{Summary: "ledger shipped", Files: []waveobj.EvidenceFile{{Path: "a.go", Stat: "M", Add: 3, Del: 1}}}
		return nil
	}); err != nil {
		t.Fatalf("update run: %v", err)
	}
	rtn, err := ws.JarvisStateCommand(ctx, wshrpc.CommandJarvisStateData{})
	if err != nil {
		t.Fatalf("JarvisStateCommand: %v", err)
	}
	if !rtn.State.Sources.Runs {
		t.Fatalf("sources=%+v want runs leg healthy", rtn.State.Sources)
	}
	var found bool
	for _, p := range rtn.State.Projects {
		for _, s := range p.Shipped {
			if s.RunOID == "r-ledger-1" && s.Summary == "ledger shipped" {
				found = true
			}
		}
	}
	if !found {
		t.Fatalf("state=%+v want the fixture run in Shipped", rtn.State)
	}
}

func TestJarvisStatusCommandReturnsSections(t *testing.T) {
	ws := &WshServer{}
	rtn, err := ws.JarvisStatusCommand(context.Background(), wshrpc.CommandJarvisStatusData{})
	if err != nil {
		t.Fatalf("JarvisStatusCommand: %v", err)
	}
	if rtn.Status.NoteCounts == nil {
		t.Fatalf("status=%+v want non-nil note counts (may be empty)", rtn.Status)
	}
}

func TestJarvisStatusIncludesEfforts(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	rtn, err := ws.EffortCreateCommand(ctx, wshrpc.CommandEffortCreateData{
		Title:  "status-effort",
		Chunks: []wshrpc.CommandEffortChunkSeed{{Label: "a"}, {Label: "b"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	cleanupEffort(t, rtn.EffortOID)
	if _, err := ws.EffortMutateCommand(ctx, wshrpc.CommandEffortMutateData{
		EffortOID: rtn.EffortOID,
		Ops:       []wshrpc.EffortOp{{Op: "setChunkStatus", Chunk: "a", Status: "done"}},
	}); err != nil {
		t.Fatal(err)
	}
	st, err := ws.JarvisStatusCommand(ctx, wshrpc.CommandJarvisStatusData{})
	if err != nil {
		t.Fatal(err)
	}
	if st.Status.Efforts.Active < 1 || st.Status.Efforts.ChunksDone < 1 || st.Status.Efforts.ChunksTotal < 2 {
		t.Fatalf("efforts accounting: %+v", st.Status.Efforts)
	}
}

// A run's lifecycle event log must be readable through the RPC (the run-card timeline's initial
// load path). The read is a bounded channel-scoped query returning newest-first.
// Kael a61a68c95: a read with no limit returns the run's whole retained history.
func TestJarvisRunEventsCommandWithoutLimitReadsEveryEvent(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	ch, err := wstore.CreateChannel(ctx, "rpc-nolimit", "/p/one")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	const total = 250
	for i := 0; i < total; i++ {
		if _, err := wstore.AppendRunEvent(ctx, ch.OID, "r-events-all", waveobj.RunEventKindCreated, nil, nil); err != nil {
			t.Fatalf("append event: %v", err)
		}
	}
	rtn, err := ws.JarvisRunEventsCommand(ctx, wshrpc.CommandJarvisRunEventsData{ChannelId: ch.OID, RunId: "r-events-all"})
	if err != nil {
		t.Fatalf("command without limit: %v", err)
	}
	if len(rtn.Events) != total {
		t.Fatalf("no limit want all %d events, got %d", total, len(rtn.Events))
	}
}

func TestJarvisRunEventsCommand(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	ch, err := wstore.CreateChannel(ctx, "rpc", "/p/one")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if err := wstore.AppendRun(ctx, ch.OID, waveobj.Run{OID: "r-events-1", ID: "r-events-1", Goal: "test run", Status: "planning", ProjectPath: "/p/one", CreatedTs: 100}); err != nil {
		t.Fatalf("append run: %v", err)
	}
	idx := 0
	if _, err := wstore.AppendRunEvent(ctx, ch.OID, "r-events-1", waveobj.RunEventKindPhaseHeld, &idx, map[string]any{"artifacts": []string{"plan.md"}}); err != nil {
		t.Fatalf("append event: %v", err)
	}
	rtn, err := ws.JarvisRunEventsCommand(ctx, wshrpc.CommandJarvisRunEventsData{ChannelId: ch.OID, RunId: "r-events-1", Limit: 10})
	if err != nil {
		t.Fatalf("command: %v", err)
	}
	if len(rtn.Events) != 1 {
		t.Fatalf("want 1 event, got %d", len(rtn.Events))
	}
	if rtn.Events[0].Kind != waveobj.RunEventKindPhaseHeld {
		t.Fatalf("want phase-held, got %q", rtn.Events[0].Kind)
	}
	if rtn.Events[0].PhaseIdx == nil || *rtn.Events[0].PhaseIdx != 0 {
		t.Fatalf("phaseidx not preserved: %v", rtn.Events[0].PhaseIdx)
	}
}
