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
