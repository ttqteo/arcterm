// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package machinestats

import (
	"context"
	"log"
	"os"
	"strings"
	"unsafe"

	"github.com/shirou/gopsutil/v4/mem"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

var (
	pdh                             = windows.NewLazySystemDLL("pdh.dll")
	procPdhOpenQueryW               = pdh.NewProc("PdhOpenQueryW")
	procPdhAddEnglishCounterW       = pdh.NewProc("PdhAddEnglishCounterW")
	procPdhCollectQueryData         = pdh.NewProc("PdhCollectQueryData")
	procPdhGetFormattedCounterValue = pdh.NewProc("PdhGetFormattedCounterValue")
	procPdhCloseQuery               = pdh.NewProc("PdhCloseQuery")
)

const pdhFmtDouble = 0x00000200

// pdhFmtCounterValue is PDH_FMT_COUNTERVALUE read as a double: the union's 8-byte alignment puts the value at 8.
type pdhFmtCounterValue struct {
	CStatus     uint32
	DoubleValue float64
}

// RunPaging writes the paging log (WatchPaging) until ctx ends. Nothing is logged when PDH cannot open its query.
func RunPaging(ctx context.Context) {
	var query windows.Handle
	if r, _, _ := procPdhOpenQueryW.Call(0, 0, uintptr(unsafe.Pointer(&query))); r != 0 {
		log.Printf("[paging] no paging log: PdhOpenQuery returned 0x%x", r)
		return
	}
	defer procPdhCloseQuery.Call(uintptr(query))
	drive := pagefileDrive()
	pagesIn, inOk := addCounter(query, `\Memory\Pages Input/sec`)
	readSec, latOk := addCounter(query, `\LogicalDisk(`+drive+`)\Avg. Disk sec/Read`)
	if !inOk && !latOk {
		log.Printf("[paging] no paging log: neither counter could be added")
		return
	}
	// a rate counter needs a collect before the first reading
	procPdhCollectQueryData.Call(uintptr(query))
	read := func() (PagingSample, bool) {
		vm, err := mem.NewExWindows().VirtualMemory()
		if err != nil {
			return PagingSample{}, false
		}
		s := PagingSample{Commit: vm.CommitTotal, Phys: vm.PhysTotal, Avail: vm.PhysAvail}
		if r, _, _ := procPdhCollectQueryData.Call(uintptr(query)); r == 0 {
			if inOk {
				s.PagesIn, s.PagesInOk = counterValue(pagesIn)
			}
			if latOk {
				var sec float64
				sec, s.ReadMsOk = counterValue(readSec)
				s.ReadMs = sec * 1000
			}
		}
		return s, true
	}
	WatchPaging(ctx, read, PagingInterval, PagingWindow, drive, func(line string) { log.Print(line) })
}

func addCounter(query windows.Handle, path string) (windows.Handle, bool) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, false
	}
	var counter windows.Handle
	if r, _, _ := procPdhAddEnglishCounterW.Call(uintptr(query), uintptr(unsafe.Pointer(p)), 0, uintptr(unsafe.Pointer(&counter))); r != 0 {
		log.Printf("[paging] counter %s: PdhAddEnglishCounter returned 0x%x", path, r)
		return 0, false
	}
	return counter, true
}

func counterValue(counter windows.Handle) (float64, bool) {
	var v pdhFmtCounterValue
	if r, _, _ := procPdhGetFormattedCounterValue.Call(uintptr(counter), pdhFmtDouble, 0, uintptr(unsafe.Pointer(&v))); r != 0 {
		return 0, false
	}
	return v.DoubleValue, true
}

// pagefileDrive is the drive of the first paging file Windows lists ("C:"), else the system drive: "?:" in the list
// means a system-managed file, which lives there.
func pagefileDrive() string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management`, registry.QUERY_VALUE)
	if err == nil {
		defer k.Close()
		if files, _, err := k.GetStringsValue("PagingFiles"); err == nil {
			for _, f := range files {
				if f = strings.TrimSpace(f); len(f) >= 2 && f[1] == ':' && f[0] != '?' {
					return strings.ToUpper(f[:2])
				}
			}
		}
	}
	if d := os.Getenv("SystemDrive"); len(d) == 2 && d[1] == ':' {
		return strings.ToUpper(d)
	}
	return "C:"
}
