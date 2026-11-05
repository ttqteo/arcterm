// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import "slices"

// routeChecker settles which seat gets proposal p's full text in the cross-check, the other seats reading its title and
// first line. It is the seat p's author named (p.Checker) when that seat is on the panel, has not failed and is not the
// author, and the coordinator is never on the panel. Otherwise it is the panel seat other than the author, and not a failed
// one, with the fewest sent proposals already routed to it (their Checker), the first in panel order on a tie. A panel of
// one has no other seat, and routes nothing: "". A seat whose call failed cannot check anything (routeCandidates).
func routeChecker(c *Council, p CouncilProposal) string {
	panel := routeCandidates(c)
	if slices.ContainsFunc(panel, func(e CouncilExpert) bool { return e.Id == p.Checker && e.Id != p.Author }) {
		return p.Checker
	}
	load := map[string]int{}
	for _, q := range sentProposals(c) {
		load[q.Checker]++
	}
	best := ""
	for _, e := range panel {
		if e.Id != p.Author && (best == "" || load[e.Id] < load[best]) {
			best = e.Id
		}
	}
	return best
}
