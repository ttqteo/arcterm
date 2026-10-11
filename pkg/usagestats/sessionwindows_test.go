// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package usagestats

import (
	"path/filepath"
	"testing"
	"time"
)

func TestScanSessionWindows(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	proj := filepath.Join(root, "proj")
	writeJSONL(t, filepath.Join(proj, "s1.jsonl"),
		asstLine("a1", now.Add(-time.Hour), testOpus, "/w", 100, 0, 0, 0, 0),
		asstLine("a2", now.Add(-24*time.Hour), testOpus, "/w", 10, 0, 0, 0, 0),
		asstLine("a3", now.Add(-10*24*time.Hour), testOpus, "/w", 1, 0, 0, 0, 0),
	)
	writeJSONL(t, filepath.Join(proj, "s1", "subagents", "agent-a.jsonl"),
		asstLine("b1", now.Add(-2*time.Hour), testSonnet, "/w", 1000, 0, 0, 0, 0))
	writeJSONL(t, filepath.Join(proj, "s2.jsonl"), asstLine("d1", now.Add(-time.Hour), testOpus, "/w", 50000, 0, 0, 0, 0))
	w := scanSessionWindows(root, time.Time{}, time.Time{}, now)
	if w.FiveHour != 51100 || w.Week != 51110 {
		t.Fatalf("windows 5h/week = %d/%d, want 51100/51110", w.FiveHour, w.Week)
	}
	if w.Sessions["s1"] != [2]int{1100, 1110} || w.Sessions["s2"] != [2]int{50000, 50000} {
		t.Fatalf("sessions %+v", w.Sessions)
	}
}
