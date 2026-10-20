// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobobject

// keepImages are desktop apps an agent may start that the person goes on using after it: Docker Desktop, which an
// agent starts when it needs docker, is the one met so far. Started in a block, such an app joins the block's job,
// and the kill that restarts or closes the agent (a Claude account switch's resume, closing its tab) took it down
// with the agent; KillTreeKeeping leaves it, and what runs under it, running. Lower-case image names.
var keepImages = map[string]bool{"docker desktop.exe": true}

// procEntry is one process in the OS process table.
type procEntry struct {
	parent int
	image  string // lower-case base name
}

// a parent chain longer than this is a pid-reuse loop, not a tree
const maxKeepDepth = 64

// Pure: the job members a kill spares: each member whose image is in keep, and every member under one through a
// chain of members. The chain stops at a non-member, so an unrelated process that took over a dead parent's pid is
// never mistaken for the app.
func keptMembers(members []int, table map[int]procEntry, keep map[string]bool) map[int]bool {
	inJob := make(map[int]bool, len(members))
	for _, pid := range members {
		inJob[pid] = true
	}
	kept := map[int]bool{}
	for _, pid := range members {
		for p, depth := pid, 0; inJob[p] && depth < maxKeepDepth; depth++ {
			e, ok := table[p]
			if !ok {
				break
			}
			if keep[e.image] {
				kept[pid] = true
				break
			}
			if e.parent == p {
				break
			}
			p = e.parent
		}
	}
	return kept
}
