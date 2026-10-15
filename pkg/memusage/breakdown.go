// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memusage

import (
	"maps"
	"slices"
)

// Sampler reads one process's memory and, on darwin, the process responsible for it. Funcs, so tests script them.
// Resident is what the process holds in RAM now; nil where Footprint already is that.
type Sampler struct {
	Footprint   func(pid int32) (uint64, bool)
	Resident    func(pid int32) (uint64, bool)
	Responsible func(pid int32) (int32, bool)
}

// Live is the sampler for this machine.
func Live() Sampler {
	return Sampler{Footprint: footprint, Resident: resident, Responsible: responsiblePid}
}

func (s Sampler) inRam(pid int32) (uint64, bool) {
	if s.Resident != nil {
		return s.Resident(pid)
	}
	return s.Footprint(pid)
}

// Breakdown is what one Measure found. A nil pointer, or an id missing from Agents, is a value it could not read.
// InRam is what all of it holds in RAM now: on darwin the footprints also count what macOS compressed or swapped
// out, which under memory pressure sum past the RAM in use.
type Breakdown struct {
	Agents    map[string]uint64
	Interface *uint64
	Server    *uint64
	Host      *uint64
	Terminals *uint64
	InRam     *uint64
}

// Measure sums each agent's tree (agents maps an id to its tree's root pid), wavesrv and the host, the plain
// terminals under wavesrv, and the webview that draws the cockpit. byResponsibility is darwin's case: the
// webview's processes are XPC services launchd starts, found as the processes the host is responsible for;
// elsewhere they are the host's tree. Either way the host itself, wavesrv's tree (the shells and the agents) and
// every agent's tree are left out of it.
func Measure(t Table, s Sampler, agents map[string]int32, serverPid, hostPid int32, byResponsibility bool) Breakdown {
	b := Breakdown{Agents: map[string]uint64{}}
	skip := map[int32]bool{}
	if hostPid > 1 {
		skip[hostPid] = true
	}
	for _, pid := range t.Tree(serverPid) {
		skip[pid] = true
	}
	inAgent := map[int32]bool{}
	for id, root := range agents {
		tree := t.Tree(root)
		for _, pid := range tree {
			skip[pid] = true
			inAgent[pid] = true
		}
		if sum, ok := sumOf(s.Footprint, tree); ok {
			b.Agents[id] = sum
		}
	}
	b.Server = one(s, serverPid)
	b.Terminals = terminalsOf(t, s, serverPid, inAgent)
	// the host, wavesrv's tree and every agent's tree, then the webview
	app := slices.Collect(maps.Keys(skip))
	if hostPid > 1 {
		b.Host = one(s, hostPid)
		webview := interfacePids(t, s, hostPid, skip, byResponsibility)
		if sum, ok := sumOf(s.Footprint, webview); ok {
			b.Interface = &sum
		}
		app = append(app, webview...)
	}
	if sum, ok := sumOf(s.inRam, app); ok {
		b.InRam = &sum
	}
	return b
}

// terminalsOf is what wavesrv's plain terminal tabs run: its tree minus itself and every agent's tree. Zero when
// there is none, nil when wavesrv is not running or none of it could be read.
func terminalsOf(t Table, s Sampler, serverPid int32, inAgent map[int32]bool) *uint64 {
	if !t.Has(serverPid) {
		return nil
	}
	var rest []int32
	for _, pid := range t.Tree(serverPid) {
		if pid != serverPid && !inAgent[pid] {
			rest = append(rest, pid)
		}
	}
	if len(rest) == 0 {
		return new(uint64)
	}
	if sum, ok := sumOf(s.Footprint, rest); ok {
		return &sum
	}
	return nil
}

func interfacePids(t Table, s Sampler, hostPid int32, skip map[int32]bool, byResponsibility bool) []int32 {
	var candidates []int32
	if byResponsibility {
		for _, pid := range t.Pids() {
			if r, ok := s.Responsible(pid); ok && r == hostPid {
				candidates = append(candidates, pid)
			}
		}
	} else {
		candidates = t.Tree(hostPid)
	}
	var kept []int32
	for _, pid := range candidates {
		if !skip[pid] {
			kept = append(kept, pid)
		}
	}
	return kept
}

// sumOf is what read gives for the pids, summed, and false when none of them could be read
func sumOf(read func(pid int32) (uint64, bool), pids []int32) (uint64, bool) {
	var sum uint64
	found := false
	for _, pid := range pids {
		if n, ok := read(pid); ok {
			sum += n
			found = true
		}
	}
	return sum, found
}

func one(s Sampler, pid int32) *uint64 {
	n, ok := s.Footprint(pid)
	if !ok {
		return nil
	}
	return &n
}
