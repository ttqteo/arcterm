// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"sync/atomic"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestContinueReRunsAFailedVerify(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}, {ID: "t-1", Label: "second"}, stillOpen})
	f.setPlanCommands(t, verifyCmd, "")
	f.finish(t, "t-0")
	merges := stubMerge(t, landedSha)
	var failing atomic.Bool
	failing.Store(true)
	stubPlanCommand(t, func(context.Context, string, string) error {
		if failing.Load() {
			return &planCommandError{exitCode: 1, output: "FAIL"}
		}
		return nil
	})
	await := awaitVerify(t)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	await()
	if got := f.dag(t).Tasks[0].State; got != TaskState_VerifyFailed {
		t.Fatalf("setup: want verify-failed, got %s", got)
	}
	// t-1 finishes after t-0's batch, so only a passing Verify lets it land
	f.finish(t, "t-1")
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if *merges != 1 {
		t.Fatalf("a failed Verify holds later merges, got %d merges", *merges)
	}

	// the lead committed a fix in the project tree
	failing.Store(false)
	if err := ContinueMerge(f.ctx, f.channel, f.ownerID, "t-0"); err != nil {
		t.Fatal(err)
	}
	await() // t-0's re-run passes; its tick lands t-1
	await() // t-1's Verify

	g := f.dag(t)
	if g.Tasks[0].State != TaskState_Done || g.Tasks[0].VerifyError != "" {
		t.Fatalf("a passing re-run clears the failure, got %s %q", g.Tasks[0].State, g.Tasks[0].VerifyError)
	}
	if *merges != 2 || g.Tasks[1].State != TaskState_Done {
		t.Fatalf("the held merge lands once Verify passes, got %d merges and %s", *merges, g.Tasks[1].State)
	}
}

func TestContinueAfterConflictRunsVerify(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}, stillOpen})
	f.setPlanCommands(t, verifyCmd, "")
	f.finish(t, "t-0")
	stubMerge(t, func(context.Context, string, string, string) (string, error) { return "", ErrMergeConflict })
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if got := f.dag(t).Tasks[0].State; got != TaskState_BlockedMerge {
		t.Fatalf("setup: want blocked-merge, got %s", got)
	}
	orig := continueMerge
	continueMerge = func(context.Context, string, string, MergeLane, []string) (string, error) { return "sha-2", nil }
	restoreAfterStages(t, func() { continueMerge = orig })
	calls := stubPlanCommand(t, func(context.Context, string, string) error { return nil })
	await := awaitVerify(t)

	if err := ContinueMerge(f.ctx, f.channel, f.ownerID, "t-0"); err != nil {
		t.Fatal(err)
	}
	await()

	task := f.dag(t).Tasks[0]
	if !task.Merged || task.State != TaskState_Done || len(calls.in(f.project)) != 1 {
		t.Fatalf("a continued merge is verified like any other, got merged=%v %s with %d runs", task.Merged, task.State, len(calls.in(f.project)))
	}
}

func TestForwardTaskAcceptsAFailedVerify(t *testing.T) {
	lead := newFakeLead(t)
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.Tasks[0].State, cur.Tasks[0].Merged = TaskState_VerifyFailed, true
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	if err := ForwardTask(f.ctx, f.dagID, "t-0", "the fix needs a product call"); err != nil {
		t.Fatal(err)
	}
	if lead.countKind(waveobj.RunEventKindTaskForwarded) != 1 {
		t.Fatalf("want one task-forwarded row, got %+v", lead.rows)
	}
}
