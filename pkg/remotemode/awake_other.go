//go:build !windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

// KeepAwake is a no-op outside windows.
func KeepAwake() (release func()) {
	return func() {}
}
