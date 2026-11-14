// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/council"
)

func TestCouncilMemoryData(t *testing.T) {
	got, err := councilMemoryData("c1", []string{"add", "Ruled-Out", "Two", "endpoints"}, "too much to maintain")
	if err != nil {
		t.Fatal(err)
	}
	if got.Action != council.EntryActionAdd || got.Kind != council.EntryRuledOut || got.Text != "Two endpoints" || got.Why != "too much to maintain" || got.Id != "c1" {
		t.Errorf("add = %+v", got)
	}
	got, err = councilMemoryData("c1", []string{"edit", "m4", "Spec now says 141."}, "")
	if err != nil || got.Action != council.EntryActionEdit || got.Entry != "m4" || got.Text != "Spec now says 141." {
		t.Errorf("edit = %+v, %v", got, err)
	}
	got, err = councilMemoryData("c1", []string{"rm", "m9"}, "")
	if err != nil || got.Action != council.EntryActionRemove || got.Entry != "m9" {
		t.Errorf("rm = %+v, %v", got, err)
	}
	for _, bad := range [][]string{{"add", "maybe", "x"}, {"add", "open"}, {"edit", "m1"}, {"rm"}, {"rm", "m1", "m2"}, {"pin", "m1"}, {"add", "open", "  "}} {
		if _, err := councilMemoryData("c1", bad, ""); err == nil {
			t.Errorf("%v: want an error", bad)
		}
	}
}

func TestCouncilMemoryText(t *testing.T) {
	c := &council.Council{Memory: &council.CouncilMemory{
		Suggestion: &council.CouncilMemoryCard{Text: "Keep the CLI as the entry point."},
		Entries: []council.CouncilMemoryEntry{
			{Id: "m1", Kind: council.EntryOpen, By: council.EntryByAuto, Text: "One endpoint or two?"},
			{Id: "m2", Kind: council.EntryRuledOut, By: council.EntryByYou, Text: "A second database", Why: "one is enough"},
		},
	}}
	got := councilMemoryText(c)
	for _, want := range []string{"Direction: (none chosen)", "Suggested, waiting on the person: Keep the CLI", "m1  open     auto One endpoint or two?", "m2  ruledout you  A second database (why: one is enough)"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}
	if got := councilMemoryText(&council.Council{}); !strings.Contains(got, "No entries.") {
		t.Errorf("empty memory = %q", got)
	}
}
