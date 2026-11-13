// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"path/filepath"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// laneGroup is the lane t-1 -> t-2 -> t-3, then t-4 and t-5, each depending on t-3 in a lane of its own.
func laneGroup(t *testing.T, mergeRequired bool, states map[string]string) *waveobj.TaskGroup {
	t.Helper()
	g, err := NewTaskGroup("run-1", "ch-1", "g", 2, mergeRequired, []waveobj.TaskNode{
		{ID: "t-1", Label: "schema"},
		{ID: "t-2", Label: "api", Deps: []string{"t-1"}},
		{ID: "t-3", Label: "ui", Deps: []string{"t-2"}},
		{ID: "t-4", Label: "docs", Deps: []string{"t-3"}},
		{ID: "t-5", Label: "e2e", Deps: []string{"t-3"}},
	}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	for id, s := range states {
		task := taskByID(&g, id)
		task.State = s
		if s == TaskState_Done || s == TaskState_Running {
			task.RunID = "run-" + id
		}
	}
	RecomputeDagStatus(&g)
	return &g
}

func markMerged(g *waveobj.TaskGroup, ids ...string) {
	for _, id := range ids {
		taskByID(g, id).Merged = true
	}
}

func TestLaneWorktreeKeyIsSharedAlongALane(t *testing.T) {
	g := laneGroup(t, true, nil)
	if got := laneOf(g, "t-2"); !reflect.DeepEqual(got, []string{"t-1", "t-2", "t-3"}) {
		t.Fatalf("lane of t-2 = %v", got)
	}
	if got := laneOf(g, "t-9"); got != nil {
		t.Fatalf("an unknown task has no lane, got %v", got)
	}
	for _, id := range []string{"t-1", "t-2", "t-3"} {
		if got := LaneWorktreeKey(g, id); got != TaskWorktreeKey("run-1", "t-1") {
			t.Fatalf("%s: key = %s, want the lane's first task's", id, got)
		}
	}
	if got := LaneWorktreeKey(g, "t-4"); got != TaskWorktreeKey("run-1", "t-4") {
		t.Fatalf("a one-task lane keys as the task always did, got %s", got)
	}
}

func TestDepSatisfiedInLaneAndAcrossLanes(t *testing.T) {
	cases := []struct {
		name          string
		mergeRequired bool
		states        map[string]string
		merged        []string
		task, dep     string
		want          bool
	}{
		{"same lane: a done dependency is enough, its commits are in the tree", true,
			map[string]string{"t-1": TaskState_Done}, nil, "t-2", "t-1", true},
		{"same lane: a running dependency is not", true,
			map[string]string{"t-1": TaskState_Running}, nil, "t-2", "t-1", false},
		{"another lane: a done, unmerged dependency is not", true,
			map[string]string{"t-1": TaskState_Done, "t-2": TaskState_Done, "t-3": TaskState_Done}, nil, "t-4", "t-3", false},
		{"another lane: the whole lane merged is", true,
			map[string]string{"t-1": TaskState_Done, "t-2": TaskState_Done, "t-3": TaskState_Done}, []string{"t-1", "t-2", "t-3"}, "t-4", "t-3", true},
		{"another lane: a skipped dependency waits for the rest of its lane to land", true,
			map[string]string{"t-1": TaskState_Done, "t-2": TaskState_Done, "t-3": TaskState_Skipped}, nil, "t-4", "t-3", false},
		{"another lane: a skipped dependency once its lane landed", true,
			map[string]string{"t-1": TaskState_Done, "t-2": TaskState_Done, "t-3": TaskState_Skipped}, []string{"t-1", "t-2"}, "t-4", "t-3", true},
		{"another lane: a merged lane whose Verify is still running is, the next merge waits on it instead", true,
			map[string]string{"t-1": TaskState_Done, "t-2": TaskState_Done, "t-3": TaskState_Verifying}, []string{"t-1", "t-2", "t-3"}, "t-4", "t-3", true},
		{"no merges: a done dependency is enough anywhere", false,
			map[string]string{"t-1": TaskState_Done, "t-2": TaskState_Done, "t-3": TaskState_Done}, nil, "t-4", "t-3", true},
	}
	for _, c := range cases {
		g := laneGroup(t, c.mergeRequired, c.states)
		markMerged(g, c.merged...)
		if got := depSatisfied(g, c.task, c.dep); got != c.want {
			t.Fatalf("%s: depSatisfied(%s, %s) = %v, want %v", c.name, c.task, c.dep, got, c.want)
		}
	}
}

func TestReadyTasksStartsTheNextTaskInALaneBeforeAnyMerge(t *testing.T) {
	g := laneGroup(t, true, map[string]string{"t-1": TaskState_Done})
	if got := ReadyTasks(g); !reflect.DeepEqual(got, []string{"t-2"}) {
		t.Fatalf("want [t-2], got %v", got)
	}
	g = laneGroup(t, true, map[string]string{"t-1": TaskState_Done, "t-2": TaskState_Done, "t-3": TaskState_Done})
	if got := ReadyTasks(g); len(got) != 0 {
		t.Fatalf("tasks in another lane wait for the lane to merge, got %v", got)
	}
	markMerged(g, "t-1", "t-2", "t-3")
	if got := ReadyTasks(g); !reflect.DeepEqual(got, []string{"t-4", "t-5"}) {
		t.Fatalf("want [t-4 t-5] once the lane landed, got %v", got)
	}
}

// a join depends on two lanes: it starts on the landing head once both have merged, never when only one has (the
// fork's F4: a task started on one lane's tip would lack the other lane's commits). Ours has no early start, so this
// pins that ReadyTasks reads every cross-lane dependency.
func TestReadyTasksJoinWaitsForEveryLaneItDependsOn(t *testing.T) {
	join := func(states map[string]string) *waveobj.TaskGroup {
		g, err := NewTaskGroup("run-1", "ch-1", "g", 2, true, []waveobj.TaskNode{
			{ID: "t-1", Label: "schema"},
			{ID: "t-2", Label: "api"},
			{ID: "t-3", Label: "ui", Deps: []string{"t-1", "t-2"}},
		}, 1, nil)
		if err != nil {
			t.Fatal(err)
		}
		for id, s := range states {
			taskByID(&g, id).State = s
		}
		return &g
	}
	g := join(map[string]string{"t-1": TaskState_Done, "t-2": TaskState_Done})
	markMerged(g, "t-1")
	if got := ReadyTasks(g); len(got) != 0 {
		t.Fatalf("one lane merged and one done but unmerged: the join waits, got %v", got)
	}
	g = join(map[string]string{"t-1": TaskState_Done, "t-2": TaskState_Reviewing})
	markMerged(g, "t-1")
	if got := ReadyTasks(g); len(got) != 0 {
		t.Fatalf("one lane merged and one under review: the join waits, got %v", got)
	}
	g = join(map[string]string{"t-1": TaskState_Done, "t-2": TaskState_Done})
	markMerged(g, "t-1", "t-2")
	if got := ReadyTasks(g); !reflect.DeepEqual(got, []string{"t-3"}) {
		t.Fatalf("both lanes merged: want [t-3], got %v", got)
	}
}

// retrying an earlier task while a later one runs would put two workers in one tree
func TestNextToSpawnRunsOneWorkerPerLane(t *testing.T) {
	g := laneGroup(t, true, map[string]string{"t-1": TaskState_Pending, "t-2": TaskState_Running})
	if got := NextToSpawn(g); len(got) != 0 {
		t.Fatalf("a lane with a running worker dispatches nothing more, got %v", got)
	}
}

func TestLaneMergeReadyNamesTheTip(t *testing.T) {
	lane := []string{"t-1", "t-2", "t-3"}
	done := map[string]string{"t-1": TaskState_Done, "t-2": TaskState_Done, "t-3": TaskState_Done}
	cases := []struct {
		name   string
		states map[string]string
		merged []string
		gate   bool
		want   string
	}{
		{"a task still running", map[string]string{"t-1": TaskState_Done, "t-2": TaskState_Done, "t-3": TaskState_Running}, nil, false, ""},
		{"every task done", done, nil, false, "t-3"},
		{"the last task skipped", map[string]string{"t-1": TaskState_Done, "t-2": TaskState_Done, "t-3": TaskState_Skipped}, nil, false, "t-2"},
		{"every task skipped", map[string]string{"t-1": TaskState_Skipped, "t-2": TaskState_Skipped, "t-3": TaskState_Skipped}, nil, false, ""},
		{"already merged", done, []string{"t-1", "t-2", "t-3"}, false, ""},
		{"a done gate not released", done, nil, true, ""},
	}
	for _, c := range cases {
		g := laneGroup(t, true, c.states)
		markMerged(g, c.merged...)
		taskByID(g, "t-2").Gate = c.gate
		got := ""
		if tip := laneMergeReady(g, lane); tip != nil {
			got = tip.ID
		}
		if got != c.want {
			t.Fatalf("%s: tip = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestLaneMergeMessageNamesEveryLandedTask(t *testing.T) {
	g := laneGroup(t, true, map[string]string{"t-1": TaskState_Done, "t-2": TaskState_Skipped, "t-3": TaskState_Done})
	if got := laneMergeMessage(g, []string{"t-1", "t-2", "t-3"}); got != "schema; ui" {
		t.Fatalf("message = %q", got)
	}
	if got := laneMergeMessage(g, []string{"t-4"}); got != "docs" {
		t.Fatalf("a one-task lane is its label, got %q", got)
	}
}

func TestLaneFoldIsTheSpecAndPlanUntilSomethingMerges(t *testing.T) {
	g := laneGroup(t, true, nil)
	if got := laneFold(g); got != nil {
		t.Fatalf("a dag submitted without docs folds nothing, got %v", got)
	}
	dir := t.TempDir()
	plan, spec := filepath.Join(dir, "plan.md"), filepath.Join(dir, "spec.md")
	g.PlanPath, g.SpecPath = plan, spec
	if got := laneFold(g); !reflect.DeepEqual(got, []string{spec, plan}) {
		t.Fatalf("fold = %v", got)
	}
	markMerged(g, "t-4")
	if got := laneFold(g); got != nil {
		t.Fatalf("after the first merge nothing is folded, got %v", got)
	}
}

// a branch-landed dag committed its docs on the run's branch at submit, and says so with repo-relative paths
func TestLaneFoldIsNothingForABranchLandedDag(t *testing.T) {
	g := laneGroup(t, true, nil)
	g.PlanPath, g.SpecPath = "docs/superpowers/plans/p.md", "docs/superpowers/specs/s.md"
	if got := laneFold(g); got != nil {
		t.Fatalf("the docs are already on the branch, got fold %v", got)
	}
}
