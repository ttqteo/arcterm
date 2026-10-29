// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package workspaceservice

import (
	"context"
	"os"
	"slices"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// TestMain points the wave data dir at a throwaway temp dir and initializes the wstore SQLite DB, so CloseTab runs
// against a real, empty store. Mirrors pkg/jarvis's TestMain.
func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "workspaceservice-test-*")
	if err != nil {
		panic(err)
	}
	wavebase.DataHome_VarCache = dir
	if err := wavebase.EnsureWaveDBDir(); err != nil {
		panic(err)
	}
	if err := wstore.InitWStore(); err != nil {
		panic(err)
	}
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

// closing a brainstorming agent closes its builder check's and its judge's tabs, which the Agent tree nests under
// it, and leaves every other tab alone
func TestCloseTabClosesItsBrainstormSessions(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "lag", t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	wsId := uuid.NewString()
	agentTab, checkTab, judgeTab, otherTab := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	sessionRun := func(role, tabId string) string {
		run := jarvis.NewRun(role, wsId, ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
		run.StageRole = role
		run.Phases[0].WorkerOrefs = []string{"tab:" + tabId}
		if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
			t.Fatalf("AppendRun: %v", err)
		}
		return run.ID
	}
	meta := waveobj.MetaMapType{
		waveobj.MetaKey_BrainstormCheckRun:     sessionRun(jarvis.UsageRole_BuilderCheck, checkTab),
		waveobj.MetaKey_BrainstormCheckChannel: ch.OID,
		waveobj.MetaKey_BrainstormJudgeRun:     sessionRun(jarvis.UsageRole_BrainstormJudge, judgeTab),
		waveobj.MetaKey_BrainstormJudgeChannel: ch.OID,
	}
	for _, obj := range []waveobj.WaveObj{
		&waveobj.Workspace{OID: wsId, TabIds: []string{otherTab, agentTab, checkTab, judgeTab}, ActiveTabId: agentTab},
		&waveobj.Tab{OID: agentTab, Meta: meta},
		&waveobj.Tab{OID: checkTab},
		&waveobj.Tab{OID: judgeTab},
		&waveobj.Tab{OID: otherTab},
	} {
		if err := wstore.DBInsert(ctx, obj); err != nil {
			t.Fatalf("DBInsert: %v", err)
		}
	}

	rtn, _, err := (&WorkspaceService{}).CloseTab(ctx, wsId, agentTab)
	if err != nil {
		t.Fatalf("CloseTab: %v", err)
	}
	ws, err := wstore.DBMustGet[*waveobj.Workspace](ctx, wsId)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(ws.TabIds, []string{otherTab}) || rtn.NewActiveTabId != otherTab {
		t.Fatalf("tabs %v, new active %q, want only %s left and active", ws.TabIds, rtn.NewActiveTabId, otherTab)
	}
	for _, id := range []string{agentTab, checkTab, judgeTab} {
		if tab, _ := wstore.DBGet[*waveobj.Tab](ctx, id); tab != nil {
			t.Fatalf("tab %s is still in the store", id)
		}
	}
}
