//go:build windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

// termWidth is 0 on Windows, which has no translate-shell: wsh trans's lines are left unwrapped.
func termWidth() int {
	return 0
}
