// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/remotemode"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func (ws *WshServer) RemoteStatusCommand(ctx context.Context) (*wshrpc.RemoteStatusData, error) {
	return remotemode.Status(), nil
}

func (ws *WshServer) RemoteSetupCommand(ctx context.Context, data wshrpc.CommandRemoteSetupData) (*wshrpc.RemoteStatusData, error) {
	return remotemode.Setup(data)
}

func (ws *WshServer) RemoteOnCommand(ctx context.Context) (*wshrpc.RemoteStatusData, error) {
	return remotemode.On()
}

func (ws *WshServer) RemoteOffCommand(ctx context.Context) (*wshrpc.RemoteStatusData, error) {
	return remotemode.Off()
}

func (ws *WshServer) RemoteHandCommand(ctx context.Context, data wshrpc.CommandRemoteHandData) (*wshrpc.RemoteStatusData, error) {
	return remotemode.Hand(ctx, data)
}

func (ws *WshServer) RemoteTakeBackCommand(ctx context.Context, data wshrpc.CommandRemoteHandData) (*wshrpc.RemoteStatusData, error) {
	return remotemode.TakeBack(ctx, data)
}
