//go:build windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobobject

import (
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const jobsSupported = true

// Attach puts proc in a new job object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE so closing the
// handle (Close) terminates the entire process tree rooted at proc, not just proc itself.
// BREAKAWAY_OK lets a descendant that asks for it (StartDetached) leave the job; every other one stays in.
func Attach(proc *os.Process) (uintptr, error) {
	return attach(proc, windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE|windows.JOB_OBJECT_LIMIT_BREAKAWAY_OK)
}

// AttachSealed is Attach without BREAKAWAY_OK, for a command whose kill must take every descendant:
// Git Bash's sleep asks to break away when the job allows it, and then outlives a timed-out Verify.
func AttachSealed(proc *os.Process) (uintptr, error) {
	return attach(proc, windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)
}

func attach(proc *os.Process, limits uint32) (uintptr, error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return 0, fmt.Errorf("CreateJobObject: %w", err)
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{
		BasicLimitInformation: windows.JOBOBJECT_BASIC_LIMIT_INFORMATION{
			LimitFlags: limits,
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

// keepRounds bounds KillTreeKeeping's passes: a shell can start a process between a pass's listing and its kills
const keepRounds = 3

// KillTreeKeeping is KillTree that leaves a kept desktop app (keepImages) and what runs under it running. Once it
// spares one, the job stops killing on close, so closing its handle afterwards leaves the app running too.
func KillTreeKeeping(job uintptr) {
	if job == 0 {
		return
	}
	for round := range keepRounds {
		members, err := Members(job)
		if err != nil {
			KillTree(job)
			return
		}
		var kept map[int]bool
		if len(members) > 0 {
			kept = keptMembers(members, processTable(), keepImages)
		}
		if len(kept) == 0 {
			KillTree(job)
			return
		}
		if round == 0 {
			if err := disarm(job); err != nil {
				log.Printf("jobobject: keeping %d processes, but the job still kills on close: %v", len(kept), err)
			}
		}
		killed := 0
		for _, pid := range members {
			if !kept[pid] && terminateIn(job, pid) {
				killed++
			}
		}
		if killed == 0 {
			return
		}
	}
}

// disarm drops KILL_ON_JOB_CLOSE, keeping BREAKAWAY_OK.
func disarm(job uintptr) error {
	return setLimits(job, windows.JOB_OBJECT_LIMIT_BREAKAWAY_OK)
}

// arm sets KILL_ON_JOB_CLOSE again, the limits Attach gave the job.
func arm(job uintptr) error {
	return setLimits(job, windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE|windows.JOB_OBJECT_LIMIT_BREAKAWAY_OK)
}

func setLimits(job uintptr, flags uint32) error {
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{
		BasicLimitInformation: windows.JOBOBJECT_BASIC_LIMIT_INFORMATION{LimitFlags: flags},
	}
	_, err := windows.SetInformationJobObject(windows.Handle(job), windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info)))
	return err
}

// keepWatchInterval is how often WatchKeptApps looks for a kept app in the registered jobs.
const keepWatchInterval = 10 * time.Second

// WatchKeptApps stops each registered job from killing on close while it holds a kept desktop app, and arms it
// again once the app is gone. Every quit of arcterm ends this server abruptly (the host kills it, an install
// force-stops it), and its jobs then close armed and take a Docker Desktop an agent started down with the agent; a
// disarmed job leaves it, and KillKeptJobs reaps the rest at shutdown. Runs for the server's life.
func WatchKeptApps() {
	for {
		refreshKeptArming(processTable())
		time.Sleep(keepWatchInterval)
	}
}

func refreshKeptArming(table map[int]procEntry) {
	if table == nil {
		return
	}
	registry.mu.Lock()
	defer registry.mu.Unlock()
	for job, e := range registry.jobs {
		members, err := Members(job)
		if err != nil {
			continue
		}
		keep := len(keptMembers(members, table, keepImages)) > 0
		if keep == e.disarmed {
			continue
		}
		if keep {
			err = disarm(job)
		} else {
			err = arm(job)
		}
		if err != nil {
			log.Printf("jobobject: setting kill-on-close %v for %s %s: %v", !keep, e.owner.Kind, e.owner.Id, err)
			continue
		}
		e.disarmed = keep
		registry.jobs[job] = e
		log.Printf("jobobject: %s %s holds a kept app %v, kill-on-close %v", e.owner.Kind, e.owner.Id, keep, !keep)
	}
}

// KillKeptJobs reaps each job WatchKeptApps disarmed, sparing its kept app: closing it at exit no longer would.
func KillKeptJobs() {
	registry.mu.Lock()
	defer registry.mu.Unlock()
	for job, e := range registry.jobs {
		if e.disarmed {
			KillTreeKeeping(job)
		}
	}
}

// terminateIn terminates pid when, on the handle it opens, it is still a running member of job.
func terminateIn(job uintptr, pid int) bool {
	h, err := windows.OpenProcess(windows.PROCESS_TERMINATE|windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		return false
	}
	defer windows.CloseHandle(h)
	if hasExited(h) {
		return false
	}
	if member, err := isProcessInJob(h, job); err != nil || !member {
		return false
	}
	return windows.TerminateProcess(h, terminateExitCode) == nil
}

// processTable reads every process's parent and image name; nil when the snapshot fails, which keeps nothing.
func processTable() map[int]procEntry {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil
	}
	defer windows.CloseHandle(snap)
	table := map[int]procEntry{}
	var e windows.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	for err = windows.Process32First(snap, &e); err == nil; err = windows.Process32Next(snap, &e) {
		table[int(e.ProcessID)] = procEntry{parent: int(e.ParentProcessID), image: strings.ToLower(windows.UTF16ToString(e.ExeFile[:]))}
	}
	return table
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
