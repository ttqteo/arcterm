// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// nothing but this line checks that the wshserver implements every pair command
var _ wshrpc.PairCommands = (*WshServer)(nil)

var errPairsNotBuilt = errors.New("pairs are not built yet")

// The pair commands are stubs until the wavesrv wiring of pkg/agentpair replaces them.

func (ws *WshServer) PairListCommand(ctx context.Context) (*wshrpc.CommandPairListRtnData, error) {
	return nil, errPairsNotBuilt
}

func (ws *WshServer) PairGetCommand(ctx context.Context, data wshrpc.CommandPairGetData) (*wshrpc.PairView, error) {
	return nil, errPairsNotBuilt
}

func (ws *WshServer) PairBriefCommand(ctx context.Context, data wshrpc.CommandPairBriefData) (*wshrpc.CommandPairBriefRtnData, error) {
	return nil, errPairsNotBuilt
}

func (ws *WshServer) PairStartCommand(ctx context.Context, data wshrpc.CommandPairStartData) (*wshrpc.PairView, error) {
	return nil, errPairsNotBuilt
}

func (ws *WshServer) PairSayCommand(ctx context.Context, data wshrpc.CommandPairSayData) error {
	return errPairsNotBuilt
}

func (ws *WshServer) PairRunNowCommand(ctx context.Context, data wshrpc.CommandPairRunNowData) error {
	return errPairsNotBuilt
}

func (ws *WshServer) PairUnpairCommand(ctx context.Context, data wshrpc.CommandPairGetData) error {
	return errPairsNotBuilt
}
