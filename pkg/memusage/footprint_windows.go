// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package memusage

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

var procGetProcessMemoryInfo = windows.NewLazySystemDLL("kernel32.dll").NewProc("K32GetProcessMemoryInfo")

// processMemoryCountersEx2 is PROCESS_MEMORY_COUNTERS_EX2 (psapi.h)
type processMemoryCountersEx2 struct {
	cb                         uint32
	pageFaultCount             uint32
	peakWorkingSetSize         uintptr
	workingSetSize             uintptr
	quotaPeakPagedPoolUsage    uintptr
	quotaPagedPoolUsage        uintptr
	quotaPeakNonPagedPoolUsage uintptr
	quotaNonPagedPoolUsage     uintptr
	pagefileUsage              uintptr
	peakPagefileUsage          uintptr
	privateUsage               uintptr
	privateWorkingSetSize      uintptr
	sharedCommitUsage          uint64
}

// footprint is the private working set, the figure Task Manager's Memory column shows. The whole working set counts
// the DLL pages every WebView2 and node process shares, which put the cockpit's own webview ~250 MB over what it
// holds. A Windows too old to fill the private working set gets the whole working set.
func footprint(pid int32) (uint64, bool) {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return 0, false
	}
	defer windows.CloseHandle(h)
	var m processMemoryCountersEx2
	// a Windows that refuses the EX2 size is asked for PROCESS_MEMORY_COUNTERS_EX's, which ends before the field
	if !memoryInfo(h, &m, unsafe.Sizeof(m)) && !memoryInfo(h, &m, unsafe.Offsetof(m.privateWorkingSetSize)) {
		return 0, false
	}
	if m.privateWorkingSetSize == 0 {
		return uint64(m.workingSetSize), true
	}
	return uint64(m.privateWorkingSetSize), true
}

func memoryInfo(h windows.Handle, m *processMemoryCountersEx2, cb uintptr) bool {
	*m = processMemoryCountersEx2{cb: uint32(cb)}
	r, _, _ := procGetProcessMemoryInfo.Call(uintptr(h), uintptr(unsafe.Pointer(m)), cb)
	return r != 0
}

// responsiblePid has no equivalent here: the webview's processes are found as the host's children instead.
func responsiblePid(int32) (int32, bool) {
	return 0, false
}
