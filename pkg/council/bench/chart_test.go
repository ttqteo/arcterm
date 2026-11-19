// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/council"
)

func TestChartMarkdown(t *testing.T) {
	row := func(harness, mode, variant string, runs, scored, recall, recall5, keys int, tokens int64) CouncilBenchRow {
		return CouncilBenchRow{Harness: harness, Mode: mode, Variant: variant, Runs: runs, Scored: scored, Recall: recall, Recall5: recall5, Keys: keys, Tokens: tokens}
	}
	rows := []CouncilBenchRow{
		// Review: the newest harness of each variant, placed by recall@5; the older council row is left out
		row("2026-11-12.1", council.ModeReview, VariantCouncil, 2, 2, 5, 2, 8, 20_000_000),
		row("2026-11-06.1", council.ModeReview, VariantCouncil, 2, 2, 1, 1, 8, 30_000_000),
		row("2026-11-12.1", council.ModeReview, VariantSolo, 2, 2, 4, 4, 8, 4_000_000),
		row("2026-11-12.1", council.ModeReview, VariantTeam, 2, 0, 0, 0, 0, 9_000_000), // never scored: left out
		// Brainstorm: recall over the whole list
		row("2026-11-05.5", council.ModeBrainstorm, VariantSolo, 1, 1, 2, 0, 5, 300_000),
	}
	got := ChartMarkdown(rows)
	for _, want := range []string{
		"### Review: key lines found against tokens per run\n", "the left edge is 10M", "Up: recall@5",
		"```mermaid\n" + council.QuadrantHead,
		"    council 11-12.1: [0.08, 0.25]\n", // the most tokens per run (10M) at the left edge; 2 of 8
		"    solo 11-12.1: [0.80, 0.50]\n",    // 2M of 10M per run; 4 of 8
		"### Brainstorm: key lines found against tokens per run\n", "Up: recall@all", "    solo 11-05.5: [0.08, 0.40]\n",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("charts lack %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "11-06.1") || strings.Contains(got, "team") {
		t.Errorf("charts hold an older harness's council or an unscored team:\n%s", got)
	}
	if got := ChartMarkdown(nil); got != "No scored bench runs to chart yet.\n" {
		t.Errorf("no rows = %q", got)
	}
}
