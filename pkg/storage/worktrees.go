// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// runWorktrees lists the engine's trees under each project's .waveterm/worktrees and cleans those of finished
// runs. A finished tree with uncommitted changes is guarded: only its own button removes it. Branches stay; a
// task's cleanup debt clears itself, since the engine's retry (RetryCleanupDebt) succeeds on a tree that is gone.
type runWorktrees struct{}

func (runWorktrees) category() StorageCategory { return CategoryRunWorktrees }

func worktreesRoot(project string) string {
	return filepath.Join(project, ".waveterm", "worktrees")
}

func (w runWorktrees) measure(ctx context.Context, env *Env) StorageCategoryReport {
	var items []StorageItem
	var errs []error
	for _, project := range env.ProjectPaths() {
		entries, err := os.ReadDir(worktreesRoot(project))
		if err != nil {
			// a root that is a file reads "not found" on some OSes: it exists, so it is an error, not "no worktrees"
			if _, serr := os.Lstat(worktreesRoot(project)); !errors.Is(err, fs.ErrNotExist) || serr == nil {
				errs = append(errs, err)
			}
			continue
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			wt := filepath.Join(worktreesRoot(project), e.Name())
			it := StorageItem{ID: wt, Kind: KindWorktree, Label: e.Name(), Detail: filepath.Base(project), Path: wt, Bytes: dirSize(wt)}
			w.judge(ctx, env, wt, &it)
			items = append(items, it)
		}
	}
	return report(CategoryRunWorktrees, items, errors.Join(errs...))
}

// judge decides whether a tree may go: one the engine did not make, or whose run still goes, stays; one with
// uncommitted changes is guarded.
func (runWorktrees) judge(ctx context.Context, env *Env, wt string, it *StorageItem) {
	runID, ok := env.RunOfWorktree(wt)
	if !ok {
		it.Reason = "not a run worktree"
		return
	}
	st, err := env.RunState(ctx, runID)
	switch {
	case err != nil:
		it.Reason = "couldn't read its run: " + err.Error()
		return
	case !st.Found:
		it.Detail += " · no run"
	case !st.Finished:
		it.Detail += " · " + st.Status
		// a done run whose land is pending or held: the merge retries in this run's trees
		it.Reason = "run still running"
		if st.Status == "landing" {
			it.Reason = "run still landing"
		}
		return
	default:
		it.Detail += " · " + st.Status
	}
	dirty, err := hasChanges(ctx, wt)
	switch {
	case err != nil:
		it.Guarded = true
		it.Reason = "couldn't read its git status"
	case dirty:
		it.Guarded = true
		it.Reason = "has uncommitted changes"
	default:
		it.Cleanable = true
	}
}

// hasChanges reports uncommitted changes in a worktree. A directory that is not a worktree root of its own (git
// unregistered it and then failed to delete it) holds no tracked work; asking git there would answer for the
// project's main tree.
func hasChanges(ctx context.Context, wt string) (bool, error) {
	top, err := gitOut(ctx, wt, "rev-parse", "--show-toplevel")
	if err != nil || !SamePath(evalOrClean(strings.TrimSpace(top)), evalOrClean(wt)) {
		return false, nil
	}
	out, err := gitOut(ctx, wt, "status", "--porcelain")
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(out) != "", nil
}

// ownerProject is the project whose .waveterm/worktrees holds wt directly, "" when none does.
func ownerProject(projects []string, wt string) string {
	for _, p := range projects {
		if SamePath(filepath.Dir(filepath.Clean(wt)), worktreesRoot(p)) {
			return p
		}
	}
	return ""
}

func (w runWorktrees) clean(ctx context.Context, env *Env, ids []string, opts CleanOpts) StorageCleanResult {
	var res StorageCleanResult
	for _, id := range ids {
		project := ownerProject(env.ProjectPaths(), id)
		if project == "" {
			skip(&res, id, "not in a project's .waveterm/worktrees")
			continue
		}
		if _, err := os.Lstat(id); err != nil {
			skip(&res, id, "no longer exists")
			continue
		}
		var it StorageItem
		w.judge(ctx, env, id, &it)
		allowed := it.Cleanable || (it.Guarded && opts.AllowGuarded && !opts.Auto)
		if !allowed {
			skip(&res, id, it.Reason)
			continue
		}
		size := dirSize(id)
		if err := env.RemoveWorktree(ctx, project, id); err != nil {
			skip(&res, id, "couldn't remove: "+err.Error())
			continue
		}
		res.Reclaimed += size
		res.Cleaned = append(res.Cleaned, id)
	}
	return res
}
