// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// ShellCompleteCommands is the wire of Chat's bash mode (pkg/shellcomplete).
type ShellCompleteCommands interface {
	// BashHistoryCommand is the newest 50 distinct `!` commands Claude Code's history holds for the folder, newest
	// first, without the `!`. A missing history is an empty list.
	BashHistoryCommand(ctx context.Context, data CommandBashHistoryData) ([]string, error)
	// ShellCompleteCommand is the shell's completions of one word in the folder: kind "command", "variable" (the word
	// without its `$`) or "file" (a folder ends in `/`). At most 50, sorted.
	ShellCompleteCommand(ctx context.Context, data CommandShellCompleteData) ([]string, error)
}

type CommandBashHistoryData struct {
	Cwd string `json:"cwd"`
}

type CommandShellCompleteData struct {
	Cwd  string `json:"cwd"`
	Kind string `json:"kind"`
	Word string `json:"word"`
}
