// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"

	"github.com/shirou/gopsutil/v4/mem"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/workercap"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// virtualMemory is the OS memory reading (host_statistics on darwin, cheap at the chip's 5 s poll). A var so
// tests can script it.
var virtualMemory = mem.VirtualMemoryWithContext

// workerBlockRunning is the tracker's test for retiring a worker into its recent peaks: its block still has a
// running shell.
func workerBlockRunning(blockId string) bool {
	rs := blockcontroller.GetBlockControllerRuntimeStatus(blockId)
	return rs != nil && rs.ShellProcStatus == blockcontroller.Status_Running
}

// GetWorkerCapacityCommand reports free RAM and how many more workers it holds. It only reads: the samples
// come from the engine's liveness tick (pkg/orchestrate/liveness.go).
func (ws *WshServer) GetWorkerCapacityCommand(ctx context.Context) (*wshrpc.CommandGetWorkerCapacityRtnData, error) {
	vm, err := virtualMemory(ctx)
	if err != nil {
		return nil, fmt.Errorf("reading system memory: %w", err)
	}
	c := workercap.Read(vm.Total, vm.Available, workerBlockRunning)
	return &wshrpc.CommandGetWorkerCapacityRtnData{
		TotalBytes:     c.Total,
		AvailableBytes: c.Available,
		PerWorkerBytes: c.PerWorker,
		Measured:       c.Measured,
		LiveWorkers:    c.LiveWorkers,
		ReserveBytes:   c.Reserve,
		MoreWorkers:    c.More,
	}, nil
}
