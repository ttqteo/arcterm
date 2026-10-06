// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package workercap estimates how many more orchestrator workers the machine's free RAM holds. The engine
// feeds it each live worker's process-tree RSS on its liveness sample (pkg/orchestrate); the app reads it
// through GetWorkerCapacityCommand. The samples live in memory only: workers do not survive a restart either.
package workercap

import "sync"

// DefaultPerWorker is the per-worker estimate before any worker has been sampled: a claude process (~350 MB)
// plus a build or a test run in its tree.
const DefaultPerWorker uint64 = 1536 << 20

// RecentPeaks is how many finished workers' peaks the estimate remembers.
const RecentPeaks = 10

type sample struct {
	rss  uint64
	peak uint64
}

var (
	mu     sync.Mutex
	live   = map[string]sample{} // by worker block id
	recent []uint64              // peaks of the last RecentPeaks finished workers, oldest first
)

// Observe records a live worker's process-tree RSS, keeping its peak. A zero reading (no node of the tree
// could be read) is not a measurement and is dropped, as is an empty block id.
func Observe(blockId string, rss uint64) {
	if blockId == "" || rss == 0 {
		return
	}
	mu.Lock()
	defer mu.Unlock()
	s := live[blockId]
	s.rss = rss
	s.peak = max(s.peak, rss)
	live[blockId] = s
}

// Snapshot retires every live worker whose block no longer runs (its peak joins the recent ones, the oldest
// dropped past RecentPeaks) and returns the live workers' current RSS and the per-worker estimate: the
// highest peak, live or recent. The max, not an average: a worker idles at its prompt and spikes in a build,
// and on a small machine an underestimate is the expensive mistake. With no peak at all it is
// DefaultPerWorker and measured is false.
func Snapshot(isRunning func(blockId string) bool) (liveRSS []uint64, perWorker uint64, measured bool) {
	mu.Lock()
	defer mu.Unlock()
	for id, s := range live {
		if isRunning(id) {
			continue
		}
		delete(live, id)
		recent = append(recent, s.peak)
		if len(recent) > RecentPeaks {
			recent = recent[len(recent)-RecentPeaks:]
		}
	}
	for _, s := range live {
		liveRSS = append(liveRSS, s.rss)
		perWorker = max(perWorker, s.peak)
	}
	for _, p := range recent {
		perWorker = max(perWorker, p)
	}
	if perWorker == 0 {
		return liveRSS, DefaultPerWorker, false
	}
	return liveRSS, perWorker, true
}

// Capacity is how many more workers fit, with the numbers that say why.
type Capacity struct {
	Total       uint64
	Available   uint64
	PerWorker   uint64
	Reserve     uint64 // room the live workers may still grow into
	Measured    bool   // false: PerWorker is DefaultPerWorker
	LiveWorkers int
	More        int
}

// Compute holds back the room every live worker may still grow into (up to perWorker each), then splits what
// is left of available into perWorker slices. Never below 0; not capped at the engine's MaxParallelism,
// because this describes the machine and the steppers cap themselves. A zero perWorker means the default.
func Compute(total, available, perWorker uint64, liveRSS []uint64) Capacity {
	if perWorker == 0 {
		perWorker = DefaultPerWorker
	}
	var reserve uint64
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
		Reserve:     reserve,
		LiveWorkers: len(liveRSS),
		More:        more,
	}
}

// Read is the whole reading: retire stopped workers, estimate, compute.
func Read(total, available uint64, isRunning func(blockId string) bool) Capacity {
	liveRSS, perWorker, measured := Snapshot(isRunning)
	c := Compute(total, available, perWorker, liveRSS)
	c.Measured = measured
	return c
}
