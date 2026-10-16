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

// tick feeds w ticks Interval apart from start through end and returns the sleeps it reported on the way.
func tick(w *Watch, start, end time.Time) [][2]time.Time {
	var got [][2]time.Time
	for now := start; !now.After(end); now = now.Add(Interval) {
		if from, to, ok := w.Tick(now); ok {
			got = append(got, [2]time.Time{from, to})
		}
	}
	return got
}

// The morning of 2026-10-16 from `pmset -g log`: asleep at 06:21:40, a DarkWake of a few seconds about every quarter
// hour, the lid opened at 10:05:36. A tick landed in the 09:56 DarkWake and the sleep was reported as 09:56 to 10:05;
// it is one sleep from the last tick before 06:21 to the first after 10:05.
func TestWatchFoldsDarkWakesIntoOneSleep(t *testing.T) {
	at := func(h, m, s int) time.Time { return time.Date(2026, 10, 16, h, m, s, 0, time.UTC) }
	w := &Watch{prev: at(6, 0, 0)}
	if got := tick(w, at(6, 0, 30), at(6, 21, 30)); len(got) != 0 {
		t.Fatalf("reported %v while awake", got)
	}
	for _, dark := range []time.Time{at(6, 37, 22), at(7, 12, 38), at(7, 35, 5), at(8, 22, 40), at(9, 23, 39), at(9, 56, 34)} {
		if from, to, ok := w.Tick(dark); ok {
			t.Fatalf("reported %v..%v in a DarkWake", from, to)
		}
	}
	got := tick(w, at(10, 5, 37), at(10, 15, 7))
	want := [2]time.Time{at(6, 21, 30), at(10, 5, 37)}
	if len(got) != 1 || !got[0][0].Equal(want[0]) || !got[0][1].Equal(want[1]) {
		t.Fatalf("reported %v, want one sleep %v", got, want)
	}
}

func TestWatchReportsOnceAwakeForSettle(t *testing.T) {
	w := &Watch{prev: t0}
	woke := t0.Add(40 * time.Minute)
	if _, _, ok := w.Tick(woke); ok {
		t.Fatal("reported at the first tick after the sleep, before it settled")
	}
	if got := tick(w, woke.Add(Interval), woke.Add(Settle-time.Second)); len(got) != 0 {
		t.Fatalf("reported %v before the machine was awake for Settle", got)
	}
	if got := tick(w, woke.Add(Settle), woke.Add(Settle+5*time.Minute)); len(got) != 1 {
		t.Fatalf("reported %d sleeps once settled, want 1", len(got))
	}
}

func TestWatchKeepsSleepsApartPastSettle(t *testing.T) {
	// a DarkWake that runs past Settle (a long maintenance wake on AC) let agents run: two sleeps, not one
	w := &Watch{prev: t0}
	first := t0.Add(20 * time.Minute)
	w.Tick(first)
	got := tick(w, first.Add(Interval), first.Add(Settle+Interval))
	second := first.Add(Settle + Interval + 20*time.Minute)
	w.Tick(second)
	got = append(got, tick(w, second.Add(Interval), second.Add(Settle+Interval))...)
	if len(got) != 2 || !got[0][0].Equal(t0) || !got[1][1].Equal(second) {
		t.Fatalf("reported %v, want two sleeps ending %v and %v", got, first, second)
	}
}
