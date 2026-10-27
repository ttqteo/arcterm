// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package projectactivity

import (
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/usagestats"
)

func TestTallyRowsSumsModelsAndSkipsNoCwd(t *testing.T) {
	buckets := []usagestats.Bucket{
		{Harness: "claude", Model: "opus", Day: "2026-10-27", Session: "s1", Input: 1, Output: 2, Reasoning: 3, CacheRead: 4, CacheCreate: 5},
		{Harness: "claude", Model: "sonnet", Day: "2026-10-27", Session: "s1", Input: 10, Output: 20},
		{Harness: "claude", Model: "opus", Day: "2026-10-28", Session: "s1", Input: 100},
		{Harness: "claude", Model: "opus", Day: "2026-10-27", Session: "nocwd", Input: 999},
		{Harness: "claude", Model: "opus", Day: "2026-10-27", Session: "unknown", Input: 999},
		{Harness: "pi", Model: "x", Day: "2026-10-27", Session: "s1", Input: 7},
	}
	metas := []usagestats.SessionMeta{
		{Harness: "claude", Session: "s1", Cwd: `C:\Work\Arc\`},
		{Harness: "claude", Session: "nocwd", Cwd: ""},
		{Harness: "pi", Session: "s1", Cwd: "/p/one"},
	}
	rows := TallyRows(buckets, metas)
	got := map[string]int64{}
	for _, r := range rows {
		got[r.Day+"|"+r.Harness+"|"+r.Session+"|"+r.Cwd] = r.Tokens
	}
	want := map[string]int64{
		"2026-10-27|claude|s1|c:/work/arc": 45, // 1+2+3+4+5 plus 10+20, the two models in one row
		"2026-10-28|claude|s1|c:/work/arc": 100,
		"2026-10-27|pi|s1|/p/one":          7,
	}
	if len(got) != len(want) || len(rows) != len(want) {
		t.Fatalf("want %v, got %v (%d rows)", want, got, len(rows))
	}
	for k, v := range want {
		if got[k] != v {
			t.Fatalf("%s: want %d, got %d (all %v)", k, v, got[k], got)
		}
	}
}

func TestScanWindowDays(t *testing.T) {
	now := time.Date(2026, 10, 28, 15, 30, 0, 0, time.Local)
	cases := []struct {
		last string
		want int
	}{
		{"", 0},
		{"2026-10-28", 1},
		{"2026-10-25", 4},
		{"2026-03-30", 213}, // across a daylight-saving change in some zones
		{"2026-11-02", 1},   // a clock gone backwards never asks for less than today
		{"junk", 0},
	}
	for _, c := range cases {
		if got := ScanWindowDays(c.last, now); got != c.want {
			t.Errorf("ScanWindowDays(%q) = %d, want %d", c.last, got, c.want)
		}
	}
}
