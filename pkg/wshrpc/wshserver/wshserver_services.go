// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"

	"github.com/wavetermdev/waveterm/pkg/services"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var errServicesNotRunning = errors.New("services are not running yet")

func (ws *WshServer) ServicesStatusCommand(ctx context.Context) (*wshrpc.ServicesData, error) {
	sup := services.Current()
	if sup == nil {
		return nil, errServicesNotRunning
	}
	return &wshrpc.ServicesData{Services: sup.Status()}, nil
}

func (ws *WshServer) ServiceOpenCommand(ctx context.Context, data wshrpc.CommandServiceData) (*wshrpc.ServiceStatus, error) {
	sup := services.Current()
	if sup == nil {
		return nil, errServicesNotRunning
	}
	status, err := sup.Open(ctx, data.Id)
	if err != nil {
		return nil, err
	}
	return &status, nil
}

func (ws *WshServer) ServiceStartCommand(ctx context.Context, data wshrpc.CommandServiceData) error {
	sup := services.Current()
	if sup == nil {
		return errServicesNotRunning
	}
	return sup.Start(ctx, data.Id)
}

func (ws *WshServer) ServiceStopCommand(ctx context.Context, data wshrpc.CommandServiceData) error {
	sup := services.Current()
	if sup == nil {
		return errServicesNotRunning
	}
	return sup.Stop(ctx, data.Id)
}

func (ws *WshServer) ServiceRestartCommand(ctx context.Context, data wshrpc.CommandServiceData) error {
	sup := services.Current()
	if sup == nil {
		return errServicesNotRunning
	}
	return sup.Restart(ctx, data.Id)
}

func (ws *WshServer) ServiceSeenCommand(ctx context.Context, data wshrpc.CommandServiceSeenData) error {
	sup := services.Current()
	if sup == nil {
		return errServicesNotRunning
	}
	sup.Seen(ctx, data.Ids)
	return nil
}
