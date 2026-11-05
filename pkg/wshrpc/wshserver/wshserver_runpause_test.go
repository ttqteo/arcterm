// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runpause"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// Cancelling a paused run cancels the runs its lead spawned (their agents are suspended, and nothing would resume
// them) and leaves no run reading paused: runpause.ClearOnCancel, wired into CancelRunCommand.
func TestCancelPausedRunCancelsWhatItsLeadSpawnedAndClearsThePause(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "cancel-paused", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	top := jarvis.NewRun("top", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	top.Phases[0].WorkerOrefs = []string{"tab:paused-top"}
	jarvis.SetRunPause(&top, &waveobj.RunPause{PausedTs: 1, By: runpause.By_Auto})
	spawned := jarvis.NewRun("spawned", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	spawned.ParentLeadORef = "tab:paused-top"
	spawned.PausedUnder = top.ID
	for _, r := range []waveobj.Run{top, spawned} {
		if err := wstore.AppendRun(ctx, ch.OID, r); err != nil {
			t.Fatal(err)
		}
	}

	if err := (&WshServer{}).CancelRunCommand(ctx, wshrpc.CommandCancelRunData{ChannelId: ch.OID, RunId: top.ID}); err != nil {
		t.Fatal(err)
	}
	gotTop, err := wstore.GetRun(ctx, ch.OID, top.ID)
	if err != nil {
		t.Fatal(err)
	}
	gotSpawned, err := wstore.GetRun(ctx, ch.OID, spawned.ID)
	if err != nil {
		t.Fatal(err)
	}
	if gotTop.Status != jarvis.RunStatus_Cancelled || gotTop.Pause != nil {
		t.Errorf("top: status %q pause %+v, want cancelled with no pause record", gotTop.Status, gotTop.Pause)
	}
	if gotSpawned.Status != jarvis.RunStatus_Cancelled {
		t.Errorf("the run its lead spawned reads %q, want cancelled", gotSpawned.Status)
	}
	for _, r := range []*waveobj.Run{gotTop, gotSpawned} {
		if jarvis.RunPaused(r) {
			t.Errorf("run %s still reads paused (PausedUnder %q)", r.ID, r.PausedUnder)
		}
	}
}
