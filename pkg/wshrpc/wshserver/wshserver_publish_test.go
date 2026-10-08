// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// an agy worker is spawned without a session id; the first status it reports through the publish path binds
// the one agy chose to its child run.
func TestPublishEventBindsWorkerSession(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "publish-bind-"+uuid.NewString(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	child := jarvis.NewRun("child", "ws-1", t.TempDir(), nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	child.Runtime = "agy"
	if err := wstore.AppendRun(ctx, ch.OID, child); err != nil {
		t.Fatal(err)
	}
	tab := &waveobj.Tab{OID: uuid.NewString(), Meta: waveobj.MetaMapType{}}
	block := &waveobj.Block{OID: uuid.NewString(), ParentORef: waveobj.MakeORef(waveobj.OType_Tab, tab.OID).String(), Meta: waveobj.MetaMapType{}}
	tab.BlockIds = []string{block.OID}
	if err := wstore.DBInsert(ctx, block); err != nil {
		t.Fatal(err)
	}
	if err := wstore.DBInsert(ctx, tab); err != nil {
		t.Fatal(err)
	}
	if err := wstore.StampWorkerOwner(ctx, waveobj.MakeORef(waveobj.OType_Tab, tab.OID).String(),
		waveobj.MakeORef(waveobj.OType_Run, child.ID).String(), waveobj.MakeORef(waveobj.OType_Channel, ch.OID).String()); err != nil {
		t.Fatal(err)
	}

	oref := blockORef(block.OID)
	publishEvent(ctx, wps.WaveEvent{
		Event:  wps.Event_AgentStatus,
		Scopes: []string{oref},
		Data:   baseds.AgentStatusData{ORef: oref, State: baseds.AgentState_Working, Agent: "agy", SessionID: "conv-42", Ts: time.Now().UnixMilli()},
	})
	got, err := wstore.GetRun(ctx, ch.OID, child.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.SessionId != "conv-42" {
		t.Fatalf("the published status must bind the worker's session, got %q", got.SessionId)
	}
}
