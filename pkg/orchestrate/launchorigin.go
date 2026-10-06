// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
)

// A stage session's prompt opens with its opener and the run id (planReviewPrompt, verifierPrompt), so
// LaunchOriginOf can read the role back from a transcript.
const (
	planReviewerOpener = "You are the plan reviewer for run "
	verifierOpener     = "You are the final verifier for run "
)

var stageOpeners = map[string]string{
	jarvis.UsageRole_PlanReviewer: planReviewerOpener,
	jarvis.UsageRole_Verifier:     verifierOpener,
}

// LaunchOrigin is the run a session's own transcript says launched it.
type LaunchOrigin struct {
	RunID  string
	TaskID string // the task whose tree it ran in; a lane's tasks share their first task's tree, which this names
	Role   string // jarvis.UsageRole_PlanReviewer or _Verifier for a stage session, else ""
}

// LaunchOriginOf places a session the engine launched from its working directory and first prompt, for when the store
// holds no record of the run (another app's store, cleared data, a deleted run). A session that ran in one of the
// engine's worktrees is that run's: a task's tree names the task, the final tree the verifier. A stage session opens
// with its stage's line, which names the run and the role. ok is false for any other session.
func LaunchOriginOf(cwd, firstPrompt string) (LaunchOrigin, bool) {
	var o LaunchOrigin
	if runID, rest, ok := runOfWorktree(cwd); ok {
		o.RunID = runID
		switch rest {
		case "":
		case finalTreeKey:
			o.Role = jarvis.UsageRole_Verifier
		default:
			o.TaskID = rest
		}
	}
	for role, opener := range stageOpeners {
		runID, ok := strings.CutPrefix(firstPrompt, opener)
		if !ok || len(runID) < uuidLen || uuid.Validate(runID[:uuidLen]) != nil {
			continue
		}
		if o.RunID == "" || o.RunID == runID[:uuidLen] {
			o = LaunchOrigin{RunID: runID[:uuidLen], Role: role}
		}
	}
	return o, o.RunID != ""
}

const uuidLen = 36

// runOfWorktree reads back the run that owns a path inside one of the engine's worktrees, and the tree's key past the
// run id: a task id (TaskWorktreeKey), finalTreeKey, or "" for the run's own tree. worktreeDir builds the path.
func runOfWorktree(path string) (runID, rest string, ok bool) {
	parts := strings.Split(filepath.ToSlash(path), "/")
	for i := 0; i+2 < len(parts); i++ {
		if parts[i] != ".waveterm" || parts[i+1] != "worktrees" {
			continue
		}
		key := parts[i+2]
		if len(key) < uuidLen || uuid.Validate(key[:uuidLen]) != nil {
			return "", "", false
		}
		if rest = key[uuidLen:]; rest != "" && rest[0] != '-' {
			return "", "", false
		}
		return key[:uuidLen], strings.TrimPrefix(rest, "-"), true
	}
	return "", "", false
}
