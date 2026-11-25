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
	// the judge's half (pkg/chatjudge): a turn that ends in a choice keeps a record of its options and the light pick, and
	// the deep judge reads the code to pick again. Judge blocks until the judge ends; a second call for a key that is
	// reading joins it.
	ChatJudgeCommand(ctx context.Context, data CommandChatJudgeData) (*ChatJudgeRecord, error)
	ChatJudgeStopCommand(ctx context.Context, data CommandChatJudgeStopData) error
	ChatJudgeListCommand(ctx context.Context, data CommandChatJudgeListData) (*CommandChatJudgeListRtnData, error)
}

// CommandChatSuggestData is one turn's ask.
type CommandChatSuggestData struct {
	Reply    string   `json:"reply"`              // the agent's last reply; only its end is sent
	Recent   []string `json:"recent,omitempty"`   // the person's last messages, oldest first: their words and language
	Question bool     `json:"question,omitempty"` // the reply ends in a question: up to 5 answers, else at most 1 next step
	BlockId  string   `json:"blockid,omitempty"`  // the agent's terminal block: whose mod may have worked the replies out
	Hook     bool     `json:"hook,omitempty"`     // a Claude agent, whose arc mod begins the call itself: wait for it a moment
	Key      string   `json:"key,omitempty"`      // Chat's suggestKey for the turn (<agentId>:<len>:<hash>): what a judge record is kept under
	Choice   bool     `json:"choice,omitempty"`   // the reply ends in a question that is not yes-or-no: its options get a judge record
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

// CommandChatSuggestRtnData is the replies; empty when the model saw no clear one. Judge is the turn's record when it
// has one: the light pick and each option's description, and the deep judge's result once it ran.
type CommandChatSuggestRtnData struct {
	Replies []string         `json:"replies"`
	Judge   *ChatJudgeRecord `json:"judge,omitempty"`
}

// the deep judge's states (ChatJudgeDeep.State)
const (
	ChatJudgeState_Reading = "reading"
	ChatJudgeState_Done    = "done"
	ChatJudgeState_Failed  = "failed"
	ChatJudgeState_Stopped = "stopped"
)

// ChatJudgeOption is one chip of a choice: its text (what a click sends) and the model's neutral description of it.
type ChatJudgeOption struct {
	Text string `json:"text"`
	Desc string `json:"desc,omitempty"`
}

// ChatJudgeAdded is the option the deep judge adds when it finds an approach that beats every listed one, with the
// facts it found in the code.
type ChatJudgeAdded struct {
	Label string   `json:"label"`
	Desc  string   `json:"desc"`
	Facts []string `json:"facts,omitempty"`
}

// ChatJudgeDeep is one deep judge run. Pick is an option's text, or Added.Label when the added option is the pick.
type ChatJudgeDeep struct {
	State   string          `json:"state"` // ChatJudgeState_*
	StartTs int64           `json:"startts"`
	EndTs   int64           `json:"endts,omitempty"`
	Pick    string          `json:"pick,omitempty"`
	Reason  string          `json:"reason,omitempty"`
	Added   *ChatJudgeAdded `json:"added,omitempty"`
	Model   string          `json:"model,omitempty"`
	Tokens  int             `json:"tokens,omitempty"` // the run's token total
	Files   int             `json:"files,omitempty"`  // distinct file base names it read
	Error   string          `json:"error,omitempty"`
}

// ChatJudgeRecord is the durable record of one turn that ends in a choice, kept under Chat's suggestKey. Pick and
// Reason are the light judge's (the chips' haiku call, reading the reply only); Deep is the deep judge's, once it ran.
type ChatJudgeRecord struct {
	Key      string            `json:"key"`
	BlockId  string            `json:"blockid,omitempty"`
	Ts       int64             `json:"ts"`
	Question string            `json:"question"`         // the question sentence the reply ends in
	Recent   []string          `json:"recent,omitempty"` // the person's recent messages, as sent
	Options  []ChatJudgeOption `json:"options"`          // in the model's order
	Pick     string            `json:"pick,omitempty"`   // the light pick: an option's text
	Reason   string            `json:"reason,omitempty"`
	Deep     *ChatJudgeDeep    `json:"deep,omitempty"`
}

// CommandChatJudgeData runs the deep judge on the turn Key names, in Cwd (the agent's directory). Retry restarts a failed
// or stopped judge.
type CommandChatJudgeData struct {
	Key   string `json:"key"`
	Cwd   string `json:"cwd"`
	Retry bool   `json:"retry,omitempty"`
}

// CommandChatJudgeStopData cancels the deep judge reading the turn Key names.
type CommandChatJudgeStopData struct {
	Key string `json:"key"`
}

// CommandChatJudgeListData asks for one agent's records (the part of a key before its first ':').
type CommandChatJudgeListData struct {
	AgentId string `json:"agentid"`
}

// CommandChatJudgeListRtnData is an agent's records.
type CommandChatJudgeListRtnData struct {
	Records []ChatJudgeRecord `json:"records"`
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
