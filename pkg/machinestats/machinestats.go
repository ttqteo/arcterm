// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package machinestats reads the machine's memory, CPU and disks for the menu bar / tray popover
// (spec 2026-10-15-tray-popover-design.md). CPU is read once a second from wavesrv's start (RunCPU): a reading costs
// about 6 µs, and the popover then has the last second's load the moment it opens, never a 0 while a sampler starts.
package machinestats

import (
	"context"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/wavetermdev/waveterm/pkg/jobqueue"
)

const CPUInterval = time.Second

// PressureWord is the popover's word for a pressure level; "" when the OS gave no reading.
func PressureWord(p jobqueue.Pressure) string {
	switch p {
	case jobqueue.PressureNormal:
		return "normal"
	case jobqueue.PressureWarn:
		return "high"
	case jobqueue.PressureCritical:
		return "critical"
	}
	return ""
}

// Latest holds the last CPU reading; none until the first lands.
type Latest struct {
	mu sync.Mutex
	v  float64
	ok bool
}

func (l *Latest) Set(v float64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.v, l.ok = v, true
}

func (l *Latest) Get() (float64, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.v, l.ok
}

var cpuLatest Latest

// WatchCPU stores read's value every interval until ctx ends. The first call's value is dropped: read is a busy
// percent since the call before it, and before the first call that is gopsutil's init.
func WatchCPU(ctx context.Context, read func() float64, interval time.Duration, store func(float64)) {
	read()
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			store(read())
		}
	}
}

// RunCPU keeps the CPU reading Read returns current, once a CPUInterval, until ctx ends.
func RunCPU(ctx context.Context) {
	WatchCPU(ctx, readCPU, CPUInterval, cpuLatest.Set)
}

// readCPU is the whole machine's busy percent since the previous call (0 on the first)
func readCPU() float64 {
	v, err := cpu.Percent(0, false)
	if err != nil || len(v) == 0 {
		return 0
	}
	return v[0]
}

type Stats struct {
	MemTotal     uint64
	MemAvailable uint64
	Pressure     string
	CpuPct       *float64 // the last second's busy percent, nil before RunCPU's first reading
	SwapTotal    uint64   // the swap files' size on macOS, the paging file's on Windows; never in MemTotal
	SwapUsed     uint64
	Disks        []Disk // the system disk first
}

// Disk is one volume the popover's Storage card shows.
type Disk struct {
	Name  string
	Root  string // where its paths start: `C:\`, or "/"
	Total uint64
	Free  uint64
}

// Read is one reading, with RunCPU's last CPU reading.
func Read(ctx context.Context) (Stats, error) {
	vm, err := mem.VirtualMemoryWithContext(ctx)
	if err != nil {
		return Stats{}, err
	}
	st := Stats{
		MemTotal:     vm.Total,
		MemAvailable: vm.Available,
		Pressure:     PressureWord(jobqueue.ReadPressure(ctx)),
	}
	if v, ok := cpuLatest.Get(); ok {
		st.CpuPct = &v
	}
	// on macOS one sysctl (vm.swapusage)
	if sw, err := mem.SwapMemoryWithContext(ctx); err == nil {
		st.SwapTotal, st.SwapUsed = sw.Total, sw.Used
	}
	for _, d := range listDisks() {
		if du, err := disk.UsageWithContext(ctx, d.Root); err == nil {
			d.Total, d.Free = du.Total, du.Free
			st.Disks = append(st.Disks, d)
		}
	}
	return st, nil
}

// MemReading is what WatchMemory reads: the pressure's word and the memory available, 0 with no reading.
type MemReading struct {
	Level     string
	Available uint64
}

// ReadMemory is one MemReading. On macOS it is a few sysctls and one host_statistics64.
func ReadMemory(ctx context.Context) MemReading {
	r := MemReading{Level: PressureWord(jobqueue.ReadPressure(ctx))}
	if vm, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		r.Available = vm.Available
	}
	return r
}

// a tenth of a GiB: the step the tray's figure shows (frontend fmtSize, trayicon.rs fmt_mem)
const memStep = (1 << 30) / 10

// WatchMemory calls publish at start and each time the level's word or the memory available, to the tenth of a GiB,
// changes, reading both every interval until ctx ends.
func WatchMemory(ctx context.Context, read func(context.Context) MemReading, interval time.Duration, publish func(MemReading)) {
	t := time.NewTicker(interval)
	defer t.Stop()
	var last MemReading
	first := true
	steps := func(b uint64) uint64 { return (b + memStep/2) / memStep }
	for {
		r := read(ctx)
		if first || r.Level != last.Level || steps(r.Available) != steps(last.Available) {
			publish(r)
			last, first = r, false
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
