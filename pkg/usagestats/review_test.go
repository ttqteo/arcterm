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

// a Council spawn is logged by `wsh council start` but starts no Agent call: it counts as logged and run, and never
// takes the session's subagents from the Agent group that did start them
func TestReviewEstimatesLeavesCouncilSpawnsUnmatched(t *testing.T) {
	root := t.TempDir()
	now := time.Now().Truncate(time.Second)
	t0 := now.Add(-2 * time.Hour)
	writeJSONL(t, filepath.Join(root, "proj", "s1", "subagents", "agent-a.jsonl"),
		asstLine("a1", t0.Add(time.Minute), testSonnet, "/w", 2000, 0, 0, 0, 0))
	line := func(l EstimateLine) string {
		data, err := json.Marshal(l)
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	logPath := filepath.Join(root, "estimates.jsonl")
	writeJSONL(t, logPath,
		// logged first and earlier than the Agent group: it would take agent-a if it were matched
		line(EstimateLine{Ts: t0.Unix(), Session: "s1", Tool: "Council", Agents: 4, Types: []string{}, Estimate: 820000, Verdict: "run"}),
		line(EstimateLine{Ts: t0.Add(30 * time.Second).Unix(), Session: "s1", Tool: "Agent", Agents: 1, Types: []string{"Explore"}, Estimate: 1000, Verdict: "run"}),
		// refused: logged, never ran
		line(EstimateLine{Ts: t0.Add(time.Hour).Unix(), Session: "s1", Tool: "Council", Agents: 4, Types: []string{}, Estimate: 820000, Verdict: "deny"}),
	)
	rev, err := reviewEstimatesIn(root, logPath, 7, now)
	if err != nil {
		t.Fatal(err)
	}
	if rev.Logged != 3 || rev.Run != 2 || rev.Matched != 1 {
		t.Fatalf("logged/run/matched = %d/%d/%d, want 3/2/1", rev.Logged, rev.Run, rev.Matched)
	}
	// agent-a's 2000 tokens against the Agent group's 1000, not the council's 820000
	if rev.MedianRatio != 2 {
		t.Fatalf("median ratio %v, want 2", rev.MedianRatio)
	}
}

// the ratios rate the figure the card said, the typical cost once the log has it (the mean before), and the total
// rates the mean, which the window shares are worked out from
func TestReviewEstimatesRatesTheCardsFigure(t *testing.T) {
	root := t.TempDir()
	now := time.Now().Truncate(time.Second)
	t0 := now.Add(-2 * time.Hour)
	sub := filepath.Join(root, "proj", "s1", "subagents")
	writeJSONL(t, filepath.Join(sub, "agent-a.jsonl"), asstLine("a1", t0.Add(time.Minute), testSonnet, "/w", 2000, 0, 0, 0, 0))
	writeJSONL(t, filepath.Join(sub, "agent-b.jsonl"), asstLine("b1", t0.Add(31*time.Minute), testSonnet, "/w", 6000, 0, 0, 0, 0))
	line := func(l EstimateLine) string {
		data, err := json.Marshal(l)
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	logPath := filepath.Join(root, "estimates.jsonl")
	gp := []string{"general-purpose"}
	writeJSONL(t, logPath,
		// the card said 1000 (the median) and the share rule weighed 4000 (the mean): agent-a cost 2000
		line(EstimateLine{Ts: t0.Unix(), Session: "s1", Tool: "Agent", Agents: 1, Types: gp, Estimate: 4000, Typical: 1000, Verdict: "run"}),
		// a line from before the typical figure: the card said its mean, 3000; agent-b cost 6000
		line(EstimateLine{Ts: t0.Add(30 * time.Minute).Unix(), Session: "s1", Tool: "Agent", Agents: 1, Types: gp, Estimate: 3000, Verdict: "run"}),
	)
	rev, err := reviewEstimatesIn(root, logPath, 7, now)
	if err != nil {
		t.Fatal(err)
	}
	if rev.Matched != 2 || rev.MedianRatio != 2 {
		t.Fatalf("matched %d median ratio %v, want 2 and 2 (2000/1000, 6000/3000)", rev.Matched, rev.MedianRatio)
	}
	if math.Abs(rev.TotalRatio-8000.0/7000.0) > 1e-9 {
		t.Fatalf("total ratio %v, want 8000/7000", rev.TotalRatio)
	}
	if len(rev.ByType) != 1 || rev.ByType[0].MedianRatio != 2 {
		t.Fatalf("by type %+v", rev.ByType)
	}
}

func TestReviewEstimatesWithNoLogIsEmpty(t *testing.T) {
	rev, err := reviewEstimatesIn(t.TempDir(), filepath.Join(t.TempDir(), "none.jsonl"), 7, time.Now())
	if err != nil || rev.Logged != 0 || rev.Matched != 0 {
		t.Fatalf("no log = %+v, %v", rev, err)
	}
}
