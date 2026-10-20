// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/services"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type memState map[string]services.Remembered

func (m memState) Get(id string) services.Remembered { return m[id] }
func (m memState) Set(id string, r services.Remembered) error {
	m[id] = r
	return nil
}

func TestServiceCommandUnknownId(t *testing.T) {
	ws := &WshServer{}
	ctx := context.Background()

	if err := ws.ServiceStartCommand(ctx, wshrpc.CommandServiceData{Id: "nope"}); err == nil || !strings.Contains(err.Error(), `services are not running yet`) {
		t.Fatalf("Start before Init: err = %v, want services are not running yet", err)
	}

	prev := services.Default
	services.Default = services.New(services.Deps{State: memState{}})
	defer func() { services.Default = prev }()

	if err := ws.ServiceStartCommand(ctx, wshrpc.CommandServiceData{Id: "nope"}); err == nil || !strings.Contains(err.Error(), `no service "nope"`) {
		t.Fatalf("Start: err = %v, want no service \"nope\"", err)
	}
	if _, err := ws.ServiceOpenCommand(ctx, wshrpc.CommandServiceData{Id: "nope"}); err == nil || !strings.Contains(err.Error(), `no service "nope"`) {
		t.Fatalf("Open: err = %v, want no service \"nope\"", err)
	}
	for name, err := range map[string]error{
		"Stop":    ws.ServiceStopCommand(ctx, wshrpc.CommandServiceData{Id: "nope"}),
		"Restart": ws.ServiceRestartCommand(ctx, wshrpc.CommandServiceData{Id: "nope"}),
	} {
		if err == nil || !strings.Contains(err.Error(), `no service "nope"`) {
			t.Fatalf("%s: err = %v, want no service \"nope\"", name, err)
		}
	}
	data, err := ws.ServicesStatusCommand(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if data == nil || data.Services == nil || len(data.Services) != 0 {
		t.Fatalf("Status = %#v, want an empty non-nil list", data)
	}
}

func TestServiceSeenCommand(t *testing.T) {
	ws := &WshServer{}
	ctx := context.Background()

	if err := ws.ServiceSeenCommand(ctx, wshrpc.CommandServiceSeenData{Ids: []string{"nope"}}); err == nil || !strings.Contains(err.Error(), `services are not running yet`) {
		t.Fatalf("Seen before Init: err = %v, want services are not running yet", err)
	}

	prev := services.Default
	services.Default = services.New(services.Deps{State: memState{}})
	defer func() { services.Default = prev }()

	if err := ws.ServiceSeenCommand(ctx, wshrpc.CommandServiceSeenData{Ids: []string{"nope"}}); err != nil {
		t.Fatalf("Seen of an unknown id: err = %v, want nil", err)
	}
	if err := ws.ServiceSeenCommand(ctx, wshrpc.CommandServiceSeenData{}); err != nil {
		t.Fatalf("Seen of an empty set: err = %v, want nil", err)
	}
	data, err := ws.ServicesStatusCommand(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if data == nil || data.Services == nil || len(data.Services) != 0 {
		t.Fatalf("Status = %#v, want an empty non-nil list", data)
	}
}
