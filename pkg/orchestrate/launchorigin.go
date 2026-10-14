// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"os"
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
	landResolverOpener = "You are the land resolver for run "
)

var stageOpeners = map[string]string{
	jarvis.UsageRole_PlanReviewer: planReviewerOpener,
	jarvis.UsageRole_Verifier:     verifierOpener,
	jarvis.UsageRole_LandResolver: landResolverOpener,
}

// LaunchOrigin is the run a session's own transcript says launched it.
type LaunchOrigin struct {
	RunID  string
	TaskID string // the task whose tree it ran in; a lane's tasks share their first task's tree, which this names
	Role   string // jarvis.UsageRole_PlanReviewer, _Verifier or _LandResolver for a stage session, else ""
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
// run id: a task id (TaskWorktreeKey), finalTreeKey, or "" for the run's own tree. worktreeDir builds the path: under
// the short root (worktreeroot.go) or, for a run started before it, the project's .waveterm/worktrees.
func runOfWorktree(path string) (runID, rest string, ok bool) {
	if runID, rest, ok := runOfShortTree(path); ok {
		return runID, rest, true
	}
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

// runOfShortTree reads back a tree under the short root: <root>/<first 8 of the run id><suffix>, named back to its run
// by the prefix's marker, or <root>/<run id><suffix> when the prefix was another run's.
func runOfShortTree(path string) (runID, rest string, ok bool) {
	root := worktreeRoot()
	if root == "" || path == "" {
		return "", "", false
	}
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		return "", "", false
	}
	tree := strings.Split(filepath.ToSlash(rel), "/")[0]
	if runID, suffix, ok := splitRunKey(tree); ok {
		return runID, strings.TrimPrefix(suffix, "-"), true
	}
	if len(tree) < runPrefixLen {
		return "", "", false
	}
	prefix, suffix := tree[:runPrefixLen], tree[runPrefixLen:]
	if suffix != "" && suffix[0] != '-' {
		return "", "", false
	}
	runMarkerMu.RLock()
	owner, err := os.ReadFile(runMarkerPath(root, prefix))
	runMarkerMu.RUnlock()
	if err != nil {
		return "", "", false
	}
	runID = string(owner)
	if len(runID) != uuidLen || uuid.Validate(runID) != nil || !strings.HasPrefix(runID, prefix) {
		return "", "", false
	}
	return runID, strings.TrimPrefix(suffix, "-"), true
}
