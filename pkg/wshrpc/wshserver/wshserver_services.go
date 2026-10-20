// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var errServicesNotRunning = errors.New("services are not running yet")

// The services commands are stubs until the supervisor is wired in (pkg/services).

func (ws *WshServer) ServicesStatusCommand(ctx context.Context) (*wshrpc.ServicesData, error) {
	return &wshrpc.ServicesData{Services: []wshrpc.ServiceStatus{}}, nil
}

func (ws *WshServer) ServiceOpenCommand(ctx context.Context, data wshrpc.CommandServiceData) (*wshrpc.ServiceStatus, error) {
	return nil, errServicesNotRunning
}

func (ws *WshServer) ServiceStartCommand(ctx context.Context, data wshrpc.CommandServiceData) error {
	return errServicesNotRunning
}

func (ws *WshServer) ServiceStopCommand(ctx context.Context, data wshrpc.CommandServiceData) error {
	return errServicesNotRunning
}

func (ws *WshServer) ServiceRestartCommand(ctx context.Context, data wshrpc.CommandServiceData) error {
	return errServicesNotRunning
}
