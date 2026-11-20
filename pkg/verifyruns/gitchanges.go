// pkg/verifyruns/gitchanges.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package verifyruns

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/gitinfo"
)

// gitBudget bounds all the git calls of one read of an agent's changes.
const gitBudget = 20 * time.Second

func gitOut(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-c", "core.quotePath=false", "-C", dir}, args...)...)
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git %s: %w", strings.Join(args, " "), err)
	}
	return string(out), nil
}

// RepoRoot is the top of the checkout holding cwd. It errors outside a repo.
func RepoRoot(ctx context.Context, cwd string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, gitBudget)
	defer cancel()
	out, err := gitOut(ctx, cwd, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", err
	}
	root := strings.TrimSpace(out)
	if root == "" {
		return "", fmt.Errorf("git rev-parse --show-toplevel: no output")
	}
	return filepath.FromSlash(root), nil
}

// WatchedChanges lists the files matching cfg.Watch that differ from where the agent's branch started, each with
// the time it last changed (ms), in the checkout holding cwd: the files `git status` lists (staged, unstaged and
// untracked, each file of a new folder on its own), and, when the branch is not the default branch, the files it
// changed since it left the default branch (`git diff --name-only <merge-base>..HEAD`). On the default branch
// itself only the uncommitted ones count. It also returns the branch ("" on a detached HEAD) and the default
// branch, with an "origin/" prefix removed. A nil cfg, or one with no watch list, finds no changes.
func WatchedChanges(ctx context.Context, cwd string, cfg *Config) (changes []Change, branch, defaultBranch string, err error) {
	root, err := RepoRoot(ctx, cwd)
	if err != nil {
		return nil, "", "", err
	}
	return watchedChanges(ctx, root, cfg)
}

func watchedChanges(ctx context.Context, root string, cfg *Config) ([]Change, string, string, error) {
	ctx, cancel := context.WithTimeout(ctx, gitBudget)
	defer cancel()

	branch, _ := gitinfo.CurrentBranch(ctx, root) // "" on a detached HEAD or a repo with no commits
	defaultBranch, mergeBase, err := gitinfo.BranchBase(ctx, root)
	if err != nil {
		return nil, "", "", err
	}
	defaultBranch = strings.TrimPrefix(defaultBranch, "origin/")
	if cfg == nil || len(cfg.Watch) == 0 {
		return nil, branch, defaultBranch, nil
	}

	var listed []string
	// --no-renames: a rename reads as its new file and the deletion of the old one, both of them changes
	status, err := gitOut(ctx, root, "status", "--porcelain", "-z", "--untracked-files=all", "--no-renames")
	if err != nil {
		return nil, "", "", err
	}
	for rec := range strings.SplitSeq(status, "\x00") {
		if len(rec) > 3 { // "XY path"
			listed = append(listed, rec[3:])
		}
	}
	if defaultBranch != "" && mergeBase != "" && branch != defaultBranch {
		diff, err := gitOut(ctx, root, "diff", "--name-only", "-z", "--no-renames", mergeBase+"..HEAD")
		if err != nil {
			return nil, "", "", err
		}
		for p := range strings.SplitSeq(diff, "\x00") {
			if p != "" {
				listed = append(listed, p)
			}
		}
	}

	seen := map[string]bool{}
	var changes []Change
	for _, p := range listed {
		p = filepath.ToSlash(p)
		if seen[p] || !cfg.Watches(p) {
			continue
		}
		seen[p] = true
		changes = append(changes, Change{Path: p, Mtime: changeTime(root, p)})
	}
	sort.Slice(changes, func(i, j int) bool {
		if changes[i].Mtime != changes[j].Mtime {
			return changes[i].Mtime > changes[j].Mtime
		}
		return changes[i].Path < changes[j].Path
	})
	return changes, branch, defaultBranch, nil
}

// changeTime is when a changed file last changed (ms). A file that is gone has no time of its own; the nearest
// folder above it that still exists has the time its entry was removed (or something later), and, unlike "now",
// it does not move between reads: a branch that deleted a watched file would otherwise make every run out of date.
func changeTime(root, rel string) int64 {
	full := filepath.Join(root, filepath.FromSlash(rel))
	if info, err := os.Stat(full); err == nil {
		return info.ModTime().UnixMilli()
	}
	for dir := filepath.Dir(full); ; dir = filepath.Dir(dir) {
		if info, err := os.Stat(dir); err == nil {
			return info.ModTime().UnixMilli()
		}
		if dir == root || filepath.Dir(dir) == dir {
			break
		}
	}
	return time.Now().UnixMilli()
}
