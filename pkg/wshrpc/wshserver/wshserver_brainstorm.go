// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// The brainstorm commands are declared (so the frontend types and clients exist) before the server behind them is
// ported: each stub refuses by naming itself, and the builder check and the judge replace them.

func (ws *WshServer) BrainstormCheckCommand(ctx context.Context, data wshrpc.CommandBrainstormCheckData) error {
	return fmt.Errorf("BrainstormCheckCommand is not wired yet")
}

func (ws *WshServer) BrainstormJudgeCommand(ctx context.Context, data wshrpc.CommandBrainstormJudgeData) error {
	return fmt.Errorf("BrainstormJudgeCommand is not wired yet")
}

func (ws *WshServer) BrainstormJudgeStopCommand(ctx context.Context, data wshrpc.CommandBrainstormJudgeStopData) error {
	return fmt.Errorf("BrainstormJudgeStopCommand is not wired yet")
}

func (ws *WshServer) BrainstormCheckTimesCommand(ctx context.Context) (*wshrpc.BrainstormCheckTimes, error) {
	return nil, fmt.Errorf("BrainstormCheckTimesCommand is not wired yet")
}
