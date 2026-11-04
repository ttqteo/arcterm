// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"regexp"
	"strings"
)

// a git commit, with any -C/-c options before the subcommand: "git commit -m …", "git -C ../repo commit"
var turnCommitRe = regexp.MustCompile(`(?:^|[\s;&|(])git\s+(?:-[Cc]\s+\S+\s+)*commit\b`)

// tools that change files: one after the commit leaves work the commit does not hold
var fileEditTools = map[string]bool{"Edit": true, "Write": true, "MultiEdit": true, "NotebookEdit": true}

// turnGit is what the current turn left in git, as its tool calls tell it.
type turnGit struct {
	// it ended on a git commit: a Bash git commit (not a dry run) whose result was not an error, with no file edit after
	// it. The cockpit offers to close an agent whose last turn committed (donesuggest.ts).
	Committed bool
	// it changed files that no commit after them took: a file edit with no good commit later in the turn. The cockpit
	// offers to ship it (shipmodel.ts).
	Edited bool
}

// turnOutcome reads turnGit from the current turn, which starts at the last user record that carries human prose, as
// lastAssistantTurn reads it.
func turnOutcome(lines []string) turnGit {
	var out turnGit
	commitID := ""
	// Edited as it stood before the commit in flight, for a commit that fails
	editedBefore := false
	for _, ln := range lines {
		ln = strings.TrimSpace(ln)
		if ln == "" {
			continue
		}
		var rec struct {
			Type    string `json:"type"`
			Message struct {
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal([]byte(ln), &rec) != nil {
			continue
		}
		var blocks []struct {
			Type      string `json:"type"`
			ID        string `json:"id"`
			Name      string `json:"name"`
			ToolUseID string `json:"tool_use_id"`
			IsError   bool   `json:"is_error"`
			Input     struct {
				Command string `json:"command"`
			} `json:"input"`
		}
		_ = json.Unmarshal(rec.Message.Content, &blocks)
		switch rec.Type {
		case "user":
			if userText(rec.Message.Content) != "" {
				out, commitID, editedBefore = turnGit{}, "", false
			}
			for _, b := range blocks {
				if b.Type == "tool_result" && b.IsError && b.ToolUseID != "" && b.ToolUseID == commitID {
					out.Committed, out.Edited = false, editedBefore
				}
			}
		case "assistant":
			for _, b := range blocks {
				if b.Type != "tool_use" {
					continue
				}
				if b.Name == "Bash" && turnCommitRe.MatchString(b.Input.Command) && !strings.Contains(b.Input.Command, "--dry-run") {
					editedBefore = out.Edited
					out.Committed, out.Edited, commitID = true, false, b.ID
				} else if fileEditTools[b.Name] {
					out.Committed, out.Edited = false, true
				}
			}
		}
	}
	return out
}

// the furthest back readTurnOutcome reads for the turn's prompt
const turnTailMaxBytes = 16 * 1024 * 1024

// readTurnOutcome reads turnOutcome from the transcript's tail, read back far enough to hold the turn's prompt: the
// window doubles from transcriptTailBytes until it does, up to turnTailMaxBytes. A turn's tool output easily outgrows
// 64 KB, and a commit before the window read as no commit (an agent that committed, then checked the commit with a few
// long git commands, never offered Close).
func readTurnOutcome(path string) turnGit {
	for n := int64(transcriptTailBytes); ; n *= 2 {
		lines, whole := tailLinesN(path, n)
		if whole || n >= turnTailMaxBytes || hasTurnStart(lines) {
			return turnOutcome(lines)
		}
	}
}

// hasTurnStart reports whether lines hold a user record that carries human prose, where turnOutcome starts a turn.
func hasTurnStart(lines []string) bool {
	for _, ln := range lines {
		var rec struct {
			Type    string `json:"type"`
			Message struct {
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal([]byte(strings.TrimSpace(ln)), &rec) == nil && rec.Type == "user" &&
			userText(rec.Message.Content) != "" {
			return true
		}
	}
	return false
}
