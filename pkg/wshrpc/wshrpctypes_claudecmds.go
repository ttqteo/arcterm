// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// ClaudeCmdsCommands is the wire of the chat view's `/` menu (pkg/claudecmds reads the files).
type ClaudeCmdsCommands interface {
	// ListClaudeCommandsCommand lists the skills and slash commands Claude Code offers in a folder: the project's,
	// the user's and the enabled plugins'. It never fails for a missing or malformed file.
	ListClaudeCommandsCommand(ctx context.Context, data CommandListClaudeCommandsData) ([]ClaudeCommandInfo, error)
}

type CommandListClaudeCommandsData struct {
	Cwd string `json:"cwd"`
}

// ClaudeCommandInfo is one entry of the menu: Name has no leading slash (a plugin's is `<plugin>:<name>`), Source is
// "skill" or "command".
type ClaudeCommandInfo struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Source      string `json:"source"`
}
