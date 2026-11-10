// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"os"

	"github.com/wavetermdev/waveterm/pkg/claudecmds"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func (ws *WshServer) ListClaudeCommandsCommand(ctx context.Context, data wshrpc.CommandListClaudeCommandsData) ([]wshrpc.ClaudeCommandInfo, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("finding the home folder: %w", err)
	}
	list, err := claudecmds.List(home, data.Cwd)
	if err != nil {
		return nil, err
	}
	out := make([]wshrpc.ClaudeCommandInfo, len(list))
	for i, c := range list {
		out[i] = wshrpc.ClaudeCommandInfo{Name: c.Name, Description: c.Description, Source: c.Source}
	}
	return out, nil
}

func (ws *WshServer) SetClaudeLiveCommandsCommand(ctx context.Context, data wshrpc.CommandSetClaudeLiveCommandsData) error {
	list := make([]claudecmds.LiveCommand, len(data.Commands))
	for i, c := range data.Commands {
		list[i] = claudecmds.LiveCommand{Name: c.Name, Description: c.Description, Source: c.Source, Plugin: c.Plugin}
	}
	return claudecmds.SetLive(data.BlockId, list)
}

func (ws *WshServer) GetClaudeLiveCommandsCommand(ctx context.Context, data wshrpc.CommandGetClaudeLiveCommandsData) ([]wshrpc.ClaudeCommandInfo, error) {
	list, ok := claudecmds.Live(data.BlockId)
	if !ok {
		return nil, nil
	}
	out := make([]wshrpc.ClaudeCommandInfo, len(list))
	for i, c := range list {
		out[i] = wshrpc.ClaudeCommandInfo{Name: c.Name, Description: c.Description, Source: c.Source, Plugin: c.Plugin}
	}
	return out, nil
}
