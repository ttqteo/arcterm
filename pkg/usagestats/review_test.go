// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package usagestats

import (
	"encoding/json"
	"math"
	"path/filepath"
	"testing"
	"time"
)

func TestReviewEstimates(t *testing.T) {
	root := t.TempDir()
	now := time.Now().Truncate(time.Second)
	t0 := now.Add(-2 * time.Hour)
	sub := filepath.Join(root, "proj", "s1", "subagents")
	writeJSONL(t, filepath.Join(sub, "agent-a.jsonl"), asstLine("a1", t0.Add(time.Minute), testSonnet, "/w", 2000, 0, 0, 0, 0))
	writeJSONL(t, filepath.Join(sub, "agent-b.jsonl"), asstLine("b1", t0.Add(2*time.Minute), testSonnet, "/w", 4000, 0, 0, 0, 0))
	// agent-d starts inside the first group's 10 minutes but past its 2 agents: no group takes it
	writeJSONL(t, filepath.Join(sub, "agent-d.jsonl"), asstLine("d1", t0.Add(3*time.Minute), testSonnet, "/w", 8000, 0, 0, 0, 0))
	writeJSONL(t, filepath.Join(sub, "agent-c.jsonl"), asstLine("c1", t0.Add(30*time.Minute), testSonnet, "/w", 99999, 0, 0, 0, 0))
	line := func(l EstimateLine) string {
		data, err := json.Marshal(l)
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	logPath := filepath.Join(root, "estimates.jsonl")
	writeJSONL(t, logPath,
		// two general-purpose agents estimated at 3000 (1000–5000): agent-a and agent-b ran, 6000, twice it and over the range
		// (without the at-most-agents cap it would take agent-d too)
		line(EstimateLine{Ts: t0.Unix(), Session: "s1", Tool: "Agent", Agents: 2, Types: []string{"general-purpose", "general-purpose"}, Estimate: 3000, Low: 1000, High: 5000, Verdict: "run"}),
		// one Plan agent 15 minutes in: the only subagent after it, agent-c, starts 15 minutes later, past the 10-minute
		// window, so it is unmatched (without the window it would take agent-c from the Explore group)
		line(EstimateLine{Ts: t0.Add(15 * time.Minute).Unix(), Session: "s1", Tool: "Agent", Agents: 1, Types: []string{"Plan"}, Estimate: 50000, Verdict: "allow-turn"}),
		// one Explore 29 minutes later: agent-c, which started a minute after it
		line(EstimateLine{Ts: t0.Add(29 * time.Minute).Unix(), Session: "s1", Tool: "Agent", Agents: 1, Types: []string{"Explore"}, Estimate: 100000, Verdict: "allow"}),
		// refused: it never ran
		line(EstimateLine{Ts: t0.Add(40 * time.Minute).Unix(), Session: "s1", Tool: "Agent", Agents: 1, Types: []string{"Explore"}, Estimate: 100000, Verdict: "deny"}),
		// a session with no subagents on disk
		line(EstimateLine{Ts: t0.Unix(), Session: "s9", Tool: "Agent", Agents: 1, Estimate: 100000, Verdict: "run"}),
		// before the period
		line(EstimateLine{Ts: now.Add(-9 * 24 * time.Hour).Unix(), Session: "s1", Tool: "Agent", Agents: 1, Estimate: 1, Verdict: "run"}),
		"not json",
	)
	rev, err := reviewEstimatesIn(root, logPath, 7, now)
	if err != nil {
		t.Fatal(err)
	}
	if rev.Logged != 5 || rev.Run != 4 || rev.Matched != 2 {
		t.Fatalf("logged/run/matched = %d/%d/%d, want 5/4/2", rev.Logged, rev.Run, rev.Matched)
	}
	// ratios 6000/3000 = 2 and 99999/100000
	if math.Abs(rev.MedianRatio-(2+0.99999)/2) > 1e-9 {
		t.Fatalf("median ratio %v", rev.MedianRatio)
	}
	if rev.WithRange != 1 || rev.InRange != 0 {
		t.Fatalf("with range %d in range %d, want 1 and 0", rev.WithRange, rev.InRange)
	}
	if len(rev.ByType) != 2 || rev.ByType[0].Type != "Explore" || rev.ByType[1].Type != "general-purpose" ||
		rev.ByType[1].MedianRatio != 2 || rev.ByType[0].Matched != 1 {
		t.Fatalf("by type %+v", rev.ByType)
	}
}

func TestReviewEstimatesWithNoLogIsEmpty(t *testing.T) {
	rev, err := reviewEstimatesIn(t.TempDir(), filepath.Join(t.TempDir(), "none.jsonl"), 7, time.Now())
	if err != nil || rev.Logged != 0 || rev.Matched != 0 {
		t.Fatalf("no log = %+v, %v", rev, err)
	}
}
