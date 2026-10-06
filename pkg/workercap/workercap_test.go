// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package workercap

import (
	"fmt"
	"testing"
)

const gib uint64 = 1 << 30

func resetTracker(t *testing.T) {
	t.Helper()
	wipe := func() {
		mu.Lock()
		live, recent = map[string]sample{}, nil
		mu.Unlock()
	}
	wipe()
	t.Cleanup(wipe)
}

func allRunning(string) bool  { return true }
func noneRunning(string) bool { return false }

func TestCompute(t *testing.T) {
	cases := []struct {
		name      string
		available uint64
		perWorker uint64
		heavy     uint64
		liveRSS   []uint64
		wantPer   uint64
		wantHeavy uint64
		reserve   uint64
		more      int
	}{
		{"no live workers still holds one heavy job back", 4 * gib, gib, 3 * gib, nil, gib, 3 * gib, 2 * gib, 2},
		{"rounds down", 4*gib + gib/2, gib, 3 * gib, nil, gib, 3 * gib, 2 * gib, 2},
		{"a live worker below the typical size holds its growth room", 5 * gib, gib, 3 * gib, []uint64{gib / 2}, gib, 3 * gib, 5 * gib / 2, 2},
		{"a live worker above the typical size holds nothing more", 4 * gib, gib, 3 * gib, []uint64{2 * gib}, gib, 3 * gib, 2 * gib, 2},
		{"free RAM below the reserve is 0, not a wrapped uint64", gib + gib/4, gib, 3 * gib, nil, gib, 3 * gib, 2 * gib, 0},
		{"zero estimates fall back to the defaults", 6 * gib, 0, 0, nil, DefaultPerWorker, DefaultHeavy, 2 * gib, 4},
		{"a heavy job no bigger than a typical worker holds nothing extra", 3 * gib, gib, gib / 2, nil, gib, gib, 0, 3},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := Compute(8*gib, tc.available, tc.perWorker, tc.heavy, tc.liveRSS)
			if c.Total != 8*gib || c.Available != tc.available || c.PerWorker != tc.wantPer || c.Heavy != tc.wantHeavy {
				t.Fatalf("passthrough fields wrong: %+v", c)
			}
			if c.Reserve != tc.reserve || c.More != tc.more || c.LiveWorkers != len(tc.liveRSS) {
				t.Fatalf("got reserve %d more %d live %d, want reserve %d more %d live %d",
					c.Reserve, c.More, c.LiveWorkers, tc.reserve, tc.more, len(tc.liveRSS))
			}
		})
	}
}

func TestNoReadingsUseTheDefaults(t *testing.T) {
	resetTracker(t)
	e := Snapshot(allRunning)
	if len(e.LiveRSS) != 0 || e.PerWorker != DefaultPerWorker || e.Heavy != DefaultHeavy || e.Measured {
		t.Fatalf("got %+v, want no live workers, the defaults, unmeasured", e)
	}
}

func TestObserveKeepsTheMeanAndThePeak(t *testing.T) {
	resetTracker(t)
	Observe("a", gib)
	Observe("a", 3*gib)
	e := Snapshot(allRunning)
	if len(e.LiveRSS) != 1 || e.LiveRSS[0] != 3*gib || e.PerWorker != 2*gib || e.Heavy != 3*gib || !e.Measured {
		t.Fatalf("got %+v, want current 3 GiB, typical (mean) 2 GiB, heavy (peak) 3 GiB, measured", e)
	}
}

func TestObserveDropsAZeroReading(t *testing.T) {
	resetTracker(t)
	Observe("a", 0)
	Observe("", gib)
	if e := Snapshot(allRunning); e.PerWorker != DefaultPerWorker || e.Measured {
		t.Fatalf("a zero reading or an empty block is not a measurement, got %+v", e)
	}
}

func TestSnapshotRetiresStoppedBlocks(t *testing.T) {
	resetTracker(t)
	Observe("a", gib)
	Observe("a", 3*gib) // mean 2 GiB, peak 3 GiB
	Observe("b", gib)
	e := Snapshot(func(id string) bool { return id == "b" })
	if len(e.LiveRSS) != 1 || e.LiveRSS[0] != gib {
		t.Fatalf("a stopped worker leaves the live set, got %+v", e)
	}
	if e.PerWorker != 3*gib/2 || e.Heavy != 3*gib {
		t.Fatalf("typical is the mean of the workers' means and heavy the highest peak, live or finished, got %+v", e)
	}
	e = Snapshot(noneRunning)
	if len(e.LiveRSS) != 0 || e.PerWorker != 3*gib/2 || e.Heavy != 3*gib || !e.Measured {
		t.Fatalf("finished workers still set the estimate, got %+v", e)
	}
}

func TestRingKeepsTheLastTen(t *testing.T) {
	resetTracker(t)
	Observe("big", 5*gib)
	Snapshot(noneRunning)
	for i := range RecentWorkers {
		Observe(fmt.Sprint(i), gib)
		Snapshot(noneRunning)
	}
	if e := Snapshot(noneRunning); e.PerWorker != gib || e.Heavy != gib {
		t.Fatalf("the oldest worker falls out after %d newer ones, got %+v", RecentWorkers, e)
	}
}

func TestRead(t *testing.T) {
	resetTracker(t)
	Observe("a", gib)
	c := Read(8*gib, 4*gib, allRunning)
	want := Capacity{Total: 8 * gib, Available: 4 * gib, PerWorker: gib, Heavy: gib, Reserve: 0, Measured: true, LiveWorkers: 1, More: 4}
	if c != want {
		t.Fatalf("got %+v, want %+v", c, want)
	}
}
