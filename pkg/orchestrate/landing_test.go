// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// land gives the fixture's owner run a landing tree on wave/<owner>, the way CreateRun does for a run that
// lands on its own branch.
func (f *mergeFixture) land(t *testing.T) string {
	t.Helper()
	base := gitCmd(t, f.project, "rev-parse", "HEAD")
	wt, err := CreateRunWorktree(f.ctx, f.project, f.ownerID, base)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateRun(f.ctx, f.channel, f.ownerID, func(r *waveobj.Run) error {
		r.LandPath = wt
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return wt
}

// laneCommit commits file on taskID's lane tree, cut from the landing branch, as its worker would.
func (f *mergeFixture) laneCommit(t *testing.T, taskID, file string) {
	t.Helper()
	key := LaneWorktreeKey(f.dag(t), taskID)
	wt, err := CreateRunWorktree(f.ctx, f.project, key, "wave/"+f.ownerID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(wt, file), []byte(file+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, wt, "add", ".")
	gitCmd(t, wt, "commit", "-m", "add "+file)
}

func committedFiles(t *testing.T, dir, rev string) []string {
	t.Helper()
	return strings.Fields(gitCmd(t, dir, "show", "--name-only", "--format=", rev))
}

func TestLaneLandsOnTheRunBranchNotTheCheckout(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	head := gitCmd(t, f.project, "rev-parse", "HEAD")
	tree := f.land(t)
	f.finish(t, "t-0")
	f.laneCommit(t, "t-0", "feature.txt")

	if err := MergeTask(f.ctx, f.channel, f.ownerID, "t-0"); err != nil {
		t.Fatal(err)
	}
	if got := gitCmd(t, f.project, "rev-parse", "HEAD"); got != head {
		t.Fatalf("the project checkout moved from %s to %s", head, got)
	}
	if got := committedFiles(t, tree, "wave/"+f.ownerID); !reflect.DeepEqual(got, []string{"feature.txt"}) {
		t.Fatalf("wave/%s tip commits %v, want the lane's feature.txt", f.ownerID, got)
	}
	if !f.dag(t).Tasks[0].Merged {
		t.Fatal("the lane is merged")
	}
}

// a human's staged edit in the checkout is not in the landing tree's index, so it cannot hold a run's merges
func TestDirtyCheckoutDoesNotHoldBranchMerges(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.land(t)
	f.finish(t, "t-0")
	f.laneCommit(t, "t-0", "feature.txt")
	if err := os.WriteFile(filepath.Join(f.project, "staged.txt"), []byte("wip\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, f.project, "add", "staged.txt")

	AutoMergeReady(f.ctx, f.dagID)
	if !f.dag(t).Tasks[0].Merged {
		t.Fatal("the automatic merge must land while the checkout has staged edits")
	}
}

func TestVerifyIsScopedToWhatTheMergeChanged(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}, stillOpen})
	f.setPlanCommands(t, verifyCmd, "")
	f.land(t)
	f.finish(t, "t-0")
	f.laneCommit(t, "t-0", "feature.txt")
	calls := stubPlanCommand(t, func(context.Context, string, string) error { return nil })
	await := awaitVerify(t)

	if err := MergeTask(f.ctx, f.channel, f.ownerID, "t-0"); err != nil {
		t.Fatal(err)
	}
	await()
	got := calls.list()
	if len(got) != 1 || got[0].command != verifyCmd {
		t.Fatalf("want the plan's Verify command unchanged, once, got %+v", got)
	}
	path := envValue(got[0].env, verifyChangedEnv)
	if path == "" || strings.Contains(path, `\`) {
		t.Fatalf("Verify runs with %s set to a forward-slash path, env %q", verifyChangedEnv, got[0].env)
	}
	if lines := strings.Fields(readFile(t, path)); !reflect.DeepEqual(lines, []string{"feature.txt"}) {
		t.Fatalf("the list names what the merge changed, got %q", lines)
	}
}

// a merge the engine cannot diff still gets its Verify: unscoped is the safe direction
func TestVerifyRunsUnscopedWhenTheMergeCannotBeListed(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}, stillOpen})
	f.setPlanCommands(t, verifyCmd, "")
	f.finish(t, "t-0")
	stubMerge(t, landedSha) // "sha-1" is no commit
	calls := stubPlanCommand(t, func(context.Context, string, string) error { return nil })
	await := awaitVerify(t)

	if err := MergeTask(f.ctx, f.channel, f.ownerID, "t-0"); err != nil {
		t.Fatal(err)
	}
	await()
	got := calls.in(f.project)
	// set empty, not left out, so a value in the server's own environment cannot scope it
	if len(got) != 1 || !slices.Contains(got[0].env, verifyChangedEnv+"=") {
		t.Fatalf("want one unscoped Verify, got %+v", got)
	}
	if f.dag(t).Tasks[0].State != TaskState_Done {
		t.Fatalf("the Verify ran and passed, got %s", f.dag(t).Tasks[0].State)
	}
}

func TestVerifyRunsInTheLandingTree(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}, stillOpen})
	f.setPlanCommands(t, verifyCmd, "")
	tree := f.land(t)
	f.finish(t, "t-0")
	f.laneCommit(t, "t-0", "feature.txt")
	calls := stubPlanCommand(t, func(context.Context, string, string) error { return nil })
	await := awaitVerify(t)

	if err := MergeTask(f.ctx, f.channel, f.ownerID, "t-0"); err != nil {
		t.Fatal(err)
	}
	await()
	list := calls.list()
	if len(list) != 1 || list[0].dir != tree {
		t.Fatalf("verify ran in %+v, want once in %s", list, tree)
	}
}

// a lane cut after an earlier lane landed must start from the landing branch, or it misses that work
func TestLaneSpawnsFromTheLandingBranch(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	tree := f.land(t)
	if err := os.WriteFile(filepath.Join(tree, "landed.txt"), []byte("earlier lane\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, tree, "add", ".")
	gitCmd(t, tree, "commit", "-m", "earlier lane")
	tip := gitCmd(t, tree, "rev-parse", "HEAD")
	var spawned []string
	stubSpawn(t, &spawned)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if len(spawned) != 1 {
		t.Fatalf("want one spawn, got %d", len(spawned))
	}
	key := LaneWorktreeKey(f.dag(t), "t-0")
	if got := gitCmd(t, f.project, "rev-parse", "wave/"+key); got != tip {
		t.Fatalf("lane starts at %s, want the landing tip %s", got, tip)
	}
}

// a landing tree deleted with a directory left behind makes git walk up to the checkout; the merge must
// refuse rather than land on the human's branch
func TestMergeRefusesALandingTreeThatIsGone(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	head := gitCmd(t, f.project, "rev-parse", "HEAD")
	tree := f.land(t)
	f.finish(t, "t-0")
	f.laneCommit(t, "t-0", "feature.txt")
	if err := os.RemoveAll(tree); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(tree, 0o755); err != nil {
		t.Fatal(err)
	}

	err := MergeTask(f.ctx, f.channel, f.ownerID, "t-0")
	if err == nil || !strings.Contains(err.Error(), "landing tree") {
		t.Fatalf("MergeTask error = %v, want a refusal naming the landing tree", err)
	}
	if got := gitCmd(t, f.project, "rev-parse", "HEAD"); got != head {
		t.Fatalf("the project checkout moved from %s to %s", head, got)
	}
	if task := f.dag(t).Tasks[0]; task.Merged || task.MergeError == "" {
		t.Fatalf("task = merged %v, merge error %q; want an unmerged task that records why", task.Merged, task.MergeError)
	}
}

// the branch outlives its tree, so lanes keep cutting from it and the merge is what reports the tree
func TestLaneSpawnsFromTheLandingBranchWithoutItsTree(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	tree := f.land(t)
	if err := os.WriteFile(filepath.Join(tree, "landed.txt"), []byte("earlier lane\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, tree, "add", ".")
	gitCmd(t, tree, "commit", "-m", "earlier lane")
	tip := gitCmd(t, tree, "rev-parse", "HEAD")
	if err := os.RemoveAll(tree); err != nil {
		t.Fatal(err)
	}
	var spawned []string
	stubSpawn(t, &spawned)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	key := LaneWorktreeKey(f.dag(t), "t-0")
	if got := gitCmd(t, f.project, "rev-parse", "wave/"+key); got != tip {
		t.Fatalf("lane starts at %s, want the landing tip %s", got, tip)
	}
}

// a cancelled lane's patch is its own work: not the lanes that landed before it was cut, and not the reverse
// of what the human committed on the checkout since
func TestRecoveryPatchHoldsOnlyTheLanesOwnWork(t *testing.T) {
	dir := newGitRepo(t)
	ctx := context.Background()
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	tree, err := CreateRunWorktree(ctx, dir, "run-1", base)
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(tree, "earlier-lane.txt"), "landed\n")
	gitCmd(t, tree, "add", ".")
	gitCmd(t, tree, "commit", "-m", "earlier lane")
	lane, err := CreateRunWorktree(ctx, dir, "run-1-t-2", "wave/run-1")
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(lane, "mine.txt"), "lane work\n")
	gitCmd(t, lane, "add", ".")
	gitCmd(t, lane, "commit", "-m", "lane work")
	writeFile(t, filepath.Join(dir, "human.txt"), "human\n")
	gitCmd(t, dir, "add", "human.txt")
	gitCmd(t, dir, "commit", "-m", "human work")

	if err := DumpRecoveryPatch(ctx, dir, "run-1-t-2", gitCmd(t, dir, "rev-parse", "wave/run-1")); err != nil {
		t.Fatal(err)
	}
	patch, err := os.ReadFile(filepath.Join(dir, ".waveterm", "recovery", "run-1-t-2.patch"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(patch), "mine.txt") || strings.Contains(string(patch), "earlier-lane.txt") || strings.Contains(string(patch), "human.txt") {
		t.Fatalf("patch should hold only mine.txt:\n%s", patch)
	}
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// foldFixture is a repo with a landing tree and one lane committing files, each cut from the same base.
func foldFixture(t *testing.T, laneFiles map[string]string) (dir, base, tree string) {
	t.Helper()
	dir = newGitRepo(t)
	base = gitCmd(t, dir, "rev-parse", "HEAD")
	tree, err := CreateRunWorktree(context.Background(), dir, "run-1", base)
	if err != nil {
		t.Fatal(err)
	}
	lane, err := CreateRunWorktree(context.Background(), dir, "run-1-t-1", base)
	if err != nil {
		t.Fatal(err)
	}
	for rel, content := range laneFiles {
		writeFile(t, filepath.Join(lane, rel), content)
	}
	gitCmd(t, lane, "add", ".")
	gitCmd(t, lane, "commit", "-m", "feature")
	return dir, base, tree
}

// a plan-path run's plan sits untracked in the checkout, outside the landing tree; it lands at the same
// repo-relative path in the tree
func TestFoldCopiesACheckoutDocIntoTheLandingTree(t *testing.T) {
	dir, base, tree := foldFixture(t, map[string]string{"feature.txt": "feat\n"})
	plan := filepath.Join(dir, "docs", "plan.md")
	writeFile(t, plan, "# plan\n")

	if _, err := MergeRunWorktree(context.Background(), tree, "run-1-t-1", MergeLane{Title: "lane"}, []string{plan}); err != nil {
		t.Fatal(err)
	}
	if got, want := committedFiles(t, tree, "HEAD"), []string{"docs/plan.md", "feature.txt"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("squash commit files = %v, want %v", got, want)
	}
	if got := gitCmd(t, dir, "rev-parse", "HEAD"); got != base {
		t.Fatalf("the checkout moved to %s", got)
	}
}

// the lane's own edit of the same path is the run's work; the checkout's copy must not replace it
func TestFoldNeverOverwritesADifferentFileInTheTree(t *testing.T) {
	dir, _, tree := foldFixture(t, map[string]string{"docs/plan.md": "# plan, as the lane amended it\n"})
	plan := filepath.Join(dir, "docs", "plan.md")
	writeFile(t, plan, "# plan\n")

	if _, err := MergeRunWorktree(context.Background(), tree, "run-1-t-1", MergeLane{Title: "lane"}, []string{plan}); err != nil {
		t.Fatal(err)
	}
	if got := gitCmd(t, tree, "show", "HEAD:docs/plan.md"); got != "# plan, as the lane amended it" {
		t.Fatalf("landed docs/plan.md = %q, want the lane's version", got)
	}
}
