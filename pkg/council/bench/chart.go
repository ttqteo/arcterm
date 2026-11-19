// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"fmt"
	"math"
	"slices"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/council"
)

// ChartMarkdown is the bench's results as Mermaid charts, one per mode of cases: each variant a point, from the newest
// harness it was scored on (older harnesses would crowd the chart with figures the prompts no longer give), placed by its
// tokens per run (across, fewer to the right) and the share of key lines it found (up), so the variant that finds the
// most for the least sits top right. A Review row's share is its head recall (recall@5), the one figure every run of it
// has whether it was judged whole or cut at 5; a Brainstorm row's is its recall over its whole list. Tokens are read
// against the most a point of that mode spent per run. A row with no scored run or no key lines is left out, and a mode
// with no row left draws no chart; with none at all the text says so.
func ChartMarkdown(rows []CouncilBenchRow) string {
	var b strings.Builder
	for _, mode := range []string{council.ModeReview, council.ModeBrainstorm} {
		var shown []CouncilBenchRow
		for _, r := range rows {
			if r.Mode != mode || r.Scored == 0 || r.Keys == 0 || r.Runs == 0 {
				continue
			}
			i := slices.IndexFunc(shown, func(s CouncilBenchRow) bool { return s.Variant == r.Variant })
			switch {
			case i < 0:
				shown = append(shown, r)
			case compareHarness(r.Harness, shown[i].Harness) > 0:
				shown[i] = r
			}
		}
		var most float64
		for _, r := range shown {
			most = math.Max(most, perRun(r))
		}
		if len(shown) == 0 || most == 0 {
			continue
		}
		title, found := "Review", "recall@5"
		if mode == council.ModeBrainstorm {
			title, found = "Brainstorm", "recall@all"
		}
		fmt.Fprintf(&b, "### %s: key lines found against tokens per run\n\n", title)
		fmt.Fprintf(&b, "Across: tokens per run, fewer to the right (the left edge is %s). Up: %s over the key lines.\n\n",
			council.FormatTokens(int64(most)), found)
		b.WriteString("```mermaid\n" + council.QuadrantHead)
		b.WriteString("    x-axis More tokens --> Fewer tokens\n")
		b.WriteString("    y-axis Found little --> Found much\n")
		b.WriteString("    quadrant-1 Finds much for little\n    quadrant-2 Finds much at a cost\n    quadrant-3 Costly and finds little\n    quadrant-4 Cheap and finds little\n")
		for _, r := range shown {
			recall := r.Recall
			if mode == council.ModeReview {
				recall = r.Recall5
			}
			x := council.ChartUnit(1 - perRun(r)/most)
			y := council.ChartUnit(float64(recall) / float64(r.Keys))
			label := council.ChartLabel(r.Variant + " " + benchHarnessLabel(r.Harness))
			fmt.Fprintf(&b, "    %s: [%.2f, %.2f]\n", label, x, y)
		}
		b.WriteString("```\n\n")
	}
	if b.Len() == 0 {
		return "No scored bench runs to chart yet.\n"
	}
	return b.String()
}

// perRun is a row's tokens per run.
func perRun(r CouncilBenchRow) float64 { return float64(r.Tokens) / float64(r.Runs) }

// benchHarnessLabel is a harness version as a point's label shows it: the month, day and run ("11-12.1"), or "unknown"
// for a row from before versions were recorded.
func benchHarnessLabel(h string) string {
	if h == "" {
		return "unknown"
	}
	if len(h) > 5 && h[4] == '-' {
		return h[5:]
	}
	return h
}
