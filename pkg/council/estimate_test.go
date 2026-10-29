// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import "testing"

func uiGroup() []CouncilExpert {
	return []CouncilExpert{
		{Id: "ux"}, {Id: "ram"}, {Id: "newuser"}, {Id: "skeptic"},
		{Id: "coordinator", Coordinator: true},
	}
}

func TestEstimateMatchesTheCanvas(t *testing.T) {
	// board Setup: "≈ 9 calls · ~0.8M tokens · ~6 min"
	got := Estimate(uiGroup(), 0, 0)
	want := CouncilEstimate{Calls: 9, Tokens: 820_000, Minutes: 6}
	if got != want {
		t.Fatalf("Estimate = %+v, want %+v", got, want)
	}
	if s := FormatTokens(got.Tokens); s != "0.8M" {
		t.Errorf("the estimate reads %q, want 0.8M", s)
	}
}

func TestEstimateCountsFileBytesAsAQuarterTokenEachForEveryExpert(t *testing.T) {
	got := Estimate(uiGroup(), 40_000, 0) // 10k tokens a file read, four experts
	if want := int64(820_000 + 4*10_000); got.Tokens != want {
		t.Errorf("tokens = %d, want %d", got.Tokens, want)
	}
	if got.Calls != 9 || got.Minutes != 6 {
		t.Errorf("files change the tokens only: %+v", got)
	}
}

func TestEstimateGrowsWithThePanel(t *testing.T) {
	paper := []CouncilExpert{{Id: "a"}, {Id: "b"}, {Id: "c"}, {Id: "chair", Coordinator: true}}
	got := Estimate(paper, 0, 0)
	want := CouncilEstimate{Calls: 7, Tokens: 3*(140_000+45_000) + 80_000, Minutes: 6}
	if got != want {
		t.Errorf("Estimate = %+v, want %+v", got, want)
	}
	if got := Estimate(nil, 0, 0); got.Calls != 1 || got.Tokens != 80_000 {
		t.Errorf("no panel is the synthesis alone: %+v", got)
	}
}

func TestEstimateRemainingMatchesPaused(t *testing.T) {
	// board Paused: "Rounds 2 and 3: ≈ 5 calls · ~0.3M tokens"
	c := &Council{Experts: uiGroup()}
	got := EstimateRemaining(c)
	if want := (CouncilEstimate{Calls: 5, Tokens: 260_000, Minutes: 3}); got != want {
		t.Fatalf("EstimateRemaining = %+v, want %+v", got, want)
	}
	if s := FormatTokens(got.Tokens); s != "0.3M" {
		t.Errorf("the remaining estimate reads %q, want 0.3M", s)
	}
}

func TestEstimateRemainingLeavesOutExpertsThatFailedInRound1(t *testing.T) {
	c := &Council{Experts: uiGroup(), Failed: map[string]CouncilFailure{
		"ram":         {Round: 1, Error: "timeout"},
		"skeptic":     {Round: 2, Error: "bad json"}, // failed in round 2: its round 2 call is still to run again
		"coordinator": {Round: 3, Error: "x"},
	}}
	got := EstimateRemaining(c)
	if want := (CouncilEstimate{Calls: 4, Tokens: 3*45_000 + 80_000, Minutes: 3}); got != want {
		t.Errorf("EstimateRemaining = %+v, want %+v", got, want)
	}
}

func TestEstimateFollowup(t *testing.T) {
	if got, want := EstimateFollowup(3, false), (CouncilEstimate{Calls: 3, Tokens: 60_000, Minutes: 1}); got != want {
		t.Errorf("without tools = %+v, want %+v", got, want)
	}
	if got, want := EstimateFollowup(3, true), (CouncilEstimate{Calls: 3, Tokens: 270_000, Minutes: 2}); got != want {
		t.Errorf("with tools = %+v, want %+v", got, want)
	}
	if got := EstimateFollowup(0, true); got.Calls != 0 || got.Tokens != 0 {
		t.Errorf("no experts cost nothing: %+v", got)
	}
}

func TestEstimateIgnoresTheModel(t *testing.T) {
	a := []CouncilExpert{{Id: "a", Model: "haiku"}, {Id: "chair", Model: "haiku", Coordinator: true}}
	b := []CouncilExpert{{Id: "a", Model: "opus"}, {Id: "chair", Model: "opus", Coordinator: true}}
	if Estimate(a, 1000, 0) != Estimate(b, 1000, 0) {
		t.Error("the model changed the token estimate: tokens are counted, not priced")
	}
}

func TestFormatTokens(t *testing.T) {
	for _, c := range []struct {
		in   int64
		want string
	}{
		{820_000, "0.8M"},
		{260_000, "0.3M"},
		{84_000, "84k"},
		{0, "0"},
		{-5, "0"},
		{999, "999"},
		{1_000, "1k"},
		{1_499, "1k"},
		{1_500, "2k"},
		{99_499, "99k"},
		{99_500, "0.1M"}, // the rounded 100k is where the millions start
		{100_000, "0.1M"},
		{250_000, "0.3M"},
		{550_000, "0.6M"},
		{999_999, "1M"},
		{1_000_000, "1M"},
		{1_240_000, "1.2M"},
		{12_340_000, "12.3M"},
	} {
		if got := FormatTokens(c.in); got != c.want {
			t.Errorf("FormatTokens(%d) = %q, want %q", c.in, got, c.want)
		}
	}
}
