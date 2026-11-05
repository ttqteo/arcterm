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
	// board Setup: "≈ 9 calls · ~0.8M tokens · ~6 min", and the round check after the one reply pass is a call more
	got := Estimate(uiGroup(), 0, 0)
	want := CouncilEstimate{Calls: 10, Tokens: 820_000 + roundCheckTokens, Minutes: 6}
	if got != want {
		t.Fatalf("Estimate = %+v, want %+v", got, want)
	}
	if s := FormatTokens(got.Tokens); s != "0.8M" {
		t.Errorf("the estimate reads %q, want 0.8M", s)
	}
}

func TestEstimateCountsFileBytesAsAQuarterTokenEachForEveryExpert(t *testing.T) {
	got := Estimate(uiGroup(), 40_000, 0) // 10k tokens a file read, four experts
	if want := int64(820_000 + roundCheckTokens + 4*10_000); got.Tokens != want {
		t.Errorf("tokens = %d, want %d", got.Tokens, want)
	}
	if got.Calls != 10 || got.Minutes != 6 {
		t.Errorf("files change the tokens only: %+v", got)
	}
}

func TestEstimateGrowsWithThePanel(t *testing.T) {
	paper := []CouncilExpert{{Id: "a"}, {Id: "b"}, {Id: "c"}, {Id: "chair", Coordinator: true}}
	got := Estimate(paper, 0, 0)
	want := CouncilEstimate{Calls: 8, Tokens: 3*(140_000+45_000) + roundCheckTokens + 80_000, Minutes: 6}
	if got != want {
		t.Errorf("Estimate = %+v, want %+v", got, want)
	}
	if got := Estimate(nil, 0, 0); got.Calls != 1 || got.Tokens != 80_000 {
		t.Errorf("no panel is the synthesis alone, with no reply pass to check: %+v", got)
	}
}

func TestEstimateRemainingMatchesPaused(t *testing.T) {
	// board Paused: "Rounds 2 and 3: ≈ 5 calls · ~0.3M tokens", and the round check after the reply pass is a call more
	c := &Council{Experts: uiGroup()}
	got := EstimateRemaining(c)
	if want := (CouncilEstimate{Calls: 6, Tokens: 260_000 + roundCheckTokens, Minutes: 3}); got != want {
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
	if want := (CouncilEstimate{Calls: 5, Tokens: 3*45_000 + roundCheckTokens + 80_000, Minutes: 3}); got != want {
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
		Calls:       8, // three seats, two rounds each, the round check after the reply pass, and the synthesis
		Tokens:      2*(140_000+45_000) + 2*625_000 + roundCheckTokens + 80_000,
		Minutes:     6,
		AgentTokens: 1_250_000, // the check is no agent's turn
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
		Calls:       4, // three seats, one round each, and the synthesis: no reply pass, so no round check
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
		Calls:       12, // three seats, three rounds each, a round check after each of the two reply passes, and the synthesis
		Tokens:      2*(140_000+2*45_000) + 3*625_000 + 2*roundCheckTokens + 80_000,
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
	want := CouncilEstimate{Calls: 6, Tokens: 2*400_000 + roundCheckTokens + 80_000, Minutes: 6, AgentTokens: 800_000}
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
			CouncilEstimate{Calls: 5, Tokens: 2*45_000 + 625_000 + roundCheckTokens + 80_000, Minutes: 3, AgentTokens: 625_000}},
		{"the default rounds, no round recorded", 0, 0,
			CouncilEstimate{Calls: 5, Tokens: 2*45_000 + 625_000 + roundCheckTokens + 80_000, Minutes: 3, AgentTokens: 625_000}},
		{"3 rounds, after round 1", 3, 1,
			CouncilEstimate{Calls: 9, Tokens: 2*2*45_000 + 2*625_000 + 2*roundCheckTokens + 80_000, Minutes: 5, AgentTokens: 1_250_000}},
		{"3 rounds, after round 2", 3, 2,
			CouncilEstimate{Calls: 5, Tokens: 2*45_000 + 625_000 + roundCheckTokens + 80_000, Minutes: 3, AgentTokens: 625_000}},
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
	if want := (CouncilEstimate{Calls: 7, Tokens: 2*2*45_000 + 2*roundCheckTokens + 80_000, Minutes: 5}); got != want {
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
	// the message's round check is one call more, whoever answers
	if got, want := EstimateFollowup(3, nil, false), (CouncilEstimate{Calls: 4, Tokens: 60_000 + roundCheckTokens, Minutes: 1}); got != want {
		t.Errorf("without tools = %+v, want %+v", got, want)
	}
	if got, want := EstimateFollowup(3, nil, true), (CouncilEstimate{Calls: 4, Tokens: 330_000 + roundCheckTokens, Minutes: 2}); got != want {
		t.Errorf("with tools = %+v, want %+v", got, want)
	}
	if got := EstimateFollowup(0, nil, true); got.Calls != 0 || got.Tokens != 0 {
		t.Errorf("no experts cost nothing, the round check included: %+v", got)
	}
}

// TestEstimateFollowupPricesChatsAtContext: a chat answering a follow-up costs what it holds, as Estimate gives a chat's
// turn, while a role expert keeps the flat price; a chat whose context is unknown (0: a pi chat, or no transcript yet)
// takes the flat price instead of costing nothing.
func TestEstimateFollowupPricesChatsAtContext(t *testing.T) {
	chat := func(id string, context int64) CouncilExpert {
		return CouncilExpert{Id: "agent-" + id, Agent: id, Harness: "claude", Context: context}
	}
	for _, tc := range []struct {
		name  string
		k     int
		chats []CouncilExpert
		tools bool
		want  CouncilEstimate
	}{
		{"two role experts and a chat of 182k", 2, []CouncilExpert{chat("tab-1", 182_000)}, false,
			CouncilEstimate{Calls: 4, Tokens: 2*20_000 + 182_000 + roundCheckTokens, Minutes: 1, AgentTokens: 182_000}},
		{"tools on: the role experts take the tools price, the chat keeps its context", 2, []CouncilExpert{chat("tab-1", 182_000)}, true,
			CouncilEstimate{Calls: 4, Tokens: 2*110_000 + 182_000 + roundCheckTokens, Minutes: 2, AgentTokens: 182_000}},
		{"two chats and no role expert: still one round check for the message", 0, []CouncilExpert{chat("tab-1", 100_000), chat("tab-2", 300_000)}, false,
			CouncilEstimate{Calls: 3, Tokens: 400_000 + roundCheckTokens, Minutes: 1, AgentTokens: 400_000}},
		{"a chat of unknown context takes the flat price", 1, []CouncilExpert{chat("tab-1", 0)}, false,
			CouncilEstimate{Calls: 3, Tokens: 2*20_000 + roundCheckTokens, Minutes: 1, AgentTokens: 20_000}},
		{"a chat of unknown context takes the tools price with tools on", 1, []CouncilExpert{chat("tab-1", 0), chat("tab-2", 50_000)}, true,
			CouncilEstimate{Calls: 4, Tokens: 110_000 + 110_000 + 50_000 + roundCheckTokens, Minutes: 2, AgentTokens: 110_000 + 50_000}},
		{"a pi chat with no context is flat too", 0, []CouncilExpert{{Id: "agent-tab-3", Agent: "tab-3", Harness: "pi"}}, false,
			CouncilEstimate{Calls: 2, Tokens: 20_000 + roundCheckTokens, Minutes: 1, AgentTokens: 20_000}},
		{"no chats is the role experts alone", 2, nil, false,
			CouncilEstimate{Calls: 3, Tokens: 40_000 + roundCheckTokens, Minutes: 1}},
	} {
		if got := EstimateFollowup(tc.k, tc.chats, tc.tools); got != tc.want {
			t.Errorf("%s: EstimateFollowup = %+v, want %+v", tc.name, got, tc.want)
		}
	}
}

// TestEstimateRouted: a whole-council message the router takes costs one router call and one seat (the low end) up to
// two seats (the high end), and the round check on the answers. A role seat takes the flat follow-up price, a chat its
// context, a chat of unknown context the flat price; the low end is the cheapest candidate and the high end the two
// dearest; with toolsAuto the low end reads no files and the high end does; a seat with a failed call and the
// coordinator are never priced.
func TestEstimateRouted(t *testing.T) {
	roles := func(ids ...string) []CouncilExpert {
		out := make([]CouncilExpert, 0, len(ids))
		for _, id := range ids {
			out = append(out, CouncilExpert{Id: id, Name: id})
		}
		return out
	}
	chat := func(id string, context int64) CouncilExpert {
		return CouncilExpert{Id: "agent-" + id, Agent: id, Harness: "claude", Context: context}
	}
	chair := CouncilExpert{Id: "chair", Coordinator: true}
	panel3 := append(roles("ux", "ram", "skeptic"), chair)
	r := int64(routerTokens + roundCheckTokens) // what every routed message pays besides its seats: the router and the check

	for _, tc := range []struct {
		name      string
		c         *Council
		tools     bool
		toolsAuto bool
		want      CouncilEstimate
	}{
		{"three role seats, files off", &Council{Experts: panel3}, false, false,
			CouncilEstimate{Calls: 3, CallsMax: 4, Tokens: r + 20_000, TokensMax: r + 40_000, Minutes: 1}},
		{"three role seats, files on: both ends at the tools price", &Council{Experts: panel3}, true, false,
			CouncilEstimate{Calls: 3, CallsMax: 4, Tokens: r + 110_000, TokensMax: r + 220_000, Minutes: 2}},
		{"Auto: the low end reads no files, the high end does", &Council{Experts: panel3}, false, true,
			CouncilEstimate{Calls: 3, CallsMax: 4, Tokens: r + 20_000, TokensMax: r + 220_000, Minutes: 2}},
		{"Auto beats the guess the composer sent in tools", &Council{Experts: panel3}, true, true,
			CouncilEstimate{Calls: 3, CallsMax: 4, Tokens: r + 20_000, TokensMax: r + 220_000, Minutes: 2}},
		{"a file in the Discussion since the report: both ends at the tools price, Auto or not",
			&Council{Experts: panel3, Summary: &CouncilSummary{At: 1}, Replies: []CouncilReply{
				{Id: "r1", Author: YouId, Text: "@paper.pdf", To: []string{"ux"}, Tools: true, Attachments: []string{"paper.pdf"}, Ts: 2},
			}}, false, true,
			CouncilEstimate{Calls: 3, CallsMax: 4, Tokens: r + 110_000, TokensMax: r + 220_000, Minutes: 2}},

		{"a chat of 300k is the dearest at the high end and absent from the low end",
			&Council{Experts: append(roles("ux", "ram"), chat("tab-1", 300_000), chair)}, false, false,
			CouncilEstimate{Calls: 3, CallsMax: 4, Tokens: r + 20_000, TokensMax: r + 300_000 + 20_000, Minutes: 1, AgentTokens: 300_000}},
		{"with files on a chat keeps its context, and the role seats take the tools price",
			&Council{Experts: append(roles("ux", "ram"), chat("tab-1", 300_000), chair)}, true, false,
			CouncilEstimate{Calls: 3, CallsMax: 4, Tokens: r + 110_000, TokensMax: r + 300_000 + 110_000, Minutes: 2, AgentTokens: 300_000}},
		{"a chat cheaper than the role seats is the low end and absent from the high end",
			&Council{Experts: append(roles("ux", "ram"), chat("tab-1", 50_000), chair)}, true, false,
			CouncilEstimate{Calls: 3, CallsMax: 4, Tokens: r + 50_000, TokensMax: r + 220_000, Minutes: 2}},
		{"Auto with a chat of 300k: the chat is dear at both ends, the cheapest seat is a role seat at the low end",
			&Council{Experts: append(roles("ux", "ram"), chat("tab-1", 300_000), chair)}, false, true,
			CouncilEstimate{Calls: 3, CallsMax: 4, Tokens: r + 20_000, TokensMax: r + 300_000 + 110_000, Minutes: 2, AgentTokens: 300_000}},
		{"a chat of unknown context takes the flat price, and its share is that price",
			&Council{Experts: []CouncilExpert{{Id: "ux"}, {Id: "agent-tab-3", Agent: "tab-3", Harness: "pi"}, chair}}, false, false,
			CouncilEstimate{Calls: 3, CallsMax: 4, Tokens: r + 20_000, TokensMax: r + 40_000, Minutes: 1, AgentTokens: 20_000}},
		{"two chats and no role seat",
			&Council{Experts: []CouncilExpert{chat("tab-1", 100_000), chat("tab-2", 300_000), chair}}, false, false,
			CouncilEstimate{Calls: 3, CallsMax: 4, Tokens: r + 100_000, TokensMax: r + 400_000, Minutes: 1, AgentTokens: 400_000}},

		{"one candidate is one seat at both ends", &Council{Experts: append(roles("ux"), chair)}, false, false,
			CouncilEstimate{Calls: 3, CallsMax: 3, Tokens: r + 20_000, TokensMax: r + 20_000, Minutes: 1}},
		{"one candidate in Auto still spans the files branches", &Council{Experts: append(roles("ux"), chair)}, false, true,
			CouncilEstimate{Calls: 3, CallsMax: 3, Tokens: r + 20_000, TokensMax: r + 110_000, Minutes: 2}},
		{"one chat is one seat at its context", &Council{Experts: []CouncilExpert{chat("tab-1", 182_000), chair}}, false, false,
			CouncilEstimate{Calls: 3, CallsMax: 3, Tokens: r + 182_000, TokensMax: r + 182_000, Minutes: 1, AgentTokens: 182_000}},

		{"a seat with a failed call is left out",
			&Council{Experts: append(roles("ux", "ram"), chat("tab-1", 300_000), chair),
				Failed: map[string]CouncilFailure{"agent-tab-1": {Round: 1, Error: "gone"}}}, false, false,
			CouncilEstimate{Calls: 3, CallsMax: 4, Tokens: r + 20_000, TokensMax: r + 40_000, Minutes: 1}},
		{"the failures that leave one candidate leave one seat",
			&Council{Experts: append(roles("ux", "ram", "skeptic"), chair),
				Failed: map[string]CouncilFailure{"ram": {Round: 1, Error: "x"}, "skeptic": {Round: 2, Error: "y"}}}, false, false,
			CouncilEstimate{Calls: 3, CallsMax: 3, Tokens: r + 20_000, TokensMax: r + 20_000, Minutes: 1}},
		{"the coordinator is never priced, whatever it holds",
			&Council{Experts: append(roles("ux", "ram"), CouncilExpert{Id: "chair", Coordinator: true, Agent: "tab-9", Context: 900_000})}, false, false,
			CouncilEstimate{Calls: 3, CallsMax: 4, Tokens: r + 20_000, TokensMax: r + 40_000, Minutes: 1}},

		{"no panel costs nothing", &Council{Experts: []CouncilExpert{chair}}, false, true, CouncilEstimate{}},
		{"no council experts at all costs nothing", &Council{}, true, false, CouncilEstimate{}},
		{"every seat failed costs nothing",
			&Council{Experts: append(roles("ux", "ram"), chair),
				Failed: map[string]CouncilFailure{"ux": {Round: 1, Error: "x"}, "ram": {Round: 1, Error: "y"}}}, false, false, CouncilEstimate{}},
	} {
		if got := EstimateRouted(tc.c, tc.tools, tc.toolsAuto); got != tc.want {
			t.Errorf("%s: EstimateRouted = %+v, want %+v", tc.name, got, tc.want)
		}
	}
}

// TestEstimateRoutedLeavesTheCouncilAlone: pricing a message reads the council and changes nothing on it, the order of its
// seats included.
func TestEstimateRoutedLeavesTheCouncilAlone(t *testing.T) {
	c := &Council{Experts: []CouncilExpert{
		{Id: "ux"}, {Id: "agent-tab-1", Agent: "tab-1", Harness: "claude", Context: 300_000}, {Id: "ram"}, {Id: "chair", Coordinator: true},
	}}
	EstimateRouted(c, false, true)
	if got := idsOf(c.Experts); got[0] != "ux" || got[1] != "agent-tab-1" || got[2] != "ram" || got[3] != "chair" {
		t.Errorf("EstimateRouted reordered the council's seats: %v", got)
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
