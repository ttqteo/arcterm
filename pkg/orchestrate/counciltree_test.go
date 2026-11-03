// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/council"
)

// councilTreeFixture is a repo with a package, a Rust crate and a subfolder, all committed; then an uncommitted edit, an
// untracked file and the installed node_modules / target dirs that only main has. snap is the commit Snapshot takes of it.
func councilTreeFixture(t *testing.T) (main, snap string) {
	t.Helper()
	main = newGitRepo(t)
	writeFile(t, filepath.Join(main, "a.txt"), "committed\n")
	writeFile(t, filepath.Join(main, "package.json"), `{"name":"x"}`+"\n")
	writeFile(t, filepath.Join(main, "src-tauri", "Cargo.toml"), "[package]\nname = \"x\"\n")
	writeFile(t, filepath.Join(main, "sub", "deep", "b.txt"), "b\n")
	gitCmd(t, main, "add", ".")
	gitCmd(t, main, "commit", "-m", "files")
	// what the experts read: an edit nobody committed, a file nobody added
	writeFile(t, filepath.Join(main, "a.txt"), "edited, not committed\n")
	writeFile(t, filepath.Join(main, "new.txt"), "untracked\n")
	// installed in main only: a snapshot never holds them (git ignores them or the person did)
	writeFile(t, filepath.Join(main, ".gitignore"), "node_modules/\ntarget/\n")
	writeFile(t, filepath.Join(main, "node_modules", "marker.txt"), "node_modules")
	writeFile(t, filepath.Join(main, "src-tauri", "target", "marker.txt"), "target")
	var err error
	if snap, err = council.Snapshot(context.Background(), main); err != nil || snap == "" {
		t.Fatalf("Snapshot = %q, %v", snap, err)
	}
	return main, snap
}

// readTreeFile reads p with LF line endings: with core.autocrlf a checkout writes CRLF, and it is the text that counts.
func readTreeFile(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return string(lfOnly(b))
}

func branchList(t *testing.T, repo string) string {
	t.Helper()
	return gitCmd(t, repo, "for-each-ref", "--format=%(refname)", "refs/heads")
}

func worktreeCount(t *testing.T, repo string) int {
	t.Helper()
	return strings.Count(gitCmd(t, repo, "worktree", "list", "--porcelain"), "worktree ")
}

func TestCouncilTreeHoldsTheSnapshotAndLeavesTheCheckoutAlone(t *testing.T) {
	main, snap := councilTreeFixture(t)
	statusBefore := gitCmd(t, main, "status", "--porcelain")
	headBefore := gitCmd(t, main, "rev-parse", "HEAD")
	branchesBefore := branchList(t, main)

	dir, err := CouncilTrees{}.Make(context.Background(), main, snap, "council-abc123")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { CouncilTrees{}.Remove(context.Background(), main, dir) })

	if want := worktreeDir(main, "council-abc123"); dir != want {
		t.Fatalf("dir = %q, want the place run trees live: %q", dir, want)
	}
	if got := readTreeFile(t, filepath.Join(dir, "a.txt")); got != "edited, not committed\n" {
		t.Errorf("a.txt = %q: the tree must hold the uncommitted edit the experts read", got)
	}
	if got := readTreeFile(t, filepath.Join(dir, "new.txt")); got != "untracked\n" {
		t.Errorf("new.txt = %q: the tree must hold the untracked file", got)
	}
	if got := gitCmd(t, dir, "rev-parse", "HEAD"); got != snap {
		t.Errorf("tree HEAD = %s, want the snapshot %s", got, snap)
	}
	if head := gitCmd(t, dir, "rev-parse", "--abbrev-ref", "HEAD"); head != "HEAD" {
		t.Errorf("tree is on %q, want a detached HEAD", head)
	}

	if got := gitCmd(t, main, "status", "--porcelain"); got != statusBefore {
		t.Errorf("the checkout's status changed:\nbefore %q\nafter  %q", statusBefore, got)
	}
	if got := gitCmd(t, main, "rev-parse", "HEAD"); got != headBefore {
		t.Errorf("the checkout's HEAD moved: %s -> %s", headBefore, got)
	}
	if got := readTreeFile(t, filepath.Join(main, "a.txt")); got != "edited, not committed\n" {
		t.Errorf("the checkout's a.txt = %q: the person's edit must stay", got)
	}
	if got := branchList(t, main); got != branchesBefore {
		t.Errorf("a branch was made:\nbefore %q\nafter  %q", branchesBefore, got)
	}
}

func TestCouncilTreeLinksNodeModulesAndTheCargoTargetWhenMainHasThem(t *testing.T) {
	main, snap := councilTreeFixture(t)
	dir, err := CouncilTrees{}.Make(context.Background(), main, snap, "council-links")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { CouncilTrees{}.Remove(context.Background(), main, dir) })

	for rel, marker := range map[string]string{"node_modules": "node_modules", "src-tauri/target": "target"} {
		link := filepath.Join(dir, filepath.FromSlash(rel))
		if !isLinkAt(t, link) {
			t.Errorf("%s must be linked: vitest and cargo test run in the tree", rel)
			continue
		}
		if got := readTreeFile(t, filepath.Join(link, "marker.txt")); got != marker {
			t.Errorf("%s reads %q through the link, want main's %q", rel, got, marker)
		}
	}
	// a dir main never installed is no one's to link
	if _, err := os.Lstat(filepath.Join(dir, "sub", "node_modules")); err == nil {
		t.Error("sub/node_modules must not be made")
	}
}

func TestCouncilTreeRunsAProjectThatIsASubfolderInThatFolderOfTheTree(t *testing.T) {
	main, snap := councilTreeFixture(t)
	project := filepath.Join(main, "sub", "deep")
	dir, err := CouncilTrees{}.Make(context.Background(), project, snap, "council-sub")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { CouncilTrees{}.Remove(context.Background(), project, dir) })

	if want := filepath.Join(worktreeDir(main, "council-sub"), "sub", "deep"); dir != want {
		t.Fatalf("dir = %q, want the subfolder inside the tree: %q", dir, want)
	}
	if got := readTreeFile(t, filepath.Join(dir, "b.txt")); got != "b\n" {
		t.Errorf("b.txt = %q", got)
	}
	// the snapshot covers the whole repo, so a sibling of the project is in the tree too
	if got := readTreeFile(t, filepath.Join(dir, "..", "..", "a.txt")); got != "edited, not committed\n" {
		t.Errorf("a.txt = %q", got)
	}

	if err := (CouncilTrees{}).Remove(context.Background(), project, dir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(worktreeDir(main, "council-sub")); !os.IsNotExist(err) {
		t.Fatalf("Remove with the subfolder's dir must remove the whole tree, stat err = %v", err)
	}
}

func TestCouncilTreeRemoveLeavesNoTreeAndNoBranchAndKeepsMainsInstalls(t *testing.T) {
	main, snap := councilTreeFixture(t)
	branchesBefore := branchList(t, main)
	dir, err := CouncilTrees{}.Make(context.Background(), main, snap, "council-gone")
	if err != nil {
		t.Fatal(err)
	}
	if worktreeCount(t, main) != 2 {
		t.Fatalf("worktrees = %d after Make, want main and the council's", worktreeCount(t, main))
	}

	if err := (CouncilTrees{}).Remove(context.Background(), main, dir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Errorf("the tree must be gone, stat err = %v", err)
	}
	if n := worktreeCount(t, main); n != 1 {
		t.Errorf("worktrees = %d after Remove, want only main: %s", n, gitCmd(t, main, "worktree", "list"))
	}
	if got := branchList(t, main); got != branchesBefore {
		t.Errorf("branches changed:\nbefore %q\nafter  %q", branchesBefore, got)
	}
	// the links went first, so the delete never followed one into main
	for rel, marker := range map[string]string{"node_modules": "node_modules", "src-tauri/target": "target"} {
		if got := readTreeFile(t, filepath.Join(main, filepath.FromSlash(rel), "marker.txt")); got != marker {
			t.Errorf("main's %s marker = %q after Remove, want %q", rel, got, marker)
		}
	}
	if got := readTreeFile(t, filepath.Join(main, "a.txt")); got != "edited, not committed\n" {
		t.Errorf("main's a.txt = %q", got)
	}

	// a second Remove of what is already gone is not an error
	if err := (CouncilTrees{}).Remove(context.Background(), main, dir); err != nil {
		t.Errorf("Remove of a tree already gone = %v", err)
	}
}

func TestCouncilTreeMakeReplacesAnEarlierTreeOfTheSameKey(t *testing.T) {
	main, snap := councilTreeFixture(t)
	first, err := CouncilTrees{}.Make(context.Background(), main, snap, "council-again")
	if err != nil {
		t.Fatal(err)
	}
	// a crash before Remove left it, and its scratch file, behind
	writeFile(t, filepath.Join(first, "scratch.txt"), "left over")

	second, err := CouncilTrees{}.Make(context.Background(), main, snap, "council-again")
	if err != nil {
		t.Fatalf("a second Make of the same key must replace the first: %v", err)
	}
	t.Cleanup(func() { CouncilTrees{}.Remove(context.Background(), main, second) })
	if second != first {
		t.Errorf("dir = %q, want the same place %q", second, first)
	}
	if _, err := os.Stat(filepath.Join(second, "scratch.txt")); err == nil {
		t.Error("the earlier tree's scratch file must not survive the replacement")
	}
	if n := worktreeCount(t, main); n != 2 {
		t.Errorf("worktrees = %d, want main and one council tree", n)
	}
	if got := readTreeFile(t, filepath.Join(main, "node_modules", "marker.txt")); got != "node_modules" {
		t.Errorf("main's node_modules marker = %q after the replacement", got)
	}
}

func TestCouncilTreeRefusesWhatIsNotACouncilTree(t *testing.T) {
	main, snap := councilTreeFixture(t)
	ctx := context.Background()

	if err := (CouncilTrees{}).Remove(ctx, main, main); err == nil {
		t.Error("Remove of the checkout itself must be refused")
	}
	if _, err := os.Stat(filepath.Join(main, "a.txt")); err != nil {
		t.Fatalf("the checkout lost a file: %v", err)
	}

	// an engine run's tree is on a branch: only a detached tree is a council's
	runTree, err := CreateRunWorktree(ctx, main, "run-9", snap)
	if err != nil {
		t.Fatal(err)
	}
	if err := (CouncilTrees{}).Remove(ctx, main, runTree); err == nil {
		t.Error("Remove of a run's tree must be refused")
	}
	if _, err := os.Stat(runTree); err != nil {
		t.Errorf("the run's tree is gone: %v", err)
	}
}

// git can drop a tree's registration and fail to finish the delete (a process holding a file on Windows): Remove finishes
// it, links first, but only for a folder named and placed as Make places a council's tree.
func TestCouncilTreeRemoveFinishesAnUnregisteredLeftoverWithoutFollowingItsLinks(t *testing.T) {
	main, _ := councilTreeFixture(t)
	ctx := context.Background()

	orphan, err := claimWorktreeDir(main, "council-orphan")
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(orphan, "half-deleted.txt"), "x")
	if err := linkDir(ctx, filepath.Join(orphan, "node_modules"), filepath.Join(main, "node_modules")); err != nil {
		t.Fatal(err)
	}
	if err := (CouncilTrees{}).Remove(ctx, main, orphan); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(orphan); !os.IsNotExist(err) {
		t.Errorf("the leftover must be gone, lstat err = %v", err)
	}
	if got := readTreeFile(t, filepath.Join(main, "node_modules", "marker.txt")); got != "node_modules" {
		t.Errorf("main's node_modules marker = %q: the delete followed a link into it", got)
	}

	// a folder git does not list and that is not where a council's tree goes is not Remove's to delete
	stranger := filepath.Join(realTempDir(t), "council-stranger")
	writeFile(t, filepath.Join(stranger, "keep.txt"), "mine")
	if err := (CouncilTrees{}).Remove(ctx, main, stranger); err == nil {
		t.Error("Remove of a folder outside the worktree root must be refused")
	}
	if got := readTreeFile(t, filepath.Join(stranger, "keep.txt")); got != "mine" {
		t.Errorf("the stranger's file = %q", got)
	}
	notCouncil, err := claimWorktreeDir(main, "not-a-council")
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(notCouncil, "keep.txt"), "engine's")
	if err := (CouncilTrees{}).Remove(ctx, main, notCouncil); err == nil {
		t.Error("Remove of a folder not named for a council must be refused")
	}
	t.Cleanup(func() { os.RemoveAll(notCouncil) })
}

func TestCouncilTreeMakeNeedsAGitRepoAndACommit(t *testing.T) {
	notRepo := realTempDir(t)
	if _, err := (CouncilTrees{}).Make(context.Background(), notRepo, "abc", "council-x"); err == nil || !strings.Contains(err.Error(), ErrNotGitRepo.Error()) {
		t.Errorf("Make outside a repo = %v, want %v", err, ErrNotGitRepo)
	}
	main, _ := councilTreeFixture(t)
	if _, err := (CouncilTrees{}).Make(context.Background(), main, "", "council-x"); err == nil {
		t.Error("Make with no commit must fail")
	}
	if _, err := (CouncilTrees{}).Make(context.Background(), main, "0123456789abcdef0123456789abcdef01234567", "council-x"); err == nil {
		t.Error("Make at a commit the repo lacks must fail")
	}
	if n := worktreeCount(t, main); n != 1 {
		t.Errorf("a failed Make left %d worktrees, want only main", n)
	}
	if out, _ := exec.Command("git", "-C", main, "worktree", "prune", "--dry-run").CombinedOutput(); strings.TrimSpace(string(out)) != "" {
		t.Errorf("a failed Make left a registration with no directory: %s", out)
	}
}
