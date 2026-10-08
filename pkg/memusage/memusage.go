// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package memusage measures what arcterm's processes hold in memory: each agent's process tree, wavesrv, the
// Tauri host and the webview that draws the cockpit. The figure is the physical footprint on macOS, what
// Activity Monitor shows, and the resident set elsewhere. A value that could not be read is absent, never zero.
package memusage

import (
	"sort"

	"github.com/shirou/gopsutil/v4/process"
)

// Table is one read of the process list: every pid's parent, and the children index built from it.
type Table struct {
	parent   map[int32]int32
	children map[int32][]int32
}

// NewTable indexes a pid -> parent map. A process listed as its own parent (pid 0 on darwin) is no one's child.
func NewTable(parent map[int32]int32) Table {
	children := make(map[int32][]int32, len(parent))
	for pid, ppid := range parent {
		if pid != ppid {
			children[ppid] = append(children[ppid], pid)
		}
	}
	for _, kids := range children {
		sort.Slice(kids, func(i, j int) bool { return kids[i] < kids[j] })
	}
	return Table{parent: parent, children: children}
}

// ReadTable lists every process once. On darwin each gopsutil Children() call lists them all again, so a poll
// that measures several trees reads the list here, once, and walks the index.
func ReadTable() (Table, error) {
	parent, err := readParents()
	if err != nil {
		return Table{}, err
	}
	return NewTable(parent), nil
}

// Has reports whether pid was running when the table was read.
func (t Table) Has(pid int32) bool {
	_, ok := t.parent[pid]
	return ok
}

// Pids is every pid in the table, ascending.
func (t Table) Pids() []int32 {
	pids := make([]int32, 0, len(t.parent))
	for pid := range t.parent {
		pids = append(pids, pid)
	}
	sort.Slice(pids, func(i, j int) bool { return pids[i] < pids[j] })
	return pids
}

// Tree is root and every descendant, root first, breadth first; nil when root was not running.
func (t Table) Tree(root int32) []int32 {
	if !t.Has(root) {
		return nil
	}
	seen := map[int32]bool{root: true}
	tree := []int32{root}
	for i := 0; i < len(tree); i++ {
		for _, kid := range t.children[tree[i]] {
			if !seen[kid] {
				seen[kid] = true
				tree = append(tree, kid)
			}
		}
	}
	return tree
}

// ProcessTree is root and every descendant, read through gopsutil one process at a time. gopsutil lists only
// direct children, and a test run is a shell, then go, then the compiled test binary. pkg/orchestrate samples
// one worker's tree per tick with it, where reading a whole Table would cost more.
func ProcessTree(root *process.Process) []*process.Process {
	tree := []*process.Process{root}
	for i := 0; i < len(tree); i++ {
		children, err := tree[i].Children()
		if err != nil {
			continue
		}
		tree = append(tree, children...)
	}
	return tree
}
