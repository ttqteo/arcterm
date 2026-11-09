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
	// AgentPermissionAnswerCommand answers the head of the queue, Allow (types `1`, or `2` with Choice 2: the
	// prompt's second option, "Yes, and don't ask again") or Deny (types Esc). It
	// refuses a request that is not the head with agentperm.ErrNotPending, and an Allow on a head the chat cannot
	// answer (its choices are not known: ExitPlanMode's plan menu, an MCP tool's) with its own error, "this prompt
	// is answered in the terminal"; Deny on that head still types Esc.
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
	// Choice picks which option an Allow types: 0 or 1 the first (`1`), 2 the second (`2`). Any other value is an
	// error; a Deny ignores it.
	Choice int `json:"choice,omitempty"`
}
