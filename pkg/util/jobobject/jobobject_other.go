//go:build !windows && !darwin

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobobject

import "os"

const jobsSupported = false

// nothing is registered here, so nothing is read
func memberReader() func(job uintptr, e regEntry) ([]int, error) {
	return func(uintptr, regEntry) ([]int, error) { return nil, nil }
}

func rootStartOf(pid int) int64 { return 0 }

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

func TerminateOutside(pid int) error {
	return ErrNotMember
}
