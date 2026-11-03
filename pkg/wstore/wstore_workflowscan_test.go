// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// the store is shared by every test in the package, so these seed far past any other test's rows
const workflowScanTestBase = int64(4_000_000_000_000)

func appendTestRun(t *testing.T, ctx context.Context, channelId string, run waveobj.Run) string {
	t.Helper()
	run.ID = uuid.NewString()
	if err := AppendRun(ctx, channelId, run); err != nil {
		t.Fatal(err)
	}
	return run.ID
}

func TestGetRunsCreatedSince(t *testing.T) {
	ctx := context.Background()
	ch, err := CreateChannel(ctx, "created-since", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	old := appendTestRun(t, ctx, ch.OID, waveobj.Run{CreatedTs: workflowScanTestBase - 1})
	first := appendTestRun(t, ctx, ch.OID, waveobj.Run{CreatedTs: workflowScanTestBase + 2})
	second := appendTestRun(t, ctx, ch.OID, waveobj.Run{CreatedTs: workflowScanTestBase})

	runs, err := GetRunsCreatedSince(ctx, workflowScanTestBase)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, r := range runs {
		if r.ChannelOID == ch.OID {
			got = append(got, r.ID)
		}
		if r.ID == old {
			t.Fatalf("a run created before the window was returned")
		}
	}
	if len(got) != 2 || got[0] != second || got[1] != first {
		t.Fatalf("want [%s %s] oldest first, got %v", second, first, got)
	}
}

func TestQueryRunEventsSince(t *testing.T) {
	ctx := context.Background()
	runA, runB := uuid.NewString(), uuid.NewString()
	for _, e := range []struct {
		ts   int64
		run  string
		kind string
	}{
		{workflowScanTestBase - 1, runA, "task-failed"},
		{workflowScanTestBase + 5, runB, "land-held"},
		{workflowScanTestBase + 1, runA, "task-failed"},
		{workflowScanTestBase + 2, runA, "phase-started"},
	} {
		if _, err := AppendRunEventAt(ctx, e.ts, "ch", e.run, e.kind, nil, map[string]any{"reason": "x"}); err != nil {
			t.Fatal(err)
		}
	}

	evs, err := QueryRunEventsSince(ctx, workflowScanTestBase, []string{"task-failed", "land-held"})
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, e := range evs {
		if e.RunID == runA || e.RunID == runB {
			got = append(got, e.RunID+":"+e.Kind)
		}
	}
	want := []string{runA + ":task-failed", runB + ":land-held"}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("want %v across runs, oldest first, got %v", want, got)
	}
	if evs, err := QueryRunEventsSince(ctx, 0, nil); err != nil || len(evs) != 0 {
		t.Fatalf("no kinds: want no events, got %d (%v)", len(evs), err)
	}
}

func TestGetWorkflowScanRuns(t *testing.T) {
	ctx := context.Background()
	ch, err := CreateChannel(ctx, "scan-runs", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	picking := appendTestRun(t, ctx, ch.OID, waveobj.Run{CreatedTs: workflowScanTestBase, WorkflowScan: &waveobj.WorkflowScan{State: waveobj.WorkflowScanState_Picking}})
	scanning := appendTestRun(t, ctx, ch.OID, waveobj.Run{CreatedTs: workflowScanTestBase + 10, WorkflowScan: &waveobj.WorkflowScan{State: waveobj.WorkflowScanState_Scanning}})
	plain := appendTestRun(t, ctx, ch.OID, waveobj.Run{CreatedTs: workflowScanTestBase + 20})

	runs, err := GetWorkflowScanRuns(ctx)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, r := range runs {
		if r.ChannelOID != ch.OID {
			continue
		}
		if r.WorkflowScan == nil {
			t.Fatalf("run %s has no scan but was returned", r.ID)
		}
		got[r.ID] = r.WorkflowScan.State
	}
	if len(got) != 2 || got[picking] != waveobj.WorkflowScanState_Picking || got[scanning] != waveobj.WorkflowScanState_Scanning {
		t.Fatalf("want the two scan runs and their states, got %v", got)
	}
	if _, ok := got[plain]; ok {
		t.Fatalf("a run with no scan was returned")
	}
}
