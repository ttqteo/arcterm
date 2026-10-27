// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestDagGoalpostCommand(t *testing.T) {
	ctx := context.Background()
	findings := []wshrpc.GoalpostFinding{{Rule: "test-skip", File: "a.test.ts", Title: "test skipped"}}
	ws := &WshServer{}

	t.Run("a run with no dag", func(t *testing.T) {
		ch, err := wstore.CreateChannel(ctx, "goalpost", t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		run := jarvis.NewRun("quick", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
		if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
			t.Fatal(err)
		}
		rtn, err := ws.DagGoalpostCommand(ctx, wshrpc.CommandDagGoalpostData{ChannelId: ch.OID, RunId: run.ID, Findings: findings})
		if err != nil || rtn == nil || rtn.Recorded {
			t.Fatalf("want not recorded and no error, got %+v, %v", rtn, err)
		}
	})

	t.Run("a missing run id", func(t *testing.T) {
		if _, err := ws.DagGoalpostCommand(ctx, wshrpc.CommandDagGoalpostData{ChannelId: "ch", Findings: findings}); err == nil {
			t.Fatal("want an error")
		}
	})
}
