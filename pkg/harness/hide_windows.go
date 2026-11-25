// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package harness

import (
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"
)

// HideWindow keeps a harness CLI that wavesrv runs (a version probe, an update) from opening a console window:
// wavesrv has no console of its own, so Windows would give the child a new one in the default terminal.
func HideWindow(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags |= windows.CREATE_NO_WINDOW
}
