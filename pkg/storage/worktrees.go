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

// runWorktrees lists the engine's trees, under each project's .waveterm/worktrees and under the shared root
// (<user cache dir>/arc-wt), and cleans those of finished runs. A finished tree with uncommitted changes is guarded:
// only its own button removes it. Branches stay; a task's cleanup debt clears itself, since the engine's retry
// (RetryCleanupDebt) succeeds on a tree that is gone.
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
	if root := sharedRoot(env); root != "" {
		shared, err := w.measureShared(ctx, env, root)
		items = append(items, shared...)
		if err != nil {
			errs = append(errs, err)
		}
	}
	return report(CategoryRunWorktrees, items, errors.Join(errs...))
}

func sharedRoot(env *Env) string {
	if env.WorktreeRoot == nil {
		return ""
	}
	return env.WorktreeRoot()
}

// measureShared lists the trees under the shared root. Its .run markers are files and are left to the engine's sweep.
func (w runWorktrees) measureShared(ctx context.Context, env *Env, root string) ([]StorageItem, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	var items []StorageItem
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		wt := filepath.Join(root, e.Name())
		detail := "arc-wt"
		if project := treeProject(ctx, wt); project != "" {
			detail = filepath.Base(project)
		}
		it := StorageItem{ID: wt, Kind: KindWorktree, Label: e.Name(), Detail: detail, Path: wt, Bytes: dirSize(wt)}
		w.judge(ctx, env, wt, &it)
		w.guardForeign(ctx, env, wt, &it)
		items = append(items, it)
	}
	return items, nil
}

// guardForeign keeps a shared-root tree whose run this app's store does not have. The dev app and the packaged one
// share the root, each with its own store, so such a tree is as likely the other app's live run as a deleted one:
// only its own button removes it, never the auto-clean.
func (runWorktrees) guardForeign(ctx context.Context, env *Env, wt string, it *StorageItem) {
	if !it.Cleanable {
		return
	}
	if runID, ok := env.RunOfWorktree(wt); ok {
		if st, err := env.RunState(ctx, runID); err == nil && st.Found {
			return
		}
	}
	it.Cleanable, it.Guarded = false, true
	it.Reason = "its run is not in this app's store (another arcterm's, or deleted)"
}

// treeProject is the main checkout a linked tree belongs to, read from the tree's git common dir, or "" when git
// cannot say (its metadata is gone).
func treeProject(ctx context.Context, wt string) string {
	out, err := gitOut(ctx, wt, "rev-parse", "--path-format=absolute", "--git-common-dir")
	if err != nil {
		return ""
	}
	common := filepath.Clean(strings.TrimSpace(out))
	if !strings.EqualFold(filepath.Base(common), ".git") {
		return ""
	}
	project := filepath.Dir(common)
	if SamePath(evalOrClean(project), evalOrClean(wt)) {
		return ""
	}
	return project
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

// inSharedRoot reports whether wt sits directly under the shared root.
func inSharedRoot(env *Env, wt string) bool {
	root := sharedRoot(env)
	return root != "" && SamePath(filepath.Dir(filepath.Clean(wt)), root)
}

func (w runWorktrees) clean(ctx context.Context, env *Env, ids []string, opts CleanOpts) StorageCleanResult {
	var res StorageCleanResult
	for _, id := range ids {
		shared := inSharedRoot(env, id)
		project := ownerProject(env.ProjectPaths(), id)
		if project == "" && !shared {
			skip(&res, id, "not in a project's .waveterm/worktrees or the engine's tree root")
			continue
		}
		if _, err := os.Lstat(id); err != nil {
			skip(&res, id, "no longer exists")
			continue
		}
		if shared {
			if project = treeProject(ctx, id); project == "" {
				skip(&res, id, "couldn't find the checkout it belongs to")
				continue
			}
		}
		var it StorageItem
		w.judge(ctx, env, id, &it)
		if shared {
			w.guardForeign(ctx, env, id, &it)
		}
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
