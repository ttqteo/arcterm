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

// turnCommitted reports whether the current turn ended on a git commit: a Bash git commit (not a dry run) whose result
// was not an error, with no file edit after it. The turn starts at the last user record that carries human prose, as
// lastAssistantTurn reads it. The cockpit offers to close an agent whose last turn committed (donesuggest.ts).
func turnCommitted(lines []string) bool {
	committed := false
	commitID := ""
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
				committed, commitID = false, ""
			}
			for _, b := range blocks {
				if b.Type == "tool_result" && b.IsError && b.ToolUseID != "" && b.ToolUseID == commitID {
					committed = false
				}
			}
		case "assistant":
			for _, b := range blocks {
				if b.Type != "tool_use" {
					continue
				}
				if b.Name == "Bash" && turnCommitRe.MatchString(b.Input.Command) && !strings.Contains(b.Input.Command, "--dry-run") {
					committed, commitID = true, b.ID
				} else if fileEditTools[b.Name] {
					committed = false
				}
			}
		}
	}
	return committed
}

// readTurnCommitted reads turnCommitted from the transcript's tail.
func readTurnCommitted(path string) bool {
	return turnCommitted(tailLines(path))
}
