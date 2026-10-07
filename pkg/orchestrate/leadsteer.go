// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// runBlockORefs is RunBlockORefs, a var so tests need no live tab.
var runBlockORefs = RunBlockORefs

func reviewFailed(g *waveobj.TaskGroup, taskID string) bool {
	t := taskByID(g, taskID)
	return t != nil && t.State == TaskState_ReviewFailed
}

func persistDag(ctx context.Context, g *waveobj.TaskGroup) error {
	g.UpdatedTs = time.Now().UnixMilli()
	if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
		*cur = *g
		return nil
	}); err != nil {
		return err
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Dag, g.OID))
	return nil
}

// AmendTask adds the lead's note to a task that has not started, carried into its worker's prompt. It is how
// the lead passes on what an earlier task found without re-planning; a started task is reached with TellTask.
func AmendTask(ctx context.Context, dagID, taskID, note string) error {
	note = strings.TrimSpace(note)
	if note == "" {
		return fmt.Errorf("amend needs the note to add")
	}
	var g *waveobj.TaskGroup
	err := withDagMutation(dagID, func() error {
		var err error
		if g, err = wstore.GetDag(ctx, dagID); err != nil {
			return fmt.Errorf("loading dag: %w", err)
		}
		task := taskByID(g, taskID)
		if task == nil {
			return fmt.Errorf("no task %q", taskID)
		}
		if !amendable(task.State) {
			return fmt.Errorf("task %s is %s: amend reaches only a task that has not started; use dag tell for a running one", taskID, task.State)
		}
		task.LeadNotes = append(task.LeadNotes, toldText(note))
		return persistDag(ctx, g)
	})
	if err != nil {
		return err
	}
	appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindTaskAmended, nil, map[string]any{"taskid": taskID, "text": toldText(note)})
	return nil
}

// TellTask types the lead's message into a running worker's or reviewer's terminal, the way the human can. The
// text stays on the task until the scan for what the human typed matches it, so it is never recorded as theirs.
func TellTask(ctx context.Context, dagID, taskID, text string) error {
	text = strings.TrimSpace(text)
	if text == "" {
		return fmt.Errorf("tell needs the text to send")
	}
	var g *waveobj.TaskGroup
	var blockId string
	var toReviewer bool
	err := withDagMutation(dagID, func() error {
		var err error
		if g, err = wstore.GetDag(ctx, dagID); err != nil {
			return fmt.Errorf("loading dag: %w", err)
		}
		task := taskByID(g, taskID)
		if task == nil {
			return fmt.Errorf("no task %q", taskID)
		}
		if tellRunID(task) == "" {
			return fmt.Errorf("task %s is %s: tell reaches only a running worker or reviewer; use dag amend for a task that has not started", taskID, task.State)
		}
		if blockId, err = taskTerminal(ctx, g, task); err != nil {
			return err
		}
		toReviewer = task.State == TaskState_Reviewing
		task.LeadTold = append(task.LeadTold, text)
		return persistDag(ctx, g)
	})
	if err != nil {
		return err
	}
	sendWakeFn(blockId, text)
	detail := map[string]any{"taskid": taskID, "text": toldText(text)}
	// a later reviewer's brief lists what the worker was told, which a message to this reviewer is not
	if toReviewer {
		detail["to"] = "reviewer"
	}
	appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindTaskLeadTold, nil, detail)
	return nil
}

// amendable reports a task whose worker has not started, so a note can still join its prompt.
func amendable(state string) bool {
	return state == TaskState_Pending || state == TaskState_Ready
}

// tellRunID is the run a told message reaches: a working task's worker, or its reviewer. Empty for any other state.
func tellRunID(task *waveobj.TaskNode) string {
	switch task.State {
	case TaskState_Running, TaskState_Stalled:
		return task.RunID
	case TaskState_Reviewing:
		return task.ReviewRunID
	}
	return ""
}

// taskTerminal is the block a message to a working task is typed into.
func taskTerminal(ctx context.Context, g *waveobj.TaskGroup, task *waveobj.TaskNode) (string, error) {
	runID := tellRunID(task)
	run, err := wstore.GetRun(ctx, g.ChannelId, runID)
	if err != nil {
		return "", fmt.Errorf("loading run %s: %w", runID, err)
	}
	blocks := runBlockORefs(ctx, run)
	if len(blocks) == 0 {
		return "", fmt.Errorf("task %s has no live terminal to type into", task.ID)
	}
	ref, err := waveobj.ParseORef(blocks[0])
	if err != nil {
		return "", fmt.Errorf("task %s terminal %q: %w", task.ID, blocks[0], err)
	}
	return ref.OID, nil
}

// takeLeadTold consumes a message the lead typed with TellTask, so the told scan does not record the lead's own
// words as the human's.
func takeLeadTold(t *waveobj.TaskNode, text string) bool {
	want := strings.TrimSpace(text)
	for i, s := range t.LeadTold {
		if strings.TrimSpace(s) == want {
			t.LeadTold = append(t.LeadTold[:i], t.LeadTold[i+1:]...)
			return true
		}
	}
	return false
}

// SendBack returns a task to a worker. A task whose review failed gets one more round, with the lead's guidance
// beside the reviewer's findings; ReviewRound is kept, so a further fail comes straight back to the lead. Any
// other task takes the old plan-gate sendback, which has no guidance.
func SendBack(ctx context.Context, dagID, taskID, guidance string) error {
	// behind an action still working on the task: a skip resetting its lane must not find it sent back
	taskActions.Lock(dagID)
	err := withDagMutation(dagID, func() error {
		g, err := wstore.GetDag(ctx, dagID)
		if err != nil {
			return fmt.Errorf("loading dag: %w", err)
		}
		if !reviewFailed(g, taskID) {
			return applyActionLocked(ctx, dagID, taskID, "sendback", waveobj.RoutePin{})
		}
		task := taskByID(g, taskID)
		task.LeadGuidance = clipRunes(strings.TrimSpace(guidance), MaxReviewNoteLen)
		task.State = TaskState_Pending
		task.RunID = ""
		RecomputeDagStatus(g)
		return persistDag(ctx, g)
	})
	taskActions.Unlock(dagID)
	if err != nil {
		return err
	}
	return Schedule(ctx, dagID)
}

// dropRejectedCommit moves a review-failed task's lane back to where the task's first reviewed attempt started.
// Nothing later in the lane can have built on it: the task never counted as done. The reset is work on a tree, so
// the caller must not hold the dag lock.
func dropRejectedCommit(ctx context.Context, g *waveobj.TaskGroup, task *waveobj.TaskNode) error {
	if task.ReviewBase == "" || task.RunID == "" {
		return nil
	}
	worker, err := wstore.GetRun(ctx, g.ChannelId, task.RunID)
	if err != nil {
		return fmt.Errorf("loading task %s's worker run: %w", task.ID, err)
	}
	if err := resetReviewTree(ctx, worker.ProjectPath, task.ReviewBase); err != nil {
		return fmt.Errorf("dropping task %s's rejected commit from its lane: %w", task.ID, err)
	}
	return nil
}
