// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"reflect"
	"slices"
	"strings"
	"testing"
)

// figureFile is a project file whose line 3 holds the idle wait and whose line 12 holds a latency.
const figureFile = "package idle\n\nconst idleWaitSeconds = 300\n// a service sleeps after the wait\n" +
	"// row 5\n// row 6\n// row 7\n// row 8\n// row 9\n// row 10\n// row 11\nconst wakeLatency = \"1,248 ms\"\n"

func TestCheckFigure(t *testing.T) {
	project := t.TempDir()
	writeCiteFile(t, project, "pkg/idle.go", figureFile)
	roots := []string{project}

	cases := []struct {
		name     string
		fig      CouncilFigure
		roots    []string
		wantCite string
		wantNote string // a substring of the note; "" means no note
	}{
		{"value in the quote, quote at the line",
			CouncilFigure{Value: "300", Measures: "idle wait", Ref: "pkg/idle.go:3", Quote: "const idleWaitSeconds = 300"}, roots, CiteOK, ""},
		{"the value matches without regard to case or the spacing",
			CouncilFigure{Value: "1,248   MS", Measures: "wake", Ref: "pkg/idle.go:12", Quote: `const wakeLatency = "1,248 ms"`}, roots, CiteOK, ""},
		{"the quote a few lines off still counts, as for evidence",
			CouncilFigure{Value: "300", Ref: "pkg/idle.go:5", Quote: "const idleWaitSeconds = 300"}, roots, CiteOK, ""},
		{"a range holds the quote",
			CouncilFigure{Value: "300", Ref: "pkg/idle.go:3-4", Quote: "const idleWaitSeconds = 300"}, roots, CiteOK, ""},
		{"the value is not in the quote",
			CouncilFigure{Value: "301", Ref: "pkg/idle.go:3", Quote: "const idleWaitSeconds = 300"}, roots, CiteWrong, "value not in the quote"},
		{"no quote",
			CouncilFigure{Value: "300", Ref: "pkg/idle.go:3"}, roots, CiteWrong, "no quote"},
		{"a quote of only spaces is no quote",
			CouncilFigure{Value: "300", Ref: "pkg/idle.go:3", Quote: "  \n "}, roots, CiteWrong, "no quote"},
		{"no line in the ref",
			CouncilFigure{Value: "300", Ref: "pkg/idle.go", Quote: "const idleWaitSeconds = 300"}, roots, CiteWrong, "no line"},
		{"no value",
			CouncilFigure{Value: "  ", Ref: "pkg/idle.go:3", Quote: "const idleWaitSeconds = 300"}, roots, CiteWrong, "no value"},
		{"a line past the end of the file",
			CouncilFigure{Value: "300", Ref: "pkg/idle.go:900", Quote: "const idleWaitSeconds = 300"}, roots, CiteWrong, "past the end"},
		{"a file that is not there",
			CouncilFigure{Value: "300", Ref: "pkg/gone.go:3", Quote: "const idleWaitSeconds = 300"}, roots, CiteWrong, "file not found"},
		{"a quote that is nowhere near the line",
			CouncilFigure{Value: "1,248 ms", Ref: "pkg/idle.go:3", Quote: `const wakeLatency = "1,248 ms"`}, roots, CiteWrong, "quote not found"},
		{"a link is no place in a project file",
			CouncilFigure{Value: "300", Ref: "https://example.com/a:3", Quote: "300"}, roots, CiteWrong, "not a path:line"},
		{"a screenshot cite is none either",
			CouncilFigure{Value: "300", Ref: "screenshot:home.png#save@0.1,0.1,0.2,0.2", Quote: "300"}, roots, CiteWrong, "not a path:line"},
		{"with no tree to check against a well-formed figure stays unchecked",
			CouncilFigure{Value: "300", Ref: "pkg/idle.go:3", Quote: "const idleWaitSeconds = 300"}, nil, "", ""},
		{"with no tree a figure with no quote is still wrong: that needs no tree to see",
			CouncilFigure{Value: "300", Ref: "pkg/idle.go:3"}, nil, CiteWrong, "no quote"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := checkFigure(tc.fig, tc.roots)
			if got.Cite != tc.wantCite {
				t.Errorf("Cite = %q (%q), want %q", got.Cite, got.CiteNote, tc.wantCite)
			}
			switch {
			case tc.wantNote == "" && got.CiteNote != "":
				t.Errorf("CiteNote = %q, want none", got.CiteNote)
			case tc.wantNote != "" && !strings.Contains(got.CiteNote, tc.wantNote):
				t.Errorf("CiteNote = %q, want it to hold %q", got.CiteNote, tc.wantNote)
			}
			// what the seat wrote stays
			if got.Value != tc.fig.Value || got.Measures != tc.fig.Measures || got.Ref != tc.fig.Ref || got.Quote != tc.fig.Quote {
				t.Errorf("the figure's own fields changed: %+v from %+v", got, tc.fig)
			}
		})
	}

	t.Run("it checks from scratch and keeps From", func(t *testing.T) {
		stale := CouncilFigure{Value: "300", Ref: "pkg/idle.go:3", Quote: "const idleWaitSeconds = 300", Cite: CiteWrong,
			CiteNote: "an earlier verdict", From: []string{"P1"}}
		got := checkFigure(stale, roots)
		if got.Cite != CiteOK || got.CiteNote != "" || !slices.Equal(got.From, []string{"P1"}) {
			t.Errorf("checkFigure = %+v, want ok with no note and From kept", got)
		}
		unchecked := checkFigure(stale, nil)
		if unchecked.Cite != "" || unchecked.CiteNote != "" {
			t.Errorf("with no roots an earlier verdict stood: %+v", unchecked)
		}
	})
}

// fig is a checked figure for the collect tests.
func fig(value, measures, ref, cite string) CouncilFigure {
	f := CouncilFigure{Value: value, Measures: measures, Ref: ref, Quote: "quote of " + value + " " + measures, Cite: cite}
	if cite == CiteWrong {
		f.CiteNote = "value not in the quote"
	}
	return f
}

func TestCollectFigures(t *testing.T) {
	t.Run("two seats' copies of one figure are one, verified, with both ids and the verified copy's measures", func(t *testing.T) {
		c := &Council{Proposals: []CouncilProposal{
			{Id: "P1", Author: "ux", Figures: []CouncilFigure{fig("300", "first measures", "pkg/idle.go:3", CiteWrong)}},
			// the same place written with a backslash and capitals, the value with another run of spaces
			{Id: "P2", Author: "ram", Figures: []CouncilFigure{fig("300", "second measures", `PKG\Idle.go:3`, CiteOK)}},
			{Id: "P3", Author: "skeptic", Figures: []CouncilFigure{fig("300", "third measures", "pkg/idle.go:3", CiteOK)}},
		}}
		got := collectFigures(c)
		if len(got) != 1 {
			t.Fatalf("got %d figures, want 1: %+v", len(got), got)
		}
		f := got[0]
		if f.Cite != CiteOK || f.CiteNote != "" {
			t.Errorf("Cite = %q (%q), want ok: a copy that verified makes the figure verified", f.Cite, f.CiteNote)
		}
		if f.Measures != "second measures" {
			t.Errorf("Measures = %q, want the first verified copy's", f.Measures)
		}
		if f.Ref != `PKG\Idle.go:3` || f.Quote != "quote of 300 second measures" {
			t.Errorf("ref and quote = %q, %q, want the first verified copy's", f.Ref, f.Quote)
		}
		if !slices.Equal(f.From, []string{"P1", "P2", "P3"}) {
			t.Errorf("From = %v, want every proposal that declared it, in order", f.From)
		}
	})

	t.Run("a figure no copy verified keeps its first copy, with the first non-empty measures", func(t *testing.T) {
		first := fig("300", "", "pkg/idle.go:3", CiteWrong)
		first.CiteNote = "file not found"
		c := &Council{Proposals: []CouncilProposal{
			{Id: "P1", Author: "ux", Figures: []CouncilFigure{first}},
			{Id: "P2", Author: "ram", Figures: []CouncilFigure{fig("300", "only measures", "pkg/idle.go:3", CiteWrong)}},
		}}
		got := collectFigures(c)
		if len(got) != 1 || got[0].Cite != CiteWrong || got[0].CiteNote != "file not found" ||
			got[0].Measures != "only measures" || !slices.Equal(got[0].From, []string{"P1", "P2"}) {
			t.Errorf("collectFigures = %+v", got)
		}
	})

	t.Run("the measures come from verified copies even when an earlier copy wrote some", func(t *testing.T) {
		c := &Council{Proposals: []CouncilProposal{
			{Id: "P1", Author: "ux", Figures: []CouncilFigure{fig("300", "unverified words", "a.go:1", CiteWrong)}},
			{Id: "P2", Author: "ram", Figures: []CouncilFigure{fig("300", "", "a.go:1", CiteOK)}},
			{Id: "P3", Author: "ram", Figures: []CouncilFigure{fig("300", "verified words", "a.go:1", CiteOK)}},
		}}
		if got := collectFigures(c); len(got) != 1 || got[0].Measures != "verified words" {
			t.Errorf("collectFigures = %+v, want the first non-empty measures among the verified copies", got)
		}
	})

	t.Run("different values or places are different figures, in the order they were first declared", func(t *testing.T) {
		c := &Council{Proposals: []CouncilProposal{
			{Id: "P1", Author: "ux", Figures: []CouncilFigure{fig("300", "a", "a.go:1", CiteOK), fig("30%", "b", "a.go:2", CiteOK)}},
			{Id: "P2", Author: "ram", Figures: []CouncilFigure{fig("30%", "b2", "b.go:2", CiteOK), fig("300", "a2", "a.go:1", CiteOK),
				fig("301", "c", "a.go:1", CiteOK)}},
		}}
		var got []string
		for _, f := range collectFigures(c) {
			got = append(got, f.Value+"@"+f.Ref+"/"+strings.Join(f.From, "+"))
		}
		want := []string{"300@a.go:1/P1+P2", "30%@a.go:2/P1", "30%@b.go:2/P2", "301@a.go:1/P2"}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("figures = %v, want %v", got, want)
		}
	})

	t.Run("a place written as a line or a range with a column is one place", func(t *testing.T) {
		c := &Council{Proposals: []CouncilProposal{
			{Id: "P1", Author: "ux", Figures: []CouncilFigure{fig("300", "a", "a.go:42", CiteOK)}},
			{Id: "P2", Author: "ram", Figures: []CouncilFigure{fig("300", "a", "a.go:L42", CiteOK)}},
			{Id: "P3", Author: "ram", Figures: []CouncilFigure{fig("300", "a", "a.go:42:7", CiteOK)}},
			{Id: "P4", Author: "ram", Figures: []CouncilFigure{fig("300", "a", "a.go:42-45", CiteOK)}},
		}}
		got := collectFigures(c)
		if len(got) != 2 || !slices.Equal(got[0].From, []string{"P1", "P2", "P3"}) || !slices.Equal(got[1].From, []string{"P4"}) {
			t.Errorf("collectFigures = %+v, want line 42 as one figure and the range as another", got)
		}
	})

	t.Run("a seat that declares one figure twice is listed once", func(t *testing.T) {
		c := &Council{Proposals: []CouncilProposal{
			{Id: "P1", Author: "ux", Figures: []CouncilFigure{fig("300", "a", "a.go:1", CiteOK), fig("300", "a", "a.go:1", CiteOK)}},
		}}
		if got := collectFigures(c); len(got) != 1 || !slices.Equal(got[0].From, []string{"P1"}) {
			t.Errorf("collectFigures = %+v", got)
		}
	})

	t.Run("a held or dropped draft's figures are not collected", func(t *testing.T) {
		c := &Council{Proposals: []CouncilProposal{
			{Id: "P1", Author: "ux", Draft: DraftHeld, Figures: []CouncilFigure{fig("300", "a", "a.go:1", CiteOK)}},
			{Id: "P2", Author: "ux", Draft: DraftDropped, Figures: []CouncilFigure{fig("301", "a", "a.go:1", CiteOK)}},
			{Id: "P3", Author: "ram", Figures: []CouncilFigure{fig("302", "a", "a.go:1", CiteOK)}},
		}}
		if got := collectFigures(c); len(got) != 1 || got[0].Value != "302" {
			t.Errorf("collectFigures = %+v, want only the sent proposal's", got)
		}
	})

	t.Run("it leaves a proposal's own figures alone", func(t *testing.T) {
		c := &Council{Proposals: []CouncilProposal{
			{Id: "P1", Author: "ux", Figures: []CouncilFigure{fig("300", "a", "a.go:1", CiteOK)}},
		}}
		collectFigures(c)
		if f := c.Proposals[0].Figures[0]; f.From != nil {
			t.Errorf("a proposal's figure got From %v: only Council.Figures carries it", f.From)
		}
	})

	t.Run("nothing to collect is nil, and a Brainstorm has none", func(t *testing.T) {
		if got := collectFigures(&Council{Proposals: []CouncilProposal{{Id: "P1", Author: "ux"}}}); got != nil {
			t.Errorf("a review with no figures got %+v, want nil", got)
		}
		b := &Council{Mode: ModeBrainstorm, Proposals: []CouncilProposal{
			{Id: "P1", Author: "ux", Figures: []CouncilFigure{fig("300", "a", "a.go:1", CiteOK)}},
		}}
		if got := collectFigures(b); got != nil {
			t.Errorf("a Brainstorm got %+v, want nil", got)
		}
	})
}
