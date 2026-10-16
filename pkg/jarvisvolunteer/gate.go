// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvisvolunteer

import "sync"

// quietWindowMs is the minimum silence between any two utterances. UNFITTED — shipped deliberately
// conservative and adjusted on evidence, because the failure modes are asymmetric: too quiet is a
// feature that underdelivers, too chatty is a feature that gets turned off. Revisit with the count of
// ReasonRateLimited against actual utterances.
const quietWindowMs int64 = 45 * 60 * 1000

// shortlistMax bounds what reaches the judge. Unfitted; with the rate gate ahead of it and the
// already-emitted filter behind it, this is not what constrains admission.
const shortlistMax = 5

var (
	gateMu      sync.Mutex
	lastSpokeAt int64
	emitted     = map[string]bool{}
)

// allowNow reports whether the quiet window has elapsed. Called BEFORE any read or model call, so a
// trigger inside the window costs zero I/O and zero tokens. The cost of that ordering is that a
// genuinely urgent candidate waits out the window; accepted, because there is no urgency signal to
// distinguish one and inventing one would be speculative.
func allowNow(now int64) bool {
	gateMu.Lock()
	defer gateMu.Unlock()
	return lastSpokeAt == 0 || now-lastSpokeAt >= quietWindowMs
}

func markSpoke(now int64) {
	gateMu.Lock()
	defer gateMu.Unlock()
	lastSpokeAt = now
}

// markEmitted records an id so the judge is never paid for a candidate the frontend would discard.
// This is a COST optimisation, not the correctness mechanism — say-once is enforced by the frontend
// watermark against the stable (At, ID) pair — so losing this map to a wavesrv restart is harmless.
func markEmitted(id string) {
	gateMu.Lock()
	defer gateMu.Unlock()
	emitted[id] = true
}

// prefilter drops already-emitted and unstampable candidates and caps the shortlist, taking the
// classes in turn: a declined candidate is never emitted, so one producer's backlog would otherwise
// fill every shortlist and keep the other classes from the judge for good. Each class keeps its
// producer's order. Deterministic, no model, no I/O.
func prefilter(cands []Candidate) []Candidate {
	gateMu.Lock()
	defer gateMu.Unlock()
	var classes []string
	byClass := map[string][]Candidate{}
	seen := map[string]bool{}
	for _, c := range cands {
		if c.ID == "" || c.At == 0 {
			continue // an undatable candidate could never advance the watermark: it would re-speak forever
		}
		if emitted[c.ID] || seen[c.ID] {
			continue
		}
		seen[c.ID] = true
		if _, ok := byClass[c.Class]; !ok {
			classes = append(classes, c.Class)
		}
		byClass[c.Class] = append(byClass[c.Class], c)
	}
	var out []Candidate
	for turn := 0; len(out) < shortlistMax && len(out) < len(seen); turn++ {
		for _, class := range classes {
			if turn < len(byClass[class]) && len(out) < shortlistMax {
				out = append(out, byClass[class][turn])
			}
		}
	}
	return out
}

// resetGateForTest clears the process-wide gate state between tests.
func resetGateForTest() {
	gateMu.Lock()
	defer gateMu.Unlock()
	lastSpokeAt = 0
	emitted = map[string]bool{}
}
