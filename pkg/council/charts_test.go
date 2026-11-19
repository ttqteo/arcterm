// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"strings"
	"testing"
)

func TestChartLabel(t *testing.T) {
	for in, want := range map[string]string{
		"Phản biện":                 "Phản biện",
		`UX: "the [first] one"; #2`: "UX the first one 2",
		"a\nb,\tc":                  "a b c",
		strings.Repeat("x", 40):     strings.Repeat("x", chartLabelMax-1) + "…",
		"  spaced   out  ":          "spaced out",
		"`code` <b>{x}</b>":         "code b x /b",
	} {
		if got := ChartLabel(in); got != want {
			t.Errorf("ChartLabel(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestChartUnitStaysOffTheEdges(t *testing.T) {
	for in, want := range map[float64]float64{-1: 0.08, 0: 0.08, 0.5: 0.5, 1: 0.9, 3: 0.9} {
		if got := ChartUnit(in); got != want {
			t.Errorf("ChartUnit(%v) = %v, want %v", in, got, want)
		}
	}
}

// chartCouncil is a done Review: P1 by ux with two checked cites and a weak claim, P2 by ram with one wrong cite, and
// direction 1 from P1 (skeptic accepts, ram challenges), direction 2 from P2 (nobody else took a side).
func chartCouncil() *Council {
	return &Council{
		Id: "c", Mode: ModeReview, State: StateDone,
		Experts: []CouncilExpert{{Id: "ux", Name: "UX"}, {Id: "ram", Name: "Đo RAM"}, {Id: "skeptic", Name: "Skeptic"}, {Id: "lead", Name: "Lead", Coordinator: true}},
		Proposals: []CouncilProposal{
			{Id: "P1", Author: "ux", Evidence: []CouncilEvidence{{Ref: "a.go:1", Cite: CiteOK}, {Ref: "b.go:2", Cite: CiteOK}, {Weak: true}}},
			{Id: "P2", Author: "ram", Evidence: []CouncilEvidence{{Ref: "c.go:3", Cite: CiteWrong}}},
		},
		Summary: &CouncilSummary{Directions: []CouncilDirection{
			{Rank: 1, Title: "One", From: []string{"P1"}, Stances: map[string]CouncilStance{"skeptic": StanceAccept, "ram": StanceChallenge}},
			{Rank: 2, Title: "Two", From: []string{"P2"}},
		}},
		Stats: map[string]CouncilExpertStat{"ux": {Tokens: 1_500_000}, "ram": {Tokens: 2_000_000}, "lead": {Tokens: 60_000}},
		Timeline: map[string][]CouncilStep{
			"ux": {
				{Ts: 1_000_000, Kind: StepSearch}, {Ts: 1_001_000, Kind: StepRead, Target: `pkg\a.go`}, {Ts: 1_002_000, Kind: StepRead, Target: "b.go"},
				{Ts: 1_003_000, Kind: StepPropose}, {Ts: 1_200_000, Kind: StepReply},
			},
			"ram": {{Ts: 1_000_500, Kind: StepRead, Target: "PKG/a.go"}, {Ts: 1_001_500, Kind: StepRun}},
		},
	}
}

func TestDirectionPoint(t *testing.T) {
	c := chartCouncil()
	// two of P1's three pieces of evidence hold; ux (author) and skeptic back it, ram challenges: 2 of 3 sides
	if x, y := directionPoint(c, c.Summary.Directions[0]); x != 2.0/3 || y != 2.0/3 {
		t.Errorf("direction 1 at (%v, %v), want (2/3, 2/3)", x, y)
	}
	// P2's one cite is wrong; only its author took a side
	if x, y := directionPoint(c, c.Summary.Directions[1]); x != 0 || y != 1 {
		t.Errorf("direction 2 at (%v, %v), want (0, 1)", x, y)
	}
	if x, y := directionPoint(c, CouncilDirection{From: []string{"P9"}}); x != 0 || y != 0 {
		t.Errorf("a direction from no known proposal at (%v, %v), want (0, 0)", x, y)
	}
}

func TestGlanceChart(t *testing.T) {
	c := chartCouncil()
	var b strings.Builder
	writeGlanceChart(&b, c)
	got := b.String()
	for _, want := range []string{"## At a glance\n", "```mermaid\n" + QuadrantHead, "x-axis Thin evidence --> Checked evidence", "    D1: [0.67, 0.67]\n", "    D2: [0.08, 0.90]\n"} {
		if !strings.Contains(got, want) {
			t.Errorf("chart lacks %q:\n%s", want, got)
		}
	}

	// two directions on one point: the second is nudged so both labels read
	c.Summary.Directions = append(c.Summary.Directions, CouncilDirection{Rank: 3, From: []string{"P1"}, Stances: c.Summary.Directions[0].Stances})
	b.Reset()
	writeGlanceChart(&b, c)
	if !strings.Contains(b.String(), "    D3: [0.62, 0.62]\n") {
		t.Errorf("a direction on direction 1's point was not nudged:\n%s", b.String())
	}

	for name, c := range map[string]*Council{
		"a Brainstorm": {Mode: ModeBrainstorm, Summary: chartCouncil().Summary},
		"no summary":   {Mode: ModeReview},
		"no direction": {Mode: ModeReview, Summary: &CouncilSummary{}},
	} {
		b.Reset()
		if writeGlanceChart(&b, c); b.Len() != 0 {
			t.Errorf("%s drew a glance chart:\n%s", name, b.String())
		}
	}
}

func TestGlanceChartOnlyInTheDocument(t *testing.T) {
	c := chartCouncil()
	if strings.Contains(Markdown(c), "At a glance") || strings.Contains(Markdown(c), "```mermaid") {
		t.Error("Markdown, which `wsh council show` and `wait` print for an agent, holds a chart")
	}
	doc := Document(c)
	glance, dirs := strings.Index(doc, "## At a glance"), strings.Index(doc, "## Directions")
	if glance < 0 || dirs < glance {
		t.Errorf("the document's glance chart is missing or not ahead of the directions:\n%s", doc)
	}
	if facts, charts := strings.Index(doc, "## Run facts"), strings.Index(doc, "### Where the tokens went"); facts < 0 || charts < facts {
		t.Errorf("the run charts are missing or not under the run facts:\n%s", doc)
	}
}

func TestRunCharts(t *testing.T) {
	var b strings.Builder
	writeRunCharts(&b, chartCouncil())
	got := b.String()
	for _, want := range []string{
		// tokens: every seat with a stat, in panel order, the coordinator included
		"x-axis [\"UX\", \"Đo RAM\", \"Lead\"]\n    y-axis \"tokens (M)\"\n    bar [1.50, 2.00, 0.06]\n",
		// look-ups: the coordinator looked nothing up and has no bar; a.go is read by both seats (path case and slashes
		// folded), b.go by ux alone; a propose or a reply is no look-up
		"x-axis [\"UX\", \"Đo RAM\"]\n    y-axis \"steps\"\n    bar [3, 2]\n    bar [2, 1]\n    bar [1, 1]\n",
		// the swimlane: ux's steps 1000–1003 s, then a reply 197 s later (past the gap), a stretch of one held to 5 s
		"gantt\n    dateFormat x\n", "    section UX\n    4 steps : 1000000, 1005000\n    1 steps : 1200000, 1205000\n",
		"    section Đo RAM\n    2 steps : 1000500, 1005500\n",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("run charts lack %q:\n%s", want, got)
		}
	}

	b.Reset()
	if writeRunCharts(&b, &Council{Experts: []CouncilExpert{{Id: "ux"}}}); b.Len() != 0 {
		t.Errorf("a council with no stats and no steps drew run charts:\n%s", b.String())
	}
	b.Reset()
	writeRunCharts(&b, &Council{Experts: []CouncilExpert{{Id: "ux", Name: "UX"}}, Stats: map[string]CouncilExpertStat{"ux": {Tokens: 9}}})
	if !strings.Contains(b.String(), "Where the tokens went") || strings.Contains(b.String(), "looked things up") || strings.Contains(b.String(), "gantt") {
		t.Errorf("stats with no steps: want the token chart alone:\n%s", b.String())
	}
}
