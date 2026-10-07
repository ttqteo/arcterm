// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// stubVerifyBreaksOn fails Verify when ARC_VERIFY_CHANGED lists file, and passes the plan's Setup.
func stubVerifyBreaksOn(t *testing.T, file, setup string, setupErr error) *planCalls {
	t.Helper()
	p := &planCalls{}
	orig := runPlanCommand
	runPlanCommand = func(ctx context.Context, dir, command string, env []string, _ time.Duration, _ planProgress) (string, error) {
		p.mu.Lock()
		p.calls = append(p.calls, planCall{dir, command, env})
		p.mu.Unlock()
		if command == setup {
			return "", setupErr
		}
		list := envValue(env, verifyChangedEnv)
		if list == "" {
			return "", fmt.Errorf("want a scoped Verify, env %q", env)
		}
		if slices.Contains(strings.Fields(readFile(t, list)), file) {
			return "--- FAIL: TestBroken (" + file + ")", &planCommandError{exitCode: 1, output: "--- FAIL: TestBroken (" + file + ")"}
		}
		return "ok", nil
	}
	restoreAfterStages(t, func() { runPlanCommand = orig })
	return p
}

func threeLaneBatch(t *testing.T, setup string) *mergeFixture {
	t.Helper()
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "a"}, {ID: "t-1", Label: "b"}, {ID: "t-2", Label: "c"}})
	f.setPlanCommands(t, verifyCmd, setup)
	f.land(t)
	for _, id := range []string{"t-0", "t-1", "t-2"} {
		f.finish(t, id)
		f.laneCommit(t, id, id+".txt")
	}
	return f
}

func states(g *waveobj.TaskGroup) []string {
	var out []string
	for _, t := range g.Tasks {
		out = append(out, t.State)
	}
	return out
}

func TestBisectFindsTheMiddleLaneAndLandsTheOneBefore(t *testing.T) {
	lead := newFakeLead(t)
	f := threeLaneBatch(t, "")
	calls := stubVerifyBreaksOn(t, "t-1.txt", "", nil)
	await := awaitVerify(t)

	AutoMergeReady(f.ctx, f.dagID)
	await()

	g := f.dag(t)
	want := []string{TaskState_Done, TaskState_VerifyFailed, TaskState_Verifying}
	if got := states(g); !reflect.DeepEqual(got, want) {
		// the wake carries a stopped bisect's reason, and the outputs which step judged what
		outputs := []string{g.Tasks[0].VerifyOutput, g.Tasks[1].VerifyOutput, g.Tasks[2].VerifyOutput}
		t.Fatalf("states = %v, want %v\nwake: %q\noutputs: %q", got, want, lead.sends, outputs)
	}
	if !strings.Contains(g.Tasks[1].VerifyOutput, "t-1.txt") || g.Tasks[2].VerifyOutput != heldLine("t-1") {
		t.Fatalf("the blamed lane keeps its failing run's output, the later one is held: %q / %q", g.Tasks[1].VerifyOutput, g.Tasks[2].VerifyOutput)
	}
	// t-0 landed on the bisect step that tested it alone, which passed with "ok"
	if g.Tasks[0].VerifyOutput != "ok" {
		t.Fatalf("a lane the bisect lands keeps the output of the run that passed it, got %q", g.Tasks[0].VerifyOutput)
	}
	got := calls.list()
	if len(got) != 3 {
		t.Fatalf("one batch run and two bisect steps, got %d", len(got))
	}
	bisectTree := worktreeDir(f.projectPath(t), f.ownerID+"-bisect")
	if got[1].dir != bisectTree || got[2].dir != bisectTree {
		t.Fatalf("bisect steps run in %s, got %s and %s", bisectTree, got[1].dir, got[2].dir)
	}
	if _, err := os.Stat(bisectTree); !os.IsNotExist(err) {
		t.Fatalf("the bisect tree is removed, stat err %v", err)
	}
	if len(lead.sends) != 1 || !strings.Contains(lead.sends[0], "task t-1 (exit 1; bisected from t-0, t-1, t-2)") {
		t.Fatalf("one wake naming the bisect, got %q", lead.sends)
	}
}

func TestABatchOfOneFailsWithoutBisecting(t *testing.T) {
	lead := newFakeLead(t)
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "a"}, stillOpen})
	f.setPlanCommands(t, verifyCmd, "")
	f.land(t)
	f.finish(t, "t-0")
	f.laneCommit(t, "t-0", "t-0.txt")
	calls := stubVerifyBreaksOn(t, "t-0.txt", "", nil)
	await := awaitVerify(t)

	AutoMergeReady(f.ctx, f.dagID)
	await()

	if got := f.dag(t).Tasks[0].State; got != TaskState_VerifyFailed {
		t.Fatalf("want verify-failed, got %s", got)
	}
	if n := len(calls.list()); n != 1 {
		t.Fatalf("a batch of one runs Verify once, got %d", n)
	}
	if _, err := os.Stat(worktreeDir(f.projectPath(t), f.ownerID+"-bisect")); !os.IsNotExist(err) {
		t.Fatalf("no bisect tree is made, stat err %v", err)
	}
	want := "Verify failed after merging task t-0 (exit 1)."
	if len(lead.sends) != 1 || !strings.Contains(lead.sends[0], want) {
		t.Fatalf("today's wake, got %q", lead.sends)
	}
}

func TestBisectBlamesTheLastLaneWhenOnlyItBreaks(t *testing.T) {
	newFakeLead(t)
	f := threeLaneBatch(t, "")
	calls := stubVerifyBreaksOn(t, "t-2.txt", "", nil)
	await := awaitVerify(t)

	AutoMergeReady(f.ctx, f.dagID)
	await()

	want := []string{TaskState_Done, TaskState_Done, TaskState_VerifyFailed}
	if got := states(f.dag(t)); !reflect.DeepEqual(got, want) {
		t.Fatalf("states = %v, want %v", got, want)
	}
	if n := len(calls.list()); n != 3 {
		t.Fatalf("one batch run and two bisect steps, got %d", n)
	}
}

// a bisect that cannot run passes nothing it did not verify
func TestABisectWhoseSetupFailsBlamesTheOldestUnverifiedLane(t *testing.T) {
	lead := newFakeLead(t)
	f := threeLaneBatch(t, "task setup")
	calls := stubVerifyBreaksOn(t, "t-2.txt", "task setup", errors.New("no node_modules"))
	await := awaitVerify(t)

	AutoMergeReady(f.ctx, f.dagID)
	await()

	want := []string{TaskState_VerifyFailed, TaskState_Verifying, TaskState_Verifying}
	if got := states(f.dag(t)); !reflect.DeepEqual(got, want) {
		t.Fatalf("no prefix was verified, so the oldest lane is blamed: states = %v, want %v", got, want)
	}
	for _, c := range calls.list()[1:] {
		if c.command != "task setup" {
			t.Fatalf("no bisect step runs past a failed Setup, got %q", c.command)
		}
	}
	if len(lead.sends) != 1 || !strings.Contains(lead.sends[0], "Setup failed in the bisect tree") {
		t.Fatalf("the wake says why the bisect stopped, got %q", lead.sends)
	}
}

// after --continue with a fix commit on top, HEAD is past the newest lane: no bisect, the continued lane is blamed
func TestAFailureAfterAFixCommitIsNotBisected(t *testing.T) {
	newFakeLead(t)
	f := threeLaneBatch(t, "")
	calls := stubVerifyBreaksOn(t, "t-1.txt", "", nil)
	await := awaitVerify(t)
	AutoMergeReady(f.ctx, f.dagID)
	await()
	if n := len(calls.list()); n != 3 {
		t.Fatalf("setup: want the batch run and two bisect steps, got %d", n)
	}

	owner, err := wstore.GetRun(f.ctx, f.channel, f.ownerID)
	if err != nil {
		t.Fatal(err)
	}
	tree := jarvis.LandPath(owner)
	if err := os.WriteFile(filepath.Join(tree, "fix.txt"), []byte("fix\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, tree, "add", ".")
	gitCmd(t, tree, "commit", "-m", "fix")

	if err := ContinueMerge(f.ctx, f.channel, f.ownerID, "t-1"); err != nil {
		t.Fatal(err)
	}
	await()

	if n := len(calls.list()); n != 4 {
		t.Fatalf("the continue's Verify runs once, unbisected: want 4 runs in all, got %d", n)
	}
	want := []string{TaskState_Done, TaskState_VerifyFailed, TaskState_Verifying}
	if got := states(f.dag(t)); !reflect.DeepEqual(got, want) {
		t.Fatalf("states = %v, want %v", got, want)
	}
}

func TestCancellingTheDagStopsTheBisect(t *testing.T) {
	lead := newFakeLead(t)
	f := threeLaneBatch(t, "")
	n := 0
	calls := stubPlanCommand(t, func(ctx context.Context, _, _ string) error {
		n++
		if n == 1 {
			return &planCommandError{exitCode: 1, output: "--- FAIL: TestX"}
		}
		if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
			cur.Status = DagStatus_Cancelled
			return nil
		}); err != nil {
			t.Error(err)
		}
		stopDagVerify(f.dagID)
		<-ctx.Done()
		return ctx.Err()
	})
	await := awaitVerify(t)

	AutoMergeReady(f.ctx, f.dagID)
	await()

	if got := len(calls.list()); got != 2 {
		t.Fatalf("the batch run and the bisect step it stopped, got %d", got)
	}
	if len(lead.sends) != 0 {
		t.Fatalf("a cancelled bisect wakes no one, got %q", lead.sends)
	}
	for _, task := range f.dag(t).Tasks {
		if task.State == TaskState_VerifyFailed {
			t.Fatalf("a cancelled bisect blames no lane, %s is verify-failed", task.ID)
		}
	}
}
