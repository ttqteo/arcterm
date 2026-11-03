// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package council

import (
	"os/exec"
	"syscall"
)

// runTree runs c in a process group of its own and, when its context ends, kills the whole group: `go test` leaves its
// compiled test binary, and `npx` its node, running when only the launcher is killed.
func runTree(c *exec.Cmd) error {
	c.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	c.Cancel = func() error {
		if c.Process != nil {
			_ = syscall.Kill(-c.Process.Pid, syscall.SIGKILL)
		}
		return nil
	}
	return c.Run()
}
