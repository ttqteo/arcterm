//go:build windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import (
	"errors"
	"fmt"
	"log"
	"slices"
	"unsafe"

	"github.com/shirou/gopsutil/v4/net"
	"golang.org/x/sys/windows"
)

const supported = true

// readTable lists every process's ppid and image name from one toolhelp snapshot.
func readTable() (map[int]proc, error) {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, fmt.Errorf("CreateToolhelp32Snapshot: %w", err)
	}
	defer windows.CloseHandle(snap)
	table := map[int]proc{}
	e := windows.ProcessEntry32{Size: uint32(unsafe.Sizeof(windows.ProcessEntry32{}))}
	for err = windows.Process32First(snap, &e); err == nil; err = windows.Process32Next(snap, &e) {
		pid := int(e.ProcessID)
		table[pid] = proc{Pid: pid, Ppid: int(e.ParentProcessID), Name: windows.UTF16ToString(e.ExeFile[:])}
	}
	if !errors.Is(err, windows.ERROR_NO_MORE_FILES) {
		return nil, fmt.Errorf("Process32Next: %w", err)
	}
	return table, nil
}

// mirrors PROCESS_MEMORY_COUNTERS_EX2 (psapi.h)
type processMemoryCounters struct {
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

var procGetProcessMemoryInfo = windows.NewLazySystemDLL("kernel32.dll").NewProc("K32GetProcessMemoryInfo")

func filetime100ns(ft windows.Filetime) uint64 {
	return uint64(ft.HighDateTime)<<32 | uint64(ft.LowDateTime)
}

// readStat opens pid with limited query rights, which even an elevated process grants; a process that still
// cannot be opened comes back not ok.
func readStat(pid int) procStat {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return procStat{}
	}
	defer windows.CloseHandle(h)
	var created, exited, kernel, user windows.Filetime
	if err := windows.GetProcessTimes(h, &created, &exited, &kernel, &user); err != nil {
		return procStat{}
	}
	s := procStat{ok: true, createTs: created.Nanoseconds() / 1e6, cpuTime: filetime100ns(kernel) + filetime100ns(user), mem: -1}
	s.mem = privateWorkingSet(h)
	return s
}

// privateWorkingSet is the RAM a process holds of its own: the Consumers panel's figure (pkg/memusage) and Task
// Manager's Memory column. The whole working set also counts the DLL pages every node, shell and WebView2 process
// shares, which put an agent's row ~170 MB over the same agent in Consumers. A Windows that refuses the EX2 size
// is asked for PROCESS_MEMORY_COUNTERS_EX's, which ends before the field, and then gets the whole working set;
// -1 when neither can be read.
func privateWorkingSet(h windows.Handle) int64 {
	var m processMemoryCounters
	if !memoryInfo(h, &m, unsafe.Sizeof(m)) && !memoryInfo(h, &m, unsafe.Offsetof(m.privateWorkingSetSize)) {
		return -1
	}
	if m.privateWorkingSetSize == 0 {
		return int64(m.workingSetSize)
	}
	return int64(m.privateWorkingSetSize)
}

func memoryInfo(h windows.Handle, m *processMemoryCounters, cb uintptr) bool {
	*m = processMemoryCounters{cb: uint32(cb)}
	r, _, _ := procGetProcessMemoryInfo.Call(uintptr(h), uintptr(unsafe.Pointer(m)), cb)
	return r != 0
}

const cmdlineBufLen = 4096

// readCmdline reads pid's command line (ProcessCommandLineInformation needs only limited query rights); ""
// when it cannot.
func readCmdline(pid int) string {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)
	buf := make([]byte, cmdlineBufLen)
	for {
		var retLen uint32
		err := windows.NtQueryInformationProcess(h, windows.ProcessCommandLineInformation, unsafe.Pointer(&buf[0]), uint32(len(buf)), &retLen)
		if err == nil {
			return (*windows.NTUnicodeString)(unsafe.Pointer(&buf[0])).String()
		}
		if !errors.Is(err, windows.STATUS_INFO_LENGTH_MISMATCH) || int(retLen) <= len(buf) {
			return ""
		}
		buf = make([]byte, retLen)
	}
}

// splitCmdline splits a command line as the C runtime would into argv; nil when it cannot.
func splitCmdline(cmdline string) []string {
	if cmdline == "" {
		return nil
	}
	argv, err := windows.DecomposeCommandLine(cmdline)
	if err != nil {
		return nil
	}
	return argv
}

const tcpListen = "LISTEN"

// readListenPorts maps each pid to the tcp ports (v4 and v6) it listens on, sorted and without repeats; nil
// when the tables cannot be read, which reads as "no ports", never as a wrong port.
func readListenPorts() map[int][]int {
	conns, err := net.Connections("tcp")
	if err != nil {
		log.Printf("resmon: reading the tcp tables: %v", err)
		return nil
	}
	ports := map[int][]int{}
	for _, c := range conns {
		pid, port := int(c.Pid), int(c.Laddr.Port)
		if c.Status != tcpListen || pid <= 0 || slices.Contains(ports[pid], port) {
			continue
		}
		ports[pid] = append(ports[pid], port)
	}
	for _, p := range ports {
		slices.Sort(p)
	}
	return ports
}
