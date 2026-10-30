// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"fmt"
	"strconv"
	"strings"
)

// The estimate is calibrated to the canvas: the four-expert UI group with no files is "≈ 9 calls · ~0.8M tokens ·
// ~6 min", and Paused's "Rounds 2 and 3" is "≈ 5 calls · ~0.3M tokens".
const (
	round1BaseTokens     = 140_000 // one expert's round 1 call: its tools reading the code, before any file is attached
	round2Tokens         = 45_000  // one expert's round 2 call: text in, a few stances out
	synthesisTokens      = 80_000
	followupTokens       = 20_000 // one expert answering a reply from text
	followupToolsTokens  = 90_000 // the same, with Read, Grep and Glob on
	round1Minutes        = 3
	replyPassMinutes     = 2 // round 2, and again for a third round
	synthesisMinutes     = 1
	followupMinutes      = 1
	followupToolsMinutes = 2
	bytesPerToken        = 4 // the rough size of a file read as tokens
)

// CouncilEstimate is what a council, or part of one, is expected to cost. Tokens are counted, not priced: the
// model an expert runs on does not enter the number.
type CouncilEstimate struct {
	Calls       int   `json:"calls"`
	Tokens      int64 `json:"tokens"`
	Minutes     int   `json:"minutes"`
	AgentTokens int64 `json:"agenttokens,omitempty"` // the share of Tokens the seated agents' turns take
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

// Estimate prices a whole council: one round 1 call for each role expert, which also reads the fileBytes of input as
// about fileBytes/4 tokens, a call per reply pass for each, the synthesis, and for each seated agent a turn per round
// that costs its Context (the agent already holds its own context, and reads the files itself). Tokens are counted, not
// priced, so the models do not change it. rounds is the council's Rounds; it counts only with an agent seated, where 1
// drops the reply pass and 3 adds a second. AgentTokens is the agents' share of Tokens.
func Estimate(experts []CouncilExpert, fileBytes int64, rounds int) CouncilEstimate {
	rn := int64(seatRounds(&Council{Experts: experts, Rounds: rounds}))
	roleExperts, agents, agentContext := seatCounts(experts, func(CouncilExpert) bool { return false })
	agentTokens := agentContext * rn
	return CouncilEstimate{
		Calls:       int((roleExperts+agents)*rn + 1),
		Tokens:      roleExperts*(round1BaseTokens+fileBytes/bytesPerToken) + roleExperts*(rn-1)*round2Tokens + agentTokens + synthesisTokens,
		Minutes:     round1Minutes + int(rn-1)*replyPassMinutes + synthesisMinutes,
		AgentTokens: agentTokens,
	}
}

// EstimateRemaining prices what is left of c after the round it has finished, for its pause: round 1 when c has none
// (Round 0, or the pause after round 1), else c.Round. An expert-only council has its one reply pass and the synthesis
// left; with agents seated the reply passes after that round count, and each takes a turn from every agent too. The
// seats whose round 1 call failed have no proposals and sit the reply passes out.
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
	return CouncilEstimate{
		Calls:       int((roleExperts+agents)*passes + 1),
		Tokens:      roleExperts*passes*round2Tokens + agentTokens + synthesisTokens,
		Minutes:     int(passes)*replyPassMinutes + synthesisMinutes,
		AgentTokens: agentTokens,
	}
}

// EstimateFollowup prices a follow-up round of k expert calls, each answering from text, or with the read-only
// tools on.
func EstimateFollowup(k int, tools bool) CouncilEstimate {
	per, minutes := int64(followupTokens), followupMinutes
	if tools {
		per, minutes = followupToolsTokens, followupToolsMinutes
	}
	return CouncilEstimate{Calls: k, Tokens: int64(k) * per, Minutes: minutes}
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
