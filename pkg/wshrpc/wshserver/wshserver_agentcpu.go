// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"log"
	"runtime"
	"sort"

	"github.com/wavetermdev/waveterm/pkg/agentcpu"
	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/resmon"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// seams, so tests script the platform, resmon's snapshot and the macOS sampler
var (
	agentCpuGOOS     = runtime.GOOS
	agentCpuSnapshot = resmon.Snapshot
	agentCpuRead     = agentcpu.Read
)

// AgentCpuCommand is one reading of each agent's CPU for Sidecar's strain band (spec 2026-11-13-sidecar-design.md,
// section 4). It is one shape on both platforms: on Windows it is resmon's sampler, the one the Consumers panel reads,
// grouped by job; on a Mac it is pkg/agentcpu's own, which runs only while this is called; elsewhere Supported is
// false. The agents are the roster's, rooted as GetConsumersCommand roots them.
func (ws *WshServer) AgentCpuCommand(ctx context.Context) (*wshrpc.AgentCpuData, error) {
	if agentCpuGOOS != "windows" && agentCpuGOOS != "darwin" {
		return &wshrpc.AgentCpuData{Agents: []wshrpc.AgentCpuAgent{}}, nil
	}
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return nil, err
	}
	rows := buildAgentRoster(facts)
	roots := make(map[string]int32, len(rows))
	for _, r := range rows {
		if pid := consumerBlockPid(r.blockId); pid > 0 {
			roots[r.blockId] = int32(pid)
		}
	}
	if agentCpuGOOS == "darwin" {
		data := agentCpuRead(roots, isShellProcess)
		return &data, nil
	}
	snap := agentCpuSnapshot(ctx, resolveResMonOwner)
	var table memusage.Table
	haveTable := false
	if snap.Supported && len(roots) > 0 {
		var terr error
		if table, terr = consumerTable(); terr != nil {
			// the figures still stand; without the process list a descendant cannot be told from the agent, so no Top
			log.Printf("agentcpu: reading the process list: %v", terr)
		} else {
			haveTable = true
		}
	}
	data := agentCpuFromResMon(snap, roots, table, haveTable, isShellProcess, func(pid int32) string { return commandOf(ctx, pid) })
	return &data, nil
}

// agentCpuFromResMon turns resmon's snapshot into the agents' CPU. A group counts when it is an agent tab's or a run
// worker's (resolveResMonOwner labels an orchestrator lead and its workers runworker) and its block is one of roots:
// a plain terminal tab is an agenttab group too, but its block is on no roster, and the arc group is Arc's own. An
// agent's figure is its groups' CPU (a block that restarted can hold two jobs at once); its Top is the busiest row
// that is a descendant of the agent's own process, never the agent or a wrapper shell, so StopProcessCommand accepts
// it. table is one read of the process list, which haveTable says is valid. Ready and Supported pass through.
func agentCpuFromResMon(snap wshrpc.ResMonSnapshotData, roots map[string]int32, table memusage.Table, haveTable bool,
	isShell func(pid int32) bool, command func(pid int32) string) wshrpc.AgentCpuData {
	out := wshrpc.AgentCpuData{Supported: snap.Supported, Ready: snap.Ready, Agents: []wshrpc.AgentCpuAgent{}}
	if !snap.Supported {
		return out
	}
	type tally struct {
		cpu    float64
		top    int32
		topCpu float64
	}
	tallies := map[string]*tally{}
	descendants := map[string]map[int32]bool{} // block id → the pids Top may name, built once per agent
	for _, g := range snap.Groups {
		if g.OwnerKind != wshrpc.ResMonOwner_AgentTab && g.OwnerKind != wshrpc.ResMonOwner_RunWorker {
			continue
		}
		root, ok := roots[g.OwnerId]
		if !ok {
			continue
		}
		tl := tallies[g.OwnerId]
		if tl == nil {
			tl = &tally{}
			tallies[g.OwnerId] = tl
		}
		tl.cpu += max(g.Cpu, 0)
		if !haveTable {
			continue
		}
		desc, built := descendants[g.OwnerId]
		if !built {
			desc = map[int32]bool{}
			agent := memusage.AgentPid(table, root, isShell)
			for _, pid := range table.Tree(agent) {
				if pid != agent {
					desc[pid] = true
				}
			}
			descendants[g.OwnerId] = desc
		}
		for _, row := range g.Rows {
			if desc[row.Pid] && row.Cpu > tl.topCpu {
				tl.top, tl.topCpu = row.Pid, row.Cpu
			}
		}
	}
	ids := make([]string, 0, len(tallies))
	for id := range tallies {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		tl := tallies[id]
		a := wshrpc.AgentCpuAgent{BlockId: id, Cpu: min(tl.cpu, 100)}
		if tl.topCpu > 0 {
			a.Top = &wshrpc.AgentCpuProcess{Pid: tl.top, Command: command(tl.top), Cpu: min(tl.topCpu, 100)}
		}
		out.Agents = append(out.Agents, a)
	}
	return out
}
