// pkg/wshrpc/wshserver/wshserver_devservers.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"log"
	"path/filepath"

	"github.com/wavetermdev/waveterm/pkg/devservers"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// machineHolders is the arcterm blocks that can hold a server, by shell pid. A var so tests need no store.
var machineHolders = readMachineHolders

// detachedPath is where wavesrv keeps the `wsh detach` launches. A var so tests write to their own dir.
var detachedPath = func() string { return filepath.Join(wavebase.GetWaveDataDir(), "detached.json") }

// blockOwners names every arcterm block with a tab: an agent (with its harness) or a terminal, by block id
func blockOwners(facts *agentRosterFacts) map[string]devservers.ServerOwner {
	agents := map[string]agentRow{}
	for _, r := range buildAgentRoster(facts) {
		agents[r.blockId] = r
	}
	out := map[string]devservers.ServerOwner{}
	for _, tf := range facts.Tabs {
		o := devservers.ServerOwner{Kind: devservers.OwnerTerminal, BlockId: tf.BlockId, TabId: tf.Tab.OID, Name: tf.Tab.Name}
		if r, ok := agents[tf.BlockId]; ok {
			o.Kind, o.Harness = devservers.OwnerAgent, r.Harness
		}
		out[tf.BlockId] = o
	}
	return out
}

func readMachineHolders(ctx context.Context) (map[int32]devservers.ServerOwner, error) {
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return nil, err
	}
	owners := blockOwners(facts)
	holders := map[int32]devservers.ServerOwner{}
	// a `wsh detach` launch's root pid holds what it started: named as its block is now, or as it was when it ran if
	// that tab has closed since. A block's live shell at the same pid wins
	launches, err := devservers.DetachedLaunches(detachedPath())
	if err != nil {
		log.Printf("devservers: reading the detached launches: %v", err)
	}
	for _, l := range launches {
		o := l.Owner
		if cur, ok := owners[o.BlockId]; ok && o.BlockId != "" {
			o = cur
		}
		holders[l.Pid] = devservers.DetachedHolder(o, l.StartMs)
	}
	for _, tf := range facts.Tabs {
		if !tf.ShellRunning {
			continue
		}
		pid := consumerBlockPid(tf.BlockId)
		if pid <= 0 {
			continue
		}
		holders[int32(pid)] = owners[tf.BlockId]
	}
	return holders, nil
}

func (ws *WshServer) RecordDetachedCommand(ctx context.Context, data wshrpc.CommandRecordDetachedData) error {
	if data.Pid <= 0 || data.StartMs <= 0 {
		return fmt.Errorf("record detached: pid and start time are required")
	}
	owner := devservers.ServerOwner{Kind: devservers.OwnerTerminal, BlockId: data.BlockId}
	if data.BlockId != "" {
		facts, err := loadAgentRosterFacts(ctx)
		if err != nil {
			return fmt.Errorf("record detached: reading arcterm's blocks: %w", err)
		}
		if o, ok := blockOwners(facts)[data.BlockId]; ok {
			owner = o
		}
	}
	return devservers.RecordDetached(detachedPath(), devservers.DetachedLaunch{
		Pid:     data.Pid,
		StartMs: data.StartMs,
		Cmd:     data.Cmd,
		Cwd:     data.Cwd,
		Log:     data.Log,
		Owner:   owner,
	})
}

// logHoldersErr logs a failed roster read, unless the call itself ended: the caller gave up on the answer
// (a poll timing out on a busy store), and logging it once per poll filled waveapp.log with hundreds of lines
func logHoldersErr(ctx context.Context, err error) {
	if err == nil || ctx.Err() != nil {
		return
	}
	log.Printf("devservers: reading arcterm's blocks: %v", err)
}

func (ws *WshServer) ListDevServersCommand(ctx context.Context, data wshrpc.CommandListDevServersData) (*wshrpc.CommandListDevServersRtnData, error) {
	holders, err := machineHolders(ctx)
	// without the roster the rail still lists every server, none of them named by its terminal
	logHoldersErr(ctx, err)
	servers, err := devservers.List(ctx, data.Cwd, data.BlockId, holders)
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
	// without the roster every server still lists, owned by an app or detached
	logHoldersErr(ctx, err)
	servers, err := devservers.ListAll(ctx, holders)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandListDevServersRtnData{Servers: servers}, nil
}

func (ws *WshServer) StopDevServerCommand(ctx context.Context, data wshrpc.CommandStopDevServerData) error {
	return devservers.Stop(ctx, data.Pid, data.CreateMs)
}
