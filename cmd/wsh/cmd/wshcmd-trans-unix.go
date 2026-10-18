//go:build !windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"os"

	"golang.org/x/sys/unix"
)

// termWidth is the terminal's width in columns, less one so a full line does not wrap on its own; 0 when stdout is not
// a terminal.
func termWidth() int {
	ws, err := unix.IoctlGetWinsize(int(os.Stdout.Fd()), unix.TIOCGWINSZ)
	if err != nil || ws.Col == 0 {
		return 0
	}
	return int(ws.Col) - 1
}
