// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"path/filepath"
	"sync"

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

// ChatSuggestCommand answers the replies Chat offers as chips once an agent's turn ends (pkg/chatsuggest), with the
// person's habits for the model to offer one word for word.
func (ws *WshServer) ChatSuggestCommand(ctx context.Context, data wshrpc.CommandChatSuggestData) (*wshrpc.CommandChatSuggestRtnData, error) {
	habits := chatHabits().Habits()
	texts := make([]string, 0, len(habits))
	for _, h := range habits {
		texts = append(texts, h.Text)
	}
	replies, err := chatSuggester().Suggest(ctx, chatsuggest.Request{
		Reply:    data.Reply,
		Recent:   data.Recent,
		Question: data.Question,
		Habits:   texts,
	})
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandChatSuggestRtnData{Replies: replies}, nil
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
