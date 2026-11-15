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
	// ShellRunCommand runs one `!` command typed to a sleeping agent in its folder, without waking it: the person's
	// login shell, no terminal, stopped with its process tree after TimeoutMs (default and cap 2 minutes). A command
	// that ran and failed is a result with its exit code, not an error.
	ShellRunCommand(ctx context.Context, data CommandShellRunData) (*ShellRunResult, error)
}

type CommandBashHistoryData struct {
	Cwd string `json:"cwd"`
}

type CommandShellCompleteData struct {
	Cwd  string `json:"cwd"`
	Kind string `json:"kind"`
	Word string `json:"word"`
}

type CommandShellRunData struct {
	Cwd       string `json:"cwd"`
	Command   string `json:"command"`
	TimeoutMs int    `json:"timeoutms,omitempty"`
}

// ShellRunResult is what the command printed, each stream cut to its last 30000 bytes (truncated says one was), and
// how it ended: exitcode -1 with timedout when it was stopped at the timeout.
type ShellRunResult struct {
	Stdout    string `json:"stdout"`
	Stderr    string `json:"stderr"`
	ExitCode  int    `json:"exitcode"`
	TimedOut  bool   `json:"timedout,omitempty"`
	Truncated bool   `json:"truncated,omitempty"`
	DurMs     int64  `json:"durms"`
}
