// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package memusage

import (
	"errors"
	"unsafe"

	"golang.org/x/sys/windows"
)

// readParents is every running pid's parent, from one toolhelp snapshot. gopsutil's Ppid takes a snapshot of
// every process for each process it asks about, so reading the table through it grows with the square of the
// process count: 11 s for 441 processes, longer than the Consumers panel's poll.
func readParents() (map[int32]int32, error) {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, err
	}
	defer windows.CloseHandle(snap)
	var e windows.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	parent := map[int32]int32{}
	for err = windows.Process32First(snap, &e); err == nil; err = windows.Process32Next(snap, &e) {
		parent[int32(e.ProcessID)] = int32(e.ParentProcessID)
	}
	if !errors.Is(err, windows.ERROR_NO_MORE_FILES) {
		return nil, err
	}
	return parent, nil
}
