// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package xmastree

import (
	"context"
	"testing"
	"time"
)

func TestSeasonAt(t *testing.T) {
	loc := time.Local
	at := func(y int, m time.Month, d, h, min int) time.Time { return time.Date(y, m, d, h, min, 0, 0, loc) }
	cases := []struct {
		name   string
		now    time.Time
		season int
		phase  string
	}{
		{"31 Oct 23:59 is off", at(2026, time.October, 31, 23, 59), 2026, PhaseOff},
		{"1 Nov 00:00 opens the season", at(2026, time.November, 1, 0, 0), 2026, PhaseSeason},
		{"31 Dec 23:59 is still the season", at(2026, time.December, 31, 23, 59), 2026, PhaseSeason},
		{"1 Jan 12:00 is new year, last year's season", at(2027, time.January, 1, 12, 0), 2026, PhaseNewYear},
		{"2 Jan 00:00 is off", at(2027, time.January, 2, 0, 0), 2027, PhaseOff},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			season, phase, from, to := SeasonAt(c.now)
			if phase != c.phase {
				t.Fatalf("phase = %q, want %q", phase, c.phase)
			}
			if season != c.season {
				t.Fatalf("season = %d, want %d", season, c.season)
			}
			if c.phase == PhaseOff {
				if !from.IsZero() || !to.IsZero() {
					t.Fatalf("off has a window: [%v, %v)", from, to)
				}
				return
			}
			wantFrom := time.Date(c.season, time.November, 1, 0, 0, 0, 0, loc)
			wantTo := time.Date(c.season+1, time.January, 2, 0, 0, 0, 0, loc)
			if !from.Equal(wantFrom) || !to.Equal(wantTo) {
				t.Fatalf("window = [%v, %v), want [%v, %v)", from, to, wantFrom, wantTo)
			}
			if c.now.Before(from) || !c.now.Before(to) {
				t.Fatalf("now %v outside its window [%v, %v)", c.now, from, to)
			}
		})
	}
}

func TestReadStub(t *testing.T) {
	data, err := Read(context.Background(), time.Date(2026, time.November, 5, 10, 0, 0, 0, time.Local))
	if err != nil {
		t.Fatal(err)
	}
	if data.Season != 2026 || data.Phase != PhaseSeason {
		t.Fatalf("got season %d phase %q", data.Season, data.Phase)
	}
	if data.Done == nil || len(data.Done) != 0 {
		t.Fatalf("Done = %#v, want empty non-nil", data.Done)
	}
}
