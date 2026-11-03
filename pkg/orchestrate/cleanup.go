// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/util/keyedmutex"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// MaxCleanupErrorLen bounds the persisted per-task cleanup error detail.
const MaxCleanupErrorLen = 200

// MaxCleanupAttempts is how many failed removals a task's cleanup debt survives before it stops
// blocking the dag from finishing (about two and a half minutes at one retry per watchdog tick).
const MaxCleanupAttempts = 5

// RemoveTaskWorktree is the injectable tree-removal step so tests can stub failures without a
// real git repository (mirrors the exported jarvis.SpawnRunWorker seam; in the merge/retry paths
// the caller goes through CleanupTaskWorktree, never this var directly).
var RemoveTaskWorktree = RemoveRunWorktree

// PendingCleanupTasks returns the tasks carrying cleanup debt, in DAG order: a merged or cancelled task's tree, or
// the directories an unmerged task's tree removals left behind (CleanupTaskWorktree).
func PendingCleanupTasks(g *waveobj.TaskGroup) []*waveobj.TaskNode {
	var out []*waveobj.TaskNode
	for i := range g.Tasks {
		t := &g.Tasks[i]
		if t.CleanupPending || t.CleanupError != "" {
			out = append(out, t)
		}
	}
	return out
}

// cleanupGivenUp reports whether a task's cleanup debt has exhausted its retries.
func cleanupGivenUp(t *waveobj.TaskNode) bool {
	return t.CleanupAttempts >= MaxCleanupAttempts
}

// HasCleanupDebt reports whether any merged task still owns a worktree waiting
// on cleanup, so digest health can keep terminal DAGs with debt in needs-you.
func HasCleanupDebt(g *waveobj.TaskGroup) bool {
	for i := range g.Tasks {
		if g.Tasks[i].CleanupPending || g.Tasks[i].CleanupError != "" {
			return true
		}
	}
	return false
}

// CleanupTaskWorktree removes one merged task's worktree idempotently and records the outcome on the
// task node; the caller persists the group and publishes. Task state and merge identity are never
// disturbed: a cleanup failure cannot turn an already-landed merge back into a failed task. The
// removal half is the same RemoveRunWorktree used elsewhere; the helper only guarantees the state
// bookkeeping around it (pending always clears; success clears error; failure records a bounded
// error). An unmerged task's tree is still its lane's, so in a live dag only the directories its
// removals left behind (laneLeftovers) go, and only what holds those is reaped.
func CleanupTaskWorktree(ctx context.Context, g *waveobj.TaskGroup, taskID string) error {
	task := taskByID(g, taskID)
	if task == nil {
		return fmt.Errorf("no task %q", taskID)
	}
	projectPath, err := cleanupProjectPath(ctx, g)
	if err != nil {
		task.CleanupPending = false
		task.CleanupError = boundedCleanupError(err)
		task.CleanupAttempts++
		return err
	}
	key := LaneWorktreeKey(g, taskID)
	left := laneLeftovers(ctx, projectPath, key)
	if task.Merged || g.Status == DagStatus_Cancelled {
		reapLaneWorkers(ctx, g, taskID, append(left, laneTree(ctx, projectPath, key)))
		err = RemoveTaskWorktree(ctx, projectPath, key)
	} else {
		reapTreeHolders(ctx, g, left, map[string]bool{})
	}
	// after the tree's own removal, which can leave its directory behind too
	err = errors.Join(err, removeLeftovers(ctx, projectPath, key))
	task.CleanupPending = false
	if err != nil {
		task.CleanupError = boundedCleanupError(err)
		task.CleanupAttempts++
		return err
	}
	task.CleanupError = ""
	task.CleanupAttempts = 0
	return nil
}

// reapLaneWorkers stops every run still holding the trees about to be removed. A harness sits at its prompt after
// reporting done instead of exiting, and on Windows a live process holding the tree as its cwd is what makes
// git's removal leave the directory behind. The lane's own tasks are reaped by id; everything else is found by
// path (reapTreeHolders). Best effort: the removal below is what decides whether cleanup succeeded.
func reapLaneWorkers(ctx context.Context, g *waveobj.TaskGroup, taskID string, trees []string) {
	reaped := map[string]bool{}
	for _, id := range laneOf(g, taskID) {
		task := taskByID(g, id)
		if task == nil || task.RunID == "" {
			continue
		}
		child, err := wstore.GetRun(ctx, g.ChannelId, task.RunID)
		if err != nil {
			log.Printf("dag %s task %s: loading child run to stop its worker: %v", g.OID, id, err)
			continue
		}
		stopReapedRun(ctx, g, child, reaped)
	}
	reapTreeHolders(ctx, g, trees, reaped)
}

// stopWorkerTab stops an engine session by its tab. A var so tests need no live block.
var stopWorkerTab = jarvis.StopRunWorker

// blockMetaRunID is the block meta key jarvis stamps an engine-launched session's run id under (RunWorkerOptions).
const blockMetaRunID = "agent:runid"

// reapTreeHolders stops the engine sessions working in one of trees, skipping the runs in reaped. This dag's runs
// are found by path - reviewers, whose ReviewRunID is cleared once their verdict applies, and replacements - and
// every engine-launched block by its cwd, the source `wsh agents list` reads: a session can outlive its run's
// record and still hold the tree.
func reapTreeHolders(ctx context.Context, g *waveobj.TaskGroup, trees []string, reaped map[string]bool) {
	if len(trees) == 0 {
		return
	}
	if runs, err := wstore.GetChannelRuns(ctx, g.ChannelId); err != nil {
		log.Printf("dag %s: listing runs to reap %v: %v", g.OID, trees, err)
	} else {
		for _, run := range runs {
			if run.DagORef == g.OID && insideAny(run.ProjectPath, trees) {
				stopReapedRun(ctx, g, run, reaped)
			}
		}
	}
	blocks, err := wstore.DBGetAllObjsByType[*waveobj.Block](ctx, waveobj.OType_Block)
	if err != nil {
		log.Printf("dag %s: listing sessions to reap %v: %v", g.OID, trees, err)
		return
	}
	for _, b := range blocks {
		runID := b.Meta.GetString(blockMetaRunID, "")
		tab := waveobj.ParseORefNoErr(b.ParentORef)
		if runID == "" || reaped[runID] || tab == nil || tab.OType != waveobj.OType_Tab {
			continue
		}
		if !insideAny(b.Meta.GetString(waveobj.MetaKey_CmdCwd, ""), trees) && !insideAny(LatestAgentStatus(b.OID, tab.OID).Cwd, trees) {
			continue
		}
		reaped[runID] = true
		if err := stopWorkerTab(ctx, tab.String()); err != nil {
			log.Printf("dag %s: stopping session %s of run %s in %v: %v", g.OID, tab, runID, trees, err)
		}
	}
}

func stopReapedRun(ctx context.Context, g *waveobj.TaskGroup, run *waveobj.Run, reaped map[string]bool) {
	if run == nil || reaped[run.ID] {
		return
	}
	reaped[run.ID] = true
	if err := stopRunWorkers(ctx, run); err != nil {
		log.Printf("dag %s run %s: stopping worker in %s: %v", g.OID, run.ID, run.ProjectPath, err)
	}
}

// insideAny reports whether path is one of dirs or under one.
func insideAny(path string, dirs []string) bool {
	if path == "" {
		return false
	}
	for _, dir := range dirs {
		rel, err := filepath.Rel(dir, path)
		if err == nil && !filepath.IsAbs(rel) && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

// cleanupProjectPath resolves the repo a task's worktree belongs to. The owning run is the authority
// because that is what the merge path uses (owner.ProjectPath); resolving cleanup from a different
// source risks removing a worktree from a different repo than the one merged into. The channel is
// only a fallback for a group whose run row is unreadable.
func cleanupProjectPath(ctx context.Context, g *waveobj.TaskGroup) (string, error) {
	if run, err := wstore.GetRun(ctx, g.ChannelId, g.RunID); err == nil && run.ProjectPath != "" {
		return run.ProjectPath, nil
	}
	ch, err := wstore.DBMustGet[*waveobj.Channel](ctx, g.ChannelId)
	if err != nil {
		return "", fmt.Errorf("loading channel for cleanup: %w", err)
	}
	return ch.ProjectPath, nil
}

// treeRemovals serializes removals of one tree. The merge path, the tick's debt retry, cancel and retry-cleanup
// can each reach the same tree, and none of them holds the dag lock while it removes.
var treeRemovals = keyedmutex.New()

// removeTaskTree removes one task's tree and records the result. The caller must not hold the dag lock: reaping
// and removing take tens of seconds on Windows, and each worker the reap stops exits into HandleChildOutcome,
// which takes that lock. wait=false skips a tree another caller is removing.
func removeTaskTree(ctx context.Context, dagID, taskID string, wait bool) error {
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		return fmt.Errorf("loading dag: %w", err)
	}
	task := taskByID(g, taskID)
	if task == nil {
		return fmt.Errorf("no task %q", taskID)
	}
	if !task.CleanupPending && task.CleanupError == "" {
		return nil
	}
	project, err := cleanupProjectPath(ctx, g)
	if err != nil {
		// counted like a failed removal, so an unresolvable repo still reaches the retry cap
		task.CleanupPending, task.CleanupError = false, boundedCleanupError(err)
		task.CleanupAttempts++
		return errors.Join(err, withDagMutation(dagID, func() error { return persistTaskCleanupLocked(ctx, dagID, task) }))
	}
	wasCancelled := g.Status == DagStatus_Cancelled
	tree := worktreeDir(project, LaneWorktreeKey(g, taskID))
	if wait {
		treeRemovals.Lock(tree)
	} else if !treeRemovals.TryLock(tree) {
		return nil
	}
	defer treeRemovals.Unlock(tree)
	// re-read under the tree lock: a removal that finished while this one waited leaves no debt
	if g, err = wstore.GetDag(ctx, dagID); err != nil {
		return fmt.Errorf("loading dag: %w", err)
	}
	if task = taskByID(g, taskID); task == nil {
		return fmt.Errorf("no task %q", taskID)
	}
	if !task.CleanupPending && task.CleanupError == "" {
		return nil
	}
	// a pass that read the dag before a cancel would remove a tree whose work the cancel has yet to dump
	if !wait && !wasCancelled && g.Status == DagStatus_Cancelled {
		return nil
	}
	cleanupErr := CleanupTaskWorktree(ctx, g, taskID)
	if err := withDagMutation(dagID, func() error { return persistTaskCleanupLocked(ctx, dagID, task) }); err != nil {
		return errors.Join(cleanupErr, err)
	}
	if cleanupErr != nil {
		appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindTaskCleanupFailed, nil, map[string]any{"taskid": taskID, "error": cleanupErr.Error()})
		return cleanupErr
	}
	appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindTaskCleanupCompleted, nil, map[string]any{"taskid": taskID})
	if !task.Merged || task.RunID == "" {
		return nil
	}
	child, err := wstore.GetRun(ctx, g.ChannelId, task.RunID)
	if err != nil {
		return fmt.Errorf("loading child run: %w", err)
	}
	return jarvis.SealEvidence(ctx, child)
}

// persistTaskCleanupLocked writes one task's cleanup fields onto the stored dag, leaving every other task's as
// stored. The caller holds the dag lock.
func persistTaskCleanupLocked(ctx context.Context, dagID string, done *waveobj.TaskNode) error {
	if err := wstore.UpdateDag(ctx, dagID, func(cur *waveobj.TaskGroup) error {
		t := taskByID(cur, done.ID)
		if t == nil {
			return fmt.Errorf("no task %q", done.ID)
		}
		t.CleanupPending, t.CleanupError, t.CleanupAttempts = done.CleanupPending, done.CleanupError, done.CleanupAttempts
		RecomputeDagStatus(cur)
		cur.UpdatedTs = time.Now().UnixMilli()
		return nil
	}); err != nil {
		return err
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Dag, dagID))
	return nil
}

// RetryCleanupDebt retries every tree still owed a removal, under the retry cap. A stuck tree never blocks
// scheduling, and a tree another caller is removing is skipped, not waited on.
func RetryCleanupDebt(ctx context.Context, dagID string) {
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		return
	}
	retryCleanupDebt(ctx, g)
}

// retryCleanupDebt retries the debt g records. A snapshot taken before a cancel never removes a tree whose
// uncommitted work the cancel has yet to dump: an unmerged task's debt is its left-behind directories, and
// removeTaskTree leaves a tree the dag was cancelled under since to the cancel.
func retryCleanupDebt(ctx context.Context, g *waveobj.TaskGroup) {
	if !HasCleanupDebt(g) {
		return
	}
	for _, task := range PendingCleanupTasks(g) {
		if cleanupGivenUp(task) {
			continue
		}
		if err := removeTaskTree(ctx, g.OID, task.ID, false); err != nil {
			log.Printf("dag %s task %s: retrying cleanup: %v", g.OID, task.ID, err)
		}
	}
}

// RetryCleanup is the human's retry-cleanup: it gives a task's stuck worktree a fresh set of attempts and tries
// once now, reaping whatever still holds the tree first. The watchdog's own retries stop at MaxCleanupAttempts,
// so without this a tree freed later (an editor closed, a shell exited) stays debt until the dag is cancelled.
// A cancelled dag is allowed: cancelling is what queued its trees.
func RetryCleanup(ctx context.Context, dagID, taskID string) error {
	if err := withDagMutation(dagID, func() error {
		g, err := wstore.GetDag(ctx, dagID)
		if err != nil {
			return fmt.Errorf("loading dag: %w", err)
		}
		task := taskByID(g, taskID)
		if task == nil {
			return fmt.Errorf("no task %q", taskID)
		}
		if !task.CleanupPending && task.CleanupError == "" {
			return fmt.Errorf("task %s has no worktree left to clean up", taskID)
		}
		task.CleanupAttempts = 0
		return persistTaskCleanupLocked(ctx, dagID, task)
	}); err != nil {
		return err
	}
	// after the lock, and outliving the RPC that asked: removal takes tens of seconds
	if err := removeTaskTree(context.WithoutCancel(ctx), dagID, taskID, true); err != nil {
		return fmt.Errorf("task %s's worktree still could not be removed: %w", taskID, err)
	}
	return nil
}

// recordLeftBehind records a directory a removal of the task's tree left behind as the task's cleanup debt, which
// the watchdog and retry-cleanup reap and delete (CleanupTaskWorktree). The caller must not hold the dag lock.
func recordLeftBehind(ctx context.Context, dagID, taskID string, cause error) error {
	return withDagMutation(dagID, func() error {
		g, err := wstore.GetDag(ctx, dagID)
		if err != nil {
			return fmt.Errorf("loading dag: %w", err)
		}
		task := taskByID(g, taskID)
		if task == nil {
			return fmt.Errorf("no task %q", taskID)
		}
		task.CleanupError, task.CleanupAttempts = boundedCleanupError(cause), 0
		return persistTaskCleanupLocked(ctx, dagID, task)
	})
}

func boundedCleanupError(err error) string {
	if err == nil {
		return ""
	}
	msg := strings.TrimSpace(err.Error())
	if len(msg) > MaxCleanupErrorLen {
		msg = msg[:MaxCleanupErrorLen]
	}
	return msg
}
