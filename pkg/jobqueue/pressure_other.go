// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !darwin

package jobqueue

import "context"

// ReadPressure has no reading off macOS: the free-RAM count decides there.
func ReadPressure(context.Context) Pressure {
	return PressureUnknown
}
