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
		liveRSS   []uint64
		wantPer   uint64
		reserve   uint64
		more      int
	}{
		{"no live workers splits free RAM", 4 * gib, gib, nil, gib, 0, 4},
		{"rounds down", 3*gib + gib/2, gib, nil, gib, 0, 3},
		{"a live worker below the estimate holds its growth room", 4 * gib, 2 * gib, []uint64{gib / 2}, 2 * gib, 3 * gib / 2, 1},
		{"a live worker above the estimate holds nothing", 4 * gib, gib, []uint64{3 * gib}, gib, 0, 4},
		{"free RAM below the reserve is 0, not a wrapped uint64", gib, 2 * gib, []uint64{gib / 4}, 2 * gib, 7 * gib / 4, 0},
		{"a zero estimate falls back to the default", 3 * gib, 0, nil, DefaultPerWorker, 0, 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := Compute(8*gib, tc.available, tc.perWorker, tc.liveRSS)
			if c.Total != 8*gib || c.Available != tc.available || c.PerWorker != tc.wantPer {
				t.Fatalf("passthrough fields wrong: %+v", c)
			}
			if c.Reserve != tc.reserve || c.More != tc.more || c.LiveWorkers != len(tc.liveRSS) {
				t.Fatalf("got reserve %d more %d live %d, want reserve %d more %d live %d",
					c.Reserve, c.More, c.LiveWorkers, tc.reserve, tc.more, len(tc.liveRSS))
			}
		})
	}
}

func TestNoReadingsUseTheDefault(t *testing.T) {
	resetTracker(t)
	liveRSS, per, measured := Snapshot(allRunning)
	if len(liveRSS) != 0 || per != DefaultPerWorker || measured {
		t.Fatalf("got %v %d %v, want no live workers, the default, unmeasured", liveRSS, per, measured)
	}
}

func TestObserveKeepsThePeak(t *testing.T) {
	resetTracker(t)
	Observe("a", 2*gib)
	Observe("a", gib)
	liveRSS, per, measured := Snapshot(allRunning)
	if len(liveRSS) != 1 || liveRSS[0] != gib || per != 2*gib || !measured {
		t.Fatalf("got %v %d %v, want current 1 GiB and peak 2 GiB, measured", liveRSS, per, measured)
	}
}

func TestObserveDropsAZeroReading(t *testing.T) {
	resetTracker(t)
	Observe("a", 0)
	Observe("", gib)
	if _, per, measured := Snapshot(allRunning); per != DefaultPerWorker || measured {
		t.Fatalf("a zero reading or an empty block is not a measurement, got %d %v", per, measured)
	}
}

func TestSnapshotRetiresStoppedBlocks(t *testing.T) {
	resetTracker(t)
	Observe("a", 3*gib)
	Observe("b", gib)
	liveRSS, per, _ := Snapshot(func(id string) bool { return id == "b" })
	if len(liveRSS) != 1 || liveRSS[0] != gib || per != 3*gib {
		t.Fatalf("a stopped worker leaves the live set and keeps its peak, got %v %d", liveRSS, per)
	}
	liveRSS, per, measured := Snapshot(noneRunning)
	if len(liveRSS) != 0 || per != 3*gib || !measured {
		t.Fatalf("finished peaks still set the estimate, got %v %d %v", liveRSS, per, measured)
	}
}

func TestRingKeepsTheLastTen(t *testing.T) {
	resetTracker(t)
	Observe("big", 5*gib)
	Snapshot(noneRunning)
	for i := range RecentPeaks {
		Observe(fmt.Sprint(i), gib)
		Snapshot(noneRunning)
	}
	if _, per, _ := Snapshot(noneRunning); per != gib {
		t.Fatalf("the oldest peak falls out after %d newer ones, got %d", RecentPeaks, per)
	}
}

func TestRead(t *testing.T) {
	resetTracker(t)
	Observe("a", gib)
	c := Read(8*gib, 4*gib, allRunning)
	want := Capacity{Total: 8 * gib, Available: 4 * gib, PerWorker: gib, Reserve: 0, Measured: true, LiveWorkers: 1, More: 4}
	if c != want {
		t.Fatalf("got %+v, want %+v", c, want)
	}
}
