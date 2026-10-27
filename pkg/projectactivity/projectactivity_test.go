// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package projectactivity

import (
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// 2026-10-28 is a Wednesday, so its Monday-first week starts 2026-10-26.
var testNow = time.Date(2026, 10, 28, 15, 0, 0, 0, time.Local)

func at(day string, hour int) int64 {
	d, err := time.ParseInLocation(dayLayout, day, time.Local)
	if err != nil {
		panic(err)
	}
	return d.Add(time.Duration(hour) * time.Hour).UnixMilli()
}

func byDay(days []wshrpc.ProjectActivityDay) map[string]wshrpc.ProjectActivityDay {
	m := map[string]wshrpc.ProjectActivityDay{}
	for _, d := range days {
		m[d.Day] = d
	}
	return m
}

func TestWindowStart(t *testing.T) {
	if got := WindowStart(testNow, 2).Format(dayLayout); got != "2026-10-12" {
		t.Fatalf("2 weeks back from Monday 10-26 = 10-12, got %s", got)
	}
	if got := WindowStart(testNow, 0).Format(dayLayout); got != WindowStart(testNow, 53).Format(dayLayout) {
		t.Fatalf("weeks <= 0 means 53, got %s", got)
	}
	sunday := time.Date(2026, 11, 1, 9, 0, 0, 0, time.Local)
	if got := WindowStart(sunday, 0).Format(dayLayout); got != WindowStart(testNow, 0).Format(dayLayout) {
		t.Fatalf("a Sunday is still in the week that began Monday 10-26, got %s", got)
	}
}

func TestAggregateWindowBound(t *testing.T) {
	rows := []wstore.SessionDay{
		{Day: "2026-10-11", Harness: "claude", Session: "before", Tokens: 5}, // the Sunday before the window
		{Day: "2026-10-12", Harness: "claude", Session: "first", Tokens: 7},  // the window's first day
		{Day: "2026-10-28", Harness: "claude", Session: "today", Tokens: 9},
		{Day: "2026-10-29", Harness: "claude", Session: "future", Tokens: 11},
	}
	runs := []*waveobj.Run{{CreatedTs: at("2026-10-11", 23)}, {CreatedTs: at("2026-10-12", 0)}}
	days, sessions := Aggregate(rows, runs, nil, testNow, 2)
	got := byDay(days)
	if len(got) != 2 || got["2026-10-12"].Tokens != 7 || got["2026-10-12"].Runs != 1 || got["2026-10-28"].Tokens != 9 {
		t.Fatalf("window 10-12..10-28, got %+v", days)
	}
	if sessions != 2 {
		t.Fatalf("sessions in the window = 2, got %d", sessions)
	}
	if days[0].Day != "2026-10-12" || days[1].Day != "2026-10-28" {
		t.Fatalf("days run oldest first, got %+v", days)
	}
}

func TestAggregateRunsAndCouncils(t *testing.T) {
	runs := []*waveobj.Run{
		{CreatedTs: at("2026-10-27", 10)},
		{CreatedTs: at("2026-10-27", 11)},
		{CreatedTs: at("2026-10-27", 12), TaskId: "t-1"},
		{CreatedTs: at("2026-10-27", 12), StageRole: "verifier"},
		{CreatedTs: at("2026-10-27", 12), ParentLeadORef: "tab:abc"},
	}
	councils := []*council.Council{
		{Created: at("2026-10-27", 9)},
		{Created: at("2026-10-27", 9), Bench: true},
		{Created: at("2026-10-26", 9)},
	}
	days, sessions := Aggregate(nil, runs, councils, testNow, 0)
	got := byDay(days)
	if got["2026-10-27"].Runs != 2 || got["2026-10-27"].Councils != 1 || got["2026-10-26"].Councils != 1 {
		t.Fatalf("child runs and Bench councils never count, got %+v", days)
	}
	if got["2026-10-27"].Sessions != 0 || sessions != 0 {
		t.Fatalf("no tally rows, no sessions, got %+v / %d", days, sessions)
	}
}

func TestAggregateSessions(t *testing.T) {
	rows := []wstore.SessionDay{
		{Day: "2026-10-26", Harness: "claude", Session: "a", Tokens: 10},
		{Day: "2026-10-27", Harness: "claude", Session: "a", Tokens: 20},
		{Day: "2026-10-27", Harness: "claude", Session: "b", Tokens: 30},
		{Day: "2026-10-27", Harness: "pi", Session: "a", Tokens: 40}, // same id, another harness
	}
	days, sessions := Aggregate(rows, nil, nil, testNow, 0)
	got := byDay(days)
	if got["2026-10-27"].Sessions != 3 || got["2026-10-27"].Tokens != 90 || got["2026-10-26"].Sessions != 1 {
		t.Fatalf("per-day distinct sessions, got %+v", days)
	}
	if sessions != 3 {
		t.Fatalf("session a ran on two days and counts once: want 3, got %d", sessions)
	}
}

func TestAggregateEmptyIsNotNil(t *testing.T) {
	days, sessions := Aggregate(nil, nil, nil, testNow, 0)
	if days == nil || len(days) != 0 || sessions != 0 {
		t.Fatalf("an empty window serializes as [], got %#v / %d", days, sessions)
	}
}
