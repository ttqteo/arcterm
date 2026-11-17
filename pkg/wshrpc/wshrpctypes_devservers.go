// pkg/wshrpc/wshrpctypes_devservers.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/devservers"
)

// DevServerCommands lists and stops the processes listening in an agent's project (the agent rail's Servers).
type DevServerCommands interface {
	ListDevServersCommand(ctx context.Context, data CommandListDevServersData) (*CommandListDevServersRtnData, error)
	// ListAllDevServersCommand is every listening process on the machine with its repo and owner (the footer's Servers)
	ListAllDevServersCommand(ctx context.Context) (*CommandListDevServersRtnData, error)
	StopDevServerCommand(ctx context.Context, data CommandStopDevServerData) error
	// RecordDetachedCommand is `wsh detach` telling wavesrv what it started and from which block, so the server it
	// runs is that block's rather than no one's (devservers/detached.go)
	RecordDetachedCommand(ctx context.Context, data CommandRecordDetachedData) error
}

type CommandRecordDetachedData struct {
	Pid     int32  `json:"pid"`
	StartMs int64  `json:"startms"`
	BlockId string `json:"blockid,omitempty"`
	Cmd     string `json:"cmd,omitempty"`
	Cwd     string `json:"cwd,omitempty"`
	Log     string `json:"log,omitempty"`
}

type CommandListDevServersData struct {
	Cwd     string `json:"cwd,omitempty"`     // the project root; "" falls back to the agent process's cwd
	BlockId string `json:"blockid,omitempty"` // the agent's block, for "started by this agent"
}

type CommandListDevServersRtnData struct {
	Servers []devservers.Server `json:"servers"`
}

type CommandStopDevServerData struct {
	Pid      int32 `json:"pid"`
	CreateMs int64 `json:"createms"`
}
