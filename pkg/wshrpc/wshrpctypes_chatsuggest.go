// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// ChatSuggestCommands is the model half of Chat's suggested replies (pkg/chatsuggest): one no-tools haiku call reads
// the end of an agent's last reply and names the replies the person would likely send next, and the messages the person
// sends often (their habits), which the call is given and Setup → Learned lists.
type ChatSuggestCommands interface {
	ChatSuggestCommand(ctx context.Context, data CommandChatSuggestData) (*CommandChatSuggestRtnData, error)
	ChatHabitsCommand(ctx context.Context) (*CommandChatHabitsRtnData, error)
	ChatHabitHideCommand(ctx context.Context, data CommandChatHabitHideData) error
	// the arc mod's half (pkg/chatsuggest Hooks): at a Claude agent's turn end the mod begins the call, runs it in its own
	// claude, and ends it with the model's answer, which ChatSuggestCommand then takes instead of starting a claude
	ChatSuggestHookBeginCommand(ctx context.Context, data CommandChatSuggestHookBeginData) (*CommandChatSuggestHookBeginRtnData, error)
	ChatSuggestHookEndCommand(ctx context.Context, data CommandChatSuggestHookEndData) error
}

// CommandChatSuggestData is one turn's ask.
type CommandChatSuggestData struct {
	Reply    string   `json:"reply"`              // the agent's last reply; only its end is sent
	Recent   []string `json:"recent,omitempty"`   // the person's last messages, oldest first: their words and language
	Question bool     `json:"question,omitempty"` // the reply ends in a question: up to 5 answers, else at most 1 next step
	BlockId  string   `json:"blockid,omitempty"`  // the agent's terminal block: whose mod may have worked the replies out
	Hook     bool     `json:"hook,omitempty"`     // a Claude agent, whose arc mod begins the call itself: wait for it a moment
}

// CommandChatSuggestHookBeginData is the turn the arc mod begins: the agent's block, its final answer and the person's
// last messages.
type CommandChatSuggestHookBeginData struct {
	BlockId string   `json:"blockid"`
	Reply   string   `json:"reply"`
	Recent  []string `json:"recent,omitempty"`
}

// CommandChatSuggestHookBeginRtnData is the completion the mod runs, and the key it ends the turn with.
type CommandChatSuggestHookBeginRtnData struct {
	Key    string `json:"key"`
	System string `json:"system"`
	Prompt string `json:"prompt"`
}

// CommandChatSuggestHookEndData is the model's answer to the turn `Key` names, or Failed when the mod got none.
type CommandChatSuggestHookEndData struct {
	BlockId string `json:"blockid"`
	Key     string `json:"key"`
	Text    string `json:"text,omitempty"`
	Failed  bool   `json:"failed,omitempty"`
}

// CommandChatSuggestRtnData is the replies, best first; empty when the model saw no clear one.
type CommandChatSuggestRtnData struct {
	Replies []string `json:"replies"`
}

// ChatHabit is one message the person sends often: its usual spelling, the key its spellings share (what Hide takes),
// and how often it was sent in the last 30 days.
type ChatHabit struct {
	Text string `json:"text"`
	Key  string `json:"key"`
	Uses int    `json:"uses"`
}

// CommandChatHabitsRtnData is the habits the model is given, most used first.
type CommandChatHabitsRtnData struct {
	Habits []ChatHabit `json:"habits"`
}

// CommandChatHabitHideData takes one habit out for good, by its key.
type CommandChatHabitHideData struct {
	Key string `json:"key"`
}
