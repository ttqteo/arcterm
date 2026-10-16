// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package machinestats

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jobqueue"
)

func TestPressureWord(t *testing.T) {
	cases := map[jobqueue.Pressure]string{
		jobqueue.PressureUnknown:  "",
		jobqueue.PressureNormal:   "normal",
		jobqueue.PressureWarn:     "high",
		jobqueue.PressureCritical: "critical",
	}
	for p, want := range cases {
		if got := PressureWord(p); got != want {
			t.Errorf("PressureWord(%d) = %q, want %q", p, got, want)
		}
	}
}

func TestSamplerSamplesWhileAskedThenStops(t *testing.T) {
	var mu sync.Mutex
	n := 0.0
	s := NewSampler(func() float64 { mu.Lock(); defer mu.Unlock(); n++; return n }, 10*time.Millisecond, 60*time.Millisecond)
	s.Samples()
	time.Sleep(45 * time.Millisecond)
	got := s.Samples()
	if len(got) < 2 {
		t.Fatalf("after 45ms of asking, %d samples, want at least 2", len(got))
	}
	if got[0] >= got[len(got)-1] {
		t.Fatalf("samples not oldest first: %v", got)
	}
	time.Sleep(150 * time.Millisecond)
	if s.Running() {
		t.Fatal("the sampler still runs 150ms after the last ask (idle stop is 60ms)")
	}
	if got := s.Samples(); len(got) > 1 {
		t.Fatalf("a restarted sampler kept %d old samples", len(got))
	}
}

func TestSamplerKeepsTheLastSixty(t *testing.T) {
	s := NewSampler(func() float64 { return 1 }, time.Millisecond, time.Second)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if len(s.Samples()) == MaxSamples {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	time.Sleep(30 * time.Millisecond)
	if got := len(s.Samples()); got != MaxSamples {
		t.Fatalf("len = %d, want %d", got, MaxSamples)
	}
}

func TestWatchMemoryPublishesOnChange(t *testing.T) {
	const gib = 1 << 30
	seq := []MemReading{
		{"normal", 2 * gib},
		{"normal", 2*gib + 10<<20}, // 2.0 GB still: not published
		{"normal", 1 * gib},
		{"high", 1 * gib},
		{"high", 1*gib + 20<<20}, // 1.0 GB still
		{"critical", 1 * gib},
	}
	var mu sync.Mutex
	i := 0
	read := func(context.Context) MemReading {
		mu.Lock()
		defer mu.Unlock()
		r := seq[min(i, len(seq)-1)]
		i++
		return r
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	got := make(chan MemReading, 10)
	go WatchMemory(ctx, read, 2*time.Millisecond, func(r MemReading) { got <- r })
	var readings []MemReading
	for len(readings) < 4 {
		select {
		case r := <-got:
			readings = append(readings, r)
		case <-time.After(2 * time.Second):
			t.Fatalf("published %v, want four changes", readings)
		}
	}
	want := []MemReading{seq[0], seq[2], seq[3], seq[5]}
	for k := range want {
		if readings[k] != want[k] {
			t.Fatalf("published %v, want %v", readings, want)
		}
	}
	select {
	case r := <-got:
		t.Fatalf("published %v after the last change", r)
	case <-time.After(20 * time.Millisecond):
	}
}

func TestReadMemory(t *testing.T) {
	if r := ReadMemory(context.Background()); r.Available == 0 {
		t.Fatalf("no memory available in %+v", r)
	}
}

func TestReadReturnsMemoryAndDisk(t *testing.T) {
	st, err := Read(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if st.MemTotal == 0 || st.MemAvailable == 0 || st.MemAvailable > st.MemTotal {
		t.Fatalf("memory %d of %d", st.MemAvailable, st.MemTotal)
	}
	if st.DiskTotal == 0 || st.DiskFree > st.DiskTotal {
		t.Fatalf("disk %d of %d", st.DiskFree, st.DiskTotal)
	}
	if st.DiskName == "" {
		t.Fatal("no disk name")
	}
}
