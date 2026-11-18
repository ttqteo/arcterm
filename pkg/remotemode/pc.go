// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"context"
	"errors"
)

// pcVolumeSteps are the volume buttons the phone page has: one press of the keyboard's volume-down key, its
// mute key, its volume-up key.
var pcVolumeSteps = []string{"down", "mute", "up"}

// pcSupported is whether this platform locks the screen and presses volume keys. It decides whether
// remoteDeps wires the PC deps, which in turn is the waiting list's pc flag.
const pcSupported = false

// pcLock and pcVolume are Deps.PCLock and Deps.PCVolume. Stubs: they do nothing yet.
func pcLock(_ context.Context) error { return errors.New("not built yet") }

func pcVolume(_ context.Context, _ string) error { return errors.New("not built yet") }
