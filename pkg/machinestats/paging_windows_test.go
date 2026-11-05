// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package machinestats

import (
	"testing"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// The counters RunPaging logs read from this machine: a wrong PDH_FMT_COUNTERVALUE layout or counter path reads
// nothing, and the log would leave the paging out of every line.
func TestThePagingCountersRead(t *testing.T) {
	var query windows.Handle
	if r, _, _ := procPdhOpenQueryW.Call(0, 0, uintptr(unsafe.Pointer(&query))); r != 0 {
		t.Fatalf("PdhOpenQuery: 0x%x", r)
	}
	defer procPdhCloseQuery.Call(uintptr(query))
	drive := pagefileDrive()
	pagesIn, ok1 := addCounter(query, `\Memory\Pages Input/sec`)
	readSec, ok2 := addCounter(query, `\LogicalDisk(`+drive+`)\Avg. Disk sec/Read`)
	if !ok1 || !ok2 {
		t.Fatalf("adding the counters (pagefile drive %s): pages in %v, read latency %v", drive, ok1, ok2)
	}
	procPdhCollectQueryData.Call(uintptr(query))
	time.Sleep(1100 * time.Millisecond)
	if r, _, _ := procPdhCollectQueryData.Call(uintptr(query)); r != 0 {
		t.Fatalf("PdhCollectQueryData: 0x%x", r)
	}
	in, inOk := counterValue(pagesIn)
	sec, secOk := counterValue(readSec)
	if !inOk || !secOk || in < 0 || sec < 0 {
		t.Fatalf("pages in %v (%v), read %vs (%v)", in, inOk, sec, secOk)
	}
	t.Logf("pagefile drive %s: %.0f pages in/s, %.1f ms read", drive, in, sec*1000)
}
