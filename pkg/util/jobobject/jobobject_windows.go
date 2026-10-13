//go:build windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobobject

import (
	"errors"
	"fmt"
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

const jobsSupported = true

// Attach puts proc in a new job object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE so closing the
// handle (Close) terminates the entire process tree rooted at proc, not just proc itself.
func Attach(proc *os.Process) (uintptr, error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return 0, fmt.Errorf("CreateJobObject: %w", err)
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{
		BasicLimitInformation: windows.JOBOBJECT_BASIC_LIMIT_INFORMATION{
			LimitFlags: windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
		},
	}
	if _, err := windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		windows.CloseHandle(job)
		return 0, fmt.Errorf("SetInformationJobObject: %w", err)
	}
	procHandle, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE|windows.PROCESS_QUERY_INFORMATION, false, uint32(proc.Pid))
	if err != nil {
		windows.CloseHandle(job)
		return 0, fmt.Errorf("OpenProcess(%d): %w", proc.Pid, err)
	}
	defer windows.CloseHandle(procHandle)
	if err := windows.AssignProcessToJobObject(job, procHandle); err != nil {
		windows.CloseHandle(job)
		return 0, fmt.Errorf("AssignProcessToJobObject(%d): %w", proc.Pid, err)
	}
	return uintptr(job), nil
}

// KillTree terminates every process in the job, i.e. the whole descendant tree.
func KillTree(job uintptr) {
	if job == 0 {
		return
	}
	_ = windows.TerminateJobObject(windows.Handle(job), 1)
}

// Close unregisters the job, then closes its handle; with KILL_ON_JOB_CLOSE set this also reaps any
// processes still in the job.
func Close(job uintptr) {
	if job == 0 {
		return
	}
	unregister(job)
	_ = windows.CloseHandle(windows.Handle(job))
}

// mirrors JOBOBJECT_BASIC_PROCESS_ID_LIST; list is a variable-length array.
type basicProcessIdList struct {
	assigned uint32
	inList   uint32
	list     [1]uintptr
}

const (
	initialIdListLen = 64
	idListSlack      = 16 // members can join between the sizing call and the retry
)

// Members lists the pids in job, growing the buffer while the list is truncated.
func Members(job uintptr) ([]int, error) {
	if job == 0 {
		return nil, nil
	}
	wordSize := unsafe.Sizeof(uintptr(0))
	hdr := int(unsafe.Offsetof(basicProcessIdList{}.list) / wordSize)
	n := initialIdListLen
	for {
		buf := make([]uintptr, hdr+n)
		list := (*basicProcessIdList)(unsafe.Pointer(&buf[0]))
		err := windows.QueryInformationJobObject(windows.Handle(job), windows.JobObjectBasicProcessIdList,
			uintptr(unsafe.Pointer(&buf[0])), uint32(uintptr(len(buf))*wordSize), nil)
		if err != nil && !errors.Is(err, windows.ERROR_MORE_DATA) {
			return nil, fmt.Errorf("QueryInformationJobObject: %w", err)
		}
		if err == nil && list.inList >= list.assigned {
			pids := make([]int, list.inList)
			for i, id := range buf[hdr : hdr+int(list.inList)] {
				pids[i] = int(id)
			}
			return pids, nil
		}
		n = max(int(list.assigned)+idListSlack, n*2)
	}
}

const terminateExitCode = 1

var procIsProcessInJob = windows.NewLazySystemDLL("kernel32.dll").NewProc("IsProcessInJob")

func isProcessInJob(proc windows.Handle, job uintptr) (bool, error) {
	var result int32
	r, _, err := procIsProcessInJob.Call(uintptr(proc), job, uintptr(unsafe.Pointer(&result)))
	if r == 0 {
		return false, err
	}
	return result != 0, nil
}

func hasExited(h windows.Handle) bool {
	ev, err := windows.WaitForSingleObject(h, 0)
	return err == nil && ev == windows.WAIT_OBJECT_0
}

// TerminateMember opens pid, checks IsProcessInJob against a live job registered for o on that same
// handle, then terminates through it. The open handle pins the process, so a reused pid cannot be hit.
func TerminateMember(o Owner, pid int) error {
	h, err := windows.OpenProcess(windows.PROCESS_TERMINATE|windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		if errors.Is(err, windows.ERROR_INVALID_PARAMETER) {
			return ErrGone
		}
		return fmt.Errorf("OpenProcess(%d): %w", pid, err)
	}
	defer windows.CloseHandle(h)
	// an exited process whose object another handle keeps open still opens and still reports its job
	if hasExited(h) {
		return ErrGone
	}
	member, err := anyOwnedJob(o, func(job uintptr) (bool, error) { return isProcessInJob(h, job) })
	if err != nil {
		return fmt.Errorf("IsProcessInJob(%d): %w", pid, err)
	}
	if !member {
		return ErrNotMember
	}
	if err := windows.TerminateProcess(h, terminateExitCode); err != nil {
		if hasExited(h) {
			return ErrGone
		}
		return fmt.Errorf("TerminateProcess(%d): %w", pid, err)
	}
	return nil
}
