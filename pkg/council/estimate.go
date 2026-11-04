// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"cmp"
	"fmt"
	"slices"
	"strconv"
	"strings"
)

// The estimate is calibrated to the canvas: the four-expert UI group with no files is "≈ 9 calls · ~0.8M tokens ·
// ~6 min", and Paused's "Rounds 2 and 3" is "≈ 5 calls · ~0.3M tokens", each a call more now for the round check after
// a reply pass (the boards predate it; the tokens round to the same figures).
const (
	round1BaseTokens     = 140_000 // one expert's round 1 call: its tools reading the code, before any file is attached
	round2Tokens         = 45_000  // one expert's round 2 call: text in, a few stances out
	synthesisTokens      = 80_000
	followupTokens       = 20_000  // one expert answering a reply from text
	followupToolsTokens  = 110_000 // the same, with Read, Grep and Glob on: three sonnet answers took 80k–147k on 2026-11-01
	routerTokens         = 15_000  // one router call: a sonnet call with no tools. A first guess: re-measure once real routed messages run
	roundCheckTokens     = 18_000  // one round check: a haiku call with no tools that reads a round's messages and the memory's entries, priced like the router plus the memory. A first guess too
	round1Minutes        = 3
	replyPassMinutes     = 2 // round 2, and again for a third round
	synthesisMinutes     = 1
	followupMinutes      = 1
	followupToolsMinutes = 2
	bytesPerToken        = 4 // the rough size of a file read as tokens
)

// CouncilEstimate is what a council, or part of one, is expected to cost. Tokens are counted, not priced: the
// model an expert runs on does not enter the number. CallsMax and TokensMax are set only for a range (EstimateRouted),
// where Calls and Tokens are its low end and these its high end.
type CouncilEstimate struct {
	Calls       int   `json:"calls"`
	Tokens      int64 `json:"tokens"`
	Minutes     int   `json:"minutes"`
	AgentTokens int64 `json:"agenttokens,omitempty"` // the share of Tokens the seated agents' turns take
	CallsMax    int   `json:"callsmax,omitempty"`
	TokensMax   int64 `json:"tokensmax,omitempty"`
}

// seatRounds is how many rounds the seats of c answer before the summary. Rounds counts only when an agent is seated,
// so an expert-only council keeps today's two whatever it says.
func seatRounds(c *Council) int {
	if !HasAgents(c) {
		return DefaultRounds
	}
	return RoundsOf(c)
}

// seatCounts counts the seats that propose and review, which is all but the coordinator and the ones sitsOut names:
// the role experts, the live agents, and the context tokens the agents hold between them.
func seatCounts(experts []CouncilExpert, sitsOut func(CouncilExpert) bool) (roleExperts, agents, agentContext int64) {
	for _, e := range experts {
		switch {
		case e.Coordinator || sitsOut(e):
		case IsAgent(e):
			agents++
			agentContext += e.Context
		default:
			roleExperts++
		}
	}
	return roleExperts, agents, agentContext
}

// roundChecks is how many round checks passes reply passes cost: one a pass, and none when no seat is left to answer in
// them (a pass nobody takes has no messages to check). A check is a call of its own, no seat's turn.
func roundChecks(seats, passes int64) int64 {
	if seats == 0 {
		return 0
	}
	return passes
}

// Estimate prices a whole council: one round 1 call for each role expert, which also reads the fileBytes of input as
// about fileBytes/4 tokens, a call per reply pass for each, the synthesis, and for each seated agent a turn per round
// that costs its Context (the agent already holds its own context, and reads the files itself). Each reply pass is
// followed by a round check, one more call. Tokens are counted, not priced, so the models do not change it. rounds is
// the council's Rounds; it counts only with an agent seated, where 1 drops the reply pass (and its check) and 3 adds a
// second. AgentTokens is the agents' share of Tokens.
func Estimate(experts []CouncilExpert, fileBytes int64, rounds int) CouncilEstimate {
	rn := int64(seatRounds(&Council{Experts: experts, Rounds: rounds}))
	roleExperts, agents, agentContext := seatCounts(experts, func(CouncilExpert) bool { return false })
	agentTokens := agentContext * rn
	checks := roundChecks(roleExperts+agents, rn-1)
	return CouncilEstimate{
		Calls:       int((roleExperts+agents)*rn + checks + 1),
		Tokens:      roleExperts*(round1BaseTokens+fileBytes/bytesPerToken) + roleExperts*(rn-1)*round2Tokens + agentTokens + checks*roundCheckTokens + synthesisTokens,
		Minutes:     round1Minutes + int(rn-1)*replyPassMinutes + synthesisMinutes,
		AgentTokens: agentTokens,
	}
}

// EstimateRemaining prices what is left of c after the round it has finished, for its pause: round 1 when c has none
// (Round 0, or the pause after round 1), else c.Round. An expert-only council has its one reply pass and the synthesis
// left; with agents seated the reply passes after that round count, and each takes a turn from every agent too. The
// seats whose round 1 call failed have no proposals and sit the reply passes out. Each reply pass left is followed by a
// round check.
func EstimateRemaining(c *Council) CouncilEstimate {
	passes := int64(1)
	if HasAgents(c) {
		passes = int64(max(RoundsOf(c)-max(c.Round, 1), 0))
	}
	roleExperts, agents, agentContext := seatCounts(c.Experts, func(e CouncilExpert) bool {
		f, failed := c.Failed[e.Id]
		return failed && f.Round == 1
	})
	agentTokens := agentContext * passes
	checks := roundChecks(roleExperts+agents, passes)
	return CouncilEstimate{
		Calls:       int((roleExperts+agents)*passes + checks + 1),
		Tokens:      roleExperts*passes*round2Tokens + agentTokens + checks*roundCheckTokens + synthesisTokens,
		Minutes:     int(passes)*replyPassMinutes + synthesisMinutes,
		AgentTokens: agentTokens,
	}
}

// EstimateFollowup prices a follow-up round: k role experts, each answering from text (or with the read-only tools on) at
// the flat price, and each chat in agents answering at the context it holds, the cost Estimate gives a chat's turn. A
// chat whose Context is unknown (0: a pi chat, or a claude chat with no transcript yet) takes the flat price too, never
// nothing. The message's answers are followed by one round check, unless nobody answers: then there is nothing to check.
// Calls counts the answers and the check; AgentTokens is the chats' share of Tokens.
func EstimateFollowup(k int, agents []CouncilExpert, tools bool) CouncilEstimate {
	per, minutes := followupPrice(tools)
	var agentTokens int64
	for _, a := range agents {
		agentTokens += chatTokens(a, per)
	}
	checks := roundChecks(int64(k+len(agents)), 1)
	return CouncilEstimate{
		Calls:       k + len(agents) + int(checks),
		Tokens:      int64(k)*per + agentTokens + checks*roundCheckTokens,
		Minutes:     minutes,
		AgentTokens: agentTokens,
	}
}

// followupPrice is what one role expert answering a message costs, and how long a round of them takes: from text, or
// with the read-only tools on.
func followupPrice(tools bool) (tokens int64, minutes int) {
	if tools {
		return followupToolsTokens, followupToolsMinutes
	}
	return followupTokens, followupMinutes
}

// chatTokens is what a chat answering costs: the context it holds, or the flat price (per) when that is unknown (0: a pi
// chat, or a claude chat with no transcript yet), never nothing.
func chatTokens(chat CouncilExpert, per int64) int64 {
	if chat.Context > 0 {
		return chat.Context
	}
	return per
}

// routedSeat is one seat the router may pick, as the estimate prices it.
type routedSeat struct {
	price int64
	chat  bool
}

// routedSeatsByPrice prices each candidate of a routed message, dearest first (a tie keeps the panel's order).
func routedSeatsByPrice(candidates []CouncilExpert, tools bool) []routedSeat {
	per, _ := followupPrice(tools)
	seats := make([]routedSeat, 0, len(candidates))
	for _, e := range candidates {
		if IsAgent(e) {
			seats = append(seats, routedSeat{price: chatTokens(e, per), chat: true})
		} else {
			seats = append(seats, routedSeat{price: per})
		}
	}
	slices.SortStableFunc(seats, func(a, b routedSeat) int { return cmp.Compare(b.price, a.price) })
	return seats
}

// EstimateRouted prices a whole-council message the router takes: one router call, then one seat (the low end) or two
// (the high end), then the round check on their answers, as a range. The router picks among routeCandidates, so a seat
// with a failed call and the coordinator are never priced. A role seat costs the flat follow-up price, a chat its context (the flat price when that is unknown);
// the low end prices the cheapest candidate and the high end the two dearest, one when there is only one. With toolsAuto
// Let them read files is on Auto: the router has not decided, so the low end reads no files and the high end does;
// otherwise both ends use tools. Calls and CallsMax count the router's call and the round check's; Minutes is the high
// end's; AgentTokens is the chats' share of the high end. No candidate is the zero estimate: nobody could answer.
func EstimateRouted(c *Council, tools, toolsAuto bool) CouncilEstimate {
	candidates := routeCandidates(c)
	if len(candidates) == 0 {
		return CouncilEstimate{}
	}
	lowTools, highTools := tools && !toolsAuto, tools || toolsAuto
	cheapest := routedSeatsByPrice(candidates, lowTools)
	dearest := routedSeatsByPrice(candidates, highTools)[:min(2, len(candidates))]
	low := routerTokens + roundCheckTokens + cheapest[len(cheapest)-1].price
	high, agentTokens := int64(routerTokens+roundCheckTokens), int64(0)
	for _, s := range dearest {
		high += s.price
		if s.chat {
			agentTokens += s.price
		}
	}
	_, minutes := followupPrice(highTools)
	return CouncilEstimate{
		Calls:       3,
		CallsMax:    2 + len(dearest),
		Tokens:      low,
		TokensMax:   high,
		Minutes:     minutes,
		AgentTokens: agentTokens,
	}
}

// FormatTokens is a token count as wsh prints it: 84k, 0.3M, 1.2M (a round 1M has no decimal). From 100k up it counts
// in millions. The frontend has its own formatter for the UI.
func FormatTokens(n int64) string {
	if n < 1000 {
		return strconv.FormatInt(max(n, 0), 10)
	}
	if k := (n + 500) / 1000; k < 100 {
		return fmt.Sprintf("%dk", k)
	}
	tenths := (n + 50_000) / 100_000 // tenths of a million, halves rounded up
	return strings.TrimSuffix(fmt.Sprintf("%d.%d", tenths/10, tenths%10), ".0") + "M"
}
