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
)

func TestFinalVerifyStandsInOnlyForTheLastMerge(t *testing.T) {
	landed := waveobj.TaskNode{ID: "t-0", Label: "a", State: TaskState_Done, Merged: true}
	other := func(state string, merged bool) waveobj.TaskNode {
		return waveobj.TaskNode{ID: "t-1", Label: "b", State: state, Merged: merged}
	}
	gate := other(TaskState_Done, true)
	gate.Gate = true
	cases := []struct {
		name   string
		verify string
		final  *waveobj.FinalStage
		other  waveobj.TaskNode
		want   bool
	}{
		{"every task landed", verifyCmd, nil, other(TaskState_Done, true), true},
		{"the rest skipped", verifyCmd, nil, other(TaskState_Skipped, false), true},
		{"no Verify for the final stage to run", "", nil, other(TaskState_Done, true), false},
		{"a task pending", verifyCmd, nil, other(TaskState_Pending, false), false},
		{"a task running", verifyCmd, nil, other(TaskState_Running, false), false},
		{"a task in review", verifyCmd, nil, other(TaskState_Reviewing, false), false},
		{"a task waiting to merge", verifyCmd, nil, other(TaskState_Done, false), false},
		{"a batch mate verifying", verifyCmd, nil, other(TaskState_Verifying, true), false},
		{"a gate not released", verifyCmd, nil, gate, false},
		{"a fix round", verifyCmd, &waveobj.FinalStage{Round: 2}, other(TaskState_Done, true), false},
	}
	for _, c := range cases {
		g := &waveobj.TaskGroup{Verify: c.verify, Final: c.final, MergeRequired: true, Tasks: []waveobj.TaskNode{landed, c.other}}
		if got := finalVerifyStandsIn(g); got != c.want {
			t.Fatalf("%s: want %v, got %v", c.name, c.want, got)
		}
	}
}

// lastMergeFixture is a dag of two lanes with a Verify line, a chunk on each task, and t-0 landed and verified
// while t-1 was still open. t-1 is finished: the next tick lands it as the dag's last merge.
func lastMergeFixture(t *testing.T, verify func(dir string) error) (*mergeFixture, *planCalls, string) {
	t.Helper()
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}, {ID: "t-1", Label: "second"}})
	f.setPlanCommands(t, verifyCmd, "")
	effort := f.effortFor(t, "first's", "second's")
	f.taskChunks(t, "t-0", "first's")
	f.taskChunks(t, "t-1", "second's")
	f.finish(t, "t-0")
	stubMerge(t, landedSha)
	calls := stubPlanCommand(t, func(_ context.Context, dir, _ string) error { return verify(dir) })
	await := awaitVerify(t)
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	await()
	if n := len(calls.in(f.project)); n != 1 || f.dag(t).Tasks[0].State != TaskState_Done {
		t.Fatalf("setup: a merge with a task still open runs its own Verify, got %d runs and %s", n, f.dag(t).Tasks[0].State)
	}
	if c := chunkOf(t, f.ctx, effort, "first's"); c.Status != "done" {
		t.Fatalf("setup: t-0's chunk closes on its own Verify, got %q", c.Status)
	}
	f.finish(t, "t-1")
	return f, calls, effort
}

func mergedRow(lead *fakeLead, taskID string) map[string]any {
	for _, row := range lead.rows {
		if row["eventkind"] == waveobj.RunEventKindTaskMerged && row["taskid"] == taskID {
			return row
		}
	}
	return nil
}

func TestTheLastMergeLeavesItsVerifyToTheFinalStage(t *testing.T) {
	lead := newFakeLead(t)
	f, calls, effort := lastMergeFixture(t, func(string) error { return nil })

	g := runFinal(t, f)

	if g.Tasks[1].State != TaskState_Done || !g.Tasks[1].Merged || g.Tasks[1].VerifyStartedTs != 0 {
		t.Fatalf("the last merge is done without verifying, got %s merged=%v started=%d", g.Tasks[1].State, g.Tasks[1].Merged, g.Tasks[1].VerifyStartedTs)
	}
	// t-0's merge Verify in the checkout, then the final stage's in its own tree: none for t-1's merge
	list := calls.list()
	if len(list) != 2 || len(calls.in(f.project)) != 1 || filepath.Clean(list[1].dir) == filepath.Clean(f.project) {
		t.Fatalf("want t-0's Verify and the final stage's, one each, got %+v", list)
	}
	if g.Final == nil || g.Final.State != FinalState_Passed || g.Status != DagStatus_Done {
		t.Fatalf("the final stage's Verify stands for the skipped one and passes, got %+v / %s", g.Final, g.Status)
	}
	if row := mergedRow(lead, "t-1"); row == nil || row["verify"] != mergeVerifyFinal {
		t.Fatalf("the timeline says the merge left its Verify to the final stage, got %v", row)
	}
	if row := mergedRow(lead, "t-0"); row == nil || row["verify"] != nil {
		t.Fatalf("a merge that verified says nothing of the final stage, got %v", row)
	}
	for _, row := range lead.rows {
		kind := row["eventkind"]
		if row["taskid"] == "t-1" && (kind == waveobj.RunEventKindTaskVerifyStarted || kind == waveobj.RunEventKindTaskVerifyPassed) {
			t.Fatalf("the last merge ran no Verify, got a %s row", kind)
		}
	}
	c := chunkOf(t, f.ctx, effort, "second's")
	want := "landed sha-1 (run " + g.RunID + ", task t-1)"
	if c.Status != "done" || !strings.Contains(c.Notes[len(c.Notes)-1].Text, want) {
		t.Fatalf("the last merge's chunk closes when the final Verify passes, got %q %+v", c.Status, c.Notes)
	}
	if g.Tasks[1].VerifyDeferred {
		t.Fatal("the mark is cleared once the final Verify stood for the merge")
	}
}

func TestAFailingFinalVerifyAfterASkippedOneBlocksTheRun(t *testing.T) {
	lead := newFakeLead(t)
	var failing atomic.Bool
	var project string
	f, calls, effort := lastMergeFixture(t, func(dir string) error {
		// only the final stage's Verify, in its own tree
		if failing.Load() && filepath.Clean(dir) != filepath.Clean(project) {
			return &planCommandError{exitCode: 1, output: "--- FAIL: TestX"}
		}
		return nil
	})
	project = f.project
	failing.Store(true)

	g := runFinal(t, f)

	if g.Final.State != FinalState_Failed || g.Status != DagStatus_Blocked {
		t.Fatalf("a failing final Verify fails the stage and blocks the run, got %+v / %s", g.Final, g.Status)
	}
	if !strings.Contains(g.Final.Detail, "Verify `"+verifyCmd+"` failed on the merged result (exit 1)") {
		t.Fatalf("the failure is the final stage's, as any final Verify failure, got %q", g.Final.Detail)
	}
	want := finalFailedWake(1, g.RunID, g.Final.Detail, false)
	if len(lead.sends) == 0 || lead.sends[len(lead.sends)-1] != want {
		t.Fatalf("the lead is woken for a fix round, want %q, got %q", want, lead.sends)
	}
	if g.Tasks[1].State != TaskState_Done || !g.Tasks[1].VerifyDeferred {
		t.Fatalf("the merge stays landed and still owed a Verify, got %s deferred=%v", g.Tasks[1].State, g.Tasks[1].VerifyDeferred)
	}
	if c := chunkOf(t, f.ctx, effort, "second's"); c.Status != "pending" {
		t.Fatalf("no Verify passed on the last merge, so its chunk stays open, got %q", c.Status)
	}

	// the fix round's one merge is the dag's last again, and runs its own Verify as every fix-round merge does
	failing.Store(false)
	round, err := AppendRound(f.ctx, f.dagID, "", []waveobj.TaskNode{{ID: "t-1", Label: "fix"}})
	if err != nil {
		t.Fatal(err)
	}
	fix := round.Tasks[2].ID
	f.finish(t, fix)
	before := len(calls.in(f.project))
	await := awaitVerify(t)
	// the Verify's own tick may start round 2 before this test asks
	finalDone := awaitFinal(t)
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	await()
	if n := len(calls.in(f.project)) - before; n != 1 || mergedRow(lead, fix)["verify"] != nil {
		t.Fatalf("a fix round's merge verifies, got %d runs and %v", n, mergedRow(lead, fix))
	}

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	finalDone()
	g = f.dag(t)

	if g.Final.Round != 2 || g.Final.State != FinalState_Passed {
		t.Fatalf("round 2 passes, got %+v", g.Final)
	}
	if c := chunkOf(t, f.ctx, effort, "second's"); c.Status != "done" || g.Tasks[1].VerifyDeferred {
		t.Fatalf("the chunk closes on the final Verify that passes, got %q deferred=%v", c.Status, g.Tasks[1].VerifyDeferred)
	}
}
