// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/council"
)

// scoredRun is a done row of the current harness; date is what orders a cell's runs.
func scoredRun(caseId, variant string, recall, keys int, tokens int64, date string) CouncilBenchResult {
	return CouncilBenchResult{
		Date: date, Harness: council.HarnessVersion, Case: caseId, Variant: variant, State: string(council.StateDone),
		Recall: recall, Keys: keys, Tokens: tokens,
	}
}

// cellRuns is one cell's two done runs, with the recalls given and the same tokens each.
func cellRuns(caseId, variant string, recalls [2]int, keys int, tokens int64) []CouncilBenchResult {
	return []CouncilBenchResult{
		scoredRun(caseId, variant, recalls[0], keys, tokens, "2026-11-04T10:00:00Z"),
		scoredRun(caseId, variant, recalls[1], keys, tokens, "2026-11-04T11:00:00Z"),
	}
}

func TestDecideThresholds(t *testing.T) {
	// one case of 5 keys; the council holds 5 key lines and 5M tokens a run
	tests := []struct {
		name         string
		teamRecall   [2]int
		teamTokens   int64
		wantOutcome  string
		wantTeamMean float64
	}{
		{"go just inside both: recall -1, tokens 0.79x", [2]int{4, 4}, 3_950_000, DecisionGo, 4},
		{"go when the team is above the council", [2]int{6, 6}, 2_500_000, DecisionGo, 6},
		{"go on a recall of -1 made from a 5 and a 3", [2]int{5, 3}, 2_500_000, DecisionGo, 4},
		{"not decided at tokens exactly 0.8x", [2]int{5, 5}, 4_000_000, DecisionNotDecided, 5},
		{"not decided when the team is above the council but dear", [2]int{6, 6}, 5_000_000, DecisionNotDecided, 6},
		{"not decided at recall -1 and tokens just over 0.8x", [2]int{4, 4}, 4_000_001, DecisionNotDecided, 4},
		{"not decided at recall -1.5", [2]int{3, 4}, 2_500_000, DecisionNotDecided, 3.5},
		{"no-go at recall -2", [2]int{3, 3}, 2_500_000, DecisionNoGo, 3},
		{"no-go below -2 even when the team costs more", [2]int{1, 2}, 9_000_000, DecisionNoGo, 1.5},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			results := append(cellRuns("a", VariantCouncil, [2]int{5, 5}, 5, 5_000_000), cellRuns("a", VariantTeam, tt.teamRecall, 5, tt.teamTokens)...)
			d := Decide(results, []string{"a"})
			if d.Outcome != tt.wantOutcome {
				t.Errorf("outcome = %q (%s), want %q", d.Outcome, d.Reason, tt.wantOutcome)
			}
			if d.CouncilRecall != 5 || d.TeamRecall != tt.wantTeamMean || d.Keys != 5 {
				t.Errorf("recall = team %v, council %v of %d keys, want team %v, council 5 of 5", d.TeamRecall, d.CouncilRecall, d.Keys, tt.wantTeamMean)
			}
			if d.CouncilTokens != 5_000_000 || d.TeamTokens != float64(tt.teamTokens) {
				t.Errorf("tokens = team %v, council %v, want %d and 5,000,000", d.TeamTokens, d.CouncilTokens, tt.teamTokens)
			}
			if d.Reason == "" {
				t.Error("reason is empty")
			}
		})
	}
}

func TestDecideSumsTheMeansOverTheCases(t *testing.T) {
	var results []CouncilBenchResult
	// case a: council 4 and 2 (mean 3) on 6M and 2M tokens (mean 4M); team 3 and 3 on 1M and 3M (mean 2M)
	results = append(results,
		scoredRun("a", VariantCouncil, 4, 6, 6_000_000, "2026-11-04T10:00:00Z"), scoredRun("a", VariantCouncil, 2, 6, 2_000_000, "2026-11-04T11:00:00Z"),
		scoredRun("a", VariantTeam, 3, 6, 1_000_000, "2026-11-04T10:30:00Z"), scoredRun("a", VariantTeam, 3, 6, 3_000_000, "2026-11-04T11:30:00Z"))
	// case b: council 2 and 3 (mean 2.5) on 3M a run; team 3 and 2 (mean 2.5) on 1M a run
	results = append(results,
		scoredRun("b", VariantCouncil, 2, 4, 3_000_000, "2026-11-04T12:00:00Z"), scoredRun("b", VariantCouncil, 3, 4, 3_000_000, "2026-11-04T13:00:00Z"),
		scoredRun("b", VariantTeam, 3, 4, 1_000_000, "2026-11-04T12:30:00Z"), scoredRun("b", VariantTeam, 2, 4, 1_000_000, "2026-11-04T13:30:00Z"))

	d := Decide(results, []string{"a", "b"})
	want := CouncilBenchDecision{
		Outcome: DecisionGo, CouncilRecall: 5.5, TeamRecall: 5.5, Keys: 10, CouncilTokens: 7_000_000, TeamTokens: 3_000_000,
	}
	want.Reason = d.Reason // the wording has its own test
	if d != want {
		t.Errorf("decision = %+v, want %+v", d, want)
	}
}

func TestDecideReasonStatesRecallAndTokenRatio(t *testing.T) {
	results := append(cellRuns("a", VariantCouncil, [2]int{4, 5}, 6, 10_000_000), cellRuns("a", VariantTeam, [2]int{3, 4}, 6, 4_000_000)...)
	d := Decide(results, []string{"a"})
	for _, want := range []string{"team 3.5 of 6 keys", "council 4.5 of 6", "0.40×"} {
		if !strings.Contains(d.Reason, want) {
			t.Errorf("reason = %q, want it to hold %q", d.Reason, want)
		}
	}
}

func TestDecideIncompleteCellsAreNamed(t *testing.T) {
	results := []CouncilBenchResult{
		// case a: the council is whole; the team has one done run and one failed one
		scoredRun("a", VariantCouncil, 4, 5, 5_000_000, "2026-11-04T10:00:00Z"),
		scoredRun("a", VariantCouncil, 4, 5, 5_000_000, "2026-11-04T11:00:00Z"),
		scoredRun("a", VariantTeam, 4, 5, 1_000_000, "2026-11-04T10:30:00Z"),
		{Date: "2026-11-04T11:30:00Z", Harness: council.HarnessVersion, Case: "a", Variant: VariantTeam, State: "failed", Tokens: 1_000_000},
		// case b: the council has one run, the team none
		scoredRun("b", VariantCouncil, 4, 5, 5_000_000, "2026-11-04T12:00:00Z"),
	}
	d := Decide(results, []string{"a", "b"})
	if d.Outcome != DecisionNotDecided {
		t.Errorf("outcome = %q, want %q", d.Outcome, DecisionNotDecided)
	}
	want := "incomplete: a team has 1 of 2 scored runs; b council has 1 of 2 scored runs; b team has 0 of 2 scored runs"
	if d.Reason != want {
		t.Errorf("reason = %q, want %q", d.Reason, want)
	}
}

func TestDecideNoRows(t *testing.T) {
	if d := Decide(nil, []string{"a"}); d.Outcome != DecisionNotDecided || !strings.Contains(d.Reason, "a council has 0 of 2") {
		t.Errorf("no rows: %+v, want not decided naming the empty cell", d)
	}
	if d := Decide(nil, nil); d.Outcome != DecisionNotDecided || d.Reason == "" {
		t.Errorf("no cases: %+v, want not decided with a reason", d)
	}
}

func TestDecideIgnoresOtherHarnessCaseAndVariant(t *testing.T) {
	base := append(cellRuns("a", VariantCouncil, [2]int{5, 5}, 5, 5_000_000), cellRuns("a", VariantTeam, [2]int{5, 5}, 5, 2_000_000)...)
	want := Decide(base, []string{"a"})
	if want.Outcome != DecisionGo {
		t.Fatalf("base = %+v, want go", want)
	}

	// each of these rows would flip the outcome if it were counted
	other := scoredRun("a", VariantTeam, 0, 5, 90_000_000, "2026-11-05T10:00:00Z")
	otherHarness := other
	otherHarness.Harness = "2026-01-01.1"
	otherCase := other
	otherCase.Case = "z"
	solo := other
	solo.Variant = VariantSolo
	noise := slices.Concat(base, []CouncilBenchResult{otherHarness, otherCase, solo})

	if got := Decide(noise, []string{"a"}); got != want {
		t.Errorf("with rows of another harness, case and variant: %+v, want %+v", got, want)
	}

	// a cell the noise would have filled is still incomplete
	onlyNoise := []CouncilBenchResult{otherHarness, otherCase, solo}
	if d := Decide(onlyNoise, []string{"a"}); d.Outcome != DecisionNotDecided || !strings.HasPrefix(d.Reason, "incomplete:") {
		t.Errorf("only rows of another harness, case and variant: %+v, want incomplete", d)
	}
}

func TestDecideCountsOnlyTheLatestTwoScoredRuns(t *testing.T) {
	// listed out of date order on purpose: the date picks the runs, not the file
	results := []CouncilBenchResult{
		scoredRun("a", VariantCouncil, 4, 5, 5_000_000, "2026-11-04T12:00:00Z"),
		scoredRun("a", VariantCouncil, 0, 5, 50_000_000, "2026-11-04T08:00:00Z"), // the oldest: left out
		scoredRun("a", VariantCouncil, 4, 5, 5_000_000, "2026-11-04T10:00:00Z"),
		// newer than all of them, but it failed: not a scored run
		{Date: "2026-11-04T14:00:00Z", Harness: council.HarnessVersion, Case: "a", Variant: VariantCouncil, State: "failed", Tokens: 9_000_000},

		scoredRun("a", VariantTeam, 4, 5, 2_000_000, "2026-11-04T09:00:00Z"),
		scoredRun("a", VariantTeam, 0, 5, 40_000_000, "2026-11-03T09:00:00Z"), // the oldest: left out
		scoredRun("a", VariantTeam, 4, 5, 2_000_000, "2026-11-04T13:00:00Z"),
	}
	d := Decide(results, []string{"a"})
	if d.CouncilRecall != 4 || d.TeamRecall != 4 || d.CouncilTokens != 5_000_000 || d.TeamTokens != 2_000_000 {
		t.Errorf("decision = %+v, want recall 4 and 4 on 5,000,000 and 2,000,000 tokens (the latest two scored runs)", d)
	}
	if d.Outcome != DecisionGo {
		t.Errorf("outcome = %q (%s), want go", d.Outcome, d.Reason)
	}
}

func TestDecideTokensLeaveOutTheJudgesCall(t *testing.T) {
	// the team spends 3M against the council's 5M (0.6x): go. The judge's calls would put the team at 13M, over the
	// council, if they counted; they are the bench's cost, not the variant's, so the outcome and the sums stay put.
	base := append(cellRuns("a", VariantCouncil, [2]int{5, 5}, 5, 5_000_000), cellRuns("a", VariantTeam, [2]int{5, 5}, 5, 3_000_000)...)
	want := Decide(base, []string{"a"})
	if want.Outcome != DecisionGo || want.TeamTokens != 3_000_000 {
		t.Fatalf("base = %+v, want go on 3,000,000 team tokens", want)
	}
	judged := slices.Clone(base)
	for i := range judged {
		judged[i].JudgeTokens = 10_000_000
	}
	judged[0].JudgeTokens = 123 // and not the same on every row
	if got := Decide(judged, []string{"a"}); got != want {
		t.Errorf("with judge tokens on the rows: %+v, want %+v", got, want)
	}
}

func TestDecideCountsACaseGivenTwiceOnce(t *testing.T) {
	results := append(cellRuns("a", VariantCouncil, [2]int{4, 4}, 5, 5_000_000), cellRuns("a", VariantTeam, [2]int{4, 4}, 5, 2_000_000)...)
	if d := Decide(results, []string{"a", "a"}); d.Keys != 5 || d.CouncilRecall != 4 {
		t.Errorf("decision = %+v, want the case counted once (5 keys, recall 4)", d)
	}
}

func TestDecisionWireNames(t *testing.T) {
	raw, err := json.Marshal(CouncilBenchDecision{Outcome: DecisionGo, Reason: "r", CouncilRecall: 1.5, TeamRecall: 2, Keys: 3, CouncilTokens: 4, TeamTokens: 5})
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	var got []string
	for k := range fields {
		got = append(got, k)
	}
	slices.Sort(got)
	want := []string{"counciltokens", "councilrecall", "keys", "outcome", "reason", "teamrecall", "teamtokens"}
	slices.Sort(want)
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("json fields = %v, want %v", got, want)
	}
	if fields["outcome"] != "go" {
		t.Errorf("outcome = %v, want the words go, no-go or not decided", fields["outcome"])
	}
}
