// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agentcpu samples the CPU each agent's process tree uses, for the strain band of the Sidecar window (spec
// 2026-11-13-sidecar-design.md, section 4). On Windows the same figures come from pkg/resmon; this package is the
// macOS sampler.
//
// Compute is the pure core: two reads of every process's CPU time, the process table and the agents' root pids in,
// one figure per agent out. The sampler around it (Sampler, Read) runs only while the band asks: the first Read
// starts a goroutine that samples every sampleInterval, and it stops idleStop after the last Read. The platform
// files supply the two reads it cannot do portably (sample_darwin.go, sample_other.go).
package agentcpu

import (
	"fmt"
	"log"
	"maps"
	"slices"
	"sort"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	// sampleInterval is 2 s, resmon's interval: a tick reads the process table once and each tracked pid's CPU time
	// once (a few hundred pids for a busy roster), and the band asks about every 5 s, so a shorter interval would
	// only sample for nobody. 2 s is long enough that one tick's delta is not noise and short enough that a build
	// starting shows within the band's first reading after it.
	sampleInterval = 2 * time.Second
	// idleStop is how long the sampler outlives the last Read (resmon's idleStop): two missed polls.
	idleStop = 10 * time.Second
)

// Times is each process's cumulative CPU time, user plus system, in nanoseconds, by pid.
type Times map[int32]uint64

// Compute is each agent's CPU between two reads of Times that were wall apart, on a machine of cores logical CPUs.
// An agent's figure is the sum over its whole tree (its root and every descendant, the shell wrapper an agent block
// runs under included) of the CPU time used between the reads, as a percent of wall x cores: the share of the whole
// machine, 0-100, as resmon's groups give it. Top is the busiest descendant of the agent's own process
// (memusage.AgentPid, so neither the agent nor a wrapper shell is ever offered, which keeps StopProcessCommand's
// check satisfied); it is absent when no descendant used CPU. A process with no time in prev (born since) counts from
// 0; one with no time in cur (gone, or unreadable) is skipped; a counter that ran backwards is a reused pid and counts
// from 0. command names the Top process and is asked for no other. An agent whose root is not in the table has no
// reading and is left out. The answer is ordered by block id; nil when wall or cores is not positive.
func Compute(prev, cur Times, wall time.Duration, cores int, t memusage.Table, roots map[string]int32,
	isShell func(pid int32) bool, command func(pid int32) string) []wshrpc.AgentCpuAgent {
	if wall <= 0 || cores <= 0 {
		return nil
	}
	capacity := float64(wall.Nanoseconds()) * float64(cores) // ns of CPU the whole machine offers in the interval
	pct := func(ns uint64) float64 { return min(float64(ns)/capacity*100, 100) }
	delta := func(pid int32) uint64 {
		now, ok := cur[pid]
		if !ok {
			return 0
		}
		before, seen := prev[pid]
		if !seen || now < before {
			return 0
		}
		return now - before
	}
	blocks := make([]string, 0, len(roots))
	for id := range roots {
		blocks = append(blocks, id)
	}
	sort.Strings(blocks)
	agents := make([]wshrpc.AgentCpuAgent, 0, len(blocks))
	for _, id := range blocks {
		root := roots[id]
		tree := t.Tree(root)
		if tree == nil {
			continue
		}
		var total uint64
		for _, pid := range tree {
			total += delta(pid)
		}
		a := wshrpc.AgentCpuAgent{BlockId: id, Cpu: pct(total)}
		agent := memusage.AgentPid(t, root, isShell)
		var top int32
		var topNs uint64
		for _, pid := range t.Tree(agent) {
			if pid == agent {
				continue
			}
			if ns := delta(pid); ns > topNs {
				top, topNs = pid, ns
			}
		}
		if topNs > 0 {
			a.Top = &wshrpc.AgentCpuProcess{Pid: top, Command: command(top), Cpu: pct(topNs)}
		}
		agents = append(agents, a)
	}
	return agents
}

// sources are what a Sampler reads from the machine, so a test scripts them.
type sources struct {
	cores   int
	table   func() (memusage.Table, error)
	times   func(pids []int32) Times // the CPU time of each pid it could read; a pid it could not is absent
	command func(pid int32) string   // a process's command line as a row shows it; "" when it cannot be read
}

// tickState is what one sampler goroutine carries from tick to tick: the last read's times and when it was taken,
// and the command line of each process that has been the busiest, so the line is read once while the process lives.
type tickState struct {
	prev     Times
	lastWall time.Time
	cmds     map[int32]string
}

func newTickState() *tickState {
	return &tickState{cmds: map[int32]string{}}
}

// Sampler samples the CPU of the agents Read names. It runs only while Read is called.
type Sampler struct {
	src      sources
	interval time.Duration
	idleStop time.Duration

	mu       sync.Mutex
	running  bool
	lastCall time.Time
	roots    map[string]int32
	isShell  func(pid int32) bool
	latest   *wshrpc.AgentCpuData // nil before the first ready tick, and again after a stop
}

func newSampler(src sources, interval, idleStop time.Duration) *Sampler {
	return &Sampler{src: src, interval: interval, idleStop: idleStop}
}

// live is the process's sampler; nothing in it runs until the first Read on a platform that has one.
var live = newSampler(platformSources(), sampleInterval, idleStop)

// Read is the latest reading of the agents in roots (block id → root pid), starting the sampler if it is stopped.
// The first answer after a start has Ready false: CPU is a rate, and one read of a counter has none. isShell is
// memusage.AgentPid's test for a wrapper shell. Off macOS it answers Supported false and starts nothing.
func Read(roots map[string]int32, isShell func(pid int32) bool) wshrpc.AgentCpuData {
	return readVia(supported, live, roots, isShell)
}

func readVia(isSupported bool, s *Sampler, roots map[string]int32, isShell func(pid int32) bool) wshrpc.AgentCpuData {
	if !isSupported {
		return wshrpc.AgentCpuData{Agents: []wshrpc.AgentCpuAgent{}}
	}
	return s.Read(roots, isShell)
}

// Read is Read for this sampler.
func (s *Sampler) Read(roots map[string]int32, isShell func(pid int32) bool) wshrpc.AgentCpuData {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastCall = time.Now()
	s.roots, s.isShell = maps.Clone(roots), isShell
	if !s.running {
		s.running = true
		go s.loop()
	}
	out := wshrpc.AgentCpuData{Supported: true, Agents: []wshrpc.AgentCpuAgent{}}
	if s.latest == nil {
		return out
	}
	out.Ready = s.latest.Ready
	// the roster can change between ticks: answer only for the agents asked about now
	for _, a := range s.latest.Agents {
		if _, asked := roots[a.BlockId]; asked {
			out.Agents = append(out.Agents, a)
		}
	}
	return out
}

func (s *Sampler) isRunning() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.running
}

func (s *Sampler) loop() {
	st := newTickState()
	t := time.NewTicker(s.interval)
	defer t.Stop()
	for {
		s.mu.Lock()
		roots, isShell := s.roots, s.isShell
		s.mu.Unlock()
		if data, ok := s.tick(st, roots, isShell, time.Now()); ok {
			s.mu.Lock()
			s.latest = &data
			s.mu.Unlock()
		}
		<-t.C
		s.mu.Lock()
		if time.Since(s.lastCall) > s.idleStop {
			s.running, s.latest = false, nil
			s.mu.Unlock()
			return
		}
		s.mu.Unlock()
	}
}

// tick takes one sample at now: one process table read, then the CPU time of each pid under an agent's root. ok is
// false when the table could not be read; the last good sample then stays the baseline, so the next delta covers the
// gap and is still a true rate. The first tick (and the first after a stop) has no baseline: Ready false.
func (s *Sampler) tick(st *tickState, roots map[string]int32, isShell func(pid int32) bool, now time.Time) (wshrpc.AgentCpuData, bool) {
	table, err := s.src.table()
	if err != nil {
		log.Printf("agentcpu: reading the process table: %v", err)
		return wshrpc.AgentCpuData{}, false
	}
	seen := map[int32]bool{}
	var pids []int32
	for _, root := range roots {
		for _, pid := range table.Tree(root) {
			if !seen[pid] {
				seen[pid] = true
				pids = append(pids, pid)
			}
		}
	}
	slices.Sort(pids)
	cur := s.src.times(pids)
	data := wshrpc.AgentCpuData{Supported: true, Ready: !st.lastWall.IsZero(), Agents: []wshrpc.AgentCpuAgent{}}
	if data.Ready {
		command := func(pid int32) string {
			if c, ok := st.cmds[pid]; ok {
				return c
			}
			c := s.src.command(pid)
			if c == "" {
				c = fmt.Sprintf("process %d", pid)
			}
			st.cmds[pid] = c
			return c
		}
		data.Agents = append(data.Agents, Compute(st.prev, cur, now.Sub(st.lastWall), s.src.cores, table, roots, isShell, command)...)
	}
	for pid := range st.cmds {
		// a pid that is not in the sample is a process that left; its pid may be reused by another command
		if _, here := cur[pid]; !here {
			delete(st.cmds, pid)
		}
	}
	st.prev, st.lastWall = cur, now
	return data, true
}
