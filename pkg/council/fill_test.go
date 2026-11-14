// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"reflect"
	"slices"
	"testing"
)

// fillCouncil is a Review of 2 rounds, past its reply pass: six proposals, three seats and a coordinator. P4 was cut and
// P5 withdrawn; the replies hold every kind the fill must read, and the ones it must leave out (a held reply, the
// person's, the coordinator's, a revision with no stance).
func fillCouncil() *Council {
	return &Council{
		Id: "c1", Question: "What first?",
		Experts: []CouncilExpert{
			{Id: "ux", Name: "UX"}, {Id: "ram", Name: "RAM"}, {Id: "skeptic", Name: "Skeptic"},
			{Id: "lead", Name: "Lead", Coordinator: true},
		},
		Proposals: []CouncilProposal{
			{Id: "P1", Author: "ux", Title: "Show the state", Argument: "Show it first. It is cheap."},
			{Id: "P2", Author: "ram", Title: "Poll less", Argument: "Polling costs RAM. Do less."},
			{Id: "P3", Author: "skeptic", Title: "Rename the chip", Argument: "The name is wrong. Fix it."},
			{Id: "P4", Author: "ram", Title: "A cut idea", Argument: "Cut.", Cut: true},
			{Id: "P5", Author: "ux", Title: "A withdrawn idea", Argument: "Gone.", Withdrawn: true},
			{Id: "P6", Author: "skeptic", Title: "Left out", Argument: "Nobody placed me. Really."},
		},
		Replies: []CouncilReply{
			{Id: "r1", ProposalId: "P1", Author: "skeptic", Stance: StanceChallenge, Round: 2},
			{Id: "r2", ProposalId: "P1", Author: "ram", Stance: StanceAccept, Round: 2},
			{Id: "r3", ProposalId: "P1", ParentId: "r1", Author: "skeptic", Stance: StanceOppose, Round: 3}, // a later pass wins
			{Id: "r4", ProposalId: "P2", Author: "ux", Stance: StanceAccept, Round: 2},
			{Id: "r5", ProposalId: "P2", Author: "skeptic", Stance: StanceOppose, Round: 2},
			{Id: "r6", ProposalId: "P3", Author: "ux", Stance: StanceChallenge, Round: 2},
			{Id: "r7", ProposalId: "P3", Author: "ram", Stance: StanceAccept, Round: 2},
			{Id: "r8", ProposalId: "P6", Author: "ux", Stance: StanceAccept, Round: 2},
			{Id: "r9", ProposalId: "P6", Author: "ram", Stance: StanceChallenge, Round: 2},
			{Id: "r10", ProposalId: "P1", ParentId: "r1", Author: "ux", Revised: true, Round: 2},                // no stance
			{Id: "r11", ProposalId: "P1", Author: "ram", Stance: StanceOppose, Round: 2, Draft: DraftHeld},      // not out in the room
			{Id: "r12", ProposalId: "P1", Author: YouId, Stance: StanceOppose, Round: 2},                        // the person is no seat
			{Id: "r13", ProposalId: "P1", Author: "lead", Stance: StanceOppose, Round: 2},                       // the coordinator is no seat
			{Id: "r14", ProposalId: "P1", ParentId: "r1", Author: "ram", Stance: StanceOppose, Round: 1, Ts: 1}, // before round 2: not a review
		},
	}
}

func dirOf(title string, from ...string) CouncilDirection {
	return CouncilDirection{Title: title, Reasoning: "why " + title, FirstStep: "start " + title, From: from, Stances: map[string]CouncilStance{}}
}

func TestFillGivesAPlainDirectionItsStancesAgreedAndOutcomes(t *testing.T) {
	c := fillCouncil()
	s := CouncilSummary{
		// what the model sent is replaced: a stance for the author, a wrong one, an agreed flag, outcomes
		Directions: []CouncilDirection{{Title: "Show", From: []string{"P1"}, Stances: map[string]CouncilStance{"ux": StanceAccept, "ram": StanceOppose}, Agreed: true}},
		Outcomes:   map[string]string{"P1": "Also raised", "P2": "Direction 9"},
	}
	fillSummary(c, &s)
	d := s.Directions[0]
	if want := map[string]CouncilStance{"ram": StanceAccept, "skeptic": StanceOppose}; !reflect.DeepEqual(d.Stances, want) {
		t.Errorf("stances = %v, want %v: the author out, each seat's strongest of its round 2 and later replies", d.Stances, want)
	}
	if d.Agreed {
		t.Error("agreed = true, want false: the skeptic opposes")
	}
	if got := s.Outcomes["P1"]; got != "Direction 1" {
		t.Errorf("outcome of P1 = %q, want Direction 1", got)
	}
}

func TestFillOfAMergedDirectionLeavesItsAuthorsOutAndTakesEachSeatsStrongestStance(t *testing.T) {
	c := fillCouncil()
	s := CouncilSummary{Directions: []CouncilDirection{dirOf("Merged", "P2", "P3")}} // by ram and the skeptic
	fillSummary(c, &s)
	d := s.Directions[0]
	// ux accepted P2 and challenged P3: its strongest is the challenge
	if want := map[string]CouncilStance{"ux": StanceChallenge}; !reflect.DeepEqual(d.Stances, want) {
		t.Errorf("stances = %v, want %v", d.Stances, want)
	}
	if d.Agreed {
		t.Error("agreed = true, want false: ux challenges P3")
	}
	if s.Outcomes["P2"] != "Direction 1" || s.Outcomes["P3"] != "Merged into direction 1" {
		t.Errorf("outcomes = %v, want Direction 1 for the first and Merged into direction 1 for the next", s.Outcomes)
	}

	// every seat that is not an author agrees: the direction is agreed
	s = CouncilSummary{Directions: []CouncilDirection{dirOf("Calm", "P1", "P2")}} // by ux and ram; the skeptic opposes both
	fillSummary(c, &s)
	if want := map[string]CouncilStance{"skeptic": StanceOppose}; !reflect.DeepEqual(s.Directions[0].Stances, want) {
		t.Errorf("stances = %v, want %v", s.Directions[0].Stances, want)
	}
	s = CouncilSummary{Directions: []CouncilDirection{dirOf("Agreed", "P1", "P3")}} // by ux and the skeptic; ram accepts both
	fillSummary(c, &s)
	if d := s.Directions[0]; !d.Agreed || !reflect.DeepEqual(d.Stances, map[string]CouncilStance{"ram": StanceAccept}) {
		t.Errorf("direction = %+v, want agreed with ram's accept", d)
	}
}

func TestFillOfAKeptItemGivesItsStancesAndAlsoRaised(t *testing.T) {
	c := fillCouncil()
	s := CouncilSummary{
		Directions: []CouncilDirection{dirOf("Show", "P1")},
		Kept:       []CouncilDirection{{Title: "Rename", Reasoning: "the name is wrong", From: []string{"P3"}, Stances: map[string]CouncilStance{}}},
	}
	fillSummary(c, &s)
	k := s.Kept[0]
	if want := map[string]CouncilStance{"ux": StanceChallenge, "ram": StanceAccept}; !reflect.DeepEqual(k.Stances, want) || k.Agreed {
		t.Errorf("kept stances = %v agreed %v, want %v and not agreed", k.Stances, k.Agreed, want)
	}
	if s.Outcomes["P3"] != "Also raised" {
		t.Errorf("outcome of P3 = %q, want Also raised", s.Outcomes["P3"])
	}
}

// The round a withdrawal reads is its withdrawing reply's, not the council's last reply pass: in a council of three
// rounds a round-2 withdrawal says round 2, in its outcome and in the prompts that name it.
func TestWithdrawnRoundIsItsWithdrawingReplys(t *testing.T) {
	c := fillCouncil()
	c.Rounds = 3
	c.Replies = append(c.Replies,
		CouncilReply{Id: "r20", ProposalId: "P5", Author: "ux", Revised: true, Withdraws: true, Round: 2},
		// a held withdrawal by someone else, and another seat's revising reply, say nothing of when P5 was withdrawn
		CouncilReply{Id: "r21", ProposalId: "P5", Author: "ram", Revised: true, Withdraws: true, Round: 3},
	)
	p := *findProposal(c, "P5")
	if got := withdrawnRound(c, p); got != 2 {
		t.Fatalf("withdrawnRound = %d, want 2", got)
	}
	s := CouncilSummary{Directions: []CouncilDirection{dirOf("Show", "P1")}}
	fillSummary(c, &s)
	if s.Outcomes["P5"] != "Withdrawn in round 2" {
		t.Errorf("outcome of P5 withdrawn in round 2 of 3 = %q, want Withdrawn in round 2", s.Outcomes["P5"])
	}
	if got := withdrawnRound(c, *findProposal(c, "P1")); got != 0 {
		t.Errorf("withdrawnRound of an idea still in the running = %d, want 0", got)
	}
	// a held withdrawal of its author is not out yet: the record falls back to the last reply pass
	c.Replies[len(c.Replies)-2].Draft = DraftHeld
	if got := withdrawnRound(c, p); got != 3 {
		t.Errorf("withdrawnRound with only a held withdrawing reply = %d, want the last reply pass, 3", got)
	}
}

func TestFillOutcomesOfAWithdrawnAndACutProposal(t *testing.T) {
	c := fillCouncil()
	// the withdrawn P5 is the first of its direction, but its fate is its own: P1 is the direction's first
	s := CouncilSummary{Directions: []CouncilDirection{dirOf("Show", "P5", "P1")}}
	fillSummary(c, &s)
	for pid, want := range map[string]string{"P5": "Withdrawn in round 2", "P4": "Cut at the pause", "P1": "Direction 1"} {
		if s.Outcomes[pid] != want {
			t.Errorf("outcome of %s = %q, want %q", pid, s.Outcomes[pid], want)
		}
	}
	c.Rounds = 3
	s = CouncilSummary{Directions: []CouncilDirection{dirOf("Show", "P1")}}
	fillSummary(c, &s)
	if s.Outcomes["P5"] != "Withdrawn in round 3" {
		t.Errorf("outcome of P5 in a council of 3 rounds = %q, want Withdrawn in round 3", s.Outcomes["P5"])
	}
	// neither a cut nor a withdrawn proposal becomes a line of Also raised
	for _, k := range s.Kept {
		if slices.Contains(k.From, "P4") || slices.Contains(k.From, "P5") {
			t.Errorf("kept %+v holds a cut or a withdrawn proposal", k)
		}
	}
}

func TestFillAppendsAReviewProposalPlacedNowhereToKept(t *testing.T) {
	c := fillCouncil()
	s := CouncilSummary{
		Directions: []CouncilDirection{dirOf("Show", "P1"), dirOf("Poll", "P2")},
		Kept:       []CouncilDirection{{Title: "Rename", Reasoning: "the name is wrong", From: []string{"P3"}, Stances: map[string]CouncilStance{}}},
	}
	fillSummary(c, &s)
	if len(s.Kept) != 2 {
		t.Fatalf("kept = %+v, want the model's line and P6's", s.Kept)
	}
	k := s.Kept[1]
	if k.Title != "Left out" || k.Reasoning != "Nobody placed me." || !reflect.DeepEqual(k.From, []string{"P6"}) || k.Rank != 2 {
		t.Errorf("appended line = %+v, want P6's title and the first sentence of its argument, rank 2", k)
	}
	if want := map[string]CouncilStance{"ux": StanceAccept, "ram": StanceChallenge}; !reflect.DeepEqual(k.Stances, want) || k.Agreed {
		t.Errorf("appended stances = %v agreed %v, want %v and not agreed", k.Stances, k.Agreed, want)
	}
	if s.Outcomes["P6"] != "Also raised" {
		t.Errorf("outcome of P6 = %q, want Also raised", s.Outcomes["P6"])
	}
	if s.Kept[0].Rank != 1 {
		t.Errorf("kept ranks = %d, %d, want 1, 2", s.Kept[0].Rank, s.Kept[1].Rank)
	}
}

func TestFillOfABrainstormReadsNotPickedAndAddsNoLine(t *testing.T) {
	c := fillCouncil()
	c.Mode = ModeBrainstorm
	s := CouncilSummary{
		Directions: []CouncilDirection{dirOf("Show", "P1", "P2")},
		Kept:       []CouncilDirection{{Title: "Rename", Reasoning: "a wild one", From: []string{"P3"}, Stances: map[string]CouncilStance{}}},
	}
	fillSummary(c, &s)
	if len(s.Kept) != 1 {
		t.Errorf("kept = %+v, want the wild idea alone: a Brainstorm adds no line", s.Kept)
	}
	want := map[string]string{
		"P1": "Direction 1", "P2": "Merged into direction 1", "P3": "Kept aside", "P4": "Cut at the pause",
		"P5": "Withdrawn in round 2", "P6": "Not picked",
	}
	if !reflect.DeepEqual(s.Outcomes, want) {
		t.Errorf("outcomes = %v, want %v", s.Outcomes, want)
	}
}

func TestFillWithNothingSaidGivesEmptyStancesAndAgreed(t *testing.T) {
	c := fillCouncil()
	c.Replies = nil
	s := CouncilSummary{Directions: []CouncilDirection{{Title: "Show", From: []string{"P1"}}}}
	fillSummary(c, &s)
	if d := s.Directions[0]; d.Stances == nil || len(d.Stances) != 0 || !d.Agreed {
		t.Errorf("direction = %+v, want an empty stances map (not nil) and agreed", d)
	}
}

// labelled is fillCouncil with a label on each proposal: P1 Ran, P2 Read code, P3 Guess, P4 Disproved, P5 and P6 none.
func labelled() *Council {
	c := fillCouncil()
	for i, l := range []string{LabelRan, LabelRead, LabelGuess, LabelDisproved, "", ""} {
		c.Proposals[i].Label = l
	}
	c.Proposals[3].Cut, c.Proposals[4].Withdrawn = false, false
	return c
}

func TestGateMovesAGuessAndADisprovedDirectionToTheHeadOfKept(t *testing.T) {
	c := labelled()
	s := CouncilSummary{
		Directions: []CouncilDirection{
			dirOf("guess", "P3"), dirOf("ran", "P1"), dirOf("disproved", "P4"), dirOf("read", "P2"),
		},
		Kept: []CouncilDirection{{Title: "model's own", From: []string{"P6"}}},
	}
	gateByEvidence(c, &s)
	var top []string
	for i, d := range s.Directions {
		top = append(top, d.Title)
		if d.Rank != i+1 {
			t.Errorf("direction %q has rank %d, want %d", d.Title, d.Rank, i+1)
		}
	}
	if !slices.Equal(top, []string{"ran", "read"}) {
		t.Errorf("top = %v, want the two backed directions, fewer than 5", top)
	}
	var kept []string
	for _, k := range s.Kept {
		kept = append(kept, k.Title)
	}
	if !slices.Equal(kept, []string{"guess", "disproved", "model's own"}) {
		t.Errorf("kept = %v, want the gated ones first, in their order, then the model's own", kept)
	}
	if k := s.Kept[0]; k.FirstStep != "" || k.Reasoning != "why guess" || !slices.Equal(k.From, []string{"P3"}) {
		t.Errorf("a folded direction = %+v, want one line: its title, reasoning and ids, no first step", k)
	}
}

func TestGateKeepsAMergedDirectionWithOneRanMemberAndAnUnlabelledOne(t *testing.T) {
	c := labelled()
	s := CouncilSummary{Directions: []CouncilDirection{
		dirOf("merged", "P3", "P1"), // Guess and Ran: its label is its best member's
		dirOf("unlabelled", "P6"),   // checks did not run for it
		dirOf("half", "P3", "P6"),   // one member is unlabelled: nothing says it is unbacked
		dirOf("nobody", "P9"),       // an id that is not on the council
	}}
	cleanFrom := func(d *CouncilDirection) { cleanDirection(c, d) }
	for i := range s.Directions {
		cleanFrom(&s.Directions[i])
	}
	gateByEvidence(c, &s)
	if len(s.Directions) != 4 || len(s.Kept) != 0 {
		t.Errorf("directions %d kept %d, want all 4 to stay: %+v", len(s.Directions), len(s.Kept), s)
	}
}

func TestGateDoesNotTouchABrainstorm(t *testing.T) {
	c := labelled()
	c.Mode = ModeBrainstorm
	s := cleanSummary(c, CouncilSummary{Directions: []CouncilDirection{dirOf("guess", "P3"), dirOf("ran", "P1")}})
	if len(s.Directions) != 2 || s.Directions[0].Title != "guess" {
		t.Errorf("directions = %+v, want a Brainstorm's ideas ungated", s.Directions)
	}
}

func TestCleanSummaryGatesAReviewAndFillsGoValuesIn(t *testing.T) {
	c := labelled()
	got := cleanSummary(c, CouncilSummary{
		Directions: []CouncilDirection{dirOf("guess", "P3"), dirOf("ran", "P1")},
		Outcomes:   map[string]string{"P3": "Direction 1", "P1": "Direction 2"}, // the model's, written for the old ranks
	})
	if len(got.Directions) != 1 || got.Directions[0].Title != "ran" || got.Directions[0].Rank != 1 {
		t.Fatalf("directions = %+v, want the Ran direction alone, rank 1", got.Directions)
	}
	// the outcomes match the final ranks, not the ones the model wrote
	if got.Outcomes["P1"] != "Direction 1" || got.Outcomes["P3"] != "Also raised" {
		t.Errorf("outcomes = %v, want P1 Direction 1 and the gated P3 Also raised", got.Outcomes)
	}
}
