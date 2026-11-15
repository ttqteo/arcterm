// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// AgentCpuCommand is one reading of each agent's CPU for Sidecar's strain band.
// TODO(Task 2): fill it from resmon on Windows and from pkg/agentcpu on macOS.
func (ws *WshServer) AgentCpuCommand(ctx context.Context) (*wshrpc.AgentCpuData, error) {
	return &wshrpc.AgentCpuData{Supported: false, Agents: []wshrpc.AgentCpuAgent{}}, nil
}
