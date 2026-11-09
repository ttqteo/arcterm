// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import (
	"context"
	"encoding/json"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

// AgentPermCommands is the wire of the chat view's permission card (pkg/agentperm holds the queue).
type AgentPermCommands interface {
	// AgentPermissionRaiseCommand queues one permission prompt Claude Code is showing: `wsh agent-hook` sends it
	// from the PermissionRequest hook.
	AgentPermissionRaiseCommand(ctx context.Context, data CommandAgentPermissionRaiseData) error
	// AgentPermissionAnswerCommand answers the head of the queue, Allow (types `1`) or Deny (types Esc). It
	// refuses a request that is not the head, or not answerable, with agentperm.ErrNotPending.
	AgentPermissionAnswerCommand(ctx context.Context, data CommandAgentPermissionAnswerData) error
	// AgentPermissionPendingCommand is the current queue of a block, for a pane that mounts after a reload.
	AgentPermissionPendingCommand(ctx context.Context, oref string) (baseds.AgentPermissionData, error)
}

type CommandAgentPermissionRaiseData struct {
	ORef      string          `json:"oref"`
	ToolName  string          `json:"toolname"`
	ToolInput json.RawMessage `json:"toolinput"`
}

type CommandAgentPermissionAnswerData struct {
	ORef  string `json:"oref"`
	Id    string `json:"id"`
	Allow bool   `json:"allow"`
}
