// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"strings"
	"testing"
)

const wellFormedReport = `Answer: The tally panics on an empty list and skips its first score.

## What to do, most important first
1. Guard Average against an empty tally
   Why: counter.go:18 divides by len(t.scores), which is 0 before any Add, so the call panics.
   Disagrees: Skeptic says the caller never asks, but nothing in counter.go:12 stops it.
2. Start Best's loop at 0
   Why: counter.go:27 begins at 1, so a lone best score in slot 0 is never seen.
   Disagrees: no one
`

func TestTeamReportWellFormed(t *testing.T) {
	s, err := parseTeamReport(wellFormedReport)
	if err != nil {
		t.Fatal(err)
	}
	if want := "The tally panics on an empty list and skips its first score."; s.Answer != want {
		t.Errorf("answer = %q, want %q", s.Answer, want)
	}
	if len(s.Directions) != 2 {
		t.Fatalf("got %d items, want 2: %+v", len(s.Directions), s.Directions)
	}
	d := s.Directions[0]
	if d.Rank != 1 || d.Title != "Guard Average against an empty tally" {
		t.Errorf("first item = rank %d %q", d.Rank, d.Title)
	}
	for _, want := range []string{"counter.go:18", "Disagrees: Skeptic says"} {
		if !strings.Contains(d.Reasoning, want) {
			t.Errorf("first item's reasoning lacks %q: %q", want, d.Reasoning)
		}
	}
	if strings.Index(d.Reasoning, "counter.go:18") > strings.Index(d.Reasoning, "Disagrees:") {
		t.Errorf("the Why line must come before the Disagrees line: %q", d.Reasoning)
	}
	if got := s.Directions[1]; got.Rank != 2 || got.Title != "Start Best's loop at 0" {
		t.Errorf("second item = rank %d %q", got.Rank, got.Title)
	}
}

func TestTeamReportMissingLines(t *testing.T) {
	s, err := parseTeamReport(`Answer: Two things.

## What to do, most important first
1. **Only a title**
2. Why but no Disagrees
   Why: counter.go:3 does it.
3. Disagrees but no Why
   Disagrees: RAM, because counter.go:9.
`)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Directions) != 3 {
		t.Fatalf("got %d items, want 3: %+v", len(s.Directions), s.Directions)
	}
	if d := s.Directions[0]; d.Title != "Only a title" || d.Reasoning != "" {
		t.Errorf("title-only item = %q / %q (the bold marks go, no reasoning is made up)", d.Title, d.Reasoning)
	}
	if d := s.Directions[1]; !strings.Contains(d.Reasoning, "counter.go:3") || strings.Contains(d.Reasoning, "Disagrees") {
		t.Errorf("item with no Disagrees line has reasoning %q", d.Reasoning)
	}
	if d := s.Directions[2]; !strings.Contains(d.Reasoning, "RAM, because counter.go:9.") || strings.Contains(d.Reasoning, "Why") {
		t.Errorf("item with no Why line has reasoning %q", d.Reasoning)
	}
}

func TestTeamReportWrappedInExtraText(t *testing.T) {
	s, err := parseTeamReport("The team is done. Here is my report:\r\n\r\n" + strings.ReplaceAll(wellFormedReport, "\n", "\r\n") +
		"\r\nreport written\r\n")
	if err != nil {
		t.Fatal(err)
	}
	if s.Answer == "" || len(s.Directions) != 2 {
		t.Fatalf("answer %q, %d items; want an answer and 2 items", s.Answer, len(s.Directions))
	}
	if strings.Contains(s.Directions[1].Reasoning, "report written") {
		t.Errorf("the closing line leaked into the last item: %q", s.Directions[1].Reasoning)
	}
}

func TestTeamReportContinuationLines(t *testing.T) {
	s, err := parseTeamReport("## What to do, most important first\n1. Wrapped\n   Why: first half\n     second half\n   Disagrees: no one\n")
	if err != nil {
		t.Fatal(err)
	}
	if got := s.Directions[0].Reasoning; !strings.Contains(got, "first half second half") {
		t.Errorf("a wrapped Why line was cut: %q", got)
	}
}

func TestTeamReportNoItems(t *testing.T) {
	for name, text := range map[string]string{
		"empty":       "",
		"answer only": "Answer: nothing to report.\n\n## What to do, most important first\n",
		"prose":       "I could not finish the review.",
	} {
		if s, err := parseTeamReport(text); err == nil {
			t.Errorf("%s: no error, got %+v", name, s)
		}
	}
}
