// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build darwin

package jobqueue

import (
	"context"

	"golang.org/x/sys/unix"
)

// ReadPressure is macOS's own memory pressure, the one Activity Monitor draws; PressureUnknown when it cannot be read.
func ReadPressure(context.Context) Pressure {
	level, err := unix.SysctlUint32("kern.memorystatus_vm_pressure_level")
	if err != nil {
		return PressureUnknown
	}
	return PressureFromLevel(level)
}
