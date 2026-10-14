// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !darwin && !windows

package jobqueue

import "context"

// ReadPressure has no reading off macOS and Windows: the free-RAM count decides there.
func ReadPressure(context.Context) Pressure {
	return PressureUnknown
}
