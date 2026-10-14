// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/ideastore"
)

// IdeaCommands are a brainstorm's ideas, decisions and open questions, one list per agent session: an agent
// adds one with `wsh idea add`, the cockpit lists, edits, merges and drops them. Every command names its
// session by id or by the terminal block that runs it.
type IdeaCommands interface {
	IdeaAddCommand(ctx context.Context, data CommandIdeaAddData) (*ideastore.Idea, error)
	IdeaListCommand(ctx context.Context, data CommandIdeaTargetData) (*ideastore.SessionIdeas, error)
	IdeaUpdateCommand(ctx context.Context, data CommandIdeaUpdateData) error
	IdeaTickCommand(ctx context.Context, data CommandIdeaTargetData) (*CommandIdeaTickRtnData, error)
}

// CommandIdeaTargetData names the session: a session id wins, else the block resolves through its transcript path.
type CommandIdeaTargetData struct {
	BlockId   string `json:"blockid,omitempty"`
	SessionId string `json:"sessionid,omitempty"`
}

type CommandIdeaAddData struct {
	CommandIdeaTargetData
	Text  string `json:"text"`
	Kind  string `json:"kind"`
	By    string `json:"by"`
	Topic string `json:"topic,omitempty"`
}

// CommandIdeaUpdateData is one ideastore.Op on a session; Op is one of the ideastore.Op* values.
type CommandIdeaUpdateData struct {
	CommandIdeaTargetData
	Op      string   `json:"op"`
	Ids     []string `json:"ids,omitempty"`
	Text    string   `json:"text,omitempty"`
	NewKind string   `json:"newkind,omitempty"`
	Topic   string   `json:"topic,omitempty"`
}

// CommandIdeaTickRtnData is empty unless the session is due a nudge to record its ideas.
type CommandIdeaTickRtnData struct {
	Nudge string `json:"nudge,omitempty"`
}

// IdeasChangedData is the data of the ideas:changed event: the session whose ideas changed.
type IdeasChangedData struct {
	SessionId string `json:"sessionid"`
}
