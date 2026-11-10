// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// ClaudeCmdsCommands is the wire of the chat view's `/` menu (pkg/claudecmds reads the files).
type ClaudeCmdsCommands interface {
	// ListClaudeCommandsCommand lists the skills and slash commands Claude Code offers in a folder: the project's,
	// the user's and the enabled plugins'. It never fails for a missing or malformed file.
	ListClaudeCommandsCommand(ctx context.Context, data CommandListClaudeCommandsData) ([]ClaudeCommandInfo, error)
	// SetClaudeLiveCommandsCommand keeps the list a running Claude session offers (the arc mod publishes it through
	// `wsh claudecmds set`) as the newest for the agent's block, replacing the one before. It lives in wavesrv's
	// memory only and is refused for an empty block id or a list over 2,000 entries.
	SetClaudeLiveCommandsCommand(ctx context.Context, data CommandSetClaudeLiveCommandsData) error
	// GetClaudeLiveCommandsCommand is the newest live list of a block, or nil when the block has none (an agent that
	// started before the mod published, a sleeping agent, wavesrv just restarted): the chat view then falls back to
	// ListClaudeCommandsCommand.
	GetClaudeLiveCommandsCommand(ctx context.Context, data CommandGetClaudeLiveCommandsData) ([]ClaudeCommandInfo, error)
}

type CommandListClaudeCommandsData struct {
	Cwd string `json:"cwd"`
}

type CommandSetClaudeLiveCommandsData struct {
	BlockId  string              `json:"blockid"`
	Commands []ClaudeCommandInfo `json:"commands"`
}

type CommandGetClaudeLiveCommandsData struct {
	BlockId string `json:"blockid"`
}

// ClaudeCommandInfo is one entry of the menu: Name has no leading slash (a plugin's is `<plugin>:<name>`). From the
// disk (ListClaudeCommandsCommand) Source is "skill" or "command"; from a live list (the Get/Set commands above) it
// is Claude Code's own, "builtin", "plugin", "user" or "mcp", and Plugin names the plugin of a "plugin" entry.
type ClaudeCommandInfo struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Source      string `json:"source"`
	Plugin      string `json:"plugin,omitempty"`
}
