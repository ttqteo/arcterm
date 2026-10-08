// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// A run's own runtime is its lead, and agy cannot lead: the start is refused with the catalog's message
// whether or not agy is installed (the real validator, not a stub), before any run is stored.
func TestRunLeadRuntimeRefusesAgy(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "lead-agy", t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	var spawnCalls int
	oldSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		spawnCalls++
		return "tab:unexpected", nil
	}
	t.Cleanup(func() { jarvis.SpawnRunWorker = oldSpawn })

	_, err = (&WshServer{}).CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
		ChannelId: ch.OID, WorkspaceId: "ws-1", Goal: "do it", Runtime: "agy",
	})
	if err == nil || !strings.Contains(err.Error(), `harness "agy" cannot lead a run`) {
		t.Fatalf("CreateRun with runtime agy error = %v", err)
	}
	if runs, _ := wstore.GetChannelRuns(ctx, ch.OID); len(runs) != 0 {
		t.Fatalf("a refused lead persisted %d runs", len(runs))
	}
	if spawnCalls != 0 {
		t.Fatalf("a refused lead spawned %d workers", spawnCalls)
	}
}

// The reviewer route of a started run is a lead role too.
func TestCreateRunRefusesAgyReviewerRoute(t *testing.T) {
	ctx := context.Background()
	stubRunServer(t, "pi", nil)
	ch, err := wstore.CreateChannel(ctx, "lead-agy-reviewer", t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	_, err = (&WshServer{}).CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
		ChannelId: ch.OID, WorkspaceId: "ws-1", Goal: "do it", Runtime: "pi",
		Mode: jarvis.RunMode_Orchestrator, Orchestration: jarvis.Orchestration_Engine, DeferStart: true,
		ReviewerRoute: &waveobj.RoutePin{Runtime: "agy"},
	})
	if err == nil || !strings.Contains(err.Error(), "reviewerRoute") || !strings.Contains(err.Error(), "cannot lead a run") {
		t.Fatalf("CreateRun with an agy reviewer route error = %v", err)
	}
}
