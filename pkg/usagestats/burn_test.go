// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package usagestats

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

// writeMeta writes the .meta.json Claude Code keeps beside a subagent transcript
func writeMeta(t *testing.T, jsonlPath, agentType string) {
	t.Helper()
	data := fmt.Sprintf(`{"agentType":%q,"model":"inherit"}`, agentType)
	if err := os.WriteFile(strings.TrimSuffix(jsonlPath, ".jsonl")+".meta.json", []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestSubagentCostsByType(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	sub := filepath.Join(root, "proj", "s1", "subagents")
	agent := func(name, agentType string, ts time.Time, tokens int) {
		path := filepath.Join(sub, name+".jsonl")
		writeJSONL(t, path, asstLine(name, ts, testSonnet, "/w", tokens, 0, 0, 0, 0))
		if agentType != "" {
			writeMeta(t, path, agentType)
		}
	}
	agent("agent-g1", "general-purpose", now.Add(-time.Hour), 100)
	agent("agent-g2", "general-purpose", now.Add(-2*time.Hour), 200)
	agent("agent-g3", "general-purpose", now.Add(-3*24*time.Hour), 900)
	agent("agent-e1", "Explore", now.Add(-time.Hour), 5000)
	agent("agent-u1", "", now.Add(-time.Hour), 50)                          // no meta file: unknown
	agent("agent-run", "general-purpose", now.Add(-10*time.Second), 99999)  // still running
	agent("agent-old", "general-purpose", now.Add(-40*24*time.Hour), 77777) // finished before the 30 days
	got := subagentCostsIn(root, now)
	want := []SubagentCost{
		{Type: "general-purpose", Samples: 3, Mean: 400, P25: 100, P90: 900},
		{Type: "Explore", Samples: 1, Mean: 5000, P25: 5000, P90: 5000},
		{Type: SubagentTypeUnknown, Samples: 1, Mean: 50, P25: 50, P90: 50},
		{Type: SubagentTypeAll, Samples: 5, Mean: 1250, P25: 100, P90: 5000},
	}
	if !slices.Equal(got, want) {
		t.Fatalf("costs\n%+v\nwant\n%+v", got, want)
	}
}

func TestNearestRank(t *testing.T) {
	sorted := []int64{10, 20, 30, 40}
	if p25, p90 := nearestRank(sorted, 25), nearestRank(sorted, 90); p25 != 10 || p90 != 40 {
		t.Fatalf("p25 %d p90 %d", p25, p90)
	}
	if got := nearestRank([]int64{7}, 90); got != 7 {
		t.Fatalf("one sample = %d", got)
	}
}

func TestSessionBurnCountsTheSessionAndItsSubagentsInEachWindow(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	fiveHour, week := now.Add(-5*time.Hour), now.Add(-7*24*time.Hour)
	proj := filepath.Join(root, "proj")
	// the session: a turn in the 5h window, one in the week before it, one before the week
	writeJSONL(t, filepath.Join(proj, "s1.jsonl"),
		asstLine("a1", now.Add(-time.Hour), testOpus, "/w", 100, 0, 0, 0, 0),
		asstLine("a2", now.Add(-24*time.Hour), testOpus, "/w", 10, 0, 0, 0, 0),
		asstLine("a3", now.Add(-10*24*time.Hour), testOpus, "/w", 1, 0, 0, 0, 0),
	)
	// a subagent, and one it spawned, both finished inside the 5h window
	writeJSONL(t, filepath.Join(proj, "s1", "subagents", "agent-a.jsonl"),
		asstLine("b1", now.Add(-2*time.Hour), testSonnet, "/w", 1000, 0, 0, 0, 0))
	writeJSONL(t, filepath.Join(proj, "s1", "subagents", "agent-a", "subagents", "agent-b.jsonl"),
		asstLine("c1", now.Add(-2*time.Hour), testSonnet, "/w", 3000, 0, 0, 0, 0))
	// another session in the same windows
	writeJSONL(t, filepath.Join(proj, "s2.jsonl"),
		asstLine("d1", now.Add(-time.Hour), testOpus, "/w", 50000, 0, 0, 0, 0))

	for _, path := range []string{
		filepath.Join(proj, "s1.jsonl"),
		filepath.Join(proj, "s1", "subagents", "agent-a.jsonl"), // a spawn from inside a subagent counts the whole session
	} {
		b := sessionBurn(root, path, fiveHour, week, now)
		if b.Session != "s1" {
			t.Errorf("%s: session %q", path, b.Session)
		}
		if b.SessionFiveHour != 4100 || b.SessionWeek != 4110 {
			t.Errorf("%s: session 5h/week = %d/%d, want 4100/4110", path, b.SessionFiveHour, b.SessionWeek)
		}
		if b.WindowFiveHour != 54100 || b.WindowWeek != 54110 {
			t.Errorf("%s: window 5h/week = %d/%d, want 54100/54110", path, b.WindowFiveHour, b.WindowWeek)
		}
		if b.Subagents != 2 {
			t.Errorf("%s: subagents = %d, want 2", path, b.Subagents)
		}
		// neither subagent has a meta file: two unknown samples, and the every-type row
		if len(b.Costs) != 2 || b.Costs[0].Type != SubagentTypeUnknown || b.Costs[0].Samples != 2 || b.Costs[1].Type != SubagentTypeAll {
			t.Errorf("%s: costs %+v", path, b.Costs)
		}
	}
}

func TestSessionBurnWithNoPathCountsOnlyTheWindows(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	proj := filepath.Join(root, "proj")
	writeJSONL(t, filepath.Join(proj, "s1.jsonl"), asstLine("a1", now.Add(-time.Hour), testOpus, "/w", 100, 0, 0, 0, 0))
	writeJSONL(t, filepath.Join(proj, "s1", "subagents", "agent-a.jsonl"),
		asstLine("b1", now.Add(-time.Hour), testSonnet, "/w", 1000, 0, 0, 0, 0))
	b := sessionBurn(root, "", time.Time{}, time.Time{}, now)
	if b.Session != "" || b.SessionFiveHour != 0 || b.SessionWeek != 0 || b.Subagents != 0 {
		t.Fatalf("no path = %+v, want no session numbers", b)
	}
	if b.WindowFiveHour != 1100 || b.WindowWeek != 1100 {
		t.Fatalf("window 5h/week = %d/%d, want 1100/1100 (zero cutoffs are the trailing windows)", b.WindowFiveHour, b.WindowWeek)
	}
}
