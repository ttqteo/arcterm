//go:build !windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobobject

import (
	"os"
	"syscall"
)

// lowNiceness is what `nice` gives a command by default.
const lowNiceness = 10

// LowerPriority renices proc to lowNiceness, so a run's agents and the builds and typechecks they start yield the
// CPU to what the person is doing; every child proc starts from now on inherits it. There is no job outside
// Windows, so job goes unused.
func LowerPriority(job uintptr, proc *os.Process) error {
	if proc == nil {
		return nil
	}
	return syscall.Setpriority(syscall.PRIO_PROCESS, proc.Pid, lowNiceness)
}
