// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"path/filepath"
	"strings"
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

// A fix the lead left uncommitted in the landing tree passes a re-run Verify there, then never lands: the land
// merges the branch and removes the tree with it. A resolution left unstaged is missing from the squash commit.
func TestContinueRefusesUncommittedWorkInTheLandingTree(t *testing.T) {
	for _, tc := range []struct{ state, want string }{
		{TaskState_VerifyFailed, "commit the fix"},
		{TaskState_BlockedMerge, "git add"},
	} {
		t.Run(tc.state, func(t *testing.T) {
			f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
			f.setPlanCommands(t, verifyCmd, "")
			tree := f.land(t)
			f.finish(t, "t-0")
			if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
				cur.Tasks[0].State, cur.Tasks[0].Merged = tc.state, tc.state == TaskState_VerifyFailed
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			writeFile(t, filepath.Join(tree, "base.txt"), "the lead's fix\n")
			calls := stubPlanCommand(t, func(context.Context, string, string) error { return nil })

			err := ContinueMerge(f.ctx, f.channel, f.ownerID, "t-0")
			if err == nil || !strings.Contains(err.Error(), tc.want) || !strings.Contains(err.Error(), "base.txt") {
				t.Fatalf("continue over an uncommitted change: err = %v, want a refusal saying %q and naming base.txt", err, tc.want)
			}
			if got := f.dag(t).Tasks[0].State; got != tc.state || len(calls.list()) != 0 {
				t.Fatalf("a refused continue moved the task to %s and ran %d commands", got, len(calls.list()))
			}
		})
	}
}

// A fix committed in the landing tree, or a resolution staged there, is what --continue is for: the refusal above
// must not stand in front of it.
func TestContinueAcceptsWhatIsCommittedOrStagedInTheLandingTree(t *testing.T) {
	t.Run("a committed fix", func(t *testing.T) {
		f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
		f.setPlanCommands(t, verifyCmd, "")
		tree := f.land(t)
		f.finish(t, "t-0")
		if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
			cur.Tasks[0].State, cur.Tasks[0].Merged = TaskState_VerifyFailed, true
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		writeFile(t, filepath.Join(tree, "base.txt"), "the lead's fix\n")
		gitCmd(t, tree, "add", "base.txt")
		gitCmd(t, tree, "commit", "-m", "fix the failure")
		calls := stubPlanCommand(t, func(context.Context, string, string) error { return nil })
		await := awaitVerify(t)

		if err := ContinueMerge(f.ctx, f.channel, f.ownerID, "t-0"); err != nil {
			t.Fatal(err)
		}
		await()
		if len(calls.list()) != 1 {
			t.Fatalf("want Verify run once over the committed fix, got %d runs", len(calls.list()))
		}
	})
	t.Run("a staged resolution", func(t *testing.T) {
		f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
		tree := f.land(t)
		f.finish(t, "t-0")
		if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
			cur.Tasks[0].State = TaskState_BlockedMerge
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		writeFile(t, filepath.Join(tree, "base.txt"), "the resolution\n")
		gitCmd(t, tree, "add", "base.txt")
		orig := continueMerge
		continueMerge = func(context.Context, string, string, MergeLane, []string) (string, error) { return "sha-2", nil }
		restoreAfterStages(t, func() { continueMerge = orig })

		if err := ContinueMerge(f.ctx, f.channel, f.ownerID, "t-0"); err != nil {
			t.Fatalf("a staged resolution is what --continue commits: %v", err)
		}
		if !f.dag(t).Tasks[0].Merged {
			t.Fatal("the continued squash is merged")
		}
	})
}
