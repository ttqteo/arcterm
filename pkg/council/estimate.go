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
	laterRoundsMinutes   = 3 // round 2 and the synthesis
	followupMinutes      = 1
	followupToolsMinutes = 2
	bytesPerToken        = 4 // the rough size of a file read as tokens
)

// CouncilEstimate is what a council, or part of one, is expected to cost. Tokens are counted, not priced: the
// model an expert runs on does not enter the number.
type CouncilEstimate struct {
	Calls   int   `json:"calls"`
	Tokens  int64 `json:"tokens"`
	Minutes int   `json:"minutes"`
}

// panelSize counts the experts that propose and review, which is all but the coordinator.
func panelSize(experts []CouncilExpert) int {
	n := 0
	for _, e := range experts {
		if !e.Coordinator {
			n++
		}
	}
	return n
}

// Estimate prices a whole council of n non-coordinator experts: one round 1 call each, which also reads the
// fileBytes of input as about fileBytes/4 tokens, one round 2 call each, and the synthesis. Tokens are counted, not
// priced, so the experts' models do not change it.
func Estimate(experts []CouncilExpert, fileBytes int64) CouncilEstimate {
	n := int64(panelSize(experts))
	return CouncilEstimate{
		Calls:   int(2*n + 1),
		Tokens:  n*(round1BaseTokens+fileBytes/bytesPerToken) + n*round2Tokens + synthesisTokens,
		Minutes: round1Minutes + laterRoundsMinutes,
	}
}

// EstimateRemaining prices rounds 2 and 3 of c, for the pause after round 1: the experts whose round 1 call failed
// have no proposals and sit round 2 out.
func EstimateRemaining(c *Council) CouncilEstimate {
	n := int64(0)
	for _, e := range c.Experts {
		if f, failed := c.Failed[e.Id]; !e.Coordinator && !(failed && f.Round == 1) {
			n++
		}
	}
	return CouncilEstimate{
		Calls:   int(n + 1),
		Tokens:  n*round2Tokens + synthesisTokens,
		Minutes: laterRoundsMinutes,
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
