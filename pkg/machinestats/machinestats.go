// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package machinestats reads the machine's memory, CPU and system disk for the menu bar / tray popover
// (spec 2026-10-15-tray-popover-design.md). CPU is sampled once a second only while someone keeps asking, and stops
// IdleStop after the last ask, as pkg/resmon's sampler does.
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

const (
	SampleInterval = time.Second
	IdleStop       = 10 * time.Second
	MaxSamples     = 60 // the popover's line is the last minute
)

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

// Sampler keeps the last MaxSamples readings of read, sampling every interval while Samples is called at least once
// per idle.
type Sampler struct {
	read     func() float64
	interval time.Duration
	idle     time.Duration

	mu       sync.Mutex
	running  bool
	lastCall time.Time
	samples  []float64
}

func NewSampler(read func() float64, interval, idle time.Duration) *Sampler {
	return &Sampler{read: read, interval: interval, idle: idle}
}

// Samples returns the readings so far, oldest first, starting the loop when it is not running.
func (s *Sampler) Samples() []float64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastCall = time.Now()
	if !s.running {
		s.running = true
		go s.loop()
	}
	return append([]float64(nil), s.samples...)
}

func (s *Sampler) Running() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.running
}

func (s *Sampler) loop() {
	t := time.NewTicker(s.interval)
	defer t.Stop()
	for {
		v := s.read()
		s.mu.Lock()
		s.samples = append(s.samples, v)
		if len(s.samples) > MaxSamples {
			s.samples = s.samples[len(s.samples)-MaxSamples:]
		}
		s.mu.Unlock()
		<-t.C
		s.mu.Lock()
		if time.Since(s.lastCall) > s.idle {
			// a later ask starts a fresh minute: an old line would draw a gap as if the CPU had idled
			s.running, s.samples = false, nil
			s.mu.Unlock()
			return
		}
		s.mu.Unlock()
	}
}

var cpuSampler = NewSampler(readCPU, SampleInterval, IdleStop)

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
	CpuPct       float64
	CpuSamples   []float64
	DiskName     string
	DiskTotal    uint64
	DiskFree     uint64
}

// Read is one reading; it also keeps the CPU sampler going for IdleStop.
func Read(ctx context.Context) (Stats, error) {
	vm, err := mem.VirtualMemoryWithContext(ctx)
	if err != nil {
		return Stats{}, err
	}
	samples := cpuSampler.Samples()
	st := Stats{
		MemTotal:     vm.Total,
		MemAvailable: vm.Available,
		Pressure:     PressureWord(jobqueue.ReadPressure(ctx)),
		CpuSamples:   samples,
		DiskName:     volumeName(),
	}
	if n := len(samples); n > 0 {
		st.CpuPct = samples[n-1]
	}
	if du, err := disk.UsageWithContext(ctx, systemRoot()); err == nil {
		st.DiskTotal, st.DiskFree = du.Total, du.Free
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
