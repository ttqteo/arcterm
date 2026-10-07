// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvisattrib"
	"github.com/wavetermdev/waveterm/pkg/jarvisdossier"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wavevault"
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

func TestListDossiersFiltersStatusAndSorts(t *testing.T) {
	ctx := context.Background()
	v, err := wavevault.OpenVaultAtForTest(ctx, t.TempDir())
	if err != nil {
		t.Fatalf("open vault: %v", err)
	}
	id1, h1, err := jarvisdossier.CreateDossier(v, jarvisdossier.DossierFacts{Ticket: "T-1", Objective: "alpha"})
	if err != nil {
		t.Fatalf("create alpha: %v", err)
	}
	if _, _, err := jarvisdossier.CreateDossier(v, jarvisdossier.DossierFacts{Ticket: "T-2", Objective: "beta"}); err != nil {
		t.Fatalf("create beta: %v", err)
	}
	id3, h3, err := jarvisdossier.CreateDossier(v, jarvisdossier.DossierFacts{Ticket: "T-3", Objective: "gamma"})
	if err != nil {
		t.Fatalf("create gamma: %v", err)
	}
	if _, err := jarvisdossier.SetStatus(v, id1, "paused", h1); err != nil {
		t.Fatalf("pause alpha: %v", err)
	}
	if _, err := jarvisdossier.SetStatus(v, id3, "completed", h3); err != nil {
		t.Fatalf("complete gamma: %v", err)
	}
	rtn, err := listDossiers(v)
	if err != nil {
		t.Fatalf("listDossiers: %v", err)
	}
	// gamma (completed) excluded; alpha (paused) + beta (active) included.
	if len(rtn.Spaces) != 2 {
		t.Fatalf("want 2 focusable (alpha paused + beta active), got %d: %+v", len(rtn.Spaces), rtn.Spaces)
	}
	for _, s := range rtn.Spaces {
		if s.Status != "active" && s.Status != "paused" {
			t.Fatalf("unexpected status in results: %+v", s)
		}
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
