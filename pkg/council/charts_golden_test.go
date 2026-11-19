// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"bytes"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"testing"
)

// The cockpit's Report draws the same at-a-glance quadrant and the same swimlane stretches as the .md charts, from its
// own TypeScript (frontend/app/view/agents/councilfiguresmodel.ts). This file holds the Go side of that pair to one
// fixture: it computes, from scripts/cdp/council/rail-apps-figures.json, what directionPoint, glancePlaced and workSpans
// give, and keeps it in testdata/glance-golden.json; councilfiguresmodel.test.ts reads the same two files and checks the
// TypeScript against them. A change to the formula fails here until the golden is rewritten (`go test ./pkg/council
// -run Golden -update`), and then fails there until the TypeScript follows.
var updateGolden = flag.Bool("update", false, "rewrite testdata/glance-golden.json from the figures fixture")

const (
	figuresFixture = "../../scripts/cdp/council/rail-apps-figures.json"
	glanceGoldenAt = "testdata/glance-golden.json"
)

type goldenDirection struct {
	Rank      int     `json:"rank"`
	Evidence  float64 `json:"evidence"`  // directionPoint's, before clamping
	Agreement float64 `json:"agreement"` // directionPoint's, before clamping
	X         float64 `json:"x"`         // glancePlaced's: clamped and nudged
	Y         float64 `json:"y"`
}

type goldenSpan struct {
	Start int64 `json:"start"`
	End   int64 `json:"end"`
	Steps int   `json:"steps"`
}

type glanceGolden struct {
	MaxTimelineSteps int                     `json:"maxTimelineSteps"`
	Directions       []goldenDirection       `json:"directions"`
	Spans            map[string][]goldenSpan `json:"spans"`
}

func loadFiguresFixture(t *testing.T) *Council {
	t.Helper()
	raw, err := os.ReadFile(filepath.FromSlash(figuresFixture))
	if err != nil {
		t.Fatalf("read the figures fixture: %v", err)
	}
	var c Council
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatalf("parse the figures fixture: %v", err)
	}
	return &c
}

func glanceGoldenOf(c *Council) glanceGolden {
	g := glanceGolden{MaxTimelineSteps: MaxTimelineSteps, Spans: map[string][]goldenSpan{}}
	placed := glancePlaced(c)
	for i, d := range c.Summary.Directions {
		evidence, agreement := directionPoint(c, d)
		g.Directions = append(g.Directions, goldenDirection{Rank: d.Rank, Evidence: evidence, Agreement: agreement, X: placed[i][0], Y: placed[i][1]})
	}
	for seat, steps := range c.Timeline {
		for _, sp := range workSpans(steps) {
			g.Spans[seat] = append(g.Spans[seat], goldenSpan{Start: sp.start, End: sp.end, Steps: sp.steps})
		}
	}
	return g
}

func TestGlanceGolden(t *testing.T) {
	c := loadFiguresFixture(t)
	if c.Summary == nil || len(c.Summary.Directions) == 0 || isBrainstorm(c) {
		t.Fatal("the figures fixture must be a Review with a summary that has directions")
	}
	got, err := json.MarshalIndent(glanceGoldenOf(c), "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	got = append(got, '\n')
	path := filepath.FromSlash(glanceGoldenAt)
	if *updateGolden {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, got, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read the golden (go test ./pkg/council -run Golden -update writes it): %v", err)
	}
	if !bytes.Equal(bytes.ReplaceAll(want, []byte("\r\n"), []byte("\n")), got) {
		t.Errorf("%s is out of date with the figures fixture and the chart formulas; rewrite it with `go test ./pkg/council -run Golden -update` and make councilfiguresmodel.ts agree\n got:\n%s", glanceGoldenAt, got)
	}
}

// The fixture is what the golden is meant to exercise: a pair of directions that sit on one another after ChartUnit (so
// the nudge runs), a direction that cites nothing, and a seat at the timeline cap.
func TestFiguresFixtureShape(t *testing.T) {
	c := loadFiguresFixture(t)
	placed := glancePlaced(c)
	if len(placed) != len(c.Summary.Directions) {
		t.Fatalf("glancePlaced gave %d points for %d directions", len(placed), len(c.Summary.Directions))
	}
	nudged, hollow := false, false
	for i, d := range c.Summary.Directions {
		x, y := directionPoint(c, d)
		if ChartUnit(x) != placed[i][0] || ChartUnit(y) != placed[i][1] {
			nudged = true
		}
		var all int
		for _, id := range d.From {
			if p := findProposal(c, id); p != nil {
				all += len(p.Evidence)
			}
		}
		hollow = hollow || all == 0
	}
	if !nudged {
		t.Error("no direction was nudged: the fixture needs a pair that coincide after ChartUnit")
	}
	if !hollow {
		t.Error("no direction cites nothing: the fixture needs one")
	}
	capped := false
	for _, steps := range c.Timeline {
		capped = capped || len(steps) >= MaxTimelineSteps
	}
	if !capped {
		t.Errorf("no seat holds %d steps", MaxTimelineSteps)
	}
}
