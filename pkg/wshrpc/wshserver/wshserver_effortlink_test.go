// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// sessionTerminal inserts an agent session's tab and its terminal block, returning the tab id and the
// block oref `wsh effort` would send as its source.
func sessionTerminal(t *testing.T) (string, string) {
	t.Helper()
	ctx := context.Background()
	tabID := uuid.NewString()
	if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: tabID, Meta: waveobj.MetaMapType{}}); err != nil {
		t.Fatal(err)
	}
	block := &waveobj.Block{OID: uuid.NewString(), ParentORef: "tab:" + tabID}
	if err := wstore.DBInsert(ctx, block); err != nil {
		t.Fatal(err)
	}
	return tabID, "block:" + block.OID
}

func newLinkEffort(t *testing.T, ws *WshServer, title string) string {
	t.Helper()
	rtn, err := ws.EffortCreateCommand(context.Background(), wshrpc.CommandEffortCreateData{
		Title: title, Chunks: []wshrpc.CommandEffortChunkSeed{{Label: "C0"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	cleanupEffort(t, rtn.EffortOID)
	return rtn.EffortOID
}

func tabEffort(t *testing.T, tabID string) string {
	t.Helper()
	tab, err := wstore.DBMustGet[*waveobj.Tab](context.Background(), tabID)
	if err != nil {
		t.Fatal(err)
	}
	return tab.Meta.GetString(waveobj.MetaKey_SessionEffort, "")
}

func TestEffortNoteFromATerminalLinksItsSession(t *testing.T) {
	ws := &WshServer{}
	oid := newLinkEffort(t, ws, "note link")
	tabID, src := sessionTerminal(t)
	_, err := ws.EffortMutateCommand(context.Background(), wshrpc.CommandEffortMutateData{
		EffortOID: oid, SourceBlock: src,
		Ops: []wshrpc.EffortOp{{Op: "appendNote", Chunk: "C0", Note: "where we are"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := tabEffort(t, tabID); got != "effort:"+oid {
		t.Fatalf("session:effort = %q, want effort:%s", got, oid)
	}
}

func TestEffortReadFromATerminalLinksItsSession(t *testing.T) {
	ws := &WshServer{}
	oid := newLinkEffort(t, ws, "read link")
	tabID, src := sessionTerminal(t)
	if _, err := ws.EffortGetCommand(context.Background(), wshrpc.CommandEffortGetData{EffortOID: oid, SourceBlock: src}); err != nil {
		t.Fatal(err)
	}
	if got := tabEffort(t, tabID); got != "effort:"+oid {
		t.Fatalf("session:effort = %q, want effort:%s", got, oid)
	}
}

func TestEffortReadFromTheCockpitLinksNothing(t *testing.T) {
	ws := &WshServer{}
	oid := newLinkEffort(t, ws, "cockpit read")
	tabID, _ := sessionTerminal(t)
	if _, err := ws.EffortGetCommand(context.Background(), wshrpc.CommandEffortGetData{EffortOID: oid}); err != nil {
		t.Fatal(err)
	}
	if got := tabEffort(t, tabID); got != "" {
		t.Fatalf("session:effort = %q, want unset", got)
	}
}

// a session that moves on to another initiative is working on that one now
func TestEffortLinkFollowsTheMostRecentInitiative(t *testing.T) {
	ws := &WshServer{}
	first := newLinkEffort(t, ws, "first")
	second := newLinkEffort(t, ws, "second")
	tabID, src := sessionTerminal(t)
	for _, oid := range []string{first, second} {
		if _, err := ws.EffortGetCommand(context.Background(), wshrpc.CommandEffortGetData{EffortOID: oid, SourceBlock: src}); err != nil {
			t.Fatal(err)
		}
	}
	if got := tabEffort(t, tabID); got != "effort:"+second {
		t.Fatalf("session:effort = %q, want effort:%s", got, second)
	}
}

// a run's worker answers to its run, which the Brief already shows; linking it would offer "Go to it" on a
// worker the engine owns
func TestEffortRunWorkerIsNotLinked(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	oid := newLinkEffort(t, ws, "worker read")
	ch, err := wstore.CreateChannel(ctx, "effortlink-worker", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	tabID, src := sessionTerminal(t)
	run := jarvis.NewRun("goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	run.Phases[0].WorkerOrefs = []string{"tab:" + tabID}
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatal(err)
	}
	if _, err := ws.EffortGetCommand(ctx, wshrpc.CommandEffortGetData{EffortOID: oid, SourceBlock: src}); err != nil {
		t.Fatal(err)
	}
	if got := tabEffort(t, tabID); got != "" {
		t.Fatalf("session:effort = %q, want unset on a run worker", got)
	}
}

// the id in the form `wsh effort list` prints must not be prefixed a second time
func TestEffortNoteWithAnORefIDLinksItsSession(t *testing.T) {
	ws := &WshServer{}
	oid := newLinkEffort(t, ws, "oref note link")
	tabID, src := sessionTerminal(t)
	_, err := ws.EffortMutateCommand(context.Background(), wshrpc.CommandEffortMutateData{
		EffortOID: "effort:" + oid, SourceBlock: src,
		Ops: []wshrpc.EffortOp{{Op: "appendNote", Chunk: "C0", Note: "where we are"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := tabEffort(t, tabID); got != "effort:"+oid {
		t.Fatalf("session:effort = %q, want effort:%s", got, oid)
	}
}
