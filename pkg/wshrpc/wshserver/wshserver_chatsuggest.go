// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/chatsuggest"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// one Suggester for wavesrv's life, so a turn's answer is kept and a second ask for it joins the call in flight
var chatSuggester = sync.OnceValue(func() *chatsuggest.Suggester { return chatsuggest.New(nil) })

// ChatSuggestCommand answers the replies Chat offers as chips once an agent's turn ends (pkg/chatsuggest).
func (ws *WshServer) ChatSuggestCommand(ctx context.Context, data wshrpc.CommandChatSuggestData) (*wshrpc.CommandChatSuggestRtnData, error) {
	replies, err := chatSuggester().Suggest(ctx, chatsuggest.Request{Reply: data.Reply, Recent: data.Recent, Question: data.Question})
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandChatSuggestRtnData{Replies: replies}, nil
}
