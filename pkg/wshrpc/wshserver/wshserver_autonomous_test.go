// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestCreateRunAutonomous(t *testing.T) {
	ctx := context.Background()
	stubRunServer(t, "pi", nil)
	profileOn := &waveobj.ProfileOverride{Autonomous: boolPtr(true)}

	cases := []struct {
		name     string
		override *waveobj.ProfileOverride
		sent     *bool
		want     bool
	}{
		{"explicit true", nil, boolPtr(true), true},
		{"explicit false beats a profile true", profileOn, boolPtr(false), false},
		{"nil inherits a profile true", profileOn, nil, true},
		{"nil with no profile value is Ask me", nil, nil, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			run, err := createEngineRun(t, ctx, tc.override, wshrpc.CommandCreateRunData{Autonomous: tc.sent})
			if err != nil {
				t.Fatalf("CreateRunCommand: %v", err)
			}
			if run.Autonomous != tc.want {
				t.Fatalf("autonomous = %v, want %v", run.Autonomous, tc.want)
			}
		})
	}

	createQuick := func(t *testing.T, override *waveobj.ProfileOverride, sent *bool) (string, *wshrpc.CommandCreateRunRtnData, error) {
		t.Helper()
		ch, err := wstore.CreateChannel(ctx, "autonomous-quick", t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		if override != nil {
			seedProfileMeta(t, ctx, ch.OID, override)
		}
		rtn, err := (&WshServer{}).CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
			ChannelId: ch.OID, WorkspaceId: "ws", Goal: "g", Runtime: "pi", Mode: jarvis.RunMode_Quick, DeferStart: true, Autonomous: sent,
		})
		return ch.OID, rtn, err
	}

	t.Run("a quick run with explicit true is refused before anything persists", func(t *testing.T) {
		channelId, _, err := createQuick(t, nil, boolPtr(true))
		if err == nil || !strings.Contains(err.Error(), "autonomous") {
			t.Fatalf("err = %v, want a refusal naming autonomous", err)
		}
		if runs, _ := wstore.GetChannelRuns(ctx, channelId); len(runs) != 0 {
			t.Fatalf("a refused run was persisted: %+v", runs)
		}
	})

	t.Run("a quick run ignores the profile's true", func(t *testing.T) {
		channelId, rtn, err := createQuick(t, profileOn, nil)
		if err != nil {
			t.Fatalf("CreateRunCommand: %v", err)
		}
		if rtn.Run.Autonomous || mustRun(t, ctx, channelId, rtn.Run.ID).Autonomous {
			t.Fatal("a quick run took the profile's autonomous")
		}
	})
}

func TestDagSubmitCarriesAutonomous(t *testing.T) {
	stubModelSubmit(t)
	tasks := []waveobj.TaskNode{{ID: "t-1", Label: "a"}}
	for _, autonomous := range []bool{true, false} {
		ctx, channelId, runId := seedModelRun(t, func(run *waveobj.Run) { run.Autonomous = autonomous })
		g, err := (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{ChannelId: channelId, RunId: runId, Title: "g", Parallelism: 1, Tasks: tasks})
		if err != nil {
			t.Fatal(err)
		}
		if g.Autonomous != autonomous {
			t.Fatalf("run autonomous %v: group autonomous = %v", autonomous, g.Autonomous)
		}
	}
}

func TestSetRunSettingsAutonomousCarrier(t *testing.T) {
	ctx := context.Background()
	ch, run := newEngineRun(t, ctx, "rs-autonomous", jarvis.Orchestration_Engine)
	ws := &WshServer{}
	set := func(autonomous *bool) {
		t.Helper()
		if err := ws.SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{ChannelId: ch.OID, RunId: run.ID, Autonomous: autonomous}); err != nil {
			t.Fatalf("SetRunSettingsCommand: %v", err)
		}
	}

	set(boolPtr(true))
	if !mustRun(t, ctx, ch.OID, run.ID).Autonomous {
		t.Fatal("before a dag: the run should carry autonomous")
	}
	set(nil)
	if !mustRun(t, ctx, ch.OID, run.ID).Autonomous {
		t.Fatal("before a dag: a nil value cleared the run's autonomous")
	}

	g := submitPlan(t, ctx, ch, run.ID)
	if !g.Autonomous {
		t.Fatal("submit did not carry the pending autonomous onto the group")
	}
	set(boolPtr(false))
	live, err := wstore.GetDag(ctx, g.OID)
	if err != nil {
		t.Fatalf("GetDag: %v", err)
	}
	if live.Autonomous {
		t.Fatal("after a dag: the group should carry the change")
	}
	if !mustRun(t, ctx, ch.OID, run.ID).Autonomous {
		t.Fatal("after a dag: the run's launch value must stay untouched")
	}
	set(boolPtr(true))
	set(nil)
	if live, err = wstore.GetDag(ctx, g.OID); err != nil {
		t.Fatalf("GetDag: %v", err)
	}
	if !live.Autonomous {
		t.Fatal("after a dag: a nil value changed the group's autonomous")
	}
}
