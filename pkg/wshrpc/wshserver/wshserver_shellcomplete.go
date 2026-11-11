// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"os"

	"github.com/wavetermdev/waveterm/pkg/shellcomplete"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// bashHistoryLimit is how many distinct `!` commands Claude Code's own ghost text looks through.
const bashHistoryLimit = 50

// BashHistoryCommand is the folder's newest `!` commands out of Claude Code's history, newest first. No history is
// an empty list, never null.
func (ws *WshServer) BashHistoryCommand(ctx context.Context, data wshrpc.CommandBashHistoryData) ([]string, error) {
	if data.Cwd == "" {
		return nil, errors.New("cwd is required")
	}
	path, err := shellcomplete.HistoryPath()
	if err != nil {
		return nil, fmt.Errorf("finding Claude Code's history: %w", err)
	}
	cmds, err := shellcomplete.BashHistory(path, data.Cwd, bashHistoryLimit)
	if err != nil {
		return nil, err
	}
	if cmds == nil {
		cmds = []string{}
	}
	return cmds, nil
}

// ShellCompleteCommand is the shell's completions of one word in the agent's folder. No match is an empty list,
// never null.
func (ws *WshServer) ShellCompleteCommand(ctx context.Context, data wshrpc.CommandShellCompleteData) ([]string, error) {
	if data.Cwd == "" {
		return nil, errors.New("cwd is required")
	}
	if info, err := os.Stat(data.Cwd); err != nil || !info.IsDir() {
		return nil, fmt.Errorf("cwd %q is not a folder", data.Cwd)
	}
	items, err := shellcomplete.Complete(ctx, data.Cwd, shellcomplete.Kind(data.Kind), data.Word)
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []string{}
	}
	return items, nil
}
