//go:build darwin

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobobject

import (
	"errors"
	"fmt"
	"os"
	"slices"
	"syscall"

	"golang.org/x/sys/unix"
)

// macOS has no job objects. A "job" here is followed as its root's process tree (treeMembers), only so the Resource
// Manager can group a block's processes and stop one of them; killing a block's tree stays the pty session's
// (SIGHUP), as before, so KillTree and the kept-app watch do nothing.
const jobsSupported = true

// Attach hands back the root's pid as the job's handle: Register keeps it, Members walks its tree, Close forgets it.
func Attach(proc *os.Process) (uintptr, error) {
	if proc == nil {
		return 0, nil
	}
	return uintptr(proc.Pid), nil
}

func AttachSealed(proc *os.Process) (uintptr, error) {
	return Attach(proc)
}

func KillTree(job uintptr) {}

func KillTreeKeeping(job uintptr) {}

func WatchKeptApps() {}

func KillKeptJobs() {}

// Close forgets the job; a handle Attach made for a command no one registered is not in the registry, which is fine.
func Close(job uintptr) {
	unregister(job)
}

func startMs(k *unix.KinfoProc) int64 {
	return k.Proc.P_starttime.Sec*1000 + int64(k.Proc.P_starttime.Usec)/1000
}

// readTree reads every process's ppid and start time in one sysctl.
func readTree() (map[int]treeProc, error) {
	procs, err := unix.SysctlKinfoProcSlice("kern.proc.all")
	if err != nil {
		return nil, fmt.Errorf("sysctl kern.proc.all: %w", err)
	}
	table := make(map[int]treeProc, len(procs))
	for i := range procs {
		k := &procs[i]
		table[int(k.Proc.P_pid)] = treeProc{ppid: int(k.Eproc.Ppid), start: startMs(k)}
	}
	return table, nil
}

// memberReader reads the process table once, on its first use, for every job read under one registry lock.
func memberReader() func(job uintptr, e regEntry) ([]int, error) {
	var table map[int]treeProc
	var readErr error
	return func(job uintptr, e regEntry) ([]int, error) {
		if table == nil && readErr == nil {
			table, readErr = readTree()
		}
		if readErr != nil {
			return nil, readErr
		}
		return treeMembers(table, e.rootPid, e.rootStart), nil
	}
}

// startOf is pid's start time (epoch ms); 0 when there is no such process.
func startOf(pid int) int64 {
	k, err := unix.SysctlKinfoProc("kern.proc.pid", pid)
	if err != nil || k == nil || int(k.Proc.P_pid) != pid {
		return 0
	}
	return startMs(k)
}

func rootStartOf(pid int) int64 {
	return startOf(pid)
}

// Members is the tree under the pid Attach handed back, with no guard against a reused root: the registry's reads
// (LiveJobs, TerminateMember) carry the root's start and use that guard.
func Members(job uintptr) ([]int, error) {
	table, err := readTree()
	if err != nil {
		return nil, err
	}
	return treeMembers(table, int(job), 0), nil
}

// kill sends SIGKILL, as TerminateProcess ends a process on Windows, to pid while it is still the process that
// started at start: a pid reused between the check and the kill is never hit.
func kill(pid int, start int64) error {
	if startOf(pid) != start {
		return ErrGone
	}
	if err := syscall.Kill(pid, syscall.SIGKILL); err != nil {
		if errors.Is(err, syscall.ESRCH) {
			return ErrGone
		}
		return fmt.Errorf("kill(%d): %w", pid, err)
	}
	return nil
}

// TerminateOutside kills pid with no tree check.
func TerminateOutside(pid int) error {
	start := startOf(pid)
	if start == 0 {
		return ErrGone
	}
	return kill(pid, start)
}

// TerminateMember kills pid when it is in the tree of a job registered for o, read afresh.
func TerminateMember(o Owner, pid int) error {
	start := startOf(pid)
	if start == 0 {
		return ErrGone
	}
	read := memberReader()
	member, err := anyOwnedJob(o, func(job uintptr, e regEntry) (bool, error) {
		members, err := read(job, e)
		return slices.Contains(members, pid), err
	})
	if err != nil {
		return err
	}
	if !member {
		return ErrNotMember
	}
	return kill(pid, start)
}
