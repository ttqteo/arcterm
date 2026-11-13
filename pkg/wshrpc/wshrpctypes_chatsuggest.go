// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// ChatSuggestCommands is the model half of Chat's suggested replies (pkg/chatsuggest): one no-tools haiku call reads
// the end of an agent's last reply and names the replies the person would likely send next.
type ChatSuggestCommands interface {
	ChatSuggestCommand(ctx context.Context, data CommandChatSuggestData) (*CommandChatSuggestRtnData, error)
}

// CommandChatSuggestData is one turn's ask.
type CommandChatSuggestData struct {
	Reply    string   `json:"reply"`              // the agent's last reply; only its end is sent
	Recent   []string `json:"recent,omitempty"`   // the person's last messages, oldest first: their words and language
	Question bool     `json:"question,omitempty"` // the reply ends in a question: up to 3 answers, else at most 1 next step
}

// CommandChatSuggestRtnData is the replies, best first; empty when the model saw no clear one.
type CommandChatSuggestRtnData struct {
	Replies []string `json:"replies"`
}
