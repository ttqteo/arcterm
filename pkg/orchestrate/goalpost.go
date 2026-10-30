// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// a reviewer needs enough of a sample to see what changed, not the whole hunk
const (
	goalpostSampleLines = 3
	goalpostSampleRunes = 120
)

// RecordGoalposts stores arc-mod's findings on an edit a task's current worker made, for that task's reviewer.
// Any other caller (a reviewer, a lead, a retired attempt, a run that works no task) is not recorded and gets
// false with no error, since the mod reports from every Claude Code session in a run.
func RecordGoalposts(ctx context.Context, dagID, callerRunID string, findings []wshrpc.GoalpostFinding) (bool, error) {
	if len(findings) == 0 {
		return false, errors.New("no findings")
	}
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		return false, fmt.Errorf("loading dag: %w", err)
	}
	caller, err := wstore.GetRun(ctx, g.ChannelId, callerRunID)
	if err != nil {
		return false, fmt.Errorf("loading run: %w", err)
	}
	if caller.TaskId == "" || caller.Review {
		return false, nil
	}
	task := taskByID(g, caller.TaskId)
	if task == nil || task.RunID != callerRunID {
		return false, nil
	}
	detail := map[string]any{"taskid": task.ID, "runid": callerRunID, "findings": findings}
	appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindTaskGoalpost, nil, detail)
	return true, nil
}

// goalpostsForTask is what arc-mod reported against a task's workers, oldest first. A failed read leaves the
// brief without them rather than failing the review.
func goalpostsForTask(ctx context.Context, g *waveobj.TaskGroup, taskID string) []wshrpc.GoalpostFinding {
	kinds := []string{waveobj.RunEventKindTaskGoalpost}
	evs, err := wstore.QueryRunEventsByKind(ctx, g.ChannelId, g.RunID, kinds, 0)
	if err != nil {
		log.Printf("dag %s task %s: reading its goalpost findings: %v", g.OID, taskID, err)
		return nil
	}
	var out []wshrpc.GoalpostFinding
	for i := len(evs) - 1; i >= 0; i-- {
		var d struct {
			TaskId   string                   `json:"taskid"`
			Findings []wshrpc.GoalpostFinding `json:"findings"`
		}
		if json.Unmarshal(evs[i].Detail, &d) != nil || d.TaskId != taskID {
			continue
		}
		out = append(out, d.Findings...)
	}
	return out
}

// goalpostSection is the reviewer's brief on the findings: one line per distinct finding, then what to do
// with them. Empty with no findings.
func goalpostSection(findings []wshrpc.GoalpostFinding) string {
	distinct := distinctGoalposts(findings)
	if len(distinct) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("While it worked, the worker made edits that lower a check (found by the goalpost guard as the edits were made):")
	for _, f := range distinct {
		b.WriteString("\n- ")
		b.WriteString(goalpostLine(f))
	}
	b.WriteString("\nPass or fail each one by name in your verdict's note. Pass one when the task or spec calls for it, or when the worker's report explains it and you agree. Pass one the final diff no longer shows, as undone. Otherwise fail the task.")
	return b.String()
}

// distinctGoalposts collapses findings with the same rule, file and title to the first one's place, keeping
// the latest one's samples: the worker may have edited the same spot more than once.
func distinctGoalposts(findings []wshrpc.GoalpostFinding) []wshrpc.GoalpostFinding {
	var out []wshrpc.GoalpostFinding
	at := map[[3]string]int{}
	for _, f := range findings {
		key := [3]string{f.Rule, f.File, f.Title}
		if i, ok := at[key]; ok {
			out[i] = f
			continue
		}
		at[key] = len(out)
		out = append(out, f)
	}
	return out
}

func goalpostLine(f wshrpc.GoalpostFinding) string {
	line := "[" + f.Rule + "] "
	if f.File != "" {
		line += f.File + ": "
	}
	line += clipRunes(oneLine(f.Title), goalpostSampleRunes)
	if s := goalpostSample(f.Before); s != "" {
		line += "; before: " + s
	}
	if s := goalpostSample(f.After); s != "" {
		line += "; after: " + s
	}
	return line
}

// goalpostSample is a finding's sample lines on one line, each trimmed and clipped, the first few only.
func goalpostSample(lines []string) string {
	var parts []string
	for _, l := range lines {
		if l = strings.TrimSpace(l); l == "" {
			continue
		}
		if len(parts) == goalpostSampleLines {
			parts = append(parts, "…")
			break
		}
		parts = append(parts, "`"+clipRunes(oneLine(l), goalpostSampleRunes)+"`")
	}
	return strings.Join(parts, " / ")
}

func oneLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}
