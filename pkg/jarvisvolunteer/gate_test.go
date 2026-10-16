// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvisvolunteer

import (
	"fmt"
	"strings"
	"testing"
)

func cand(id string, at int64) Candidate {
	return Candidate{Class: ClassLooseEnd, ID: id, At: at, Title: "t", Snippet: "s"}
}

func TestRateGateBlocksInsideQuietWindow(t *testing.T) {
	resetGateForTest()
	const start int64 = 1_000_000
	if !allowNow(start) {
		t.Fatalf("first utterance must be allowed on a fresh gate")
	}
	markSpoke(start)
	if allowNow(start + quietWindowMs - 1) {
		t.Fatalf("a trigger inside the quiet window must be blocked")
	}
	if !allowNow(start + quietWindowMs) {
		t.Fatalf("a trigger at exactly the window edge must be allowed")
	}
}

func TestPrefilterDropsAlreadyEmitted(t *testing.T) {
	resetGateForTest()
	markEmitted("seen-1")
	got := prefilter([]Candidate{cand("seen-1", 10), cand("fresh-1", 20)})
	if len(got) != 1 || got[0].ID != "fresh-1" {
		t.Fatalf("an already-emitted id must be dropped, got %+v", got)
	}
}

func TestPrefilterCapsShortlist(t *testing.T) {
	resetGateForTest()
	var in []Candidate
	for i := 0; i < shortlistMax+3; i++ {
		in = append(in, cand(string(rune('a'+i)), int64(i+1)))
	}
	got := prefilter(in)
	if len(got) != shortlistMax {
		t.Fatalf("shortlist must cap at %d, got %d", shortlistMax, len(got))
	}
}

func TestPrefilterDropsUnstampedCandidate(t *testing.T) {
	resetGateForTest()
	got := prefilter([]Candidate{{Class: ClassLedger, ID: "no-at", At: 0}, cand("ok", 5)})
	if len(got) != 1 || got[0].ID != "ok" {
		t.Fatalf("a candidate with no At can never advance the watermark and must be dropped, got %+v", got)
	}
}

func TestPrefilterTakesClassesInTurn(t *testing.T) {
	resetGateForTest()
	var in []Candidate
	for i := 1; i <= 6; i++ {
		in = append(in, cand(fmt.Sprintf("le-%d", i), int64(i)))
	}
	in = append(in,
		Candidate{Class: ClassMemoryHygiene, ID: "mh-1", At: 100},
		Candidate{Class: ClassMemoryHygiene, ID: "mh-2", At: 200},
	)
	var ids []string
	for _, c := range prefilter(in) {
		ids = append(ids, c.ID)
	}
	// one producer's backlog must not fill the shortlist; each class keeps its own order
	if want := "le-1 mh-1 le-2 mh-2 le-3"; strings.Join(ids, " ") != want {
		t.Fatalf("shortlist = %v, want %s", ids, want)
	}
}
