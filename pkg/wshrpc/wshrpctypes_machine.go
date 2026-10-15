// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// MachineCommands back the menu bar / tray popover (spec 2026-10-15-tray-popover-design.md).
type MachineCommands interface {
	GetMachineStatsCommand(ctx context.Context) (*MachineStatsData, error) // memory, its pressure, CPU (sampled while asked) and the system disk
}

type MachineStatsData struct {
	MemTotal     uint64    `json:"memtotal"`
	MemAvailable uint64    `json:"memavailable"`
	Pressure     string    `json:"pressure"`   // "normal", "high", "critical", or "" with no reading
	CpuPct       float64   `json:"cpupct"`     // the latest sample
	CpuSamples   []float64 `json:"cpusamples"` // up to the last 60, one a second, oldest first
	DiskName     string    `json:"diskname"`
	DiskTotal    uint64    `json:"disktotal"`
	DiskFree     uint64    `json:"diskfree"`
}

// MemoryPressureData is the memorypressure event: the level's word each time it changes.
type MemoryPressureData struct {
	Level string `json:"level"`
}
