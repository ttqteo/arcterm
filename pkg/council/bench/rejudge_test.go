// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/council"
)

func TestNeedsRejudge(t *testing.T) {
	old := CouncilBenchResult{Case: "a", Variant: VariantCouncil, Council: "c1", State: "done", Recall: 0, Keys: 4}
	cases := []struct {
		name string
		r    CouncilBenchResult
		mode string
		want bool
	}{
		{"a council's Review report cut at 5", old, council.ModeReview, true},
		{"a solo one", func() CouncilBenchResult { r := old; r.Variant = VariantSolo; return r }(), council.ModeReview, true},
		{"already judged whole", func() CouncilBenchResult { r := old; r.Judged = 8; return r }(), council.ModeReview, false},
		{"a team: no saved report, and no more than 5 items", func() CouncilBenchResult { r := old; r.Variant = VariantTeam; return r }(), council.ModeReview, false},
		{"a Brainstorm row", old, council.ModeBrainstorm, false},
		{"a failed run", func() CouncilBenchResult { r := old; r.State = "failed"; return r }(), council.ModeReview, false},
		{"no council id", func() CouncilBenchResult { r := old; r.Council = ""; return r }(), council.ModeReview, false},
	}
	for _, tc := range cases {
		if got := NeedsRejudge(tc.r, tc.mode); got != tc.want {
			t.Errorf("%s: NeedsRejudge = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestHeadRecall(t *testing.T) {
	cases := []struct {
		name      string
		r         CouncilBenchResult
		head      int
		wholeList bool
	}{
		{"a Review line cut at 5: its Recall is the head", CouncilBenchResult{Variant: VariantCouncil, Recall: 2}, 2, false},
		{"a Review line judged whole", CouncilBenchResult{Variant: VariantCouncil, Recall: 3, Recall5: 1, Judged: 9}, 1, true},
		{"a team line, old or new", CouncilBenchResult{Variant: VariantTeam, Recall: 2}, 2, true},
		{"a Brainstorm line has no Recall5", CouncilBenchResult{Variant: VariantCouncil, Mode: council.ModeBrainstorm, Recall: 3, Recall3: 1, Judged: 9}, 3, true},
	}
	for _, tc := range cases {
		if got := HeadRecall(tc.r); got != tc.head {
			t.Errorf("%s: HeadRecall = %d, want %d", tc.name, got, tc.head)
		}
		if got := JudgedWhole(tc.r); got != tc.wholeList {
			t.Errorf("%s: JudgedWhole = %v, want %v", tc.name, got, tc.wholeList)
		}
	}
}

func TestRejudge(t *testing.T) {
	c := Case{Id: "a", Mode: council.ModeReview, KeyLines: []KeyLine{{Id: "K1"}, {Id: "K2"}, {Id: "K3"}, {Id: "K4"}}}
	r := CouncilBenchResult{Case: "a", Variant: VariantCouncil, Run: 2, Council: "c1", State: "done", Recall: 0, Keys: 4}
	report := &council.Council{Id: "c1", Summary: &council.CouncilSummary{}}
	judge := func(ctx context.Context, c Case, report *council.Council) (Verdict, error) {
		return Verdict{Matches: map[string]int{"K4": 8, "K1": 3}, Judged: 12, Items: []ItemVerdict{{Rank: 2, Verdict: "wrong"}}, Tokens: 40_000}, nil
	}

	got, err := Rejudge(context.Background(), judge, c, r, report)
	if err != nil {
		t.Fatal(err)
	}
	want := CouncilBenchRejudge{Council: "c1", Case: "a", Variant: VariantCouncil, Run: 2, Recall: 2, Recall5: 1, Keys: 4, Judged: 12, Wrong: 1,
		Matches: map[string]int{"K4": 8, "K1": 3}, JudgeTokens: 40_000}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Rejudge\n got %+v\nwant %+v", got, want)
	}

	if _, err := Rejudge(context.Background(), judge, c, r, &council.Council{Id: "other", Summary: &council.CouncilSummary{}}); err == nil {
		t.Error("Rejudge took another council's report")
	}
	if _, err := Rejudge(context.Background(), judge, c, r, &council.Council{Id: "c1"}); err == nil {
		t.Error("Rejudge took a report with no summary")
	}
	failing := func(ctx context.Context, c Case, report *council.Council) (Verdict, error) {
		return Verdict{Tokens: 9_000}, errors.New("unreadable reply")
	}
	if line, err := Rejudge(context.Background(), failing, c, r, report); err == nil || line.JudgeTokens != 9_000 {
		t.Errorf("a failed judging = %+v, %v, want an error that still carries the 9000 tokens spent", line, err)
	}
}

func TestLoadResultsAppliesTheLastRejudge(t *testing.T) {
	dir := t.TempDir()
	run := func(id string, variant string, recall int) CouncilBenchResult {
		return CouncilBenchResult{Harness: "h", Case: "a", Variant: variant, Run: 1, Council: id, State: "done", Mode: council.ModeReview,
			Recall: recall, Keys: 4, Wrong: 0, JudgeTokens: 30_000}
	}
	for _, r := range []CouncilBenchResult{run("c1", VariantCouncil, 0), run("c2", VariantCouncil, 1)} {
		if err := AppendResult(dir, r); err != nil {
			t.Fatal(err)
		}
	}
	for _, rj := range []CouncilBenchRejudge{
		{Council: "c1", Case: "a", Variant: VariantCouncil, Run: 1, Recall: 1, Recall5: 0, Keys: 4, Judged: 9, Wrong: 3, JudgeTokens: 20_000},
		{Council: "c1", Case: "a", Variant: VariantCouncil, Run: 1, Recall: 2, Recall5: 1, Keys: 4, Judged: 9, Wrong: 2, JudgeTokens: 25_000,
			Matches: map[string]int{"K1": 3, "K4": 8}},
		{Council: "c9", Case: "a", Variant: VariantCouncil, Run: 1, Recall: 4, Keys: 4, Judged: 4}, // names no run line
	} {
		if err := AppendRejudge(dir, rj); err != nil {
			t.Fatal(err)
		}
	}
	if err := AppendRejudge(dir, CouncilBenchRejudge{Case: "a"}); err == nil {
		t.Error("AppendRejudge wrote a line with no council")
	}

	runs, _, err := LoadResults(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 2 {
		t.Fatalf("got %d run lines, want 2: a rejudge line is not a run", len(runs))
	}
	c1, c2 := runs[0], runs[1]
	if c1.Recall != 2 || c1.Recall5 != 1 || c1.Judged != 9 || c1.Wrong != 2 || !reflect.DeepEqual(c1.Matches, map[string]int{"K1": 3, "K4": 8}) {
		t.Errorf("c1 = %+v, want the last rejudge's scores", c1)
	}
	if c1.JudgeTokens != 75_000 {
		t.Errorf("c1 judge tokens = %d, want 75000: the run's own judging and both rejudges were spent", c1.JudgeTokens)
	}
	if c2.Recall != 1 || c2.Judged != 0 || c2.JudgeTokens != 30_000 {
		t.Errorf("c2 = %+v, want it as written: no rejudge names it", c2)
	}
}

func TestSummarizeReviewHeadRecall(t *testing.T) {
	line := func(variant string, recall, recall5, judged int) CouncilBenchResult {
		return CouncilBenchResult{Harness: "h", Case: "a", Variant: variant, State: "done", Mode: council.ModeReview,
			Recall: recall, Recall5: recall5, Judged: judged, Keys: 4, Tokens: 2_000_000}
	}
	t.Run("every run judged whole", func(t *testing.T) {
		rows := Summarize([]CouncilBenchResult{line(VariantCouncil, 2, 1, 9), line(VariantCouncil, 3, 2, 11)}, nil)
		r := rows[0]
		if r.Recall5 != 3 || r.Recall != 5 || r.AllScored != 2 || r.Judged != 20 {
			t.Errorf("row = %+v, want recall@5 3, recall@all 5, both runs judged whole over 20 items", r)
		}
		if r.RecallPerM != 0.75 {
			t.Errorf("recall per M = %v, want 0.75: a Review row's is its head recall's (3 over 4M)", r.RecallPerM)
		}
	})
	t.Run("one run still cut at 5", func(t *testing.T) {
		rows := Summarize([]CouncilBenchResult{line(VariantCouncil, 2, 1, 9), line(VariantCouncil, 1, 0, 0)}, nil)
		if r := rows[0]; r.Recall5 != 2 || r.AllScored != 1 {
			t.Errorf("row = %+v, want recall@5 2 (1 judged whole, 1 cut) and 1 of 2 runs judged whole", r)
		}
	})
	t.Run("an old team row counts as judged whole", func(t *testing.T) {
		rows := Summarize([]CouncilBenchResult{line(VariantTeam, 2, 0, 0)}, nil)
		if r := rows[0]; r.Recall5 != 2 || r.AllScored != 1 {
			t.Errorf("row = %+v, want recall@5 2 and the run judged whole", r)
		}
	})
}

func TestDecideReadsTheHeadRecall(t *testing.T) {
	// the council's whole list matches 3 key lines but only 1 in its first 5; the team, which keeps 5 items, matches 1
	var results []CouncilBenchResult
	for run := 1; run <= 2; run++ {
		results = append(results,
			CouncilBenchResult{Date: "2026-11-19T10:00:00Z", Harness: council.HarnessVersion, Case: "a", Variant: VariantCouncil, Run: run, State: "done",
				Mode: council.ModeReview, Recall: 3, Recall5: 1, Judged: 12, Keys: 4, Tokens: 10_000_000},
			CouncilBenchResult{Date: "2026-11-19T10:00:00Z", Harness: council.HarnessVersion, Case: "a", Variant: VariantTeam, Run: run, State: "done",
				Mode: council.ModeReview, Recall: 1, Judged: 5, Keys: 4, Tokens: 5_000_000},
		)
	}
	d := Decide(results, []string{"a"})
	if d.CouncilRecall != 1 || d.TeamRecall != 1 || d.Outcome != DecisionGo {
		t.Errorf("decision = %+v, want council 1 and team 1 (both at rank 5 or better) and go", d)
	}
}
