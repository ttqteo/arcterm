// pkg/wshrpc/wshserver/wshserver_devservers.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"log"

	"github.com/wavetermdev/waveterm/pkg/devservers"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// machineHolders is the arcterm blocks that can hold a server, by shell pid. A var so tests need no store.
var machineHolders = readMachineHolders

func readMachineHolders(ctx context.Context) (map[int32]devservers.ServerOwner, error) {
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return nil, err
	}
	agents := map[string]agentRow{}
	for _, r := range buildAgentRoster(facts) {
		agents[r.blockId] = r
	}
	holders := map[int32]devservers.ServerOwner{}
	for _, tf := range facts.Tabs {
		if !tf.ShellRunning {
			continue
		}
		pid := consumerBlockPid(tf.BlockId)
		if pid <= 0 {
			continue
		}
		o := devservers.ServerOwner{Kind: devservers.OwnerTerminal, BlockId: tf.BlockId, TabId: tf.Tab.OID, Name: tf.Tab.Name}
		if r, ok := agents[tf.BlockId]; ok {
			o.Kind, o.Harness = devservers.OwnerAgent, r.Harness
		}
		holders[int32(pid)] = o
	}
	return holders, nil
}

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

func (ws *WshServer) ListAllDevServersCommand(ctx context.Context) (*wshrpc.CommandListDevServersRtnData, error) {
	holders, err := machineHolders(ctx)
	if err != nil {
		// without the roster every server still lists, owned by an app or detached
		log.Printf("devservers: reading arcterm's blocks: %v", err)
	}
	servers, err := devservers.ListAll(ctx, holders)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandListDevServersRtnData{Servers: servers}, nil
}

func (ws *WshServer) StopDevServerCommand(ctx context.Context, data wshrpc.CommandStopDevServerData) error {
	return devservers.Stop(ctx, data.Pid, data.CreateMs)
}
