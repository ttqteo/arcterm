// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// seedBoundWorker stores a child run of runtime and the worker tab and block the engine stamps at spawn,
// returning the block's oref, the channel and the run.
func seedBoundWorker(t *testing.T, runtime string) (blockORef, channelID, runID string) {
	t.Helper()
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "bind-"+uuid.NewString(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	child := jarvis.NewRun("child", "ws-1", t.TempDir(), nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	child.Runtime = runtime
	if err := wstore.AppendRun(ctx, ch.OID, child); err != nil {
		t.Fatal(err)
	}
	blockORef = insertWorkerTab(t, waveobj.MakeORef(waveobj.OType_Run, child.ID).String(), waveobj.MakeORef(waveobj.OType_Channel, ch.OID).String())
	return blockORef, ch.OID, child.ID
}

// insertWorkerTab stores a tab stamped with the owner orefs and its block; blank orefs leave the tab unstamped.
func insertWorkerTab(t *testing.T, runORef, channelORef string) string {
	t.Helper()
	ctx := context.Background()
	tab := &waveobj.Tab{OID: uuid.NewString(), Meta: waveobj.MetaMapType{}}
	block := &waveobj.Block{OID: uuid.NewString(), ParentORef: waveobj.MakeORef(waveobj.OType_Tab, tab.OID).String(), Meta: waveobj.MetaMapType{}}
	tab.BlockIds = []string{block.OID}
	if err := wstore.DBInsert(ctx, block); err != nil {
		t.Fatal(err)
	}
	if err := wstore.DBInsert(ctx, tab); err != nil {
		t.Fatal(err)
	}
	if runORef != "" {
		if err := wstore.StampWorkerOwner(ctx, waveobj.MakeORef(waveobj.OType_Tab, tab.OID).String(), runORef, channelORef); err != nil {
			t.Fatal(err)
		}
	}
	return waveobj.MakeORef(waveobj.OType_Block, block.OID).String()
}

func statusEvent(blockORef, agent, sessionID string) *wps.WaveEvent {
	return &wps.WaveEvent{
		Event: wps.Event_AgentStatus,
		Data:  baseds.AgentStatusData{ORef: blockORef, Agent: agent, State: baseds.AgentState_Working, SessionID: sessionID},
	}
}

func boundSession(t *testing.T, channelID, runID string) string {
	t.Helper()
	run, err := wstore.GetRun(context.Background(), channelID, runID)
	if err != nil {
		t.Fatal(err)
	}
	return run.SessionId
}

func TestNoteWorkerSessionBindsAndRebinds(t *testing.T) {
	block, channelID, runID := seedBoundWorker(t, "agy")
	if got := boundSession(t, channelID, runID); got != "" {
		t.Fatalf("an agy child starts unbound, got %q", got)
	}
	NoteWorkerSession(context.Background(), statusEvent(block, "agy", "conv-1"))
	if got := boundSession(t, channelID, runID); got != "conv-1" {
		t.Fatalf("the first report binds the id, got %q", got)
	}
	// the latest id wins: agy starts a new conversation on /clear
	NoteWorkerSession(context.Background(), statusEvent(block, "agy", "conv-2"))
	if got := boundSession(t, channelID, runID); got != "conv-2" {
		t.Fatalf("a second id rebinds, got %q", got)
	}
	NoteWorkerSession(context.Background(), statusEvent(block, "agy", ""))
	if got := boundSession(t, channelID, runID); got != "conv-2" {
		t.Fatalf("a report with no id leaves the binding, got %q", got)
	}
}

func TestNoteWorkerSessionIgnoresWhatIsNotAnAgyWorker(t *testing.T) {
	ctx := context.Background()
	t.Run("a block that is no worker", func(t *testing.T) {
		block := insertWorkerTab(t, "", "")
		NoteWorkerSession(ctx, statusEvent(block, "agy", "conv-1")) // must not panic or error out
	})
	t.Run("a stamp whose run is gone", func(t *testing.T) {
		ch, err := wstore.CreateChannel(ctx, "bind-gone-"+uuid.NewString(), t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		block := insertWorkerTab(t, waveobj.MakeORef(waveobj.OType_Run, uuid.NewString()).String(), waveobj.MakeORef(waveobj.OType_Channel, ch.OID).String())
		NoteWorkerSession(ctx, statusEvent(block, "agy", "conv-1"))
	})
	t.Run("a claude status", func(t *testing.T) {
		block, channelID, runID := seedBoundWorker(t, "agy")
		NoteWorkerSession(ctx, statusEvent(block, "claude", "claude-session"))
		if got := boundSession(t, channelID, runID); got != "" {
			t.Fatalf("a claude status must not bind, got %q", got)
		}
	})
	t.Run("a claude worker keeps its own session", func(t *testing.T) {
		block, channelID, runID := seedBoundWorker(t, "claude")
		if err := wstore.UpdateRun(ctx, channelID, runID, func(r *waveobj.Run) error { r.SessionId = "launched-id"; return nil }); err != nil {
			t.Fatal(err)
		}
		// a nested `agy -p` inside a claude worker's block reports as agy
		NoteWorkerSession(ctx, statusEvent(block, "agy", "nested-agy"))
		if got := boundSession(t, channelID, runID); got != "launched-id" {
			t.Fatalf("an agy status inside a claude worker's block must not touch it, got %q", got)
		}
	})
	t.Run("not a status event", func(t *testing.T) {
		block, channelID, runID := seedBoundWorker(t, "agy")
		ev := statusEvent(block, "agy", "conv-1")
		ev.Event = wps.Event_ControllerStatus
		NoteWorkerSession(ctx, ev)
		NoteWorkerSession(ctx, nil)
		if got := boundSession(t, channelID, runID); got != "" {
			t.Fatalf("got %q", got)
		}
	})
}
