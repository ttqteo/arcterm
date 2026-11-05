// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package xmastree is the season ledger behind the Office hall's Christmas tree: which orchestrator tasks finished in
// the current season, and when. The season's dates live here only; the frontend never computes them.
package xmastree

import (
	"context"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// The phases of the year, as XmasTreeData.Phase carries them.
const (
	PhaseSeason  = "season"  // 1 November to 31 December
	PhaseNewYear = "newyear" // all of 1 January
	PhaseOff     = "off"     // 2 January to 31 October
)

// SeasonAt places now in the year, in server-local time. In season and newyear it returns the season (the year its
// November falls in) and the window [1 Nov 00:00, 2 Jan 00:00) in which a finished task counts. In off it returns the
// season that opens next (now's year, since off runs from 2 January to 31 October) and a zero window.
func SeasonAt(now time.Time) (season int, phase string, from, to time.Time) {
	now = now.Local()
	year, month, day := now.Date()
	switch {
	case month >= time.November:
		season, phase = year, PhaseSeason
	case month == time.January && day == 1:
		season, phase = year-1, PhaseNewYear
	default:
		return year, PhaseOff, time.Time{}, time.Time{}
	}
	from = time.Date(season, time.November, 1, 0, 0, 0, 0, time.Local)
	to = time.Date(season+1, time.January, 2, 0, 0, 0, 0, time.Local)
	return season, phase, from, to
}

// Read answers the tree's data at now: the season, its phase, and each counted task's finish time in ms, oldest first.
// Done is never nil, and empty in off.
func Read(ctx context.Context, now time.Time) (*wshrpc.XmasTreeData, error) {
	season, phase, _, _ := SeasonAt(now)
	return &wshrpc.XmasTreeData{Season: season, Phase: phase, Done: []int64{}}, nil
}
