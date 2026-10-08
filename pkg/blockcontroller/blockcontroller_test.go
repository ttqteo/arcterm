// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"errors"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

func TestAgentStatusEvent(t *testing.T) {
	ev := AgentStatusEvent("abc", baseds.AgentState_Idle, "codex", 1717000000000)
	if ev.Event != wps.Event_AgentStatus {
		t.Fatalf("event = %q, want %q", ev.Event, wps.Event_AgentStatus)
	}
	if ev.Persist != 1 {
		t.Errorf("persist = %d, want 1", ev.Persist)
	}
	if len(ev.Scopes) != 1 || ev.Scopes[0] != "block:abc" {
		t.Errorf("scopes = %v, want [block:abc]", ev.Scopes)
	}
	data, ok := ev.Data.(baseds.AgentStatusData)
	if !ok {
		t.Fatalf("data type = %T, want baseds.AgentStatusData", ev.Data)
	}
	if data.State != baseds.AgentState_Idle || data.ORef != "block:abc" || data.Agent != "codex" || data.Ts != 1717000000000 {
		t.Errorf("data = %#v, want idle/block:abc/codex/ts", data)
	}
}

func TestIdleOnExitEvent(t *testing.T) {
	// agent session -> idle event carrying the runtime as agent
	meta := waveobj.MetaMapType{"session:agent": "claude"}
	ev := idleOnExitEvent("blk1", meta, 42)
	if ev == nil {
		t.Fatal("agent session should produce an idle event, got nil")
	}
	data := ev.Data.(baseds.AgentStatusData)
	if data.State != baseds.AgentState_Idle || data.ORef != "block:blk1" || data.Agent != "claude" {
		t.Errorf("data = %#v, want idle/block:blk1/claude", data)
	}

	// codex runtime preserved
	if ev := idleOnExitEvent("blk1", waveobj.MetaMapType{"session:agent": "codex"}, 42); ev == nil || ev.Data.(baseds.AgentStatusData).Agent != "codex" {
		t.Errorf("codex runtime not preserved: %#v", ev)
	}

	// plain terminal (no session:agent) -> no emit
	if ev := idleOnExitEvent("blk1", waveobj.MetaMapType{}, 42); ev != nil {
		t.Errorf("non-agent block should emit nothing, got %#v", ev)
	}
}

func TestExitHookIsSilentDuringShutdown(t *testing.T) {
	oldHook := AgentOutcomeHook
	AgentOutcomeHook = func(string, int) {}
	t.Cleanup(func() { AgentOutcomeHook = oldHook; shuttingDown.Store(false) })

	if exitHook() == nil {
		t.Fatal("a normal exit must reach the outcome hook")
	}
	shuttingDown.Store(true)
	if exitHook() != nil {
		t.Fatal("an exit caused by server shutdown is not a worker failure")
	}
}

func TestOutputPublishDue(t *testing.T) {
	interval := outputPublishInterval.Milliseconds()
	if !outputPublishDue(0, 5_000) {
		t.Fatal("a block's first output is published")
	}
	if outputPublishDue(5_000, 5_000+interval-1) {
		t.Fatal("output inside the interval is not republished")
	}
	if !outputPublishDue(5_000, 5_000+interval) {
		t.Fatal("output after the interval is republished")
	}
}

func TestAgentShouldCloseOnExit(t *testing.T) {
	agentTab := waveobj.MetaMapType{"session:agent": "claude"}
	plainTab := waveobj.MetaMapType{}
	tests := []struct {
		name     string
		block    waveobj.MetaMapType
		tab      waveobj.MetaMapType
		exitCode int
		want     bool
	}{
		{"agent clean exit closes", waveobj.MetaMapType{}, agentTab, 0, true},
		{"agent nonzero exit closes", waveobj.MetaMapType{}, agentTab, 1, true},
		{"agent keeponexit keeps", waveobj.MetaMapType{"cmd:keeponexit": true}, agentTab, 0, false},
		{"agent keeponexit keeps on nonzero too", waveobj.MetaMapType{"cmd:keeponexit": true}, agentTab, 1, false},
		{"agent force closes over keeponexit", waveobj.MetaMapType{"cmd:keeponexit": true, "cmd:closeonexitforce": true}, agentTab, 1, true},
		{"plain terminal no flags keeps", waveobj.MetaMapType{}, plainTab, 0, false},
		{"plain closeonexit clean exit closes", waveobj.MetaMapType{"cmd:closeonexit": true}, plainTab, 0, true},
		{"plain closeonexit nonzero keeps", waveobj.MetaMapType{"cmd:closeonexit": true}, plainTab, 1, false},
		{"plain force closes", waveobj.MetaMapType{"cmd:closeonexitforce": true}, plainTab, 1, true},
	}
	for _, tc := range tests {
		got := agentShouldCloseOnExit(tc.block, tc.tab, tc.exitCode)
		if got != tc.want {
			t.Errorf("%s: agentShouldCloseOnExit(%v, %v, %d) = %v, want %v", tc.name, tc.block, tc.tab, tc.exitCode, got, tc.want)
		}
	}
}

// a restart replaces the block's controller before the old process's close-on-exit fires: that exit must not
// delete the block the resumed agent now runs in (a Resume after a Claude account switch closed the agent)
func TestStoppedOnPurpose(t *testing.T) {
	const blockId = "stopped-on-purpose"
	exited := &ShellController{BlockId: blockId}
	setReg := func(c Controller) {
		registryLock.Lock()
		defer registryLock.Unlock()
		if c == nil {
			delete(controllerRegistry, blockId)
		} else {
			controllerRegistry[blockId] = c
		}
	}
	defer setReg(nil)

	setReg(exited)
	if stoppedOnPurpose(blockId, exited) {
		t.Error("the agent's own exit (its controller still the block's) must close it")
	}
	setReg(&ShellController{BlockId: blockId})
	if !stoppedOnPurpose(blockId, exited) {
		t.Error("a restart's replaced controller must keep the block")
	}
	setReg(nil)
	if !stoppedOnPurpose(blockId, exited) {
		t.Error("a destroyed controller (restart in progress, or the block closing) must keep the block")
	}
}

// a launch that never produced a process (CreateProcess refusing an over-long command line, a bad cwd) must
// end like an exit: otherwise the controller reads "init" forever and a worker's run never learns it died
func TestFailedStartEndsLikeAnExit(t *testing.T) {
	oldHook := AgentOutcomeHook
	exited := make(chan int, 1)
	AgentOutcomeHook = func(_ string, exitCode int) { exited <- exitCode }
	t.Cleanup(func() { AgentOutcomeHook = oldHook })

	sc := MakeShellController("tab-1", "block-1", BlockController_Cmd, "").(*ShellController)
	sc.failStart(errors.New("The filename or extension is too long."))

	if st := sc.GetRuntimeStatus(); st.ShellProcStatus != Status_Done || st.ShellProcExitCode == 0 {
		t.Fatalf("status = %q exit %d, want done with a nonzero exit", st.ShellProcStatus, st.ShellProcExitCode)
	}
	select {
	case code := <-exited:
		if code == 0 {
			t.Fatal("the outcome hook must hear a failing exit code")
		}
	case <-time.After(time.Second):
		t.Fatal("the outcome hook never heard the failed start")
	}
}
