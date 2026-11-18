// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobobject

import "slices"

// treeProc is one process of a process table, as a tree walk needs it.
type treeProc struct {
	ppid  int
	start int64 // epoch ms; 0 when unknown
}

// treeMembers is where macOS keeps a "job": the root and every descendant by ppid, sorted. A child must not be older
// than its parent, so a pid reused under a live parent is not claimed; a root whose start is not rootStart (when
// rootStart is known) has exited and its pid been reused, and the job is empty. A process that left the tree
// (reparented to launchd once its parent exited, as `wsh detach` does) is no longer a member, as one that broke away
// from a job object is not on Windows.
func treeMembers(table map[int]treeProc, root int, rootStart int64) []int {
	r, ok := table[root]
	if !ok || (rootStart != 0 && r.start != 0 && r.start != rootStart) {
		return nil
	}
	kids := map[int][]int{}
	for pid, p := range table {
		if pid != p.ppid {
			kids[p.ppid] = append(kids[p.ppid], pid)
		}
	}
	out := []int{root}
	seen := map[int]bool{root: true}
	for i := 0; i < len(out); i++ {
		parent := out[i]
		for _, c := range kids[parent] {
			cp := table[c]
			if seen[c] || (cp.start != 0 && table[parent].start != 0 && cp.start < table[parent].start) {
				continue
			}
			seen[c] = true
			out = append(out, c)
		}
	}
	slices.Sort(out)
	return out
}
