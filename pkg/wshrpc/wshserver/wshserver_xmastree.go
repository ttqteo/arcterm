// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/xmastree"
)

func (ws *WshServer) XmasTreeCommand(ctx context.Context) (*wshrpc.XmasTreeData, error) {
	return xmastree.Read(ctx, time.Now())
}
