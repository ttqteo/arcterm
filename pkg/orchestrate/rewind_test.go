// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"bytes"
	"context"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"slices"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// threeLane is t-1, t-2, t-3, each depending on the one before.
func threeLane() []waveobj.TaskNode {
	return append(oneLane(), waveobj.TaskNode{ID: "t-3", Label: "ui", Deps: []string{"t-2"}})
}

// stubStopWorkers lets a skip or retry stop the fixture's worker, which has no live tab.
func stubStopWorkers(t *testing.T) {
	t.Helper()
	old := stopRunWorkers
	stopRunWorkers = func(context.Context, *waveobj.Run) error { return nil }
	restoreAfterStages(t, func() { stopRunWorkers = old })
}

func (f *mergeFixture) setTaskState(t *testing.T, taskID, state string) {
	t.Helper()
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		taskByID(cur, taskID).State = state
		RecomputeDagStatus(cur)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

// startSecondTask dispatches the lane's t-1, commits schema.txt as its work and finishes it, then dispatches t-2 in
// the same tree. It returns the tree and t-1's commit.
func (f *mergeFixture) startSecondTask(t *testing.T) (string, string) {
	t.Helper()
	var spawned []string
	stubSpawn(t, &spawned)
	stubStopWorkers(t)
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	wt := worktreeDir(f.project, TaskWorktreeKey(f.ownerID, "t-1"))
	schema := commitInTree(t, wt, "schema.txt")
	f.finish(t, "t-1")
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if got := f.taskRun(t, "t-2").BaseCommit; got != schema {
		t.Fatalf("t-2 starts at t-1's commit %s, got %s", schema, got)
	}
	return wt, schema
}

func (f *mergeFixture) laneHead(t *testing.T) string {
	t.Helper()
	return gitCmd(t, f.project, "rev-parse", "wave/"+TaskWorktreeKey(f.ownerID, "t-1"))
}

func (f *mergeFixture) skippedPatch() string {
	return filepath.Join(f.project, ".waveterm", "recovery", TaskWorktreeKey(f.ownerID, "t-2")+"-skipped.patch")
}

func TestSkippingAFailedTaskLandsItsLaneWithoutItsCommits(t *testing.T) {
	f := newMergeFixture(t, oneLane())
	wt, _ := f.startSecondTask(t)
	commitInTree(t, wt, "bad.txt")
	f.setTaskState(t, "t-2", TaskState_Failed)

	if err := ApplyAction(f.ctx, f.dagID, "t-2", "skip", waveobj.RoutePin{}); err != nil {
		t.Fatal(err)
	}
	g := f.dag(t)
	if g.Tasks[1].State != TaskState_Skipped || !g.Tasks[0].Merged {
		t.Fatalf("the skip lets the lane land, got t-2 %s, t-1 merged=%v", g.Tasks[1].State, g.Tasks[0].Merged)
	}
	if got := committedFiles(t, f.project, "HEAD"); !reflect.DeepEqual(got, []string{"schema.txt"}) {
		t.Fatalf("the squash carries t-1's work and none of the skipped t-2's, got %v", got)
	}
	patch, err := os.ReadFile(f.skippedPatch())
	if err != nil || !strings.Contains(string(patch), "bad.txt") || strings.Contains(string(patch), "schema.txt") {
		t.Fatalf("the skipped attempt's work, and only it, is saved to a recovery patch, got %q err %v", patch, err)
	}
}

// a task skipped again writes its patch beside the earlier one's: the log named the earlier file
func TestSkippingLogsThePatchItWrote(t *testing.T) {
	f := newMergeFixture(t, oneLane())
	wt, _ := f.startSecondTask(t)
	commitInTree(t, wt, "bad.txt")
	f.setTaskState(t, "t-2", TaskState_Failed)
	writeFile(t, f.skippedPatch(), "an earlier skip's work\n")
	var logged bytes.Buffer
	log.SetOutput(&logged)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	if err := ApplyAction(f.ctx, f.dagID, "t-2", "skip", waveobj.RoutePin{}); err != nil {
		t.Fatal(err)
	}
	second := strings.TrimSuffix(filepath.Base(f.skippedPatch()), ".patch") + "-2.patch"
	if patch := readFile(t, filepath.Join(filepath.Dir(f.skippedPatch()), second)); !strings.Contains(patch, "bad.txt") {
		t.Fatalf("the skip's work goes beside the earlier patch, got %q", patch)
	}
	if !strings.Contains(logged.String(), "saved to recovery/"+second) {
		t.Fatalf("the log names %s, got:\n%s", second, logged.String())
	}
}

func TestSkippingAStalledTaskDropsItsCommitsAndTheNextTaskStartsWithout(t *testing.T) {
	f := newMergeFixture(t, threeLane())
	f.setPlanCommands(t, "", setupCmd)
	setups := stubPlanCommand(t, func(context.Context, string, string) error { return nil })
	wt, schema := f.startSecondTask(t)
	// uncommitted work goes with the commits
	commitInTree(t, wt, "bad.txt")
	if err := os.WriteFile(filepath.Join(wt, "wip.txt"), []byte("wip\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	f.setTaskState(t, "t-2", TaskState_Stalled)

	if err := ApplyAction(f.ctx, f.dagID, "t-2", "skip", waveobj.RoutePin{}); err != nil {
		t.Fatal(err)
	}
	if got := f.laneHead(t); got != schema {
		t.Fatalf("the lane goes back to t-1's commit %s, got %s", schema, got)
	}
	third := f.taskRun(t, "t-3")
	if third.BaseCommit != schema || third.ProjectPath != wt {
		t.Fatalf("t-3 starts in the lane's tree at t-1's commit %s, got %s at %s", schema, third.ProjectPath, third.BaseCommit)
	}
	for _, name := range []string{"bad.txt", "wip.txt"} {
		if _, err := os.Stat(filepath.Join(wt, name)); !os.IsNotExist(err) {
			t.Fatalf("t-3's tree must not hold the skipped attempt's %s, stat err %v", name, err)
		}
	}
	// the tree t-3 got is a fresh checkout, so it is prepared again
	if got := len(setups.in(wt)); got != 2 {
		t.Fatalf("want Setup run for t-1's tree and again for t-3's, got %d", got)
	}
	patch, err := os.ReadFile(f.skippedPatch())
	if err != nil || !strings.Contains(string(patch), "bad.txt") || !strings.Contains(string(patch), "wip.txt") {
		t.Fatalf("the skipped attempt's commits and uncommitted work are saved, got %q err %v", patch, err)
	}
}

func TestSkippingATaskThatCommittedNothingLeavesItsLane(t *testing.T) {
	f := newMergeFixture(t, threeLane())
	f.setPlanCommands(t, "", setupCmd)
	setups := stubPlanCommand(t, func(context.Context, string, string) error { return nil })
	wt, schema := f.startSecondTask(t)
	f.setTaskState(t, "t-2", TaskState_Failed)

	if err := ApplyAction(f.ctx, f.dagID, "t-2", "skip", waveobj.RoutePin{}); err != nil {
		t.Fatal(err)
	}
	if got := f.laneHead(t); got != schema {
		t.Fatalf("the lane stays at t-1's commit %s, got %s", schema, got)
	}
	if third := f.taskRun(t, "t-3"); third.BaseCommit != schema || third.ProjectPath != wt {
		t.Fatalf("t-3 starts in the lane's tree at %s, got %s at %s", schema, third.ProjectPath, third.BaseCommit)
	}
	if got := len(setups.in(wt)); got != 1 {
		t.Fatalf("nothing was rolled back, so the tree is kept and not prepared again, got %d Setup runs", got)
	}
	if _, err := os.Stat(f.skippedPatch()); !os.IsNotExist(err) {
		t.Fatalf("no recovery patch for a skip with nothing to drop, stat err %v", err)
	}
}

// linkOutside links link to target the way task worktree:prepare does: a junction on Windows, a symlink elsewhere.
func linkOutside(t *testing.T, link, target string) {
	t.Helper()
	if runtime.GOOS != "windows" {
		if err := os.Symlink(target, link); err != nil {
			t.Fatal(err)
		}
		return
	}
	if out, err := exec.Command("cmd", "/c", "mklink", "/J", link, target).CombinedOutput(); err != nil {
		t.Fatalf("mklink /J %s %s: %v\n%s", link, target, err, out)
	}
}

func TestSkipRollbackLeavesADirectoryLinkedIntoTheTreeIntact(t *testing.T) {
	f := newMergeFixture(t, oneLane())
	if err := os.WriteFile(filepath.Join(f.project, ".gitignore"), []byte("node_modules\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, f.project, "add", ".gitignore")
	gitCmd(t, f.project, "commit", "-m", "ignore")
	wt, _ := f.startSecondTask(t)
	shared := t.TempDir()
	keep := filepath.Join(shared, "keep.txt")
	if err := os.WriteFile(keep, []byte("keep\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// one link git ignores, as the real ones are, and one it does not
	linkOutside(t, filepath.Join(wt, "node_modules"), shared)
	if err := os.MkdirAll(filepath.Join(wt, "dist"), 0o755); err != nil {
		t.Fatal(err)
	}
	linkOutside(t, filepath.Join(wt, "dist", "bin"), shared)
	commitInTree(t, wt, "bad.txt")
	f.setTaskState(t, "t-2", TaskState_Failed)

	if err := ApplyAction(f.ctx, f.dagID, "t-2", "skip", waveobj.RoutePin{}); err != nil {
		t.Fatal(err)
	}
	if got := committedFiles(t, f.project, "HEAD"); !reflect.DeepEqual(got, []string{"schema.txt"}) {
		t.Fatalf("the skipped commit is dropped, got %v", got)
	}
	entries, err := os.ReadDir(shared)
	if err != nil || len(entries) != 1 {
		t.Fatalf("the linked directory keeps exactly its own contents, got %v err %v", entries, err)
	}
	if b, err := os.ReadFile(keep); err != nil || string(b) != "keep\n" {
		t.Fatalf("a directory linked into the lane's tree must survive the rollback, got %q err %v", b, err)
	}
}

func TestARetrysEvidenceKeepsWhatTheFailedAttemptCommitted(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	var spawned []string
	stubSpawn(t, &spawned)
	stubStopWorkers(t)
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	wt := worktreeDir(f.project, TaskWorktreeKey(f.ownerID, "t-0"))
	start := f.taskRun(t, "t-0").BaseCommit
	commitInTree(t, wt, "partial.txt")
	f.setTaskState(t, "t-0", TaskState_Failed)

	if err := ApplyAction(f.ctx, f.dagID, "t-0", "retry", waveobj.RoutePin{}); err != nil {
		t.Fatal(err)
	}
	retry := f.taskRun(t, "t-0")
	if retry.BaseCommit != start {
		t.Fatalf("the retry reports from where the task first started, %s, got %s", start, retry.BaseCommit)
	}
	retry.EndCommit = commitInTree(t, wt, "fix.txt")
	if err := jarvis.SealEvidence(f.ctx, retry); err != nil {
		t.Fatal(err)
	}
	var files []string
	for _, file := range retry.Evidence.Files {
		files = append(files, file.Path)
	}
	slices.Sort(files)
	if !reflect.DeepEqual(files, []string{"fix.txt", "partial.txt"}) {
		t.Fatalf("the retry's evidence covers the failed attempt's commit and its own, got %v", files)
	}
}

// a rollback retried after a removal that git unregistered but could not finish meets such a directory
func TestRecoveryPatchLeavesTheProjectIndexAloneForAStrayDirectory(t *testing.T) {
	dir := newGitRepo(t)
	wt, err := CreateRunWorktree(context.Background(), dir, "run-1", "")
	if err != nil {
		t.Fatal(err)
	}
	gitCmd(t, dir, "worktree", "remove", "--force", wt)
	if err := os.MkdirAll(wt, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "human.txt"), []byte("wip\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := DumpRecoveryPatch(context.Background(), dir, "run-1", ""); err != nil {
		t.Fatal(err)
	}
	if staged := gitCmd(t, dir, "diff", "--cached", "--name-only"); staged != "" {
		t.Fatalf("the project checkout's index must be left alone, got staged %q", staged)
	}
}

func TestRemoveRunWorktreeDeletesTheBranchOfATreeAlreadyGone(t *testing.T) {
	dir := newGitRepo(t)
	wt, err := CreateRunWorktree(context.Background(), dir, "run-1", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := removeWorktreeDir(context.Background(), dir, wt); err != nil {
		t.Fatal(err)
	}
	if err := RemoveRunWorktree(context.Background(), dir, "run-1"); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("git", "-C", dir, "show-ref", "--verify", "-q", "refs/heads/wave/run-1").CombinedOutput(); err == nil {
		t.Fatalf("the branch must be deleted with its tree already gone: %s", out)
	}
}
