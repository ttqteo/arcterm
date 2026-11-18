//go:build !windows && !darwin

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"context"
	"fmt"
	"runtime"
)

// pcSupported is false here: remoteDeps leaves PCLock and PCVolume nil, so their routes answer 501 and the
// waiting list's pc flag is false.
const pcSupported = false

// pcLock and pcVolume are never wired where pcSupported is false; they refuse by name if anything calls them.
func pcLock(_ context.Context) error {
	return fmt.Errorf("lock the screen: not supported on %s", runtime.GOOS)
}

func pcVolume(_ context.Context, step string) error {
	if err := pcCheckStep(step); err != nil {
		return err
	}
	return fmt.Errorf("press volume %s: not supported on %s", step, runtime.GOOS)
}
