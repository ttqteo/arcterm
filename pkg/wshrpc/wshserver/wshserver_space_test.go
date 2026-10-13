// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvisattrib"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func TestBuildSpaceScopeDedupsAndStripsTabPrefix(t *testing.T) {
	edges := []jarvisattrib.AttributedEdge{
		{RunORef: "run:r1"},
		{RunORef: "run:r2"},
		{RunORef: "run:r1"},      // duplicate edge
		{RunORef: "run:missing"}, // edge to a run not in byORef
	}
	byORef := map[string]*waveobj.Run{
		"run:r1": {OID: "r1", ChannelOID: "ch1", Phases: []waveobj.RunPhase{{WorkerOrefs: []string{"tab:t1", "tab:t2"}}}},
		"run:r2": {OID: "r2", ChannelOID: "ch1", Phases: []waveobj.RunPhase{{WorkerOrefs: []string{"tab:t2", "tab:t3"}}}},
	}
	got := buildSpaceScope(edges, byORef)

	if len(got.RunORefs) != 3 {
		t.Fatalf("runorefs: want 3 deduped (r1,r2,missing), got %v", got.RunORefs)
	}
	if len(got.ChannelOids) != 1 || got.ChannelOids[0] != "ch1" {
		t.Fatalf("channeloids: want [ch1], got %v", got.ChannelOids)
	}
	if strings.Join(got.TabIds, ",") != "t1,t2,t3" {
		t.Fatalf("tabids: want t1,t2,t3 (deduped, tab: stripped), got %v", got.TabIds)
	}
}

// A worker oref that is not a tab: address must not be trimmed into a spurious match.
func TestRunHasWorkerTabIgnoresNonTabWorkerOrefs(t *testing.T) {
	run := &waveobj.Run{OID: "r1", Phases: []waveobj.RunPhase{{WorkerOrefs: []string{"t1", "block:t1", "tab:t2"}}}}
	if runHasWorkerTab(run, "t1") {
		t.Fatalf("t1 matched a non-tab worker oref")
	}
	if !runHasWorkerTab(run, "t2") {
		t.Fatalf("t2 is a tab worker and did not match")
	}
}
