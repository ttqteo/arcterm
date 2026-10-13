// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsync

import (
	"strings"
	"testing"
)

func TestApplyRegionAppendsWhenAbsent(t *testing.T) {
	got := applyRegion("# Notes\n\nsome hand-written text\n", "canonical body")
	if !strings.HasPrefix(got, "# Notes\n\nsome hand-written text\n") {
		t.Fatalf("existing content not preserved: %q", got)
	}
	if !strings.Contains(got, steeringBegin) || !strings.Contains(got, "canonical body") {
		t.Fatalf("region not appended: %q", got)
	}
}

func TestApplyRegionReplacesInPlaceAndIsIdempotent(t *testing.T) {
	existing := "# Prefs\n\n<!-- ARC-MEMORY:BEGIN project=waveterm -->\nfacts\n<!-- ARC-MEMORY:END -->\n"
	once := applyRegion(existing, "first")
	updated := applyRegion(once, "second")
	if strings.Contains(updated, "first") {
		t.Fatalf("stale body survived the replace: %q", updated)
	}
	if strings.Count(updated, steeringBegin) != 1 {
		t.Fatalf("region duplicated: %q", updated)
	}
	if again := applyRegion(updated, "second"); again != updated {
		t.Fatalf("not idempotent:\nfirst:  %q\nsecond: %q", updated, again)
	}
}

// the shape codex and opencode had on disk: a region followed by a leftover memory block
func TestApplyRegionLeavesTextAroundTheRegionByteIdentical(t *testing.T) {
	before := "# Prefs\n\n"
	after := "\n<!-- ARC-MEMORY:BEGIN project=x -->\nfacts\n<!-- ARC-MEMORY:END -->\n"
	got := applyRegion(before+renderRegion("first")+after, "second")
	if want := before + renderRegion("second") + after; got != want {
		t.Fatalf("text outside the markers changed:\ngot:  %q\nwant: %q", got, want)
	}
}

// A shared doc seeded from a harness file carried that file's markers, so each sync closed the nested region at
// its first end marker and left one more stray end marker in every harness file (20 to 26 by 2026-10-10).
func TestApplyRegionDropsMarkersInTheBodyAndHealsStrayEnds(t *testing.T) {
	body := steeringBegin + "\n# Prefs\n- rule\n" + steeringEnd + "\n"
	want := "# Notes\n\n" + renderRegion("# Prefs\n- rule") + "after\n"
	if got := renderRegion(body); got != renderRegion("# Prefs\n- rule") {
		t.Fatalf("markers in the body were rendered:\n%q", got)
	}
	corrupt := "# Notes\n\n" + steeringBegin + "\n" + steeringBegin + "\n# Prefs\n- rule\n" + strings.Repeat(steeringEnd+"\n", 20) + "after\n"
	got := applyRegion(corrupt, body)
	if got != want {
		t.Fatalf("a file with a nested region and stray end markers was not healed:\ngot:  %q\nwant: %q", got, want)
	}
	if again := applyRegion(got, body); again != got {
		t.Fatalf("not idempotent:\nfirst:  %q\nsecond: %q", got, again)
	}
	if steeringState(got, body) != "current" {
		t.Fatalf("a healed file reads %q against the marker-carrying doc", steeringState(got, body))
	}
}
