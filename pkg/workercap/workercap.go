// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package workercap estimates how many more orchestrator workers the machine's free RAM holds. The engine
// feeds it each live worker's process-tree RSS on its liveness sample (pkg/orchestrate); the app reads it
// through GetWorkerCapacityCommand. The samples live in memory only: workers do not survive a restart either.
//
// A worker spends most of its life small and spikes only in a heavy job. Measured on an 8 GB Mac
// (2026-10-06, process-tree footprint plus the claude process's ~330 MB): idle or asking ~330 MB, go test
// ~420 MB, the full vitest suite ~920 MB, headless Chromium ~940 MB, tsc --noEmit ~3.1 GB for about a
// minute. Sizing every worker at the peak read a machine with room for four workers as room for one; sizing
// them at the typical size let two overlapping tsc runs swap. So each worker counts at its typical size, and
// one heavy job's extra is held back once: several workers rarely spike at the same moment.
package workercap

import "sync"

// DefaultPerWorker is the typical worker size before any worker has been sampled.
const DefaultPerWorker uint64 = 1 << 30

// DefaultHeavy is the heaviest job's size before any worker has been sampled: this repo's tsc run.
const DefaultHeavy uint64 = 3 << 30

// RecentWorkers is how many finished workers the estimate remembers.
const RecentWorkers = 10

type sample struct {
	rss  uint64 // the latest reading
	peak uint64
	sum  uint64 // of every reading, for the mean
	n    uint64
}

type finished struct {
	mean uint64
	peak uint64
}

var (
	mu     sync.Mutex
	live   = map[string]sample{} // by worker block id
	recent []finished            // the last RecentWorkers finished workers, oldest first
)

// Observe records a live worker's process-tree RSS, keeping its mean and its peak. A zero reading (no node of
// the tree could be read) is not a measurement and is dropped, as is an empty block id.
func Observe(blockId string, rss uint64) {
	if blockId == "" || rss == 0 {
		return
	}
	mu.Lock()
	defer mu.Unlock()
	s := live[blockId]
	s.rss = rss
	s.peak = max(s.peak, rss)
	s.sum += rss
	s.n++
	live[blockId] = s
}

// Estimate is what the samples say: the live workers' current RSS, a typical worker's size (the mean of the
// workers' means, live and recent) and the heaviest job's (the highest peak, live or recent).
type Estimate struct {
	LiveRSS   []uint64
	PerWorker uint64
	Heavy     uint64
	Measured  bool // false: PerWorker and Heavy are the defaults
}

// Snapshot retires every live worker whose block no longer runs (it joins the recent ones, the oldest dropped
// past RecentWorkers) and estimates from the live and recent workers.
func Snapshot(isRunning func(blockId string) bool) Estimate {
	mu.Lock()
	defer mu.Unlock()
	for id, s := range live {
		if isRunning(id) {
			continue
		}
		delete(live, id)
		recent = append(recent, finished{mean: s.sum / s.n, peak: s.peak})
		if len(recent) > RecentWorkers {
			recent = recent[len(recent)-RecentWorkers:]
		}
	}
	var e Estimate
	var meanSum, workers uint64
	for _, s := range live {
		e.LiveRSS = append(e.LiveRSS, s.rss)
		meanSum += s.sum / s.n
		workers++
		e.Heavy = max(e.Heavy, s.peak)
	}
	for _, f := range recent {
		meanSum += f.mean
		workers++
		e.Heavy = max(e.Heavy, f.peak)
	}
	if workers == 0 {
		e.PerWorker, e.Heavy = DefaultPerWorker, DefaultHeavy
		return e
	}
	e.PerWorker, e.Measured = meanSum/workers, true
	return e
}

// Capacity is how many more workers fit, with the numbers that say why.
type Capacity struct {
	Total       uint64
	Available   uint64
	PerWorker   uint64 // a typical worker
	Heavy       uint64 // the heaviest job
	Reserve     uint64 // room the live workers may still grow into, plus one heavy job's extra
	Measured    bool   // false: PerWorker and Heavy are the defaults
	LiveWorkers int
	More        int
}

// Compute holds back the room every live worker may still grow into (up to the typical size each) and, once,
// what a heavy job needs beyond a typical worker, then splits what is left of available into typical
// slices. Never below 0; not capped at the engine's MaxParallelism, because this describes the machine and
// the steppers cap themselves. Zero estimates mean the defaults.
func Compute(total, available, perWorker, heavy uint64, liveRSS []uint64) Capacity {
	if perWorker == 0 {
		perWorker = DefaultPerWorker
	}
	if heavy == 0 {
		heavy = DefaultHeavy
	}
	heavy = max(heavy, perWorker)
	reserve := heavy - perWorker
	for _, rss := range liveRSS {
		if rss < perWorker {
			reserve += perWorker - rss
		}
	}
	more := 0
	if available > reserve {
		more = int((available - reserve) / perWorker)
	}
	return Capacity{
		Total:       total,
		Available:   available,
		PerWorker:   perWorker,
		Heavy:       heavy,
		Reserve:     reserve,
		LiveWorkers: len(liveRSS),
		More:        more,
	}
}

// Read is the whole reading: retire stopped workers, estimate, compute.
func Read(total, available uint64, isRunning func(blockId string) bool) Capacity {
	e := Snapshot(isRunning)
	c := Compute(total, available, e.PerWorker, e.Heavy, e.LiveRSS)
	c.Measured = e.Measured
	return c
}
