// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/resmon"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// 10 is an agent that exec'd its command, with 11 and 12 under it and 13 under 11; 20 is a pwsh wrapper around the
// agent 21, whose commands are 22 and 23; 30 is a plain terminal tab's shell with 31 under it; 99 is no one's.
func agentCpuTable() memusage.Table {
	return memusage.NewTable(map[int32]int32{
		10: 1, 11: 10, 12: 10, 13: 11,
		20: 1, 21: 20, 22: 21, 23: 21,
		30: 1, 31: 30,
		99: 1,
	})
}

var agentCpuRoots = map[string]int32{"blk-a": 10, "blk-w": 20}

func agentCpuIsShell(pid int32) bool { return pid == 20 }

func agentCpuCommandNamed(pid int32) string { return fmt.Sprintf("cmd-%d", pid) }

func resRow(pid int32, cpu float64) wshrpc.ProcessInfo {
	return wshrpc.ProcessInfo{Pid: pid, Cpu: cpu, Mem: 1, MemPct: 0.1}
}

func resGroup(kind, owner string, cpu float64, rows ...wshrpc.ProcessInfo) wshrpc.ResMonGroup {
	return wshrpc.ResMonGroup{Key: "job:" + owner, OwnerKind: kind, OwnerId: owner, Label: owner, Cpu: cpu, Rows: rows}
}

func fromResMon(snap wshrpc.ResMonSnapshotData) map[string]wshrpc.AgentCpuAgent {
	data := agentCpuFromResMon(snap, agentCpuRoots, agentCpuTable(), true, agentCpuIsShell, agentCpuCommandNamed)
	out := map[string]wshrpc.AgentCpuAgent{}
	for _, a := range data.Agents {
		out[a.BlockId] = a
	}
	return out
}

func readySnapshot(groups ...wshrpc.ResMonGroup) wshrpc.ResMonSnapshotData {
	return wshrpc.ResMonSnapshotData{Supported: true, Ready: true, Groups: groups}
}

func TestAgentCpuFromResMonKeepsAgentsAndRunWorkers(t *testing.T) {
	snap := readySnapshot(
		resGroup(wshrpc.ResMonOwner_Arc, "", 3, resRow(500, 3)),
		resGroup(wshrpc.ResMonOwner_AgentTab, "blk-a", 30, resRow(10, 20), resRow(11, 10)),
		resGroup(wshrpc.ResMonOwner_RunWorker, "blk-w", 12, resRow(20, 1), resRow(21, 4), resRow(22, 7)),
		// a plain terminal tab is an agenttab group too, but its block is no roster agent's
		resGroup(wshrpc.ResMonOwner_AgentTab, "blk-t", 60, resRow(30, 10), resRow(31, 50)),
	)
	got := fromResMon(snap)
	if len(got) != 2 {
		t.Fatalf("got %+v, want exactly the agenttab agent and the runworker agent: the terminal's group and arc's are dropped", got)
	}
	if a := got["blk-a"]; a.Cpu != 30 || a.BlockId != "blk-a" {
		t.Fatalf("blk-a = %+v, want Cpu 30 from its group", a)
	}
	if a := got["blk-w"]; a.Cpu != 12 {
		t.Fatalf("blk-w = %+v, want Cpu 12 from its runworker group", a)
	}
}

func TestAgentCpuFromResMonTopIsADescendantOnly(t *testing.T) {
	snap := readySnapshot(
		// 10, the agent, is the hottest row, and 99 is in no tree of this agent: neither may be offered to Stop
		resGroup(wshrpc.ResMonOwner_AgentTab, "blk-a", 40,
			resRow(10, 20), resRow(99, 15), resRow(11, 5), resRow(13, 8), resRow(12, -1)),
		// 20 is the wrapper shell and 21 the agent: Top is under 21
		resGroup(wshrpc.ResMonOwner_RunWorker, "blk-w", 30, resRow(20, 9), resRow(21, 12), resRow(22, 3), resRow(23, 6)),
	)
	got := fromResMon(snap)
	if top := got["blk-a"].Top; top == nil || top.Pid != 13 || top.Cpu != 8 || top.Command != "cmd-13" {
		t.Fatalf("blk-a Top = %+v, want 13 at 8%% named cmd-13: not the agent 10, not 99, and -1 is no reading", top)
	}
	if top := got["blk-w"].Top; top == nil || top.Pid != 23 || top.Cpu != 6 {
		t.Fatalf("blk-w Top = %+v, want 23 at 6%%: neither the wrapper 20 nor the agent 21", top)
	}
}

func TestAgentCpuFromResMonNoDescendantCpuNoTop(t *testing.T) {
	snap := readySnapshot(
		resGroup(wshrpc.ResMonOwner_AgentTab, "blk-a", 10, resRow(10, 10), resRow(11, 0), resRow(12, 0)),
	)
	a, ok := fromResMon(snap)["blk-a"]
	if !ok || a.Cpu != 10 || a.Top != nil {
		t.Fatalf("got %+v (listed %v), want Cpu 10 and no Top: the agent runs nothing but itself", a, ok)
	}
}

func TestAgentCpuFromResMonSumsAnAgentsGroups(t *testing.T) {
	// a block that restarted can hold two jobs at once: the agent's figure is both
	snap := readySnapshot(
		resGroup(wshrpc.ResMonOwner_AgentTab, "blk-a", 10, resRow(10, 4), resRow(11, 6)),
		resGroup(wshrpc.ResMonOwner_AgentTab, "blk-a", 15, resRow(12, 15)),
	)
	a := fromResMon(snap)["blk-a"]
	if a.Cpu != 25 || a.Top == nil || a.Top.Pid != 12 {
		t.Fatalf("got %+v top %+v, want 25 with 12 on top", a, a.Top)
	}
}

func TestAgentCpuFromResMonClampsToTheWholeMachine(t *testing.T) {
	snap := readySnapshot(
		resGroup(wshrpc.ResMonOwner_AgentTab, "blk-a", 60, resRow(11, 60)),
		resGroup(wshrpc.ResMonOwner_AgentTab, "blk-a", 60, resRow(12, 60)),
	)
	if a := fromResMon(snap)["blk-a"]; a.Cpu != 100 {
		t.Fatalf("Cpu = %v, want 100", a.Cpu)
	}
}

func TestAgentCpuFromResMonNotReadyPassesThrough(t *testing.T) {
	snap := wshrpc.ResMonSnapshotData{Supported: true, Ready: false, Groups: []wshrpc.ResMonGroup{
		resGroup(wshrpc.ResMonOwner_AgentTab, "blk-a", 0, resRow(10, 0)),
	}}
	data := agentCpuFromResMon(snap, agentCpuRoots, agentCpuTable(), true, agentCpuIsShell, agentCpuCommandNamed)
	if !data.Supported || data.Ready {
		t.Fatalf("got %+v, want supported and not ready: resmon has no CPU deltas yet", data)
	}
	if data.Agents == nil {
		t.Fatal("Agents must be an empty list, not null")
	}
}

func TestAgentCpuFromResMonUnsupportedPassesThrough(t *testing.T) {
	data := agentCpuFromResMon(wshrpc.ResMonSnapshotData{}, agentCpuRoots, agentCpuTable(), true, agentCpuIsShell, agentCpuCommandNamed)
	if data.Supported || data.Ready || data.Agents == nil || len(data.Agents) != 0 {
		t.Fatalf("got %+v, want unsupported with an empty list", data)
	}
}

func TestAgentCpuFromResMonWithoutAProcessTableStillGivesTheFigure(t *testing.T) {
	snap := readySnapshot(resGroup(wshrpc.ResMonOwner_AgentTab, "blk-a", 22, resRow(10, 10), resRow(11, 12)))
	data := agentCpuFromResMon(snap, agentCpuRoots, memusage.Table{}, false, agentCpuIsShell, agentCpuCommandNamed)
	if len(data.Agents) != 1 || data.Agents[0].Cpu != 22 || data.Agents[0].Top != nil {
		t.Fatalf("got %+v, want 22 with no Top: without the process list a descendant cannot be told from the agent", data.Agents)
	}
}

func TestAgentCpuFromResMonListsAgentsByBlockId(t *testing.T) {
	roots := map[string]int32{"blk-z": 10, "blk-a": 20}
	snap := readySnapshot(
		resGroup(wshrpc.ResMonOwner_AgentTab, "blk-z", 1, resRow(10, 1)),
		resGroup(wshrpc.ResMonOwner_AgentTab, "blk-a", 1, resRow(20, 1)),
	)
	data := agentCpuFromResMon(snap, roots, agentCpuTable(), true, agentCpuIsShell, agentCpuCommandNamed)
	if len(data.Agents) != 2 || data.Agents[0].BlockId != "blk-a" || data.Agents[1].BlockId != "blk-z" {
		t.Fatalf("got %+v, want blk-a then blk-z", data.Agents)
	}
}

// agentCpuScript is what AgentCpuCommand reads, scripted by scriptAgentCpu: the platform, the roster with its root
// pids, the Windows snapshot, the macOS sampler and the process table.
type agentCpuScript struct {
	goos     string
	snap     wshrpc.ResMonSnapshotData
	read     wshrpc.AgentCpuData
	tableErr error
	// what the command handed its seams
	snapAsked, readAsked, rosterAsked int
	readRoots                         map[string]int32
}

func scriptAgentCpu(t *testing.T, s *agentCpuScript) {
	t.Helper()
	oldGoos, oldSnap, oldRead := agentCpuGOOS, agentCpuSnapshot, agentCpuRead
	oldFacts, oldPid, oldTable := loadAgentRosterFacts, consumerBlockPid, consumerTable
	t.Cleanup(func() {
		agentCpuGOOS, agentCpuSnapshot, agentCpuRead = oldGoos, oldSnap, oldRead
		loadAgentRosterFacts, consumerBlockPid, consumerTable = oldFacts, oldPid, oldTable
	})
	agentCpuGOOS = s.goos
	agentCpuSnapshot = func(context.Context, resmon.Resolver) wshrpc.ResMonSnapshotData {
		s.snapAsked++
		return s.snap
	}
	agentCpuRead = func(roots map[string]int32, isShell func(int32) bool) wshrpc.AgentCpuData {
		s.readAsked++
		s.readRoots = roots
		return s.read
	}
	loadAgentRosterFacts = func(context.Context) (*agentRosterFacts, error) {
		s.rosterAsked++
		return &agentRosterFacts{Tabs: []agentTabFacts{
			agentFacts("tab-a", "portal", "blk-a", "claude", "working"),
			agentFacts("tab-w", "worker", "blk-w", "claude", "working"),
			agentFacts("tab-s", "asleep", "blk-s", "claude", "idle"), // no process: no pid
		}}, nil
	}
	consumerBlockPid = func(blockId string) int { return map[string]int{"blk-a": 10, "blk-w": 20}[blockId] }
	consumerTable = func() (memusage.Table, error) {
		if s.tableErr != nil {
			return memusage.Table{}, s.tableErr
		}
		return agentCpuTable(), nil
	}
}

func TestAgentCpuCommandOnWindowsReadsResMon(t *testing.T) {
	s := &agentCpuScript{goos: "windows", snap: readySnapshot(
		resGroup(wshrpc.ResMonOwner_AgentTab, "blk-a", 30, resRow(10, 20), resRow(11, 10)),
		resGroup(wshrpc.ResMonOwner_RunWorker, "blk-w", 8, resRow(22, 8)),
	)}
	scriptAgentCpu(t, s)
	data, err := (&WshServer{}).AgentCpuCommand(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !data.Supported || !data.Ready || len(data.Agents) != 2 {
		t.Fatalf("got %+v, want supported, ready and the two agents", data)
	}
	if data.Agents[0].BlockId != "blk-a" || data.Agents[0].Cpu != 30 || data.Agents[0].Top == nil || data.Agents[0].Top.Pid != 11 {
		t.Fatalf("blk-a = %+v, want 30 with 11 on top", data.Agents[0])
	}
	if s.snapAsked != 1 || s.readAsked != 0 {
		t.Fatalf("resmon asked %d times and the macOS sampler %d, want 1 and 0", s.snapAsked, s.readAsked)
	}
}

func TestAgentCpuCommandOnWindowsWithoutAProcessListStillAnswers(t *testing.T) {
	s := &agentCpuScript{goos: "windows", tableErr: errors.New("access denied"), snap: readySnapshot(
		resGroup(wshrpc.ResMonOwner_AgentTab, "blk-a", 30, resRow(10, 20), resRow(11, 10)),
	)}
	scriptAgentCpu(t, s)
	data, err := (&WshServer{}).AgentCpuCommand(context.Background())
	if err != nil || len(data.Agents) != 1 || data.Agents[0].Cpu != 30 || data.Agents[0].Top != nil {
		t.Fatalf("got %+v err %v, want the 30%% figure with no Top", data, err)
	}
}

func TestAgentCpuCommandOnMacUsesTheSamplerWithTheRosterRoots(t *testing.T) {
	want := wshrpc.AgentCpuData{Supported: true, Ready: true, Agents: []wshrpc.AgentCpuAgent{{BlockId: "blk-a", Cpu: 12}}}
	s := &agentCpuScript{goos: "darwin", read: want}
	scriptAgentCpu(t, s)
	data, err := (&WshServer{}).AgentCpuCommand(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !data.Supported || !data.Ready || len(data.Agents) != 1 || data.Agents[0].Cpu != 12 {
		t.Fatalf("got %+v, want the sampler's answer", data)
	}
	if len(s.readRoots) != 2 || s.readRoots["blk-a"] != 10 || s.readRoots["blk-w"] != 20 {
		t.Fatalf("sampler asked about %v, want the two agents with a process (the sleeping one has no pid)", s.readRoots)
	}
	if s.snapAsked != 0 {
		t.Fatal("resmon must not be read on a Mac: its supported flag turns on the Resource Manager readout")
	}
}

func TestAgentCpuCommandElsewhereIsUnsupportedAndReadsNothing(t *testing.T) {
	s := &agentCpuScript{goos: "linux"}
	scriptAgentCpu(t, s)
	data, err := (&WshServer{}).AgentCpuCommand(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if data.Supported || data.Ready || data.Agents == nil || len(data.Agents) != 0 {
		t.Fatalf("got %+v, want unsupported with an empty list", data)
	}
	if s.snapAsked != 0 || s.readAsked != 0 || s.rosterAsked != 0 {
		t.Fatalf("a platform with no sampler read the roster %d, resmon %d and the sampler %d times", s.rosterAsked, s.snapAsked, s.readAsked)
	}
}

func TestAgentCpuCommandReportsARosterThatCannotBeRead(t *testing.T) {
	s := &agentCpuScript{goos: "darwin"}
	scriptAgentCpu(t, s)
	loadAgentRosterFacts = func(context.Context) (*agentRosterFacts, error) { return nil, errors.New("store busy") }
	if _, err := (&WshServer{}).AgentCpuCommand(context.Background()); err == nil {
		t.Fatal("want the roster's error")
	}
}
