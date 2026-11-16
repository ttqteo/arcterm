// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// DUM-E's chunk waits on its branch for the person to land it: the tree goes, the commits stay.
func TestRemoveTreeKeepBranch(t *testing.T) {
	ctx := context.Background()
	dir := newGitRepo(t)
	key := "dume-abcd1234-k1"
	wt, err := CreateRunWorktree(ctx, dir, key, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(wt, "chore.txt"), []byte("done\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, wt, "add", "chore.txt")
	gitCmd(t, wt, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "chore")

	if err := RemoveTreeKeepBranch(ctx, dir, key); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(wt); !os.IsNotExist(err) {
		t.Fatalf("the tree's directory should be gone, stat: %v", err)
	}
	gitCmd(t, dir, "show-ref", "--verify", "refs/heads/wave/"+key) // fails the test when the branch is gone
	if n := gitCmd(t, dir, "rev-list", "--count", "HEAD..wave/"+key); n != "1" {
		t.Fatalf("the branch keeps its commit, got %s commits ahead", n)
	}

	// no tree is not an error: the loop may drop one twice
	if err := RemoveTreeKeepBranch(ctx, dir, key); err != nil {
		t.Fatalf("a second removal of a tree already gone: %v", err)
	}
}

// storage's scan names a tree back to its run through RunOfWorktree; DUM-E's trees belong to no run, so the scan
// never lists one as a finished run's leftover to clean (pkg/storage/worktrees.go judge).
func TestRunOfWorktreeIgnoresDumeTrees(t *testing.T) {
	root := t.TempDir()
	defer UseWorktreeRootForTest(root)()
	if id, ok := RunOfWorktree(filepath.Join(root, "dume-abcd1234-k1")); ok {
		t.Fatalf("a DUM-E tree is no run's, got run %q", id)
	}
	legacy := filepath.Join(t.TempDir(), ".waveterm", "worktrees", "dume-abcd1234-k1")
	if id, ok := RunOfWorktree(legacy); ok {
		t.Fatalf("a DUM-E tree in a project's worktrees is no run's, got run %q", id)
	}
}
