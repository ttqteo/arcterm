//go:build windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobobject

import (
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

// LowerPriority runs proc and every descendant below normal CPU priority, so a run's agents and the builds and
// typechecks they start yield the CPU to what the person is doing, and still take all of it when the machine is
// otherwise idle. With a job it sets the job's priority-class limit, which holds for every process in the job,
// present and future, and keeps them from raising it; a descendant that breaks away (StartDetached) leaves it.
// Without one (attach failed) it lowers proc alone, whose later children inherit below-normal.
func LowerPriority(job uintptr, proc *os.Process) error {
	if job != 0 {
		return updateLimits(job, func(b *windows.JOBOBJECT_BASIC_LIMIT_INFORMATION) {
			b.LimitFlags |= windows.JOB_OBJECT_LIMIT_PRIORITY_CLASS
			b.PriorityClass = windows.BELOW_NORMAL_PRIORITY_CLASS
		})
	}
	if proc == nil {
		return nil
	}
	h, err := windows.OpenProcess(windows.PROCESS_SET_INFORMATION, false, uint32(proc.Pid))
	if err != nil {
		return fmt.Errorf("OpenProcess(%d): %w", proc.Pid, err)
	}
	defer windows.CloseHandle(h)
	return windows.SetPriorityClass(h, windows.BELOW_NORMAL_PRIORITY_CLASS)
}
