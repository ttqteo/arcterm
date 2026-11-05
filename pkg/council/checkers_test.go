// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import "testing"

// routeCouncil is a panel of three (UX, RAM, Skeptic) and a coordinator, holding the given proposals.
func routeCouncil(proposals ...CouncilProposal) *Council {
	return &Council{
		Experts:   []CouncilExpert{{Id: "ux"}, {Id: "ram"}, {Id: "skeptic"}, {Id: "lead", Coordinator: true}},
		Proposals: proposals,
	}
}

func TestRouteCheckerKeepsTheNamedSeat(t *testing.T) {
	c := routeCouncil()
	for _, named := range []string{"ram", "skeptic"} {
		if got := routeChecker(c, CouncilProposal{Author: "ux", Checker: named}); got != named {
			t.Errorf("a proposal naming %q went to %q", named, got)
		}
	}
}

func TestRouteCheckerFallsBackWhenTheNamedSeatCannotCheck(t *testing.T) {
	c := routeCouncil()
	for name, named := range map[string]string{"none": "", "unknown": "ghost", "the author": "ux", "the coordinator": "lead", "spaces": "  "} {
		// nothing is routed yet, so the first panel seat other than the author gets it
		if got := routeChecker(c, CouncilProposal{Author: "ux", Checker: named}); got != "ram" {
			t.Errorf("%s: went to %q, want ram, the first seat other than the author", name, got)
		}
	}
}

func TestRouteCheckerBreaksTiesByPanelOrder(t *testing.T) {
	c := routeCouncil()
	if got := routeChecker(c, CouncilProposal{Author: "ram"}); got != "ux" {
		t.Errorf("RAM's proposal went to %q, want ux: first in the panel", got)
	}
	if got := routeChecker(c, CouncilProposal{Author: "skeptic"}); got != "ux" {
		t.Errorf("Skeptic's proposal went to %q, want ux: first in the panel", got)
	}
}

func TestRouteCheckerSpreadsTheLoad(t *testing.T) {
	c := routeCouncil()
	var got []string
	for i := range 4 {
		p := CouncilProposal{Id: string(rune('A' + i)), Author: "ux"}
		p.Checker = routeChecker(c, p)
		got = append(got, p.Checker)
		c.Proposals = append(c.Proposals, p)
	}
	if want := []string{"ram", "skeptic", "ram", "skeptic"}; got[0] != want[0] || got[1] != want[1] || got[2] != want[2] || got[3] != want[3] {
		t.Errorf("four proposals by UX went to %v, want %v", got, want)
	}

	// a seat that already checks more gets nothing while the others have less
	busy := routeCouncil(
		CouncilProposal{Id: "P1", Author: "ux", Checker: "ram"},
		CouncilProposal{Id: "P2", Author: "skeptic", Checker: "ram"},
		CouncilProposal{Id: "P3", Author: "skeptic", Checker: "ux"})
	if got := routeChecker(busy, CouncilProposal{Id: "P4", Author: "ux"}); got != "skeptic" {
		t.Errorf("went to %q, want skeptic: RAM checks 2, Skeptic none", got)
	}
}

// A held or dropped draft is not out in the room, so it is no check routed to a seat.
func TestRouteCheckerCountsOnlySentProposals(t *testing.T) {
	c := routeCouncil(
		CouncilProposal{Id: "P1", Author: "skeptic", Checker: "ram", Draft: DraftHeld},
		CouncilProposal{Id: "P2", Author: "skeptic", Checker: "ram", Draft: DraftDropped})
	if got := routeChecker(c, CouncilProposal{Id: "P3", Author: "skeptic"}); got != "ux" {
		t.Errorf("went to %q, want ux: first in the panel, since no sent proposal is routed to anyone", got)
	}
	c.Proposals = append(c.Proposals, CouncilProposal{Id: "P4", Author: "skeptic", Checker: "ux"})
	if got := routeChecker(c, CouncilProposal{Id: "P5", Author: "skeptic"}); got != "ram" {
		t.Errorf("went to %q, want ram: UX has the one sent check", got)
	}
}

func TestRouteCheckerOfALonePanelSeat(t *testing.T) {
	c := &Council{Experts: []CouncilExpert{{Id: "ux"}, {Id: "lead", Coordinator: true}}}
	if got := routeChecker(c, CouncilProposal{Author: "ux", Checker: "lead"}); got != "" {
		t.Errorf("a one-seat panel routed to %q, want nothing", got)
	}
	if got := routeChecker(c, CouncilProposal{Author: "ux"}); got != "" {
		t.Errorf("a one-seat panel routed to %q, want nothing", got)
	}
}
