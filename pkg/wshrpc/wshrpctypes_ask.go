// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

type AskCommands interface {
	// agent ask
	AskCommand(ctx context.Context, data CommandAskData) (AskRtnData, error)
	AnswerAgentCommand(ctx context.Context, data CommandAnswerAgentData) error
	AgentAskClearCommand(ctx context.Context, oref string) error
}

type CommandAskData struct {
	ORef      string                    `json:"oref"`
	Questions []baseds.AgentAskQuestion `json:"questions"`
	// Wait blocks the RPC until the ask is answered (Answers) or cleared/cancelled
	// (Cancelled=true). Fire-and-forget when false (Claude Code hook path).
	Wait bool `json:"wait,omitempty"`
	// Prose marks a projected bare-prose question (pi prose bridge): the answer is typed
	// into the block terminal as text (no native picker to drive with arrow keys).
	Prose bool `json:"prose,omitempty"`
	// Hold marks a held command's card (`wsh memgate`): it is raised from inside the tool call it holds,
	// so the agent's working reports (a parallel call, a subagent) do not retire it.
	Hold bool `json:"hold,omitempty"`
}

type AskRtnData struct {
	AskId     string                   `json:"askid"`
	Answers   []baseds.AgentAnswerItem `json:"answers,omitempty"`
	Cancelled bool                     `json:"cancelled,omitempty"`
}

type CommandAnswerAgentData struct {
	ORef    string                   `json:"oref"`
	Answers []baseds.AgentAnswerItem `json:"answers"`
}
