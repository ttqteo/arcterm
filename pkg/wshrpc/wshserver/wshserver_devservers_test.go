// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/devservers"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestMachineHoldersNamesAgentsAndTerminals(t *testing.T) {
	agent := agentFacts("tab-a", "portal", "blk-a", "claude", "working")
	term := agentFacts("tab-t", "dev", "blk-t", "", "")
	stopped := agentFacts("tab-s", "old", "blk-s", "", "")
	stopped.ShellRunning = false
	restoreFacts := loadAgentRosterFacts
	restorePid := consumerBlockPid
	t.Cleanup(func() { loadAgentRosterFacts = restoreFacts; consumerBlockPid = restorePid })
	loadAgentRosterFacts = func(context.Context) (*agentRosterFacts, error) {
		return &agentRosterFacts{Tabs: []agentTabFacts{agent, term, stopped}}, nil
	}
	consumerBlockPid = func(blockId string) int { return map[string]int{"blk-a": 20, "blk-t": 30, "blk-s": 40}[blockId] }
	holders, err := readMachineHolders(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if h := holders[20]; h.Kind != devservers.OwnerAgent || h.TabId != "tab-a" || h.Name != "portal" || h.Harness != "claude" {
		t.Fatalf("holders[20] = %+v; want the claude agent", h)
	}
	if h := holders[30]; h.Kind != devservers.OwnerTerminal || h.TabId != "tab-t" || h.Name != "dev" {
		t.Fatalf("holders[30] = %+v; want the terminal", h)
	}
	if _, ok := holders[40]; ok {
		t.Fatal("a tab whose shell stopped holds nothing")
	}
}

func TestMachineHoldersNameADetachedLaunchByItsBlock(t *testing.T) {
	agent := agentFacts("tab-a", "dev env", "blk-a", "claude", "idle")
	restoreFacts, restorePid, restorePath := loadAgentRosterFacts, consumerBlockPid, detachedPath
	t.Cleanup(func() { loadAgentRosterFacts, consumerBlockPid, detachedPath = restoreFacts, restorePid, restorePath })
	loadAgentRosterFacts = func(context.Context) (*agentRosterFacts, error) {
		return &agentRosterFacts{Tabs: []agentTabFacts{agent}}, nil
	}
	consumerBlockPid = func(string) int { return 20 }
	path := filepath.Join(t.TempDir(), "detached.json")
	detachedPath = func() string { return path }

	ws := &WshServer{}
	if err := ws.RecordDetachedCommand(context.Background(), wshrpc.CommandRecordDetachedData{Pid: 300, StartMs: 1000, BlockId: "blk-a"}); err != nil {
		t.Fatal(err)
	}
	// a block arcterm no longer has keeps the name it had at launch
	if err := devservers.RecordDetached(path, devservers.DetachedLaunch{
		Pid: 400, StartMs: 2000, Owner: devservers.ServerOwner{Kind: devservers.OwnerAgent, BlockId: "gone", TabId: "tab-g", Name: "closed"},
	}); err != nil {
		t.Fatal(err)
	}
	holders, err := readMachineHolders(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if h := holders[300]; h.Kind != devservers.OwnerAgent || h.TabId != "tab-a" || h.Name != "dev env" || !h.Detached {
		t.Fatalf("holders[300] = %+v; want the agent that ran wsh detach", h)
	}
	if h := holders[400]; h.Name != "closed" || !h.Detached {
		t.Fatalf("holders[400] = %+v; want the closed tab's name from the record", h)
	}
	if h := holders[20]; h.Detached || h.TabId != "tab-a" {
		t.Fatalf("holders[20] = %+v; the shell still holds as before", h)
	}
}
