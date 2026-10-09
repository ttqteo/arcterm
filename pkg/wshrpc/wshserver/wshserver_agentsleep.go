// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// Stubs: the agent-sleep commands answer "not implemented" until the sleep logic lands.

func (ws *WshServer) AgentsSleepCommand(ctx context.Context, data wshrpc.CommandAgentsSleepData) (*wshrpc.CommandAgentsSleepRtnData, error) {
	return nil, fmt.Errorf("not implemented")
}

func (ws *WshServer) AgentsWakeCommand(ctx context.Context, data wshrpc.CommandAgentsWakeData) error {
	return fmt.Errorf("not implemented")
}

func (ws *WshServer) AgentsSetViewingCommand(ctx context.Context, data wshrpc.CommandAgentsSetViewingData) error {
	return fmt.Errorf("not implemented")
}
