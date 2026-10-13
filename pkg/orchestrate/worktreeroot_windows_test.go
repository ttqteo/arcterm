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

	"github.com/google/uuid"
)

// freeDriveLetter is a drive letter nothing is mapped to, or "" when none is.
func freeDriveLetter() string {
	for c := 'Z'; c >= 'D'; c-- {
		drive := string(c) + ":"
		if _, err := os.Stat(drive + `\`); err != nil {
			return drive
		}
	}
	return ""
}

// a project on another drive than the root's: git links the tree across drive letters, works inside it, and the
// removal reaches it
func TestWorktreeOnSubstDrive(t *testing.T) {
	ctx := context.Background()
	drive := freeDriveLetter()
	if drive == "" {
		t.Skip("no free drive letter")
	}
	target := t.TempDir()
	if out, err := exec.Command("subst", drive, target).CombinedOutput(); err != nil {
		t.Skipf("subst %s %s: %v: %s", drive, target, err, out)
	}
	t.Cleanup(func() {
		if out, err := exec.Command("subst", drive, "/D").CombinedOutput(); err != nil {
			t.Errorf("subst %s /D: %v: %s", drive, err, out)
		}
	})
	dir := drive + `\proj`
	newGitRepoAt(t, dir)
	root := worktreeRoot()
	if strings.EqualFold(filepath.VolumeName(root), drive) {
		t.Fatalf("the root %s must be on another drive than the project %s", root, dir)
	}
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	key := uuid.NewString() + "-t-1"
	wt, _, created, err := EnsureRunWorktree(ctx, dir, key, base)
	if err != nil || !created {
		t.Fatalf("EnsureRunWorktree created %v err %v", created, err)
	}
	if !strings.HasPrefix(wt, root) {
		t.Fatalf("lane tree at %s, want it under %s", wt, root)
	}
	writeFile(t, filepath.Join(wt, "lane.txt"), "lane\n")
	if got := gitCmd(t, wt, "status", "--porcelain"); got != "?? lane.txt" {
		t.Fatalf("git status in the tree = %q, want the new file", got)
	}
	if err := RemoveRunWorktree(ctx, dir, key); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(wt); !os.IsNotExist(err) {
		t.Fatalf("the tree is removed, stat err %v", err)
	}
	if isWorktreeRegistered(ctx, dir, wt) {
		t.Fatal("the tree is unregistered")
	}
}
