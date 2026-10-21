// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package devservers

import (
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

// stdoutFile is the file pid's stdout (else its stderr) writes to, "" when it writes to a console or a pipe, or pid
// can't be read. The handles are the ones its process parameters name; a 32-bit process, whose PEB is laid out
// otherwise, is skipped.
func stdoutFile(pid int32) string {
	h, err := windows.OpenProcess(
		windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.PROCESS_VM_READ|windows.PROCESS_DUP_HANDLE,
		false, uint32(pid))
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)
	var wow64 bool
	if windows.IsWow64Process(h, &wow64) != nil || wow64 {
		return ""
	}
	var pbi windows.PROCESS_BASIC_INFORMATION
	if windows.NtQueryInformationProcess(h, windows.ProcessBasicInformation, unsafe.Pointer(&pbi),
		uint32(unsafe.Sizeof(pbi)), nil) != nil || pbi.PebBaseAddress == nil {
		return ""
	}
	var peb windows.PEB
	if !readMem(h, uintptr(unsafe.Pointer(pbi.PebBaseAddress)), unsafe.Pointer(&peb), unsafe.Sizeof(peb)) ||
		peb.ProcessParameters == nil {
		return ""
	}
	var params windows.RTL_USER_PROCESS_PARAMETERS
	if !readMem(h, uintptr(unsafe.Pointer(peb.ProcessParameters)), unsafe.Pointer(&params), unsafe.Sizeof(params)) {
		return ""
	}
	for _, src := range []windows.Handle{params.StandardOutput, params.StandardError} {
		if path := diskPath(h, src); path != "" {
			return path
		}
	}
	return ""
}

func readMem(h windows.Handle, addr uintptr, dst unsafe.Pointer, size uintptr) bool {
	var n uintptr
	return windows.ReadProcessMemory(h, addr, (*byte)(dst), size, &n) == nil && n == size
}

// diskPath is the path of the file src (a handle in process h) is open on; "" for a console, a pipe or a handle
// that no longer duplicates. Only a disk file's name is asked: asking a pipe's can block.
func diskPath(h, src windows.Handle) string {
	if src == 0 || src == windows.InvalidHandle {
		return ""
	}
	var dup windows.Handle
	if windows.DuplicateHandle(h, src, windows.CurrentProcess(), &dup, 0, false, windows.DUPLICATE_SAME_ACCESS) != nil {
		return ""
	}
	defer windows.CloseHandle(dup)
	if t, err := windows.GetFileType(dup); err != nil || t != windows.FILE_TYPE_DISK {
		return ""
	}
	buf := make([]uint16, windows.MAX_LONG_PATH)
	n, err := windows.GetFinalPathNameByHandle(dup, &buf[0], uint32(len(buf)), 0)
	if err != nil || n == 0 || int(n) > len(buf) {
		return ""
	}
	path := windows.UTF16ToString(buf[:n])
	// \\?\UNC\server\share\x is \\server\share\x; \\?\D:\x is D:\x
	if rest, ok := strings.CutPrefix(path, `\\?\UNC\`); ok {
		return `\\` + rest
	}
	return strings.TrimPrefix(path, `\\?\`)
}
