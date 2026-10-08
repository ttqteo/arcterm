// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/devservers"
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
