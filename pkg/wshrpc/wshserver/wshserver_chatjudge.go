// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// the judge's commands (pkg/chatjudge), not wired to it yet: they answer an error until the judge's wiring replaces them
var errChatJudgeNotWired = errors.New("chat judge: not wired yet")

// ChatJudgeCommand runs the deep judge on a turn's choice.
func (ws *WshServer) ChatJudgeCommand(ctx context.Context, data wshrpc.CommandChatJudgeData) (*wshrpc.ChatJudgeRecord, error) {
	return nil, errChatJudgeNotWired
}

// ChatJudgeStopCommand cancels a turn's deep judge.
func (ws *WshServer) ChatJudgeStopCommand(ctx context.Context, data wshrpc.CommandChatJudgeStopData) error {
	return errChatJudgeNotWired
}

// ChatJudgeListCommand lists one agent's judge records.
func (ws *WshServer) ChatJudgeListCommand(ctx context.Context, data wshrpc.CommandChatJudgeListData) (*wshrpc.CommandChatJudgeListRtnData, error) {
	return nil, errChatJudgeNotWired
}
