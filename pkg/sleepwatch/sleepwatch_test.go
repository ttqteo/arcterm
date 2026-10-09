// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sleepwatch

import (
	"testing"
	"time"
)

var t0 = time.Date(2026, 10, 9, 14, 2, 0, 0, time.UTC)

func TestGapOnTimeIsNoSleep(t *testing.T) {
	if _, _, ok := Gap(t0, t0.Add(Interval+time.Second), Interval); ok {
		t.Fatal("a tick on time read as a sleep")
	}
}

func TestGapUnderTheBarIsNoSleep(t *testing.T) {
	// a tick 1m59s late: a busy machine, not a sleeping one
	if _, _, ok := Gap(t0, t0.Add(Interval+MinGap-time.Second), Interval); ok {
		t.Fatal("a late tick under the bar read as a sleep")
	}
}

func TestGapPastTheBarIsASleep(t *testing.T) {
	now := t0.Add(40*time.Minute + 20*time.Second)
	from, to, ok := Gap(t0, now, Interval)
	if !ok {
		t.Fatal("a 40-minute gap did not read as a sleep")
	}
	if !from.Equal(t0) || !to.Equal(now) {
		t.Fatalf("slept %v..%v, want %v..%v", from, to, t0, now)
	}
}

// macOS stops Go's monotonic clock while asleep, so the gap must be read from the wall clock: two readings whose
// monotonic parts are close but whose wall parts are 40 minutes apart are a sleep.
func TestGapReadsTheWallClock(t *testing.T) {
	prev := time.Now()
	now := prev.Add(Interval) // carries a monotonic reading Interval after prev
	wallNow := now.Round(0).Add(40 * time.Minute)
	if _, _, ok := Gap(prev, wallNow, Interval); !ok {
		t.Fatal("a wall-clock gap behind a monotonic prev reading did not read as a sleep")
	}
}

func TestGapBackwardsIsNoSleep(t *testing.T) {
	// the wall clock set back (a manual change) is not a sleep
	if _, _, ok := Gap(t0, t0.Add(-time.Hour), Interval); ok {
		t.Fatal("a clock set back read as a sleep")
	}
}
