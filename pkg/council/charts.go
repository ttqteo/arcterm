// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"fmt"
	"math"
	"path/filepath"
	"slices"
	"strings"
)

// The charts a council's saved document draws, as Mermaid blocks (arcterm's markdown and most viewers render them): an
// at-a-glance quadrant of a Review's directions, how much each seat spent, how it looked things up, and when it worked.
// They are built from what the council recorded, never asked of a model, so a chart says only what the run facts hold.

// chartLabelMax caps a name in a chart.
const chartLabelMax = 32

// ChartLabel is s made safe for a Mermaid label: the characters Mermaid reads as syntax become spaces, runs of space fold
// to one, and it is cut to chartLabelMax runes.
func ChartLabel(s string) string {
	s = strings.Map(func(r rune) rune {
		switch r {
		case '"', ':', ';', '#', '[', ']', '{', '}', ',', '\n', '\r', '\t', '`', '<', '>':
			return ' '
		}
		return r
	}, s)
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > chartLabelMax {
		s = strings.TrimSpace(string(r[:chartLabelMax-1])) + "…"
	}
	return s
}

// directionPoint is where a direction sits in the at-a-glance quadrant, each from 0 to 1. Evidence is the share of its
// proposals' evidence the cite check found holding: a weak claim, a wrong cite and one not checked all count against
// it. Agreement is the share of the seats that took a side that back it: its proposals' authors and the seats whose
// stance is accept, over the authors and every seat with a stance. A direction with no evidence or no side taken has 0
// on that axis.
func directionPoint(c *Council, d CouncilDirection) (evidence, agreement float64) {
	authors := map[string]bool{}
	var held, all int
	for _, id := range d.From {
		p := findProposal(c, id)
		if p == nil {
			continue
		}
		authors[p.Author] = true
		for _, ev := range p.Evidence {
			all++
			if !ev.Weak && ev.Cite == CiteOK {
				held++
			}
		}
	}
	backers, sides := len(authors), len(authors)
	for seat, st := range d.Stances {
		if authors[seat] {
			continue
		}
		sides++
		if st == StanceAccept {
			backers++
		}
	}
	if all > 0 {
		evidence = float64(held) / float64(all)
	}
	if sides > 0 {
		agreement = float64(backers) / float64(sides)
	}
	return evidence, agreement
}

// writeGlanceChart draws a Review's directions on evidence × agreement, under "## At a glance", so the reader sees at
// once which directions stand on checked evidence and the panel's backing and which are a guess. Points that would sit
// on one another are nudged apart. A Brainstorm asks for no evidence and a report with no direction has nothing to
// place: neither gets the chart.
func writeGlanceChart(b *strings.Builder, c *Council) {
	if c.Summary == nil || len(c.Summary.Directions) == 0 || isBrainstorm(c) {
		return
	}
	b.WriteString("## At a glance\n\n")
	b.WriteString("Each direction (D1 is direction 1) by how much of its evidence the cite check found holding (across) and how much of the panel backs it (up).\n\n")
	b.WriteString("```mermaid\n" + QuadrantHead)
	b.WriteString("    x-axis Thin evidence --> Checked evidence\n")
	b.WriteString("    y-axis Contested --> Backed\n")
	b.WriteString("    quadrant-1 Stands\n    quadrant-2 Backed on thin evidence\n    quadrant-3 A guess\n    quadrant-4 Shown but contested\n")
	for i, p := range glancePlaced(c) {
		fmt.Fprintf(b, "    D%d: [%.2f, %.2f]\n", i+1, p[0], p[1])
	}
	b.WriteString("```\n\n")
}

// glancePlaced is where each direction of the summary is drawn in the at-a-glance quadrant, in the order the summary
// lists them (D1 is the first): its directionPoint kept off the chart's edges (ChartUnit) and, when it would sit on a
// point already placed, nudged inward. The cockpit's Report draws the same quadrant (frontend councilfiguresmodel.ts),
// held to these numbers by testdata/glance-golden.json. Nil with no summary.
func glancePlaced(c *Council) [][2]float64 {
	if c.Summary == nil {
		return nil
	}
	var placed [][2]float64
	for _, d := range c.Summary.Directions {
		x, y := directionPoint(c, d)
		x, y = ChartUnit(x), ChartUnit(y)
		// at most a few nudges: near the middle a nudge can swing a point back onto one already placed
		for n := 0; n < 4 && slices.ContainsFunc(placed, func(p [2]float64) bool { return math.Abs(p[0]-x) < 0.04 && math.Abs(p[1]-y) < 0.04 }); n++ {
			x, y = nudge(x), nudge(y)
		}
		placed = append(placed, [2]float64{x, y})
	}
	return placed
}

// QuadrantHead opens a Mermaid quadrant chart wider than Mermaid's 500 px default, so a point's label, centred under it,
// still fits near an edge.
const QuadrantHead = "---\nconfig:\n  quadrantChart:\n    chartWidth: 640\n    chartHeight: 480\n---\nquadrantChart\n"

// ChartUnit keeps a quadrant coordinate off the chart's edges: Mermaid refuses a point at 1.00, and a label centred under
// a point at an edge, or over a quadrant's title at the top, is cut.
func ChartUnit(v float64) float64 { return math.Min(math.Max(v, 0.08), 0.9) }

// nudge moves a coordinate 0.05 inward, so two points that coincide are both readable and neither leaves the chart.
func nudge(v float64) float64 {
	if v > 0.5 {
		return v - 0.05
	}
	return v + 0.05
}

// chartSeat is one seat's figures for the run charts.
type chartSeat struct {
	name                        string
	tokens                      int64
	lookups, reads, sharedReads int
	steps                       []CouncilStep
}

// chartSeats is the seats the run charts show, in panel order: every seat with a stat or a step. A read is shared when
// another seat read the same file (compared as a slash path, case folded).
func chartSeats(c *Council) []chartSeat {
	readers := map[string]map[string]bool{} // file -> the seats that read it
	for seat, steps := range c.Timeline {
		for _, s := range steps {
			if s.Kind == StepRead {
				f := readKey(s.Target)
				if readers[f] == nil {
					readers[f] = map[string]bool{}
				}
				readers[f][seat] = true
			}
		}
	}
	var seats []chartSeat
	for _, e := range c.Experts {
		st, hasStat := c.Stats[e.Id]
		steps := c.Timeline[e.Id]
		if !hasStat && len(steps) == 0 {
			continue
		}
		cs := chartSeat{name: ChartLabel(docName(c, e.Id)), tokens: st.Tokens, steps: steps}
		for _, s := range steps {
			switch s.Kind {
			case StepRead:
				cs.lookups++
				cs.reads++
				if len(readers[readKey(s.Target)]) > 1 {
					cs.sharedReads++
				}
			case StepSearch, StepRun:
				cs.lookups++
			}
		}
		seats = append(seats, cs)
	}
	return seats
}

// readKey is a read's file as reads are compared: a slash path, lower case.
func readKey(target string) string {
	return strings.ToLower(filepath.ToSlash(strings.TrimSpace(target)))
}

// chartNames is the seats' names as an xychart x-axis.
func chartNames(seats []chartSeat) string {
	names := make([]string, len(seats))
	for i, s := range seats {
		names[i] = `"` + s.name + `"`
	}
	return "[" + strings.Join(names, ", ") + "]"
}

// writeRunCharts draws, under the run facts, what each seat spent and how: its tokens; its look-ups with its reads and
// its reads of a file another seat also read drawn over them (each bar inside the one before, so the three read as one
// stacked bar); and a swimlane of when it worked, one bar per stretch of steps with no gap over chartGap. A council with
// no stats and no steps (one saved before they were kept) draws none of them.
func writeRunCharts(b *strings.Builder, c *Council) {
	seats := chartSeats(c)
	if len(seats) == 0 {
		return
	}
	b.WriteString("\n### Where the tokens went\n\n")
	b.WriteString("```mermaid\nxychart-beta\n")
	fmt.Fprintf(b, "    x-axis %s\n", chartNames(seats))
	b.WriteString("    y-axis \"tokens (M)\"\n")
	vals := make([]string, len(seats))
	for i, s := range seats {
		vals[i] = fmt.Sprintf("%.2f", float64(s.tokens)/1e6)
	}
	fmt.Fprintf(b, "    bar [%s]\n```\n", strings.Join(vals, ", "))

	// a seat that looked nothing up (the coordinator writes from what it is handed) has no bar there
	lookers := slices.DeleteFunc(slices.Clone(seats), func(s chartSeat) bool { return s.lookups == 0 })
	if len(lookers) == 0 {
		return
	}
	b.WriteString("\n### How each seat looked things up\n\n")
	b.WriteString("Each bar holds the next: every search, read and command; the reads among them; and the reads of a file another seat also read.\n\n")
	b.WriteString("```mermaid\nxychart-beta\n")
	fmt.Fprintf(b, "    x-axis %s\n", chartNames(lookers))
	b.WriteString("    y-axis \"steps\"\n")
	for _, pick := range []func(chartSeat) int{
		func(s chartSeat) int { return s.lookups },
		func(s chartSeat) int { return s.reads },
		func(s chartSeat) int { return s.sharedReads },
	} {
		vals := make([]string, len(lookers))
		for i, s := range lookers {
			vals[i] = fmt.Sprint(pick(s))
		}
		fmt.Fprintf(b, "    bar [%s]\n", strings.Join(vals, ", "))
	}
	b.WriteString("```\n")

	b.WriteString("\n### When each seat worked\n\n")
	b.WriteString("```mermaid\ngantt\n    dateFormat x\n    axisFormat %H:%M\n")
	for _, s := range seats {
		spans := workSpans(s.steps)
		if len(spans) == 0 {
			continue
		}
		fmt.Fprintf(b, "    section %s\n", s.name)
		for _, sp := range spans {
			fmt.Fprintf(b, "    %d steps : %d, %d\n", sp.steps, sp.start, sp.end)
		}
	}
	b.WriteString("```\n")
}

// chartGap is the pause that ends one stretch of a seat's work in the swimlane: rounds are minutes apart, a seat's steps
// within one are seconds apart. chartMinSpan keeps a stretch of one step visible.
const (
	chartGap     = 60_000
	chartMinSpan = 5_000
)

type workSpan struct {
	start, end int64
	steps      int
}

// workSpans cuts a seat's steps, oldest first, into stretches with no pause over chartGap.
func workSpans(steps []CouncilStep) []workSpan {
	var spans []workSpan
	for _, s := range steps {
		if s.Ts <= 0 {
			continue
		}
		if n := len(spans); n > 0 && s.Ts-spans[n-1].end <= chartGap {
			spans[n-1].end = max(spans[n-1].end, s.Ts)
			spans[n-1].steps++
			continue
		}
		spans = append(spans, workSpan{start: s.Ts, end: s.Ts, steps: 1})
	}
	for i := range spans {
		spans[i].end = max(spans[i].end, spans[i].start+chartMinSpan)
	}
	return spans
}
