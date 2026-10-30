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

// withAgent is two role experts, their coordinator and one live agent that holds 625k tokens of context.
func withAgent() []CouncilExpert {
	return []CouncilExpert{
		{Id: "a"}, {Id: "b"},
		{Id: "witness", Agent: "tab-1", Harness: "claude", Context: 625_000},
		{Id: "chair", Coordinator: true},
	}
}

func TestEstimateAgentSeatCostsItsContextTimesRounds(t *testing.T) {
	got := Estimate(withAgent(), 0, 2)
	want := CouncilEstimate{
		Calls:       7, // three seats, two rounds each, and the synthesis
		Tokens:      2*(140_000+45_000) + 2*625_000 + 80_000,
		Minutes:     6,
		AgentTokens: 1_250_000,
	}
	if got != want {
		t.Fatalf("Estimate = %+v, want %+v", got, want)
	}
	if s := FormatTokens(got.AgentTokens); s != "1.3M" {
		t.Errorf("the agent's share reads %q, want 1.3M", s)
	}
	if Estimate(withAgent(), 0, 0) != got {
		t.Error("rounds 0 reads as 2, as RoundsOf does")
	}
	for _, rounds := range []int{-1, 4, 9} {
		if Estimate(withAgent(), 0, rounds) != got {
			t.Errorf("rounds %d is out of range and reads as 2", rounds)
		}
	}
}

func TestEstimateRounds1DropsTheReplyPass(t *testing.T) {
	got := Estimate(withAgent(), 0, 1)
	want := CouncilEstimate{
		Calls:       4, // three seats, one round each, and the synthesis
		Tokens:      2*140_000 + 625_000 + 80_000,
		Minutes:     4,
		AgentTokens: 625_000,
	}
	if got != want {
		t.Errorf("Estimate = %+v, want %+v", got, want)
	}
}

func TestEstimateRounds3AddsASecondReplyPass(t *testing.T) {
	got := Estimate(withAgent(), 0, 3)
	want := CouncilEstimate{
		Calls:       10, // three seats, three rounds each, and the synthesis
		Tokens:      2*(140_000+2*45_000) + 3*625_000 + 80_000,
		Minutes:     8,
		AgentTokens: 1_875_000,
	}
	if got != want {
		t.Errorf("Estimate = %+v, want %+v", got, want)
	}
}

func TestEstimateFilesAreReadByTheExpertsNotTheAgents(t *testing.T) {
	plain, withFiles := Estimate(withAgent(), 0, 2), Estimate(withAgent(), 40_000, 2)
	if got, want := withFiles.Tokens-plain.Tokens, int64(2*10_000); got != want {
		t.Errorf("files add %d tokens, want %d: the two role experts read them, the agent does not", got, want)
	}
	if withFiles.AgentTokens != plain.AgentTokens {
		t.Errorf("files changed the agent's share: %d -> %d", plain.AgentTokens, withFiles.AgentTokens)
	}
}

func TestEstimateAgentsOnlyIsTheirTurnsAndTheSynthesis(t *testing.T) {
	seats := []CouncilExpert{
		{Id: "one", Agent: "tab-1", Harness: "claude", Context: 100_000},
		{Id: "two", Agent: "tab-2", Harness: "pi", Context: 300_000},
		{Id: "chair", Coordinator: true},
	}
	got := Estimate(seats, 0, 2)
	want := CouncilEstimate{Calls: 5, Tokens: 2*400_000 + 80_000, Minutes: 6, AgentTokens: 800_000}
	if got != want {
		t.Errorf("Estimate = %+v, want %+v", got, want)
	}
}

func TestEstimateExpertOnlyCouncilIgnoresRounds(t *testing.T) {
	want := Estimate(uiGroup(), 0, 0)
	for _, rounds := range []int{1, 2, 3, 7} {
		if got := Estimate(uiGroup(), 0, rounds); got != want {
			t.Errorf("rounds %d priced an expert-only council as %+v, want %+v", rounds, got, want)
		}
	}
	if want.AgentTokens != 0 {
		t.Errorf("an expert-only council has no agent share: %+v", want)
	}
}

func TestEstimateRemainingWithAgentsCountsTheirTurnsLeft(t *testing.T) {
	for _, c := range []struct {
		name   string
		rounds int
		round  int
		want   CouncilEstimate
	}{
		{"2 rounds, after round 1", 2, 1,
			CouncilEstimate{Calls: 4, Tokens: 2*45_000 + 625_000 + 80_000, Minutes: 3, AgentTokens: 625_000}},
		{"the default rounds, no round recorded", 0, 0,
			CouncilEstimate{Calls: 4, Tokens: 2*45_000 + 625_000 + 80_000, Minutes: 3, AgentTokens: 625_000}},
		{"3 rounds, after round 1", 3, 1,
			CouncilEstimate{Calls: 7, Tokens: 2*2*45_000 + 2*625_000 + 80_000, Minutes: 5, AgentTokens: 1_250_000}},
		{"3 rounds, after round 2", 3, 2,
			CouncilEstimate{Calls: 4, Tokens: 2*45_000 + 625_000 + 80_000, Minutes: 3, AgentTokens: 625_000}},
		{"3 rounds, after round 3 is the synthesis alone", 3, 3,
			CouncilEstimate{Calls: 1, Tokens: 80_000, Minutes: 1}},
		{"1 round is the synthesis alone", 1, 1,
			CouncilEstimate{Calls: 1, Tokens: 80_000, Minutes: 1}},
	} {
		if got := EstimateRemaining(&Council{Experts: withAgent(), Rounds: c.rounds, Round: c.round}); got != c.want {
			t.Errorf("%s: EstimateRemaining = %+v, want %+v", c.name, got, c.want)
		}
	}
}

func TestEstimateRemainingLeavesOutAnAgentThatFailedInRound1(t *testing.T) {
	c := &Council{Experts: withAgent(), Rounds: 3, Round: 1, Failed: map[string]CouncilFailure{
		"witness": {Round: 1, Error: "gone"},
	}}
	got := EstimateRemaining(c)
	if want := (CouncilEstimate{Calls: 5, Tokens: 2*2*45_000 + 80_000, Minutes: 5}); got != want {
		t.Errorf("EstimateRemaining = %+v, want %+v", got, want)
	}
}

func TestEstimateRemainingExpertOnlyIgnoresRounds(t *testing.T) {
	want := EstimateRemaining(&Council{Experts: uiGroup()})
	for _, rounds := range []int{1, 3} {
		if got := EstimateRemaining(&Council{Experts: uiGroup(), Rounds: rounds, Round: 1}); got != want {
			t.Errorf("rounds %d priced an expert-only council's remainder as %+v, want %+v", rounds, got, want)
		}
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
