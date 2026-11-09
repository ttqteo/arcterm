// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// The three commands of the chat view's permission card. The interface is landed first so the frontend can build
// against it; pkg/agentperm's queue replaces these bodies.

func (ws *WshServer) AgentPermissionRaiseCommand(ctx context.Context, data wshrpc.CommandAgentPermissionRaiseData) error {
	return errors.New("not implemented")
}

func (ws *WshServer) AgentPermissionAnswerCommand(ctx context.Context, data wshrpc.CommandAgentPermissionAnswerData) error {
	return errors.New("not implemented")
}

func (ws *WshServer) AgentPermissionPendingCommand(ctx context.Context, oref string) (baseds.AgentPermissionData, error) {
	return baseds.AgentPermissionData{}, errors.New("not implemented")
}
