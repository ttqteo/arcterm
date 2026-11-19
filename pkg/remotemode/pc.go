// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"fmt"
	"slices"
	"strings"
)

// The computer controls of the phone page (spec "Controlling the computer from the phone"). Each platform file
// defines the four things remoteDeps wires, so this file holds only what they share:
//
//	const pcSupported bool                              whether this platform has the controls; it decides
//	                                                    whether remoteDeps sets Deps.PCLock and Deps.PCVolume,
//	                                                    which is the waiting list's pc flag
//	func pcLock(ctx context.Context) error              Deps.PCLock: lock the screen
//	func pcVolume(ctx context.Context, step string) error   Deps.PCVolume: press one volume button
//	var pcLocked func(ctx context.Context) (bool, error)    Deps.PCLocked: whether the session is locked, the
//	                                                    waiting list's locked; nil (Windows only reads it)
//
// pc_windows.go, pc_darwin.go and pc_other.go (no controls). A failure returns an error that names what failed:
// the handler answers 500 with its text and the page shows it under the buttons.

// pcVolumeSteps are the volume buttons the phone page has: one press of the keyboard's volume-down key, its
// mute key, its volume-up key.
var pcVolumeSteps = []string{"down", "mute", "up"}

// pcCheckStep refuses a step that is not one of pcVolumeSteps. The handler already validates the request body;
// every platform's pcVolume checks again first, so a caller other than the handler can never press a key the
// page has no button for.
func pcCheckStep(step string) error {
	if slices.Contains(pcVolumeSteps, step) {
		return nil
	}
	return fmt.Errorf("volume step %q is not one of %s", step, strings.Join(pcVolumeSteps, ", "))
}
