// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// StagnationThreshold is how long a worker's worktree may stay unchanged while the worker is active before the
// lead hears of it. Unmeasured: no worker on record looped (the longest stretch without an edit was 3.8 min).
const StagnationThreshold = 20 * time.Minute

// ActiveWindow is how recent a transcript write or a busy CPU sample must be for a worker to count as active. A
// worker that is not active is the stall path's, not this one's.
const ActiveWindow = 5 * time.Minute

// progressCheckEvery is the least time between two progress checks of a task: each is a git process. A var so
// tests that tick back to back can zero it.
var progressCheckEvery = time.Minute

// progressFingerprint is the worktree probe, a var so tests need no repo.
var progressFingerprint = worktreeFingerprint

// worktreeFingerprint hashes the tree's status (HEAD's commit, changed and untracked paths) with the size and
// mtime of every listed path, which catch a further edit to an already-changed file that the status text alone
// does not show. Ignored paths are not listed, so a test run's artifacts are not progress.
func worktreeFingerprint(ctx context.Context, dir string) (string, error) {
	out, err := git(ctx, dir, "status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all")
	if err != nil {
		return "", err
	}
	h := sha256.New()
	io.WriteString(h, out)
	for _, p := range statusPaths(out) {
		// porcelain paths are relative to the tree's root, which a task's worktree is
		if info, err := os.Lstat(filepath.Join(dir, p)); err == nil {
			fmt.Fprintf(h, "\x00%s\x00%d\x00%d", p, info.Size(), info.ModTime().UnixNano())
		} else {
			fmt.Fprintf(h, "\x00%s\x00gone", p)
		}
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// statusPaths are the paths a `git status --porcelain=v2 -z` output lists. A rename's second field is its
// original path, which no longer exists in the tree, so it is skipped.
func statusPaths(out string) []string {
	var paths []string
	records := strings.Split(out, "\x00")
	for i := 0; i < len(records); i++ {
		rec := records[i]
		fieldCount := 0
		switch {
		case strings.HasPrefix(rec, "1 "):
			fieldCount = 9
		case strings.HasPrefix(rec, "2 "):
			fieldCount = 10
			i++
		case strings.HasPrefix(rec, "u "):
			fieldCount = 11
		case strings.HasPrefix(rec, "? "):
			paths = append(paths, strings.TrimPrefix(rec, "? "))
			continue
		default:
			continue
		}
		if fields := strings.SplitN(rec, " ", fieldCount); len(fields) == fieldCount {
			paths = append(paths, fields[fieldCount-1])
		}
	}
	return paths
}

// suspectReason names the stagnation, then what the worker is running now, so the lead can tell a slow test from a
// loop.
func suspectReason(unchangedMs int64, latestTool string) string {
	parts := []string{fmt.Sprintf("worktree unchanged %dm while active", unchangedMs/time.Minute.Milliseconds())}
	if latestTool != "" {
		parts = append(parts, "now: "+latestTool)
	}
	return strings.Join(parts, "; ")
}

// checkProgress flags a running task whose worker is active but not progressing: its worktree unchanged for
// StagnationThreshold while active. It fires once per episode and re-arms on a tree change. A worker waiting on an ask
// is the question queue's, and its unchanged-tree clock restarts while it waits. (A repeated-failure scan of the
// transcript used to fire too; it was dropped on 2026-11-26: in 7 weeks of runs it never fired here, and its two
// firings in the fork came after the worker had already moved past the failure.)
// detail is the task-suspect row's.
func checkProgress(ctx context.Context, t *waveobj.TaskNode, run *waveobj.Run, now int64) (reason string, detail map[string]any, flagged bool) {
	if run == nil || run.ProjectPath == "" || now-t.ProgressCheckTs < progressCheckEvery.Milliseconds() {
		return "", nil, false
	}
	if run.Branch == "" {
		// no lane tree (a project that is not a git repo): nothing to fingerprint, and git status there only fails
		return "", nil, false
	}
	if blockId, _ := workerBlockFn(ctx, run); blockId != "" {
		if _, asking := agentask.GlobalRegistry.Get(waveobj.MakeORef(waveobj.OType_Block, blockId).String()); asking {
			// the wait is not stagnation: without this, a worker answered after a long ask is flagged at once
			t.ProgressTs = now
			return "", nil, false
		}
	}
	t.ProgressCheckTs = now
	fp, err := progressFingerprint(ctx, run.ProjectPath)
	if err != nil {
		log.Printf("orchestrate: progress check for dag task %s (run %s): %v", t.ID, run.ID, err)
		return "", nil, false
	}
	if fp != t.ProgressHash {
		t.ProgressHash, t.ProgressTs = fp, now
		t.SuspectTs, t.SuspectReason = 0, ""
	}
	active := now-max(t.LastActivity, t.BusyTs) <= ActiveWindow.Milliseconds()
	unchanged := now - t.ProgressTs
	if t.SuspectTs != 0 || !active || unchanged < StagnationThreshold.Milliseconds() {
		return "", nil, false
	}
	t.SuspectTs = now
	t.SuspectReason = suspectReason(unchanged, t.LatestTool)
	detail = map[string]any{"taskid": t.ID, "unchangedms": unchanged}
	return t.SuspectReason, detail, true
}
