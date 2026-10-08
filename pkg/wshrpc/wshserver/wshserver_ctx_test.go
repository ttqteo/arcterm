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

func TestJarvisCtxResolvesOwnerRun(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "ctx-test", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ownerID := uuid.NewString()
	tabOref := "tab:" + uuid.NewString()
	blockID := uuid.NewString()
	owner := jarvis.NewRun("owner goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	owner.ID = ownerID
	owner.Phases[0].WorkerOrefs = []string{tabOref}
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	block := &waveobj.Block{OID: blockID, ParentORef: tabOref}
	if err := wstore.DBInsert(ctx, block); err != nil {
		t.Fatal(err)
	}

	ws := &WshServer{}
	rtn, err := ws.JarvisCtxCommand(ctx, wshrpc.CommandJarvisCtxData{BlockORef: "block:" + blockID})
	if err != nil {
		t.Fatal(err)
	}
	if rtn.ChannelId != ch.OID || rtn.RunId != ownerID || rtn.Goal != "owner goal" {
		t.Fatalf("ctx mismatch: %+v", rtn)
	}
}

// a lead works in the project checkout, which is also the project path of every other running run of that
// project, so its dag commands must act on the run that lists its tab even when another run comes first.
func TestJarvisCtxResolvesALeadToItsOwnRunBesideAnotherRunOfTheSameProject(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "ctx-test3", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	tabOrefs := []string{"tab:" + uuid.NewString(), "tab:" + uuid.NewString()}
	var runIds []string
	for i, tab := range tabOrefs {
		run := jarvis.NewRun("goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), int64(i+1))
		run.DagORef = uuid.NewString()
		run.Phases[0].WorkerOrefs = []string{tab}
		if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
			t.Fatal(err)
		}
		runIds = append(runIds, run.ID)
	}
	block := &waveobj.Block{
		OID:        uuid.NewString(),
		ParentORef: tabOrefs[1],
		Meta:       waveobj.MetaMapType{waveobj.MetaKey_CmdCwd: ch.ProjectPath},
	}
	if err := wstore.DBInsert(ctx, block); err != nil {
		t.Fatal(err)
	}

	ws := &WshServer{}
	rtn, err := ws.JarvisCtxCommand(ctx, wshrpc.CommandJarvisCtxData{BlockORef: "block:" + block.OID})
	if err != nil {
		t.Fatal(err)
	}
	if rtn.RunId != runIds[1] {
		t.Fatalf("lead resolved to run %q, want its own run %q", rtn.RunId, runIds[1])
	}
}

// the store finds candidate runs by text, so an older run that only quotes the tab must not be taken for
// its owner.
func TestJarvisCtxSkipsARunThatOnlyQuotesTheTab(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "ctx-test4", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	tabOref := "tab:" + uuid.NewString()
	quoting := jarvis.NewRun("look at "+tabOref, "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	owner := jarvis.NewRun("owner goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 2)
	owner.Phases[0].WorkerOrefs = []string{tabOref}
	for _, run := range []waveobj.Run{quoting, owner} {
		if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
			t.Fatal(err)
		}
	}
	block := &waveobj.Block{OID: uuid.NewString(), ParentORef: tabOref}
	if err := wstore.DBInsert(ctx, block); err != nil {
		t.Fatal(err)
	}

	ws := &WshServer{}
	rtn, err := ws.JarvisCtxCommand(ctx, wshrpc.CommandJarvisCtxData{BlockORef: "block:" + block.OID})
	if err != nil {
		t.Fatal(err)
	}
	if rtn.RunId != owner.ID || rtn.ChannelId != ch.OID {
		t.Fatalf("resolved to run %q in %q, want the owner %q in %q", rtn.RunId, rtn.ChannelId, owner.ID, ch.OID)
	}
}

func TestJarvisCtxEmptyForUnrelatedBlock(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "ctx-test2", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	owner.Phases[0].WorkerOrefs = []string{"tab:" + uuid.NewString()}
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	blockID := uuid.NewString()
	block := &waveobj.Block{OID: blockID, ParentORef: "tab:" + uuid.NewString()}
	if err := wstore.DBInsert(ctx, block); err != nil {
		t.Fatal(err)
	}

	ws := &WshServer{}
	rtn, err := ws.JarvisCtxCommand(ctx, wshrpc.CommandJarvisCtxData{BlockORef: "block:" + blockID})
	if err != nil {
		t.Fatal(err)
	}
	if rtn.RunId != "" || rtn.ChannelId != "" {
		t.Fatalf("unrelated block must resolve to empty ctx, got %+v", rtn)
	}
	// empty + malformed orefs are safe no-ops, never errors
	if _, err := ws.JarvisCtxCommand(ctx, wshrpc.CommandJarvisCtxData{}); err != nil {
		t.Fatal(err)
	}
	if _, err := ws.JarvisCtxCommand(ctx, wshrpc.CommandJarvisCtxData{BlockORef: "not-an-oref"}); err != nil {
		t.Fatal(err)
	}
}
