// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"errors"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

var errNoProcessTable = errors.New("no process table")

func TestDagRunIDsListsTheOwnerThenEveryChildRun(t *testing.T) {
	g := &waveobj.TaskGroup{
		RunID: "owner",
		Tasks: []waveobj.TaskNode{
			{ID: "t-1", RunID: "w1", ReviewRunID: "rv1"},
			{ID: "t-2", RunID: "w2"},
			{ID: "t-3"},
		},
		PlanReview: &waveobj.PlanReviewStage{Reviewers: []waveobj.PlanReviewer{{RunID: "pr1"}, {Lens: "second"}}},
		Final:      &waveobj.FinalStage{VerifierRunID: "fv"},
	}
	want := []string{"owner", "w1", "rv1", "w2", "pr1", "fv"}
	if got := DagRunIDs(g); !reflect.DeepEqual(got, want) {
		t.Fatalf("DagRunIDs = %v, want %v", got, want)
	}
}

func TestDagRunIDsOfADagWithNoChildren(t *testing.T) {
	if got, want := DagRunIDs(&waveobj.TaskGroup{RunID: "owner"}), []string{"owner"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("DagRunIDs = %v, want %v", got, want)
	}
	if got := DagRunIDs(nil); len(got) != 0 {
		t.Fatalf("DagRunIDs(nil) = %v, want none", got)
	}
}

func TestBlockTreeBytesIsTheTreesResidentMemory(t *testing.T) {
	prev := childTreeSample
	t.Cleanup(func() { childTreeSample = prev })
	var asked string
	childTreeSample = func(blockId string) (treeSample, bool) {
		asked = blockId
		return treeSample{CPUMs: 10, RSS: 700 << 20}, true
	}
	if got := BlockTreeBytes("blk-1"); got != 700<<20 {
		t.Fatalf("BlockTreeBytes = %d, want %d", got, uint64(700<<20))
	}
	if asked != "blk-1" {
		t.Fatalf("sampled block %q, want blk-1", asked)
	}
}

func TestBlockTreeBytesIsZeroWithNoReading(t *testing.T) {
	prev := childTreeSample
	t.Cleanup(func() { childTreeSample = prev })
	childTreeSample = func(string) (treeSample, bool) { return treeSample{RSS: 123}, false }
	if got := BlockTreeBytes("gone"); got != 0 {
		t.Fatalf("a block with no reading holds %d, want 0", got)
	}
}

// stubRunCommandTrees scripts the three seams RunCommandBytes reads: the live jobs, the process table and each
// process's memory. pid 10's tree is 10 and 11; pid 20's is 20; pid 30's is 30 and 31.
func stubRunCommandTrees(t *testing.T, jobs []jobobject.LiveJob) {
	t.Helper()
	prevJobs, prevTable, prevSampler := liveJobs, readProcessTable, processSampler
	t.Cleanup(func() { liveJobs, readProcessTable, processSampler = prevJobs, prevTable, prevSampler })
	liveJobs = func() []jobobject.LiveJob { return jobs }
	readProcessTable = func() (memusage.Table, error) {
		return memusage.NewTable(map[int32]int32{1: 0, 10: 1, 11: 10, 20: 1, 30: 1, 31: 30}), nil
	}
	held := map[int32]uint64{10: 100, 11: 50, 20: 400, 30: 1000, 31: 2000}
	processSampler = func() memusage.Sampler {
		return memusage.Sampler{Footprint: func(pid int32) (uint64, bool) { n, ok := held[pid]; return n, ok }}
	}
}

func TestRunCommandBytesSumsTheTreesOfTheRunsCommandsOnly(t *testing.T) {
	stubRunCommandTrees(t, []jobobject.LiveJob{
		{Owner: jobobject.Owner{Kind: jobobject.OwnerKind_RunCmd, Id: "run-a", Cmd: "Verify"}, RootPid: 10},
		{Owner: jobobject.Owner{Kind: jobobject.OwnerKind_RunCmd, Id: "run-a", Cmd: "Final"}, RootPid: 20},
		{Owner: jobobject.Owner{Kind: jobobject.OwnerKind_RunCmd, Id: "run-b", Cmd: "Verify"}, RootPid: 30},
		// a block shell of the same run is counted through BlockTreeBytes, not here
		{Owner: jobobject.Owner{Kind: jobobject.OwnerKind_Block, Id: "run-a"}, RootPid: 30},
	})
	if got, want := RunCommandBytes([]string{"run-a"}), uint64(100+50+400); got != want {
		t.Fatalf("run-a's commands hold %d, want %d", got, want)
	}
	if got, want := RunCommandBytes([]string{"run-a", "run-b"}), uint64(100+50+400+1000+2000); got != want {
		t.Fatalf("both runs' commands hold %d, want %d", got, want)
	}
	if got := RunCommandBytes([]string{"run-c"}); got != 0 {
		t.Fatalf("a run with no command holds %d, want 0", got)
	}
	if got := RunCommandBytes(nil); got != 0 {
		t.Fatalf("no runs hold %d, want 0", got)
	}
}

func TestRunCommandBytesIsZeroWithNoLiveJobsOrNoProcessTable(t *testing.T) {
	stubRunCommandTrees(t, nil)
	if got := RunCommandBytes([]string{"run-a"}); got != 0 {
		t.Fatalf("with no live jobs (every platform but Windows): %d, want 0", got)
	}
	stubRunCommandTrees(t, []jobobject.LiveJob{{Owner: jobobject.Owner{Kind: jobobject.OwnerKind_RunCmd, Id: "run-a"}, RootPid: 10}})
	readProcessTable = func() (memusage.Table, error) { return memusage.Table{}, errNoProcessTable }
	if got := RunCommandBytes([]string{"run-a"}); got != 0 {
		t.Fatalf("with no process table: %d, want 0", got)
	}
}
