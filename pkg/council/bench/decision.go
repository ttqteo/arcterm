// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/council"
)

// The outcomes of the go / no-go rule.
const (
	DecisionGo         = "go"
	DecisionNoGo       = "no-go"
	DecisionNotDecided = "not decided"
)

// decisionRuns is how many scored runs a cell needs, and how many of its latest the verdict reads.
const decisionRuns = 2

// CouncilBenchDecision is the verdict of the council-against-team bench. The recall and token figures are each side's
// cells summed over the cases, a cell being the mean of its two runs; Keys is the key lines of those cases. They are zero
// when the outcome is "not decided" for want of runs, since there is nothing to sum yet.
type CouncilBenchDecision struct {
	Outcome       string  `json:"outcome"` // DecisionGo, DecisionNoGo or DecisionNotDecided
	Reason        string  `json:"reason"`
	CouncilRecall float64 `json:"councilrecall"`
	TeamRecall    float64 `json:"teamrecall"`
	Keys          int     `json:"keys"`
	CouncilTokens float64 `json:"counciltokens"`
	TeamTokens    float64 `json:"teamtokens"`
}

// decisionCell is one case and variant: the runs the verdict reads, the latest scored ones.
type decisionCell struct {
	caseId  string
	variant string
	runs    []CouncilBenchResult
}

// Decide applies the rule to the council and team rows of the given cases:
//
//   - go: the team's recall is within one key line of the council's, or above it, at under 0.8× the council's tokens;
//   - no-go: the team's recall is two or more key lines below the council's;
//   - not decided: anything else, and a cell with fewer than two scored runs.
//
// Only rows of the current council.HarnessVersion count, and per cell the latest two runs that ended done. Tokens are a
// row's Tokens, the council's or team's own spend: the judge's call (JudgeTokens) is the bench's cost, not the variant's.
func Decide(results []CouncilBenchResult, caseIds []string) CouncilBenchDecision {
	caseIds = dedupe(caseIds)
	if len(caseIds) == 0 {
		return CouncilBenchDecision{Outcome: DecisionNotDecided, Reason: "no cases to decide on"}
	}

	var cells []decisionCell
	var short []string
	for _, id := range caseIds {
		for _, variant := range []string{VariantCouncil, VariantTeam} {
			cell := decisionCell{id, variant, latestScored(results, id, variant)}
			cells = append(cells, cell)
			if len(cell.runs) < decisionRuns {
				short = append(short, fmt.Sprintf("%s %s has %d of %d scored runs", id, variant, len(cell.runs), decisionRuns))
			}
		}
	}
	if len(short) > 0 {
		return CouncilBenchDecision{Outcome: DecisionNotDecided, Reason: "incomplete: " + strings.Join(short, "; ")}
	}

	d := CouncilBenchDecision{}
	for _, cell := range cells {
		var recall, tokens float64
		for _, r := range cell.runs {
			recall += float64(r.Recall)
			tokens += float64(r.Tokens)
		}
		recall /= decisionRuns
		tokens /= decisionRuns
		if cell.variant == VariantTeam {
			d.TeamRecall += recall
			d.TeamTokens += tokens
		} else {
			d.CouncilRecall += recall
			d.CouncilTokens += tokens
			d.Keys += cell.runs[len(cell.runs)-1].Keys
		}
	}

	// A cell's recall and tokens are multiples of 0.5, so these comparisons are exact; "under 0.8×" is written as
	// team×5 < council×4 for the same reason.
	var why string
	switch {
	case d.TeamRecall >= d.CouncilRecall-1 && d.TeamTokens*5 < d.CouncilTokens*4:
		d.Outcome = DecisionGo
		why = "the team is within one key line of the council's recall, or above it, at under 0.8× its tokens"
	case d.TeamRecall <= d.CouncilRecall-2:
		d.Outcome = DecisionNoGo
		why = "the team's recall is two or more key lines below the council's"
	default:
		d.Outcome = DecisionNotDecided
		why = "neither rule is met (go needs recall within one key line and tokens under 0.8×; no-go needs recall two or more key lines behind)"
	}
	ratio := "no council tokens to compare"
	if d.CouncilTokens > 0 {
		ratio = fmt.Sprintf("team tokens %.2f× the council's", d.TeamTokens/d.CouncilTokens)
	}
	d.Reason = fmt.Sprintf("%s (team %g of %d keys, council %g of %d; %s)", why, d.TeamRecall, d.Keys, d.CouncilRecall, d.Keys, ratio)
	return d
}

// latestScored is the latest two runs of one cell that ended done, of the current harness version, oldest first. A date
// that does not parse reads as the oldest, and two runs of one time keep their order in the file.
func latestScored(results []CouncilBenchResult, caseId, variant string) []CouncilBenchResult {
	var runs []CouncilBenchResult
	for _, r := range results {
		if r.Harness == council.HarnessVersion && r.Case == caseId && r.Variant == variant && r.State == string(council.StateDone) {
			runs = append(runs, r)
		}
	}
	slices.SortStableFunc(runs, func(a, b CouncilBenchResult) int { return runTime(a).Compare(runTime(b)) })
	return runs[max(len(runs)-decisionRuns, 0):]
}

func runTime(r CouncilBenchResult) time.Time {
	at, _ := time.Parse(time.RFC3339, r.Date) // a bad date is the zero time: oldest
	return at
}
