// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// DUM-E's last status, written by its loop (dumeTick) and read by the command and the event.
var (
	dumeMu     sync.Mutex
	dumeStatus wshrpc.DumeStatusData
)

func dumeEnabled() bool {
	v := wconfig.GetWatcher().GetFullConfig().Settings.DumeEnabled
	return v != nil && *v
}

func (ws *WshServer) DumeStatusCommand(ctx context.Context) (*wshrpc.DumeStatusData, error) {
	dumeMu.Lock()
	s := dumeStatus
	dumeMu.Unlock()
	s.Enabled = dumeEnabled() // live: the setting may have moved since the last tick
	return &s, nil
}
