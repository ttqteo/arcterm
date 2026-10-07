// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// taskStartBase is the commit a task's first attempt started from, read from its oldest worker run in a tree: the
// task's RunID moves on at every retry. Empty when no attempt of it ran in one.
func taskStartBase(ctx context.Context, g *waveobj.TaskGroup, taskID string) (string, error) {
	runs, err := wstore.GetChannelRuns(ctx, g.ChannelId)
	if err != nil {
		return "", fmt.Errorf("loading task %s's runs: %w", taskID, err)
	}
	// oldest first
	for _, r := range runs {
		if r.DagORef == g.OID && r.TaskId == taskID && !r.Review && r.StageRole == "" && r.Branch != "" && r.BaseCommit != "" {
			return r.BaseCommit, nil
		}
	}
	return "", nil
}

func isAncestor(ctx context.Context, dir, commit, of string) bool {
	_, err := git(ctx, dir, "merge-base", "--is-ancestor", commit, of)
	return err == nil
}

// attemptBase is the commit a task's attempt, starting in its lane's tree at head, reports its work from: the
// task's first start while the lane still holds it, so a retry's evidence keeps what an earlier attempt committed.
func attemptBase(ctx context.Context, g *waveobj.TaskGroup, taskID, wt, head string) string {
	first, err := taskStartBase(ctx, g, taskID)
	if err != nil {
		log.Printf("schedule dag %s task %s: %v; its evidence starts at the lane head", g.OID, taskID, err)
		return head
	}
	if first == "" || first == head || !isAncestor(ctx, wt, first, head) {
		return head
	}
	return first
}

// dropSkippedAttempt takes what a skipped task's attempts committed off its lane, so the lane's squash lands none of
// it: the branch goes back to the task's first start, which holds the lane's earlier tasks. The work is saved to
// .waveterm/recovery/<owner>-<task>-skipped.patch first. The tree is removed, never reset or cleaned: its
// node_modules, src-tauri/target and dist/bin can be junctions into the main checkout, which a reset or clean follows.
// removeWorktreeDir unlinks those first, and the branch moves from the project checkout. The lane's next dispatch
// checks the tree out again, and runs Setup in it. The caller must not hold the dag lock: dumping and removing the
// tree take tens of seconds on Windows.
func dropSkippedAttempt(ctx context.Context, g *waveobj.TaskGroup, taskID string) error {
	base, err := taskStartBase(ctx, g, taskID)
	if err != nil || base == "" {
		return err
	}
	project, err := cleanupProjectPath(ctx, g)
	if err != nil {
		return err
	}
	key := LaneWorktreeKey(g, taskID)
	branch := "wave/" + key
	head, err := WorktreeHeadCommit(ctx, project, key)
	if err != nil {
		return fmt.Errorf("reading task %s's lane: %w", taskID, err)
	}
	if head == base {
		return nil
	}
	if !isAncestor(ctx, project, base, head) {
		return fmt.Errorf("%s no longer holds %s, where task %s started: not moving it back", branch, base, taskID)
	}
	wt := worktreeDir(project, key)
	// the caller holds no dag lock, so a cancel or a merge's cleanup can be removing this tree
	treeRemovals.Lock(wt)
	defer treeRemovals.Unlock(wt)
	patchName := TaskWorktreeKey(g.RunID, taskID) + "-skipped"
	if err := dumpRecoveryPatch(ctx, project, key, base, patchName); err != nil {
		return fmt.Errorf("saving task %s's work before dropping it from %s: %w", taskID, branch, err)
	}
	if _, err := os.Stat(wt); err == nil {
		if err := removeWorktreeDir(ctx, project, wt); err != nil {
			return fmt.Errorf("dropping task %s's work from %s: %w", taskID, branch, err)
		}
	}
	// a registration whose directory is gone still holds the branch
	if _, err := gitLocked(ctx, project, "worktree", "prune"); err != nil {
		return fmt.Errorf("dropping task %s's work from %s: %w", taskID, branch, err)
	}
	if _, err := git(ctx, project, "branch", "-f", branch, base); err != nil {
		return fmt.Errorf("dropping task %s's work from %s: %w", taskID, branch, err)
	}
	log.Printf("dag %s: skipped task %s's commits dropped from %s (%s..%s), saved to recovery/%s.patch", g.OID, taskID, branch, base, head, patchName)
	return nil
}
