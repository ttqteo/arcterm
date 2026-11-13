// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"path/filepath"
	"slices"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// laneOf returns the lane holding taskID, or nil for an unknown task. Lanes are derived from the
// dependencies on every call rather than stored, so dispatch, the merge path and the digest cannot disagree
// about them.
func laneOf(g *waveobj.TaskGroup, taskID string) []string {
	for _, lane := range jarvis.Lanes(g.Tasks) {
		if slices.Contains(lane, taskID) {
			return lane
		}
	}
	return nil
}

// LaneWorktreeKey is the worktree key every task in a lane shares: its first task's. A one-task lane keys
// exactly as a task always has, so dags without chains keep their trees.
func LaneWorktreeKey(g *waveobj.TaskGroup, taskID string) string {
	first := taskID
	if lane := laneOf(g, taskID); len(lane) > 0 {
		first = lane[0]
	}
	return TaskWorktreeKey(g.RunID, first)
}

// laneTip is the lane's last task that was not skipped: the squash merge, its conflict, its Verify and its
// cleanup are recorded there. Nil when every task in the lane was skipped.
func laneTip(g *waveobj.TaskGroup, lane []string) *waveobj.TaskNode {
	for i := len(lane) - 1; i >= 0; i-- {
		if t := taskByID(g, lane[i]); t != nil && t.State != TaskState_Skipped {
			return t
		}
	}
	return nil
}

// laneMergeReady returns the tip of a lane that is finished and not yet landed: every task done or skipped,
// and every done gate released. Nil otherwise.
func laneMergeReady(g *waveobj.TaskGroup, lane []string) *waveobj.TaskNode {
	tip := laneTip(g, lane)
	if tip == nil || tip.Merged || tip.RunID == "" {
		return nil
	}
	for _, id := range lane {
		t := taskByID(g, id)
		if t.State == TaskState_Skipped {
			continue
		}
		if !taskStates[t.State].settled || (t.Gate && !t.Released) {
			return nil
		}
	}
	return tip
}

// mergeReadyTip reports whether t is the tip of a lane waiting to be landed, the one task a merge is
// offered on.
func mergeReadyTip(g *waveobj.TaskGroup, t *waveobj.TaskNode) bool {
	if !g.MergeRequired {
		return false
	}
	tip := laneMergeReady(g, laneOf(g, t.ID))
	return tip != nil && tip.ID == t.ID
}

// laneMerged reports whether a lane's work is on the project branch: each task skipped, or merged and past its
// gate. Its Verify may still be running, or have failed: that holds the next merge, not a dependent's start, so
// a chain link no longer waits minutes for tests its dependent does not need to begin.
func laneMerged(g *waveobj.TaskGroup, lane []string) bool {
	for _, id := range lane {
		t := taskByID(g, id)
		if t == nil {
			return false
		}
		if t.State == TaskState_Skipped {
			continue
		}
		if !t.Merged || (t.Gate && !t.Released) {
			return false
		}
	}
	return true
}

// laneMergeMessage names every task the squash commit lands, in lane order.
func laneMergeMessage(g *waveobj.TaskGroup, lane []string) string {
	var labels []string
	for _, id := range lane {
		t := taskByID(g, id)
		if t == nil || t.State == TaskState_Skipped {
			continue
		}
		label := t.Label
		if label == "" {
			label = t.ID
		}
		labels = append(labels, label)
	}
	return strings.Join(labels, "; ")
}

// laneFold lists the spec and plan to stage into the dag's first squash commit, so the docs land with the
// work they describe. Nil once anything has merged, and for a dag submitted without them. A branch-landed
// dag's docs were committed on its branch at submit (SnapshotDocs), which leaves its paths repo-relative:
// there is nothing left to fold.
func laneFold(g *waveobj.TaskGroup) []string {
	for i := range g.Tasks {
		if g.Tasks[i].Merged {
			return nil
		}
	}
	var paths []string
	for _, p := range []string{g.SpecPath, g.PlanPath} {
		if p != "" && filepath.IsAbs(p) {
			paths = append(paths, p)
		}
	}
	return paths
}
