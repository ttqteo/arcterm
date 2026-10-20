// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package services

import (
	"slices"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
)

func TestBlockJobPids(t *testing.T) {
	block := func(id string) jobobject.Owner { return jobobject.Owner{Kind: jobobject.OwnerKind_Block, Id: id} }
	jobs := []jobobject.LiveJob{
		{Owner: block("blk-a"), RootPid: 10, Members: []int{10, 11, 12}},
		{Owner: block("blk-b"), RootPid: 20, Members: []int{20, 21}},
		{Owner: block("blk-a"), RootPid: 30, Members: []int{30}}, // a second job for the same block, as a restarted shell leaves
		{Owner: jobobject.Owner{Kind: jobobject.OwnerKind_RunCmd, Id: "blk-a", Cmd: "Verify"}, RootPid: 40, Members: []int{40, 41}},
	}

	got := blockJobPids(jobs, "blk-a")
	slices.Sort(got)
	if want := []int32{10, 11, 12, 30}; !slices.Equal(got, want) {
		t.Errorf("blockJobPids(blk-a) = %v, want %v: both of its jobs, nothing of another block's or a run command's", got, want)
	}
	if got := blockJobPids(jobs, "blk-b"); !slices.Equal(got, []int32{20, 21}) {
		t.Errorf("blockJobPids(blk-b) = %v", got)
	}
	if got := blockJobPids(jobs, "blk-none"); got != nil {
		t.Errorf("blockJobPids(blk-none) = %v, want nil", got)
	}
	if got := blockJobPids(nil, "blk-a"); got != nil {
		t.Errorf("blockJobPids with no jobs = %v, want nil", got)
	}
}
