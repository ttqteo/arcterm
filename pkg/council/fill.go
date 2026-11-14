// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"fmt"
	"slices"
)

// What the coordinator writes is the judgment: the answer, which proposals merge, the ranked top with its reasoning and
// first step, a line for each other item, the questions to ask next, the weak claims. What follows is the bookkeeping Go
// does from the replies it holds: the evidence gate on a Review's top, then each item's stances and agreed flag, each
// proposal's outcome, and a line for any proposal the coordinator placed nowhere. Go's values replace whatever the model
// sent, so an older reply that holds stances or outcomes reads the same.

// labelRank orders the claim labels, best first: 4 Ran, 3 Read code, 2 Guess, 1 Disproved. 0 is no label (checks did not
// run, or a council from before labels), which says nothing about the claim.
func labelRank(label string) int {
	switch label {
	case LabelRan:
		return 4
	case LabelRead:
		return 3
	case LabelGuess:
		return 2
	case LabelDisproved:
		return 1
	}
	return 0
}

// unbacked says no proposal of d is backed: it has proposals, each of them labelled, and the best label among them is
// Guess or Disproved. A merged direction is as backed as its best member; one unlabelled member, or none at all, leaves it
// alone: nothing says it is a guess.
func unbacked(c *Council, d CouncilDirection) bool {
	best := 0
	for _, pid := range d.From {
		p := findSentProposal(c, pid)
		if p == nil || labelRank(p.Label) == 0 {
			return false
		}
		best = max(best, labelRank(p.Label))
	}
	return best > 0 && best <= labelRank(LabelGuess)
}

// foldedLine is d as one line of Kept: its title, reasoning and ids, with no first step, stances or rank.
func foldedLine(d CouncilDirection) CouncilDirection {
	return CouncilDirection{Title: d.Title, Reasoning: d.Reasoning, From: d.From, Stances: map[string]CouncilStance{}}
}

// gateByEvidence is a Review's evidence gate: a direction in the top whose proposals are all Guess or Disproved moves, in
// its order, to the head of Kept, and the top is renumbered from 1, so it may hold fewer than the cap. Go promotes nothing:
// a folded line has no reasoning or first step to show in full. A Brainstorm is not gated: a Guess idea can still be a
// direction.
func gateByEvidence(c *Council, s *CouncilSummary) {
	if isBrainstorm(c) {
		return
	}
	var top, moved []CouncilDirection
	for _, d := range s.Directions {
		if unbacked(c, d) {
			moved = append(moved, foldedLine(d))
		} else {
			top = append(top, d)
		}
	}
	if len(moved) == 0 {
		return
	}
	for i := range top {
		top[i].Rank = i + 1
	}
	s.Directions = top
	s.Kept = append(moved, s.Kept...)
}

// stanceStrength orders the stances, strongest first: oppose, challenge, accept.
func stanceStrength(s CouncilStance) int {
	switch s {
	case StanceOppose:
		return 3
	case StanceChallenge:
		return 2
	case StanceAccept:
		return 1
	}
	return 0
}

// stancesOn are the stances towards the proposals in from: each panel seat other than their authors takes the strongest
// of its replies on them from round 2 on. A seat that said none has none. agreed is true when no stance challenges or
// opposes.
func stancesOn(c *Council, from []string) (stances map[string]CouncilStance, agreed bool) {
	authors := map[string]bool{}
	for _, pid := range from {
		if p := findSentProposal(c, pid); p != nil {
			authors[p.Author] = true
		}
	}
	stances, agreed = map[string]CouncilStance{}, true
	for _, e := range panelOf(c) {
		if authors[e.Id] {
			continue
		}
		var best CouncilStance
		for _, r := range c.Replies {
			if r.Author == e.Id && r.Round >= 2 && Sent(r.Draft) && slices.Contains(from, r.ProposalId) &&
				stanceStrength(r.Stance) > stanceStrength(best) {
				best = r.Stance
			}
		}
		if best != "" {
			stances[e.Id] = best
			agreed = agreed && best == StanceAccept
		}
	}
	return stances, agreed
}

// fillSummary writes what Go knows into s: a line of Kept for each Review proposal that is sent, not cut, not withdrawn and
// placed in no direction and no kept line, then every item's stances and agreed flag, and every proposal's outcome.
func fillSummary(c *Council, s *CouncilSummary) {
	placed := map[string]bool{}
	for _, items := range [][]CouncilDirection{s.Directions, s.Kept} {
		for _, d := range items {
			for _, pid := range d.From {
				placed[pid] = true
			}
		}
	}
	for _, p := range sentProposals(c) {
		if !isBrainstorm(c) && !placed[p.Id] && !p.Cut && !p.Withdrawn {
			s.Kept = append(s.Kept, CouncilDirection{Title: p.Title, Reasoning: firstSentence(p.Argument), From: []string{p.Id}})
		}
	}
	for i := range s.Kept {
		s.Kept[i].Rank = i + 1
	}
	for _, items := range [][]CouncilDirection{s.Directions, s.Kept} {
		for i := range items {
			items[i].Stances, items[i].Agreed = stancesOn(c, items[i].From)
		}
	}

	outcomes := map[string]string{}
	for _, p := range sentProposals(c) {
		switch {
		case p.Cut:
			outcomes[p.Id] = "Cut at the pause"
		case p.Withdrawn:
			outcomes[p.Id] = withdrawnOutcome(c, p)
			if outcomes[p.Id] == "" {
				outcomes[p.Id] = "Withdrawn"
			}
		}
	}
	for i, d := range s.Directions {
		first := true
		for _, pid := range d.From {
			if _, has := outcomes[pid]; has {
				continue
			}
			if first {
				outcomes[pid], first = fmt.Sprintf("Direction %d", i+1), false
			} else {
				outcomes[pid] = fmt.Sprintf("Merged into direction %d", i+1)
			}
		}
	}
	keptWord := "Also raised"
	if isBrainstorm(c) {
		keptWord = "Kept aside"
	}
	for _, k := range s.Kept {
		for _, pid := range k.From {
			if _, has := outcomes[pid]; !has {
				outcomes[pid] = keptWord
			}
		}
	}
	if isBrainstorm(c) {
		for _, p := range sentProposals(c) {
			if _, has := outcomes[p.Id]; !has {
				outcomes[p.Id] = "Not picked"
			}
		}
	}
	s.Outcomes = outcomes
}
