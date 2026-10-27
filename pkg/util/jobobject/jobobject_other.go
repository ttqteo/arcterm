//go:build !windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobobject

import "os"

const jobsSupported = false

// no job objects outside windows; process trees are handled by the pty/session
func Attach(proc *os.Process) (uintptr, error) {
	return 0, nil
}

func AttachSealed(proc *os.Process) (uintptr, error) {
	return 0, nil
}

func KillTree(job uintptr) {}

func KillTreeKeeping(job uintptr) {}

func WatchKeptApps() {}

func KillKeptJobs() {}

func Close(job uintptr) {}

func Members(job uintptr) ([]int, error) {
	return nil, nil
}

func TerminateMember(o Owner, pid int) error {
	return ErrNotMember
}
