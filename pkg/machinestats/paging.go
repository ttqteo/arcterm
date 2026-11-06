// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package machinestats

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jobqueue"
)

// Windows's memory pressure (jobqueue.PressureFromCommit) reads critical on a dev box at 143% commit with 6 GB of
// 32 free, and on the 2026-10-14 stall at 5.2 GB free alike: those three numbers cannot tell them apart. The paging
// log writes, for each minute that reads warn or critical or whose pagefile disk is slow, the paging rate and that
// disk's read latency beside them, so a threshold that does tell them apart can be set from real days (initiative
// chunk "Re-measure: Windows paging signal", due 2026-11-19).

// PagingInterval is how often the paging log samples; PagingWindow the span each line sums up.
const (
	PagingInterval = 5 * time.Second
	PagingWindow   = time.Minute
)

// slowReadMs is a pagefile-disk read latency that is logged whatever the pressure reads: a stall the commit rule
// misses still shows. A logging bar, not a gate.
const slowReadMs = 50

// PagingSample is one reading: the commit rule's three numbers, the pages read from disk to resolve hard faults per
// second (\Memory\Pages Input/sec), and the pagefile disk's average read latency (\LogicalDisk(X:)\Avg. Disk
// sec/Read). ok is false for a counter the reading could not take.
type PagingSample struct {
	Commit, Phys, Avail uint64
	PagesIn             float64
	PagesInOk           bool
	ReadMs              float64
	ReadMsOk            bool
}

// pagingWindow sums up the samples of one PagingWindow.
type pagingWindow struct {
	n              int
	worst          jobqueue.Pressure
	last           PagingSample
	minAvail       uint64
	inN, latN      int
	inSum, inMax   float64
	latSum, latMax float64
}

func (w *pagingWindow) add(s PagingSample) {
	if p := jobqueue.PressureFromCommit(s.Commit, s.Phys, s.Avail); p > w.worst {
		w.worst = p
	}
	if w.n == 0 || s.Avail < w.minAvail {
		w.minAvail = s.Avail
	}
	w.n++
	w.last = s
	if s.PagesInOk {
		w.inN++
		w.inSum += s.PagesIn
		w.inMax = max(w.inMax, s.PagesIn)
	}
	if s.ReadMsOk {
		w.latN++
		w.latSum += s.ReadMs
		w.latMax = max(w.latMax, s.ReadMs)
	}
}

// worth reports whether the window goes in the log: it read warn or critical, or its pagefile disk was slow.
func (w *pagingWindow) worth() bool {
	return w.n > 0 && (w.worst == jobqueue.PressureWarn || w.worst == jobqueue.PressureCritical || w.latMax >= slowReadMs)
}

// line is the window's log line, e.g. "[paging] critical: commit 45.6 GB on 31.8 GB RAM, 6.0 GB free (min 5.9 GB);
// pages in 700/s avg, 1200 max; C: read 3 ms avg, 25 ms max".
func (w *pagingWindow) line(drive string) string {
	level := PressureWord(w.worst)
	if level == "" {
		level = "no pressure"
	}
	var b strings.Builder
	fmt.Fprintf(&b, "[paging] %s: commit %s on %s RAM, %s free (min %s)", level, gb(w.last.Commit), gb(w.last.Phys), gb(w.last.Avail), gb(w.minAvail))
	if w.inN > 0 {
		fmt.Fprintf(&b, "; pages in %.0f/s avg, %.0f max", w.inSum/float64(w.inN), w.inMax)
	}
	if w.latN > 0 {
		fmt.Fprintf(&b, "; %s read %.0f ms avg, %.0f ms max", drive, w.latSum/float64(w.latN), w.latMax)
	}
	return b.String()
}

func gb(n uint64) string {
	return fmt.Sprintf("%.1f GB", float64(n)/(1<<30))
}

// WatchPaging samples read every interval until ctx ends, and at the end of each window logs its line when the
// window is worth it. A failed read (ok false) is skipped.
func WatchPaging(ctx context.Context, read func() (PagingSample, bool), interval, window time.Duration, drive string, logf func(string)) {
	t := time.NewTicker(interval)
	defer t.Stop()
	var w pagingWindow
	start := time.Now()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-t.C:
			if s, ok := read(); ok {
				w.add(s)
			}
			if now.Sub(start) < window {
				continue
			}
			if w.worth() {
				logf(w.line(drive))
			}
			w, start = pagingWindow{}, now
		}
	}
}
