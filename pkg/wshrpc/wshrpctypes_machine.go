// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// MachineCommands back the menu bar / tray popover (spec 2026-10-15-tray-popover-design.md).
type MachineCommands interface {
	GetMachineStatsCommand(ctx context.Context) (*MachineStatsData, error) // memory, its pressure, swap, the last second's CPU and the system disk
}

type MachineStatsData struct {
	MemTotal     uint64   `json:"memtotal"`
	MemAvailable uint64   `json:"memavailable"`
	Pressure     string   `json:"pressure"`         // "normal", "high", "critical", or "" with no reading
	CpuPct       *float64 `json:"cpupct,omitempty"` // the last second's busy percent; none before wavesrv's first reading
	SwapTotal    uint64   `json:"swaptotal"`        // not in MemTotal; 0 with no swap file
	SwapUsed     uint64   `json:"swapused"`
	DiskName     string   `json:"diskname"`
	DiskTotal    uint64   `json:"disktotal"`
	DiskFree     uint64   `json:"diskfree"`
}

// MemoryPressureData is the memorypressure event: the level's word and the memory available, each time either
// changes (the memory by a tenth of a GiB).
type MemoryPressureData struct {
	Level        string `json:"level"`
	MemAvailable uint64 `json:"memavailable"` // 0 with no reading
}
