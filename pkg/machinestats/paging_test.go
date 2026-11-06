// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package machinestats

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"
)

const gib = 1 << 30

// this box on 2026-11-05: 45.6 GB committed on 31.8 GB, 6 GB free, which the commit rule reads critical
func criticalSample(pagesIn, readMs float64) PagingSample {
	return PagingSample{Commit: 456 * gib / 10, Phys: 318 * gib / 10, Avail: 6 * gib, PagesIn: pagesIn, PagesInOk: true, ReadMs: readMs, ReadMsOk: true}
}

// under the RAM: no pressure
func calmSample(readMs float64) PagingSample {
	return PagingSample{Commit: 20 * gib, Phys: 32 * gib, Avail: 12 * gib, PagesIn: 10, PagesInOk: true, ReadMs: readMs, ReadMsOk: true}
}

func TestAPressuredMinuteIsLoggedWithItsPagingAndLatency(t *testing.T) {
	var w pagingWindow
	w.add(criticalSample(600, 2))
	s := criticalSample(800, 4)
	s.Avail = 59 * gib / 10
	w.add(s)
	if !w.worth() {
		t.Fatal("a minute that read critical must be logged")
	}
	got := w.line("C:")
	want := "[paging] critical: commit 45.6 GB on 31.8 GB RAM, 5.9 GB free (min 5.9 GB); pages in 700/s avg, 800 max; C: read 3 ms avg, 4 ms max"
	if got != want {
		t.Fatalf("line:\n got %q\nwant %q", got, want)
	}
}

func TestACalmMinuteIsNotLoggedUnlessItsDiskIsSlow(t *testing.T) {
	var w pagingWindow
	w.add(calmSample(3))
	if w.worth() {
		t.Fatal("a calm minute with a fast disk is not logged")
	}
	w.add(calmSample(slowReadMs))
	if !w.worth() {
		t.Fatal("a slow pagefile disk is logged whatever the pressure reads")
	}
	if line := w.line("D:"); !strings.HasPrefix(line, "[paging] no pressure:") || !strings.Contains(line, "D: read") {
		t.Fatalf("line %q", line)
	}
}

func TestAMissingCounterIsLeftOutOfTheLine(t *testing.T) {
	var w pagingWindow
	s := criticalSample(0, 0)
	s.PagesInOk, s.ReadMsOk = false, false
	w.add(s)
	if line := w.line("C:"); strings.Contains(line, "pages in") || strings.Contains(line, "read") {
		t.Fatalf("a counter with no reading must not show as 0: %q", line)
	}
}

func TestWatchPagingLogsOneLinePerWorthyWindow(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var mu sync.Mutex
	var lines []string
	reads := 0
	read := func() (PagingSample, bool) {
		mu.Lock()
		defer mu.Unlock()
		reads++
		return criticalSample(100, 1), true
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		WatchPaging(ctx, read, time.Millisecond, 20*time.Millisecond, "C:", func(l string) {
			mu.Lock()
			defer mu.Unlock()
			lines = append(lines, l)
		})
	}()
	deadline := time.Now().Add(5 * time.Second)
	for {
		mu.Lock()
		n, r := len(lines), reads
		mu.Unlock()
		if n >= 2 {
			if n > r {
				t.Fatalf("%d lines from %d reads: a window logs once", n, r)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("want two window lines, got %d", n)
		}
		time.Sleep(5 * time.Millisecond)
	}
	cancel()
	<-done
}
