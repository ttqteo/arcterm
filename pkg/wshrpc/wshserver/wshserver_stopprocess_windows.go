// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package wshserver

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func stopProcessTree(ctx context.Context, ws *WshServer, _ memusage.Table, data wshrpc.CommandStopProcessData) error {
	// the Resource Manager's tree kill, inside the agent's job (pkg/resmon/kill.go)
	rtn, err := ws.ResMonKillCommand(ctx, wshrpc.CommandResMonKillData{OwnerId: data.BlockId, Pid: data.Pid, Tree: true})
	if err != nil {
		return err
	}
	switch rtn.Outcome {
	case wshrpc.ResMonKill_Killed:
		return nil
	case wshrpc.ResMonKill_Gone:
		return fmt.Errorf("process %d has already exited", data.Pid)
	case wshrpc.ResMonKill_Failed:
		return fmt.Errorf("could not stop process %d: %s", data.Pid, rtn.Error)
	default:
		return fmt.Errorf("process %d is no longer one of that agent's commands (%s)", data.Pid, rtn.Outcome)
	}
}
