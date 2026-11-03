// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// oneLane is t-1, then t-2, which depends on it and on nothing else.
func oneLane() []waveobj.TaskNode {
	return []waveobj.TaskNode{{ID: "t-1", Label: "schema"}, {ID: "t-2", Label: "api", Deps: []string{"t-1"}}}
}

type mergeCall struct {
	runID, goal string
	fold        []string
}

// recordMerges stubs the squash merge with a fixed outcome and records every call.
func recordMerges(t *testing.T, sha string, err error) *[]mergeCall {
	t.Helper()
	var calls []mergeCall
	old := mergeWorktree
	mergeWorktree = func(_ context.Context, _, runID string, lane MergeLane, fold []string) (string, error) {
		calls = append(calls, mergeCall{runID, lane.Title, fold})
		return sha, err
	}
	restoreAfterStages(t, func() { mergeWorktree = old })
	return &calls
}

// commitInTree commits one new file in a task's tree, as its worker would, and returns the commit.
func commitInTree(t *testing.T, wt, name string) string {
	t.Helper()
	if err := os.WriteFile(filepath.Join(wt, name), []byte(name+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, wt, "add", name)
	gitCmd(t, wt, "commit", "-m", name)
	return gitCmd(t, wt, "rev-parse", "HEAD")
}

// taskRun loads the child run the task currently points at.
func (f *mergeFixture) taskRun(t *testing.T, taskID string) *waveobj.Run {
	t.Helper()
	run, err := wstore.GetRun(f.ctx, f.channel, taskByID(f.dag(t), taskID).RunID)
	if err != nil {
		t.Fatal(err)
	}
	return run
}

func TestLaneTasksStackInOneWorktreeAndMergeOnce(t *testing.T) {
	f := newMergeFixture(t, oneLane())
	merges := recordMerges(t, "sha-lane", nil)
	var spawned []string
	stubSpawn(t, &spawned)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	wt := worktreeDir(f.project, TaskWorktreeKey(f.ownerID, "t-1"))
	if got := f.taskRun(t, "t-1").ProjectPath; got != wt {
		t.Fatalf("t-1 works in the lane's tree, got %s", got)
	}
	// the tree and its branch are gone after cleanup, so the run is the only record of where the work was
	branch := "wave/" + TaskWorktreeKey(f.ownerID, "t-1")
	if got := f.taskRun(t, "t-1").Branch; got != branch {
		t.Fatalf("t-1 records the lane's branch %s, got %q", branch, got)
	}
	schema := commitInTree(t, wt, "schema.txt")
	f.finish(t, "t-1")

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if len(*merges) != 0 {
		t.Fatalf("a lane does not merge before its last task is done, got %+v", *merges)
	}
	second := f.taskRun(t, "t-2")
	if second.ProjectPath != wt || second.BaseCommit != schema || second.Branch != branch {
		t.Fatalf("t-2 starts in the same tree and branch at t-1's commit, got %s (%s) at %s", second.ProjectPath, second.Branch, second.BaseCommit)
	}
	f.finish(t, "t-2")

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	want := []mergeCall{{runID: TaskWorktreeKey(f.ownerID, "t-1"), goal: "schema; api"}}
	if !reflect.DeepEqual(*merges, want) {
		t.Fatalf("one squash merge of the lane's branch, got %+v", *merges)
	}
	g := f.dag(t)
	if !g.Tasks[0].Merged || !g.Tasks[1].Merged || g.Status != DagStatus_Done {
		t.Fatalf("the merge lands both tasks, got merged %v/%v, dag %s", g.Tasks[0].Merged, g.Tasks[1].Merged, g.Status)
	}
	if got := f.taskRun(t, "t-2").EndCommit; got != "sha-lane" {
		t.Fatalf("the squash is recorded on the lane's last task, got %q", got)
	}
}

func TestManualMergeRefusesALaneThatIsNotFinished(t *testing.T) {
	f := newMergeFixture(t, oneLane())
	f.finish(t, "t-1")
	merges := recordMerges(t, "sha-lane", nil)

	err := MergeTask(f.ctx, f.channel, f.ownerID, "t-1")
	if err == nil || !strings.Contains(err.Error(), "lane t-1, t-2") {
		t.Fatalf("merging part of a lane must be refused and name the lane, got %v", err)
	}
	if len(*merges) != 0 {
		t.Fatalf("nothing merges, got %+v", *merges)
	}
}

func TestLaneConflictBlocksItsLastTaskAndContinueLandsTheLane(t *testing.T) {
	lead := newFakeLead(t)
	f := newMergeFixture(t, oneLane())
	f.finish(t, "t-1")
	f.finish(t, "t-2")
	recordMerges(t, "", ErrMergeConflict)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	g := f.dag(t)
	if g.Tasks[1].State != TaskState_BlockedMerge || g.Tasks[0].State != TaskState_Done || g.Tasks[0].Merged {
		t.Fatalf("the conflict belongs to the lane's last task, got %s / %s merged=%v", g.Tasks[0].State, g.Tasks[1].State, g.Tasks[0].Merged)
	}
	want := "wake: merge conflict landing lane ending at task t-2. git status, then wsh jarvis dag status t-2"
	if len(lead.sends) != 1 || lead.sends[0] != want {
		t.Fatalf("want %q, got %q", want, lead.sends)
	}

	var continued []string
	orig := continueMerge
	continueMerge = func(_ context.Context, _, runID string, _ MergeLane, _ []string) (string, error) {
		continued = append(continued, runID)
		return "sha-resolved", nil
	}
	restoreAfterStages(t, func() { continueMerge = orig })
	if err := ContinueMerge(f.ctx, f.channel, f.ownerID, "t-2"); err != nil {
		t.Fatal(err)
	}
	g = f.dag(t)
	if !reflect.DeepEqual(continued, []string{TaskWorktreeKey(f.ownerID, "t-1")}) || !g.Tasks[0].Merged || !g.Tasks[1].Merged {
		t.Fatalf("continue lands the lane's branch and both tasks, got %v merged %v/%v", continued, g.Tasks[0].Merged, g.Tasks[1].Merged)
	}
}

func TestSetupFailureInALaneKeepsItsCommitsForTheRetry(t *testing.T) {
	newFakeLead(t)
	f := newMergeFixture(t, oneLane())
	f.setPlanCommands(t, "", setupCmd)
	var failSetup atomic.Bool
	stubPlanCommand(t, func(context.Context, string, string) error {
		if failSetup.Load() {
			return &planCommandError{exitCode: 1, output: "task: not found"}
		}
		return nil
	})
	var spawned []string
	stubSpawn(t, &spawned)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	key := TaskWorktreeKey(f.ownerID, "t-1")
	wt := worktreeDir(f.project, key)
	schema := commitInTree(t, wt, "schema.txt")
	// a file the worker left uncommitted makes t-2's dispatch rebuild the tree, so Setup runs again
	if err := os.WriteFile(filepath.Join(wt, "leftover.txt"), []byte("wip\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	f.finish(t, "t-1")
	failSetup.Store(true)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if task := f.dag(t).Tasks[1]; task.State != TaskState_Failed || task.LastFailureKind != FailureKindSetup {
		t.Fatalf("want t-2 failed (setup), got %s (%s)", task.State, task.LastFailureKind)
	}
	if _, err := os.Stat(wt); !os.IsNotExist(err) {
		t.Fatalf("the half-prepared tree goes, stat err = %v", err)
	}
	if got := gitCmd(t, f.project, "rev-parse", "wave/"+key); got != schema {
		t.Fatalf("the lane's branch keeps t-1's commit, got %s", got)
	}

	failSetup.Store(false)
	if err := ApplyAction(f.ctx, f.dagID, "t-2", "retry", waveobj.RoutePin{}); err != nil {
		t.Fatal(err)
	}
	if got := f.taskRun(t, "t-2").BaseCommit; got != schema {
		t.Fatalf("the retry starts at t-1's commit, got %s", got)
	}
	if _, err := os.Stat(filepath.Join(wt, "schema.txt")); err != nil {
		t.Fatalf("the retried tree holds t-1's work: %v", err)
	}
}

func TestOnlyTheFirstMergeCarriesTheSpecAndPlan(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-1", Label: "schema"}, {ID: "t-2", Label: "docs"}})
	spec, plan := filepath.Join(f.project, "spec.md"), filepath.Join(f.project, "plan.md")
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.PlanPath, cur.SpecPath = plan, spec
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	f.finish(t, "t-1")
	f.finish(t, "t-2")
	merges := recordMerges(t, "sha-1", nil)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if len(*merges) != 2 {
		t.Fatalf("want both lanes merged, got %+v", *merges)
	}
	if got := (*merges)[0].fold; !reflect.DeepEqual(got, []string{spec, plan}) {
		t.Fatalf("the first merge stages the spec and plan, got %v", got)
	}
	if got := (*merges)[1].fold; got != nil {
		t.Fatalf("a later merge stages nothing extra, got %v", got)
	}
}
