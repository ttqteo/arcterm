// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package cmd

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

// jobslotProcs is the process table, each process's parent and image name; nil when it cannot be read, which holds
// wsh's own parent as before.
func jobslotProcs() map[int32]jobslotProc {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil
	}
	defer windows.CloseHandle(snap)
	var e windows.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	if err := windows.Process32First(snap, &e); err != nil {
		return nil
	}
	procs := map[int32]jobslotProc{}
	for {
		procs[int32(e.ProcessID)] = jobslotProc{parent: int32(e.ParentProcessID), image: windows.UTF16ToString(e.ExeFile[:])}
		if err := windows.Process32Next(snap, &e); err != nil {
			return procs
		}
	}
}
