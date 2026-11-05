// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"log"

	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// DagRunIDs is every run of a dag: the owner run, then the runs it spawned (childRunIDs). A pause marks all of
// them. The ids are in that order and are not deduplicated.
func DagRunIDs(g *waveobj.TaskGroup) []string {
	if g == nil {
		return nil
	}
	var ids []string
	if g.RunID != "" {
		ids = append(ids, g.RunID)
	}
	return append(ids, childRunIDs(g)...)
}

// BlockTreeBytes is the resident memory of the process tree of a block's controller, through childTreeSample;
// 0 when there is no reading (the block has no running process).
func BlockTreeBytes(blockId string) uint64 {
	s, ok := childTreeSample(blockId)
	if !ok {
		return 0
	}
	return s.RSS
}

// The seams RunCommandBytes reads, vars so tests script them.
var (
	liveJobs         = jobobject.LiveJobs
	readProcessTable = memusage.ReadTable
	processSampler   = memusage.Live
)

// RunCommandBytes is the memory held by the process trees of the plan commands (Setup, Check, Verify, Final) that
// are running for runIDs: the trees rooted at the jobobject.LiveJobs of kind run-cmd owned by one of those runs,
// each pid counted once, as pkg/memusage reads it (the private working set on Windows).
//
// It is 0 off Windows: jobobject.LiveJobs is nil there, since only Windows keeps a job object per command, so
// plan commands are not counted on other platforms. It is also 0 when the process table cannot be read, which is
// logged.
func RunCommandBytes(runIDs []string) uint64 {
	if len(runIDs) == 0 {
		return 0
	}
	owned := make(map[string]bool, len(runIDs))
	for _, id := range runIDs {
		owned[id] = true
	}
	var roots []int32
	for _, job := range liveJobs() {
		if job.Owner.Kind == jobobject.OwnerKind_RunCmd && owned[job.Owner.Id] && job.RootPid > 0 {
			roots = append(roots, int32(job.RootPid))
		}
	}
	if len(roots) == 0 {
		return 0
	}
	table, err := readProcessTable()
	if err != nil {
		log.Printf("runcommandbytes: reading the process table: %v", err)
		return 0
	}
	sampler := processSampler()
	var total uint64
	counted := map[int32]bool{}
	for _, root := range roots {
		for _, pid := range table.Tree(root) {
			if counted[pid] {
				continue
			}
			counted[pid] = true
			if n, ok := sampler.Footprint(pid); ok {
				total += n
			}
		}
	}
	return total
}
