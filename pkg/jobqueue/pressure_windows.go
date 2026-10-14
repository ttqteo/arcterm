// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package jobqueue

import (
	"context"

	"github.com/shirou/gopsutil/v4/mem"
)

// ReadPressure is the commit charge against the physical RAM (PressureFromCommit); PressureUnknown when it cannot
// be read.
func ReadPressure(context.Context) Pressure {
	vm, err := mem.NewExWindows().VirtualMemory()
	if err != nil {
		return PressureUnknown
	}
	return PressureFromCommit(vm.CommitTotal, vm.PhysTotal, vm.PhysAvail)
}
