// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/chatsuggest"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// one Suggester for wavesrv's life, so a turn's answer is kept and a second ask for it joins the call in flight
var chatSuggester = sync.OnceValue(func() *chatsuggest.Suggester { return chatsuggest.New(nil) })

// the person's habits over their Claude Code transcripts, with how far each was read and what they took out kept in the
// data dir, so a restart reads only what the transcripts gained
var chatHabits = sync.OnceValue(func() *chatsuggest.HabitIndex {
	data := wavebase.GetWaveDataDir()
	return chatsuggest.NewHabitIndex(
		filepath.Join(wavebase.GetHomeDir(), ".claude", "projects"),
		filepath.Join(data, "chatsuggest-habits.json"),
		filepath.Join(data, "chatsuggest-hidden.json"),
		nil,
	)
})

// the turns Claude agents' arc mods work out themselves, for wavesrv's life
var chatHooks = sync.OnceValue(chatsuggest.NewHooks)

// chatHabitTexts is the habits' texts the model is given, most used first.
func chatHabitTexts() []string {
	habits := chatHabits().Habits()
	texts := make([]string, 0, len(habits))
	for _, h := range habits {
		texts = append(texts, h.Text)
	}
	return texts
}

// ChatSuggestCommand answers the replies Chat offers as chips once an agent's turn ends (pkg/chatsuggest), with the
// person's habits for the model to offer one word for word. A Claude agent's arc mod works them out itself at the turn's
// end: its answer is taken when it comes in time, and the headless call runs only when it does not.
func (ws *WshServer) ChatSuggestCommand(ctx context.Context, data wshrpc.CommandChatSuggestData) (*wshrpc.CommandChatSuggestRtnData, error) {
	start := time.Now()
	if replies, ok := chatHooks().Await(ctx, data.BlockId, data.Reply, data.Question, data.Hook); ok {
		log.Print(chatSuggestLogLine(data.BlockId, "mod", time.Since(start), len(replies), nil))
		return &wshrpc.CommandChatSuggestRtnData{Replies: replies}, nil
	}
	replies, err := chatSuggester().Suggest(ctx, chatsuggest.Request{
		Reply:    data.Reply,
		Recent:   data.Recent,
		Question: data.Question,
		Habits:   chatHabitTexts(),
	})
	log.Print(chatSuggestLogLine(data.BlockId, "headless", time.Since(start), len(replies), err))
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandChatSuggestRtnData{Replies: replies}, nil
}

// chatSuggestLogLine is the one line each answer leaves in waveapp.log: which way it came (the arc mod's own, or the
// headless call), how long it took and how many chips it made, with the error when the headless call failed. It is
// what a "no chips" report can be read against.
func chatSuggestLogLine(blockID, via string, took time.Duration, chips int, err error) string {
	if len(blockID) > 8 {
		blockID = blockID[:8]
	}
	line := fmt.Sprintf("chatsuggest: block=%s via=%s %dms chips=%d", blockID, via, took.Milliseconds(), chips)
	if err != nil {
		line += " err=" + err.Error()
	}
	return line
}

// ChatSuggestHookBeginCommand begins a Claude agent's turn for its arc mod: the completion it runs in its own claude.
func (ws *WshServer) ChatSuggestHookBeginCommand(ctx context.Context, data wshrpc.CommandChatSuggestHookBeginData) (*wshrpc.CommandChatSuggestHookBeginRtnData, error) {
	if data.BlockId == "" {
		return nil, fmt.Errorf("chatsuggest hook begin needs a block")
	}
	if strings.TrimSpace(data.Reply) == "" {
		return nil, fmt.Errorf("chatsuggest hook begin needs the turn's reply")
	}
	call := chatHooks().Begin(data.BlockId, chatsuggest.Request{
		Reply:  data.Reply,
		Recent: data.Recent,
		Habits: chatHabitTexts(),
	})
	return &wshrpc.CommandChatSuggestHookBeginRtnData{Key: call.Key, System: call.System, Prompt: call.Prompt}, nil
}

// ChatSuggestHookEndCommand ends the turn the mod began with the model's answer, or with none.
func (ws *WshServer) ChatSuggestHookEndCommand(ctx context.Context, data wshrpc.CommandChatSuggestHookEndData) error {
	chatHooks().End(data.BlockId, data.Key, data.Text, data.Failed)
	return nil
}

// ChatHabitsCommand lists the habits the model is given, for Setup → Learned.
func (ws *WshServer) ChatHabitsCommand(ctx context.Context) (*wshrpc.CommandChatHabitsRtnData, error) {
	habits := chatHabits().Habits()
	out := make([]wshrpc.ChatHabit, 0, len(habits))
	for _, h := range habits {
		out = append(out, wshrpc.ChatHabit{Text: h.Text, Key: h.Key, Uses: h.Uses})
	}
	return &wshrpc.CommandChatHabitsRtnData{Habits: out}, nil
}

// ChatHabitHideCommand takes one habit out for good: the model is not given it and Setup no longer lists it.
func (ws *WshServer) ChatHabitHideCommand(ctx context.Context, data wshrpc.CommandChatHabitHideData) error {
	return chatHabits().Hide(data.Key)
}
