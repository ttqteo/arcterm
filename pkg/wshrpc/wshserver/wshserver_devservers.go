// pkg/wshrpc/wshserver/wshserver_devservers.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/devservers"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func (ws *WshServer) ListDevServersCommand(ctx context.Context, data wshrpc.CommandListDevServersData) (*wshrpc.CommandListDevServersRtnData, error) {
	servers, err := devservers.List(ctx, data.Cwd, data.BlockId)
	if err != nil {
		return nil, err
	}
	if servers == nil {
		servers = []devservers.Server{}
	}
	return &wshrpc.CommandListDevServersRtnData{Servers: servers}, nil
}

func (ws *WshServer) StopDevServerCommand(ctx context.Context, data wshrpc.CommandStopDevServerData) error {
	return devservers.Stop(ctx, data.Pid, data.CreateMs)
}
