// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func awaitBaseCheck(t *testing.T) func() {
	t.Helper()
	done := make(chan struct{}, 4)
	orig := baseCheckFinished
	baseCheckFinished = func(string) { done <- struct{}{} }
	restoreAfterStages(t, func() { baseCheckFinished = orig })
	return func() {
		t.Helper()
		select {
		case <-done:
		case <-time.After(60 * time.Second):
			t.Fatal("the base Check did not finish")
		}
	}
}

func (f *mergeFixture) setCheck(t *testing.T, check string) {
	t.Helper()
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.Check = check
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestBaseCheckFailureIsRecordedAndWakesTheLead(t *testing.T) {
	lead := newFakeLead(t)
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setCheck(t, "echo 'error TS2307: three'; exit 2")
	var spawned []string
	stubSpawn(t, &spawned)
	await := awaitBaseCheck(t)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	await()

	bc := f.dag(t).BaseCheck
	if bc == nil || bc.State != BaseCheckState_Failed || bc.Commit == "" || !strings.Contains(bc.Detail, "exit 2") || !strings.Contains(bc.Detail, "TS2307") {
		t.Fatalf("want a failed base Check with its commit and cause, got %+v", bc)
	}
	if len(lead.sends) != 1 || !strings.Contains(lead.sends[0], "already fails on the base") {
		t.Fatalf("the lead is told once, got %q", lead.sends)
	}
	if _, err := os.Stat(worktreeDir(f.project, f.ownerID+"-base")); !os.IsNotExist(err) {
		t.Fatalf("the base tree is removed, stat err %v", err)
	}
}

func TestBaseCheckPassesQuietlyAndRunsOnce(t *testing.T) {
	lead := newFakeLead(t)
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setCheck(t, "true")
	var spawned []string
	stubSpawn(t, &spawned)
	await := awaitBaseCheck(t)
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	await()
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if bc := f.dag(t).BaseCheck; bc == nil || bc.State != BaseCheckState_Passed {
		t.Fatalf("want passed, got %+v", bc)
	}
	if len(lead.sends) != 0 {
		t.Fatalf("a passing base Check wakes nobody, got %q", lead.sends)
	}
}

func TestNoBaseCheckWithoutCheckOrOnceATaskStarted(t *testing.T) {
	g := mustGroup(t, []waveobj.TaskNode{{ID: "t-0", Label: "a"}})
	owner := &waveobj.Run{ProjectPath: newGitRepo(t)}
	var after []func()
	advanceBaseCheck(context.Background(), g, owner, &after)
	if g.BaseCheck != nil || len(after) != 0 {
		t.Fatalf("a dag with no Check runs nothing, got %+v", g.BaseCheck)
	}
	// a dag already under way has no base left to check: its lanes have moved the head
	g.Check = "true"
	g.Tasks[0].State = TaskState_Running
	advanceBaseCheck(context.Background(), g, owner, &after)
	if g.BaseCheck != nil || len(after) != 0 {
		t.Fatalf("no base Check once a task started, got %+v", g.BaseCheck)
	}
}

// a revised plan with another Check or Setup has a base nobody checked with it yet
func TestAReplacedPlanChecksItsNewCheckOnTheBase(t *testing.T) {
	for _, c := range []struct {
		name, check string
		want        bool
	}{{"a new Check starts over", "go vet ./...", false}, {"the same Check keeps the result", "tsc", true}} {
		t.Run(c.name, func(t *testing.T) {
			ctx, dag := seedPlanReviewDag(t)
			captureSpawns(t)
			newFakeLead(t)
			if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
				g.Check = "tsc"
				g.BaseCheck = &waveobj.BaseCheck{State: BaseCheckState_Failed, Commit: "abc", Detail: "exit 2: error TS2307"}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			reviewer := startPlanReview(t, ctx, dag.OID)
			if err := RecordPlanReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Fail, "no task for 4.1", nil); err != nil {
				t.Fatal(err)
			}
			revised := &waveobj.TaskGroup{Title: "revised", Parallelism: 1, PlanPath: "p2.md", Check: c.check,
				Tasks: []waveobj.TaskNode{{ID: "t-1", Label: "a", State: TaskState_Pending}}}
			if _, err := ReplacePlanReviewProposal(ctx, dag.OID, revised); err != nil {
				t.Fatal(err)
			}
			if got := loadDag(t, ctx, dag.OID).BaseCheck != nil; got != c.want {
				t.Fatalf("base Check kept = %v, want %v", got, c.want)
			}
		})
	}
}

// a base Check still running when the plan changed its Check reports on a command the dag no longer has
func TestABaseCheckResultForAnotherCommandIsDropped(t *testing.T) {
	lead := newFakeLead(t)
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.Check = "go vet ./..."
		cur.BaseCheck = &waveobj.BaseCheck{State: BaseCheckState_Running, Commit: "abc"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := recordBaseCheckLocked(f.ctx, f.dagID, "", "tsc", BaseCheckState_Failed, "exit 2: error TS2307"); err != nil {
		t.Fatal(err)
	}
	if bc := f.dag(t).BaseCheck; bc.State != BaseCheckState_Running || len(lead.sends) != 0 {
		t.Fatalf("the stale result is dropped, got %+v and %q", bc, lead.sends)
	}
}

// A Check the base tree could not finish judged nothing about the base. Read as failed, it would tell every worker
// that Check failures are not theirs and let the final stage pass a failing Check as unverified.
func TestABaseCheckThatDidNotFinishIsSkipped(t *testing.T) {
	for name, cause := range map[string]*planCommandError{
		"timed out": {exitCode: -1, timeout: VerifyTimeout},
		"killed":    {exitCode: 0xC000013A, killed: "exit 0xc000013a"},
	} {
		t.Run(name, func(t *testing.T) {
			lead := newFakeLead(t)
			f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
			f.setCheck(t, "tsc --noEmit")
			var spawned []string
			stubSpawn(t, &spawned)
			stubPlanCommand(t, func(context.Context, string, string) error { return cause })
			await := awaitBaseCheck(t)

			if err := Schedule(f.ctx, f.dagID); err != nil {
				t.Fatal(err)
			}
			await()

			if bc := f.dag(t).BaseCheck; bc == nil || bc.State != BaseCheckState_Skipped || !strings.Contains(bc.Detail, "Check did not finish") {
				t.Fatalf("want a skipped base Check that says it did not finish, got %+v", bc)
			}
			for _, sent := range lead.sends {
				if strings.Contains(sent, "already fails on the base") {
					t.Fatalf("the lead was told the base fails: %q", sent)
				}
			}
		})
	}
}

// a Check that ran and failed with an ordinary exit is still a verdict on the base
func TestABaseCheckThatExitedNonZeroStillFails(t *testing.T) {
	lead := newFakeLead(t)
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setCheck(t, "tsc --noEmit")
	var spawned []string
	stubSpawn(t, &spawned)
	stubPlanCommand(t, func(context.Context, string, string) error {
		return &planCommandError{exitCode: 2, output: "error TS2307"}
	})
	await := awaitBaseCheck(t)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	await()

	if bc := f.dag(t).BaseCheck; bc == nil || bc.State != BaseCheckState_Failed {
		t.Fatalf("want a failed base Check, got %+v", bc)
	}
	if len(lead.sends) != 1 || !strings.Contains(lead.sends[0], "already fails on the base") {
		t.Fatalf("the lead is told the base fails, got %q", lead.sends)
	}
}
