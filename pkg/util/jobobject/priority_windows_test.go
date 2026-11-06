//go:build windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobobject

import (
	"testing"

	"golang.org/x/sys/windows"
)

func priorityClass(t *testing.T, pid int) uint32 {
	t.Helper()
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		t.Fatalf("OpenProcess(%d): %v", pid, err)
	}
	defer windows.CloseHandle(h)
	class, err := windows.GetPriorityClass(h)
	if err != nil {
		t.Fatalf("GetPriorityClass(%d): %v", pid, err)
	}
	return class
}

func basicLimits(t *testing.T, job uintptr) windows.JOBOBJECT_BASIC_LIMIT_INFORMATION {
	t.Helper()
	var b windows.JOBOBJECT_BASIC_LIMIT_INFORMATION
	if err := updateLimits(job, func(cur *windows.JOBOBJECT_BASIC_LIMIT_INFORMATION) { b = *cur }); err != nil {
		t.Fatalf("reading limits: %v", err)
	}
	return b
}

// The cap holds for a process already in the job and one that joins later, and arming or disarming the job for a
// kept app (WatchKeptApps) flips kill-on-close without dropping it.
func TestLowerPriorityCapsTheWholeJob(t *testing.T) {
	first := startSleeper(t)
	job := attachRegistered(t, first, Owner{Kind: OwnerKind_Block, Id: "low-priority"})
	if err := LowerPriority(job, first.Process); err != nil {
		t.Fatalf("LowerPriority: %v", err)
	}
	if got := priorityClass(t, first.Process.Pid); got != windows.BELOW_NORMAL_PRIORITY_CLASS {
		t.Fatalf("process in the job: priority class %#x, want below normal", got)
	}
	later := startSleeper(t)
	assignToJob(t, job, later.Process.Pid)
	if got := priorityClass(t, later.Process.Pid); got != windows.BELOW_NORMAL_PRIORITY_CLASS {
		t.Fatalf("process that joined later: priority class %#x, want below normal", got)
	}

	if err := disarm(job); err != nil {
		t.Fatalf("disarm: %v", err)
	}
	b := basicLimits(t, job)
	if b.LimitFlags&windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE != 0 {
		t.Fatalf("disarm left kill-on-close set: flags %#x", b.LimitFlags)
	}
	if b.LimitFlags&windows.JOB_OBJECT_LIMIT_PRIORITY_CLASS == 0 || b.PriorityClass != windows.BELOW_NORMAL_PRIORITY_CLASS {
		t.Fatalf("disarm dropped the priority cap: flags %#x class %#x", b.LimitFlags, b.PriorityClass)
	}
	if err := arm(job); err != nil {
		t.Fatalf("arm: %v", err)
	}
	b = basicLimits(t, job)
	want := uint32(windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | windows.JOB_OBJECT_LIMIT_BREAKAWAY_OK | windows.JOB_OBJECT_LIMIT_PRIORITY_CLASS)
	if b.LimitFlags != want || b.PriorityClass != windows.BELOW_NORMAL_PRIORITY_CLASS {
		t.Fatalf("after arm: flags %#x class %#x, want flags %#x below normal", b.LimitFlags, b.PriorityClass, want)
	}
}

// A sealed job (a plan command's) stays sealed: arming it no longer adds BREAKAWAY_OK.
func TestArmKeepsASealedJobSealed(t *testing.T) {
	cmd := startSleeper(t)
	job, err := AttachSealed(cmd.Process)
	if err != nil {
		t.Fatalf("AttachSealed: %v", err)
	}
	t.Cleanup(func() { Close(job) })
	if err := disarm(job); err != nil {
		t.Fatalf("disarm: %v", err)
	}
	if err := arm(job); err != nil {
		t.Fatalf("arm: %v", err)
	}
	if b := basicLimits(t, job); b.LimitFlags != windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE {
		t.Fatalf("flags %#x, want kill-on-close alone", b.LimitFlags)
	}
}

// Without a job it lowers the process itself.
func TestLowerPriorityWithoutAJob(t *testing.T) {
	cmd := startSleeper(t)
	if err := LowerPriority(0, cmd.Process); err != nil {
		t.Fatalf("LowerPriority: %v", err)
	}
	if got := priorityClass(t, cmd.Process.Pid); got != windows.BELOW_NORMAL_PRIORITY_CLASS {
		t.Fatalf("priority class %#x, want below normal", got)
	}
}
