// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package jobmeter measures how much memory each Bash-tool command of an agent peaks at. One poll finds the
// shell each agent's Bash tool started, adds up its process tree on every poll while it runs, and reports the
// largest sum once it has gone, so the heavy-job queue can plan with what a command really took.
package jobmeter

import (
	"context"
	"log"
	"maps"
	"runtime"
	"slices"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/resmon"
)

const (
	defaultPoll = 2 * time.Second

	imageBash = "bash.exe"

	// the arc mod runs a heavy background command as
	//   '<wsh>' jobslot --hold-parent -- '<command>'; [ $? -ne 75 ] || exit 75\n<command>
	// (claude/arc-mod/hooks/jobslot-core.ts heldInBackground; 75 is JOBSLOT_REFUSED_EXIT)
	heldMarker = " jobslot --hold-parent -- "
	heldTail   = "; [ $? -ne 75 ] || exit 75\n"
)

// Agent is one agent to watch: the block it runs in and the agent's own process.
type Agent struct {
	BlockId string
	Pid     int32 // the agent's own process (memusage.AgentPid), not the block's root
}

// Done is one measured command that has ended. Peak is the largest sum, in bytes, of its process tree over the
// polls it was seen in.
type Done struct {
	BlockId string
	Command string
	Peak    uint64
}

// Config wires the meter to its surroundings.
type Config struct {
	Agents func(t memusage.Table) []Agent // the agents to watch, given this poll's table
	OnDone func(Done)                     // a measured command ended; called outside any lock
	Poll   time.Duration                  // 0 is 2 s
}

// seams is everything one poll reads from the machine besides the process table, so a test scripts a poll with no
// real processes.
type seams struct {
	argv      func(pid int32) []string
	footprint func(pid int32) (uint64, bool)
	// Windows only (both nil elsewhere): Git Bash starts a task's real work outside the bash's Windows tree, and
	// only MSYS process groups tie it back. psBeside is the ps.exe beside an MSYS bash ("" when none), and msys
	// reads that install's process table with it.
	psBeside func(bashExe string) string
	msys     func(ps string) []resmon.MsysProc
}

func liveSeams(ctx context.Context) seams {
	s := seams{
		argv:      func(pid int32) []string { return resmon.ReadArgv(int(pid)) },
		footprint: memusage.JobFootprint,
	}
	if runtime.GOOS == "windows" {
		s.psBeside = resmon.MsysPsBeside
		lastErr := ""
		s.msys = func(ps string) []resmon.MsysProc {
			procs, err := resmon.ReadMsysProcs(ctx, ps)
			if err != nil {
				if msg := err.Error(); msg != lastErr && ctx.Err() == nil {
					log.Printf("jobmeter: reading the msys process table with %s: %v", ps, err)
					lastErr = msg
				}
				return nil
			}
			lastErr = ""
			return procs
		}
	}
	return s
}

// shell is a Bash-tool command being measured: the shell claude code started for it, a child of its agent.
type shell struct {
	block   string
	agent   int32 // the agent pid the shell was found under
	command string
	peak    uint64
	sampled bool   // a footprint was read at least once
	ps      string // the MSYS install's ps.exe, once a bash in the shell's tree has one beside it
}

// meter is the state kept between polls. One goroutine (Run) uses it.
type meter struct {
	shells map[int32]*shell
	argvs  map[int32][]string // each process's argv, read once
}

func newMeter() *meter {
	return &meter{shells: map[int32]*shell{}, argvs: map[int32][]string{}}
}

// argvOf is pid's argv. It is read once and kept until pid leaves the process table; a read that found nothing (the
// process was just starting, or is not ours) is tried again on the next poll.
func (m *meter) argvOf(pid int32, s seams) []string {
	if argv, ok := m.argvs[pid]; ok {
		return argv
	}
	argv := s.argv(pid)
	if len(argv) > 0 {
		m.argvs[pid] = argv
	}
	return argv
}

// step is one poll over the process table t: it finds the Bash-tool shells newly under agents, adds up each
// shell's tree, and returns the commands whose shell has gone since the last poll, in shell pid order. A command
// that was never sampled is not returned.
func (m *meter) step(t memusage.Table, agents []Agent, s seams) []Done {
	for pid := range m.argvs {
		if !t.Has(pid) {
			delete(m.argvs, pid)
		}
	}

	// a shell that left the table, or whose parent is no longer its agent (its pid is someone else's now), is over
	var done []Done
	for _, pid := range slices.Sorted(maps.Keys(m.shells)) {
		sh := m.shells[pid]
		if parent, ok := t.Parent(pid); ok && parent == sh.agent {
			continue
		}
		delete(m.shells, pid)
		if sh.sampled {
			done = append(done, Done{BlockId: sh.block, Command: sh.command, Peak: sh.peak})
		}
	}

	for _, a := range agents {
		for _, kid := range t.Children(a.Pid) {
			if _, ok := m.shells[kid]; ok {
				continue
			}
			argv := m.argvOf(kid, s)
			command, ok := resmon.EvalCommand(argv)
			if !ok {
				continue
			}
			command = unwrapHeld(command)
			if strings.TrimSpace(command) == "" {
				continue
			}
			m.shells[kid] = &shell{block: a.BlockId, agent: a.Pid, command: command}
		}
	}

	msysTables := map[string][]resmon.MsysProc{} // each install's table, read at most once this poll
	for _, pid := range slices.Sorted(maps.Keys(m.shells)) {
		sh := m.shells[pid]
		var sum uint64
		read := false
		for _, p := range m.treeOf(t, pid, sh, s, msysTables) {
			if n, ok := s.footprint(p); ok {
				sum += n
				read = true
			}
		}
		if read {
			sh.sampled = true
			sh.peak = max(sh.peak, sum)
		}
	}
	return done
}

// treeOf is the shell and its Windows descendants, then, where Git Bash runs, each MSYS group member's tree: the
// process groups the shell's tree leads hold what the command really runs.
func (m *meter) treeOf(t memusage.Table, root int32, sh *shell, s seams, tables map[string][]resmon.MsysProc) []int32 {
	tree := t.Tree(root)
	if s.msys == nil || s.psBeside == nil {
		return tree
	}
	if sh.ps == "" {
		for _, p := range tree {
			argv := m.argvOf(p, s)
			if len(argv) == 0 || !isBash(argv[0]) {
				continue
			}
			if sh.ps = s.psBeside(argv[0]); sh.ps != "" {
				break
			}
		}
	}
	if sh.ps == "" {
		return tree
	}
	procs, ok := tables[sh.ps]
	if !ok {
		procs = s.msys(sh.ps)
		tables[sh.ps] = procs
	}
	pids := make([]int, len(tree))
	seen := make(map[int32]bool, len(tree))
	for i, p := range tree {
		pids[i] = int(p)
		seen[p] = true
	}
	for _, w := range resmon.MsysGroupPids(procs, pids) {
		for _, p := range t.Tree(int32(w)) {
			if !seen[p] {
				seen[p] = true
				tree = append(tree, p)
			}
		}
	}
	return tree
}

// isBash reports whether argv0 is a bash.exe, whichever way its path is written.
func isBash(argv0 string) bool {
	if i := strings.LastIndexAny(argv0, `\/`); i >= 0 {
		argv0 = argv0[i+1:]
	}
	return strings.EqualFold(argv0, imageBash)
}

// unwrapHeld is the command the arc mod's background wrapper holds, which is what the person ran; any other command
// comes back as it is. It is jobslot-core.ts heldOriginal without knowing the wsh path: the wrapper is rebuilt around
// each candidate original, and only a command that equals its rebuilt self is a wrapper. The quoted copy may hold
// the tail's text too, so each place the tail occurs is tried.
func unwrapHeld(command string) string {
	i := strings.Index(command, heldMarker)
	if i < 2 || command[0] != '\'' || command[i-1] != '\'' {
		return command
	}
	prefix := command[:i] + heldMarker
	quote := func(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }
	for from := 0; from < len(command); {
		k := strings.Index(command[from:], heldTail)
		if k < 0 {
			break
		}
		at := from + k
		original := command[at+len(heldTail):]
		if command == prefix+quote(original)+heldTail+original {
			return original
		}
		from = at + 1
	}
	return command
}

// poll reads the process table once and reports the commands that ended.
func (m *meter) poll(cfg Config, s seams, lastErr *string) {
	if cfg.Agents == nil && len(m.shells) == 0 {
		return
	}
	t, err := memusage.ReadTable()
	if err != nil {
		if msg := err.Error(); msg != *lastErr {
			log.Printf("jobmeter: reading the process table: %v", err)
			*lastErr = msg
		}
		return
	}
	*lastErr = ""
	var agents []Agent
	if cfg.Agents != nil {
		agents = cfg.Agents(t)
	}
	for _, d := range m.step(t, agents, s) {
		if cfg.OnDone != nil {
			cfg.OnDone(d)
		}
	}
}

// Run polls until ctx ends.
func Run(ctx context.Context, cfg Config) {
	every := cfg.Poll
	if every <= 0 {
		every = defaultPoll
	}
	m := newMeter()
	s := liveSeams(ctx)
	tick := time.NewTicker(every)
	defer tick.Stop()
	lastErr := ""
	for ctx.Err() == nil {
		m.poll(cfg, s, &lastErr)
		select {
		case <-ctx.Done():
		case <-tick.C:
		}
	}
}
