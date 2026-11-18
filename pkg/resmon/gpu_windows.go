// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package resmon

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

// The "GPU Engine" counters Task Manager reads, through PDH. A query holds one wildcard counter; a rate counter needs
// two collections, so the first read of a query answers nothing.
var (
	pdhDll                       = windows.NewLazySystemDLL("pdh.dll")
	pdhOpenQueryW                = pdhDll.NewProc("PdhOpenQueryW")
	pdhAddEnglishCounterW        = pdhDll.NewProc("PdhAddEnglishCounterW")
	pdhCollectQueryData          = pdhDll.NewProc("PdhCollectQueryData")
	pdhGetFormattedCounterArrayW = pdhDll.NewProc("PdhGetFormattedCounterArrayW")
	pdhCloseQuery                = pdhDll.NewProc("PdhCloseQuery")
)

const (
	pdhFmtDouble    = 0x00000200
	pdhFmtNoCap100  = 0x00008000
	pdhMoreData     = 0x800007D2
	pdhCstatusValid = 0x00000000
	pdhCstatusNew   = 0x00000001
	gpuCounterPath  = `\GPU Engine(*)\Utilization Percentage`
)

// PDH_FMT_COUNTERVALUE_ITEM_W with a double: the name, then the status and the value (the union is 8-aligned)
type pdhCounterItem struct {
	Name   *uint16
	Status uint32
	_      uint32
	Value  float64
}

type gpuReader struct {
	query   uintptr
	counter uintptr
	primed  bool
	failed  bool // the counter could not be set up: no GPU counters on this machine, never asked again
}

func (g *gpuReader) open() error {
	var q uintptr
	if r, _, _ := pdhOpenQueryW.Call(0, 0, uintptr(unsafe.Pointer(&q))); r != 0 {
		return fmt.Errorf("PdhOpenQuery: 0x%x", r)
	}
	path, _ := windows.UTF16PtrFromString(gpuCounterPath)
	var c uintptr
	if r, _, _ := pdhAddEnglishCounterW.Call(q, uintptr(unsafe.Pointer(path)), 0, uintptr(unsafe.Pointer(&c))); r != 0 {
		pdhCloseQuery.Call(q)
		return fmt.Errorf("PdhAddEnglishCounter: 0x%x", r)
	}
	g.query, g.counter, g.primed = q, c, false
	return nil
}

// read collects once and returns the machine's GPU and each process's. ok is false before the second collection
// and where the machine has no GPU counters.
func (g *gpuReader) read() (machine float64, byPid map[int]float64, ok bool) {
	if g.failed {
		return 0, nil, false
	}
	if g.query == 0 {
		if err := g.open(); err != nil {
			g.failed = true
			return 0, nil, false
		}
	}
	if r, _, _ := pdhCollectQueryData.Call(g.query); r != 0 {
		return 0, nil, false
	}
	if !g.primed {
		g.primed = true
		return 0, nil, false
	}
	var size, count uint32
	r, _, _ := pdhGetFormattedCounterArrayW.Call(g.counter, pdhFmtDouble|pdhFmtNoCap100,
		uintptr(unsafe.Pointer(&size)), uintptr(unsafe.Pointer(&count)), 0)
	if uint32(r) != pdhMoreData || size == 0 {
		// no instance at all (no GPU process running) reads as an idle GPU
		return 0, map[int]float64{}, uint32(r) == 0
	}
	buf := make([]byte, size)
	r, _, _ = pdhGetFormattedCounterArrayW.Call(g.counter, pdhFmtDouble|pdhFmtNoCap100,
		uintptr(unsafe.Pointer(&size)), uintptr(unsafe.Pointer(&count)), uintptr(unsafe.Pointer(&buf[0])))
	if r != 0 || count == 0 {
		return 0, nil, false
	}
	items := unsafe.Slice((*pdhCounterItem)(unsafe.Pointer(&buf[0])), count)
	uses := make([]gpuEngineUse, 0, count)
	for _, it := range items {
		if it.Status != pdhCstatusValid && it.Status != pdhCstatusNew {
			continue
		}
		pid, engine, parsed := parseGpuInstance(windows.UTF16PtrToString(it.Name))
		if !parsed {
			continue
		}
		uses = append(uses, gpuEngineUse{Pid: pid, Engine: engine, Pct: it.Value})
	}
	machine, byPid = gpuTotals(uses)
	return machine, byPid, true
}

// close ends the query: the sampler stopped, and the next one starts a fresh query (and primes it again).
func (g *gpuReader) close() {
	if g.query != 0 {
		pdhCloseQuery.Call(g.query)
	}
	g.query, g.counter, g.primed = 0, 0, false
}
