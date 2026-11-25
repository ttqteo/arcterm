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

	"github.com/wavetermdev/waveterm/pkg/chatjudge"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// the record kept for each turn that ends in a choice, in the data dir for wavesrv's life: a restart keeps them. A file
// that cannot be read is logged and the store starts empty, so a broken file does not stop the chips.
var chatJudgeStore = sync.OnceValue(func() *chatjudge.Store {
	store, err := chatjudge.OpenStore(filepath.Join(wavebase.GetWaveDataDir(), "chatjudge.json"))
	if err != nil {
		log.Printf("chatjudge: %v\n", err)
	}
	return store
})

// the deep judges, at most one per turn. They do not go through `wsh tokengate`: each is the person's own press.
var chatJudges = sync.OnceValue(func() *chatjudge.Judges {
	return chatjudge.NewJudges(chatJudgeStore(), chatjudge.RunSonnet, chatjudge.Timeout)
})

// ChatJudgeCommand runs the deep judge on a turn's choice and answers the record once it ends. A judge that fails or times
// out is not an error: the record's deep result says failed, and why.
func (ws *WshServer) ChatJudgeCommand(ctx context.Context, data wshrpc.CommandChatJudgeData) (*wshrpc.ChatJudgeRecord, error) {
	if data.Key == "" {
		return nil, fmt.Errorf("chat judge needs the turn's key")
	}
	if strings.TrimSpace(data.Cwd) == "" {
		return nil, fmt.Errorf("chat judge needs the agent's working directory")
	}
	rec, err := chatJudges().Judge(ctx, data.Key, data.Cwd, data.Retry)
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

// ChatJudgeStopCommand cancels a turn's deep judge.
func (ws *WshServer) ChatJudgeStopCommand(ctx context.Context, data wshrpc.CommandChatJudgeStopData) error {
	return chatJudges().Stop(data.Key)
}

// ChatJudgeListCommand lists one agent's judge records, oldest first.
func (ws *WshServer) ChatJudgeListCommand(ctx context.Context, data wshrpc.CommandChatJudgeListData) (*wshrpc.CommandChatJudgeListRtnData, error) {
	return &wshrpc.CommandChatJudgeListRtnData{Records: chatJudgeStore().List(data.AgentId)}, nil
}
