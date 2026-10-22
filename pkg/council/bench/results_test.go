// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func resultsPath(dir string) string { return filepath.Join(dir, "council-bench.jsonl") }

func TestAppendAndLoadResults(t *testing.T) {
	dir := t.TempDir()
	run := CouncilBenchResult{
		Date: "2026-10-22T10:00:00Z", Harness: "2026-10-22.1", Case: "newcomer", Variant: VariantCouncil, Run: 1,
		Council: "c1", State: "done", Recall: 2, Keys: 5, Kept: 1, Wrong: 0, Tokens: 1_400_000, Minutes: 8.5, Messages: 80,
	}
	if err := AppendResult(dir, run); err != nil {
		t.Fatal(err)
	}
	rating := CouncilBenchRating{RatedAt: "2026-10-22T11:00:00Z", Harness: "2026-10-22.1", Mode: "review", Council: "c2", Rating: RatingUseful}
	if err := AppendRating(dir, rating); err != nil {
		t.Fatal(err)
	}
	// lines a future version, a crash or a person might leave in the file
	f, err := os.OpenFile(resultsPath(dir), os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString("{\"kind\":\"mystery\",\"x\":1}\n\n{this is not json\n{\"kind\":\"rating\",\"council\":\"c9\",\"rating\":\"maybe\"}\n"); err != nil {
		t.Fatal(err)
	}
	f.Close()
	if err := AppendResult(dir, CouncilBenchResult{Date: "2026-10-23T10:00:00Z", Harness: "2026-10-22.1", Case: "codefix", Variant: VariantSolo, Run: 1, State: "failed"}); err != nil {
		t.Fatal(err)
	}

	runs, ratings, err := LoadResults(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 2 || len(ratings) != 1 {
		t.Fatalf("runs = %d, ratings = %d, want 2 and 1 (the unknown kind, the broken line and the unknown rating skipped)", len(runs), len(ratings))
	}
	run.Kind = KindRun
	if runs[0] != run {
		t.Errorf("run round trip:\n got %+v\nwant %+v", runs[0], run)
	}
	if runs[1].Case != "codefix" || runs[1].State != "failed" {
		t.Errorf("second run = %+v", runs[1])
	}
	rating.Kind = KindRating
	if ratings[0] != rating {
		t.Errorf("rating round trip:\n got %+v\nwant %+v", ratings[0], rating)
	}

	raw, err := os.ReadFile(resultsPath(dir))
	if err != nil {
		t.Fatal(err)
	}
	if first, _, _ := strings.Cut(string(raw), "\n"); !strings.Contains(first, `"kind":"run"`) || !strings.Contains(first, `"harness":"2026-10-22.1"`) {
		t.Errorf("first line = %s, want a run line with kind and harness", first)
	}
}

func TestLoadResultsNoFile(t *testing.T) {
	runs, ratings, err := LoadResults(t.TempDir())
	if err != nil || len(runs) != 0 || len(ratings) != 0 {
		t.Errorf("no file: runs = %v, ratings = %v, err = %v, want nothing and no error", runs, ratings, err)
	}
}

func TestAppendStampsKindAndDate(t *testing.T) {
	dir := t.TempDir()
	before := time.Now().UTC().Add(-time.Second)
	if err := AppendResult(dir, CouncilBenchResult{Kind: "rating", Case: "a", Variant: VariantSolo, State: "done"}); err != nil {
		t.Fatal(err)
	}
	if err := AppendRating(dir, CouncilBenchRating{Kind: "run", Council: "c1", Rating: RatingNot}); err != nil {
		t.Fatal(err)
	}
	runs, ratings, err := LoadResults(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || len(ratings) != 1 {
		t.Fatalf("runs = %d, ratings = %d, want 1 and 1: the kind is the function's, not the caller's", len(runs), len(ratings))
	}
	for name, stamp := range map[string]string{"date": runs[0].Date, "ratedat": ratings[0].RatedAt} {
		at, err := time.Parse(time.RFC3339, stamp)
		if err != nil || at.Before(before) || at.After(time.Now().Add(time.Second)) {
			t.Errorf("%s = %q, want now in RFC 3339 (err %v)", name, stamp, err)
		}
	}
}

func TestAppendRatingRefusesUnknown(t *testing.T) {
	dir := t.TempDir()
	if err := AppendRating(dir, CouncilBenchRating{Council: "c1", Rating: "meh"}); err == nil {
		t.Error("a rating other than useful or not: want an error")
	}
	if err := AppendRating(dir, CouncilBenchRating{Rating: RatingUseful}); err == nil {
		t.Error("a rating with no council: want an error")
	}
	if _, err := os.Stat(resultsPath(dir)); err == nil {
		t.Error("a refused rating wrote the file")
	}
}

func TestAppendAfterTornLine(t *testing.T) {
	dir := t.TempDir()
	// a crash left half a line with no newline; the next append must not glue itself to it
	if err := os.WriteFile(resultsPath(dir), []byte(`{"kind":"run","case":"half`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := AppendResult(dir, CouncilBenchResult{Date: "2026-10-22T10:00:00Z", Case: "whole", Variant: VariantSolo, State: "done"}); err != nil {
		t.Fatal(err)
	}
	runs, _, err := LoadResults(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || runs[0].Case != "whole" {
		t.Errorf("runs = %+v, want only the whole line", runs)
	}
}

func TestSummarizeByHarness(t *testing.T) {
	done := func(h, variant string, recall, keys, kept, wrong int, tokens int64) CouncilBenchResult {
		return CouncilBenchResult{Harness: h, Case: "c", Variant: variant, Run: 1, State: "done", Recall: recall, Keys: keys, Kept: kept, Wrong: wrong, Tokens: tokens}
	}
	results := []CouncilBenchResult{
		done("2026-10-20.1", VariantCouncil, 1, 5, 0, 1, 1_000_000),
		done("2026-10-22.1", VariantCouncil, 2, 5, 1, 0, 1_500_000),
		done("2026-10-22.1", VariantSolo, 1, 5, 0, 0, 500_000),
		done("2026-10-22.1", VariantCouncil, 3, 6, 1, 2, 1_500_000),
		// a council that failed: it spent tokens but scored nothing, and its denominator does not count either
		{Harness: "2026-10-22.1", Case: "c", Variant: VariantCouncil, Run: 2, State: "failed", Tokens: 500_000},
		{Harness: "2026-10-22.1", Case: "c", Variant: VariantCouncil, Run: 3, State: "stopped", Tokens: 100_000, Recall: 4, Keys: 5},
	}
	rows := Summarize(results)
	if len(rows) != 3 {
		t.Fatalf("rows = %+v, want 3 (two harnesses; the newer has two variants)", rows)
	}
	if rows[0].Harness != "2026-10-22.1" || rows[0].Variant != VariantSolo ||
		rows[1].Harness != "2026-10-22.1" || rows[1].Variant != VariantCouncil ||
		rows[2].Harness != "2026-10-20.1" {
		t.Errorf("order = %s/%s, %s/%s, %s/%s; want the newest harness first, solo before council",
			rows[0].Harness, rows[0].Variant, rows[1].Harness, rows[1].Variant, rows[2].Harness, rows[2].Variant)
	}

	council := rows[1]
	if council.Runs != 4 || council.Scored != 2 {
		t.Errorf("council runs = %d, scored = %d, want 4 and 2", council.Runs, council.Scored)
	}
	if council.Recall != 5 || council.Keys != 11 || council.Kept != 2 || council.Wrong != 2 {
		t.Errorf("council recall = %d/%d, kept = %d, wrong = %d, want 5/11, 2, 2 (failed and stopped rows add none)",
			council.Recall, council.Keys, council.Kept, council.Wrong)
	}
	if council.Tokens != 3_600_000 {
		t.Errorf("council tokens = %d, want 3,600,000 (every run's)", council.Tokens)
	}
	if want := 5 / 3.6; council.RecallPerM < want-1e-9 || council.RecallPerM > want+1e-9 {
		t.Errorf("council recall per M = %v, want %v", council.RecallPerM, want)
	}
	if solo := rows[0]; solo.Recall != 1 || solo.Keys != 5 || solo.Tokens != 500_000 || solo.RecallPerM != 2 {
		t.Errorf("solo = %+v, want 1/5 on 500k tokens at 2 per M", solo)
	}
	if old := rows[2]; old.Runs != 1 || old.Recall != 1 || old.Tokens != 1_000_000 {
		t.Errorf("the old harness's row = %+v, want its own numbers, none of the new one's", old)
	}
}

func TestSummarizeOnlyFailedRunsScoreNothing(t *testing.T) {
	rows := Summarize([]CouncilBenchResult{
		{Harness: "h", Variant: VariantSolo, State: "failed", Tokens: 200_000},
	})
	if len(rows) != 1 || rows[0].Runs != 1 || rows[0].Scored != 0 || rows[0].Keys != 0 || rows[0].Recall != 0 || rows[0].RecallPerM != 0 {
		t.Errorf("rows = %+v, want one run, none scored, no recall and no division by zero", rows)
	}
	if len(Summarize(nil)) != 0 {
		t.Error("no results: want no rows")
	}
}

func TestSummarizeHarnessOrder(t *testing.T) {
	var results []CouncilBenchResult
	for _, h := range []string{"", "2026-10-22.9", "2026-10-22.10", "2026-09-30.3", "2026-10-22.1"} {
		results = append(results, CouncilBenchResult{Harness: h, Variant: VariantSolo, State: "done"})
	}
	var got []string
	for _, r := range Summarize(results) {
		got = append(got, r.Harness)
	}
	want := []string{"2026-10-22.10", "2026-10-22.9", "2026-10-22.1", "2026-09-30.3", ""}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("order = %q, want %q (the counter after the date counts as a number; no harness is oldest)", got, want)
	}
}

func TestSummarizeRatingsLatestCounts(t *testing.T) {
	dir := t.TempDir()
	rate := func(at, harness, mode, id, rating string) {
		t.Helper()
		if err := AppendRating(dir, CouncilBenchRating{RatedAt: at, Harness: harness, Mode: mode, Council: id, Rating: rating}); err != nil {
			t.Fatal(err)
		}
	}
	rate("2026-10-22T10:00:00Z", "2026-10-22.1", "review", "c1", RatingUseful)
	rate("2026-10-22T10:05:00Z", "2026-10-22.1", "review", "c2", RatingUseful)
	rate("2026-10-22T10:10:00Z", "2026-10-22.1", "review", "c1", RatingNot) // c1 changed its mind
	rate("2026-10-22T10:15:00Z", "2026-10-22.1", "brainstorm", "c3", RatingNot)
	rate("2026-10-21T09:00:00Z", "2026-10-20.1", "review", "c4", RatingUseful)
	rate("2026-10-22T12:00:00Z", "2026-10-22.1", "review", "c5", RatingNot)
	rate("2026-10-22T11:00:00Z", "2026-10-22.1", "review", "c5", RatingUseful) // written later but dated earlier: c5's earlier time loses

	_, ratings, err := LoadResults(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(ratings) != 7 {
		t.Fatalf("ratings = %d, want all 7 lines kept in the file", len(ratings))
	}

	rows := SummarizeRatings(ratings)
	if len(rows) != 3 {
		t.Fatalf("rows = %+v, want 3 (harness x mode)", rows)
	}
	// newest harness first; within it brainstorm before review
	if rows[0].Harness != "2026-10-22.1" || rows[0].Mode != "brainstorm" || rows[0].Useful != 0 || rows[0].Not != 1 {
		t.Errorf("rows[0] = %+v, want 2026-10-22.1 brainstorm: 0 useful, 1 not", rows[0])
	}
	if rows[1].Harness != "2026-10-22.1" || rows[1].Mode != "review" || rows[1].Useful != 1 || rows[1].Not != 2 {
		t.Errorf("rows[1] = %+v, want 2026-10-22.1 review: 1 useful (c2), 2 not (c1 changed, c5's later-dated line)", rows[1])
	}
	if rows[2].Harness != "2026-10-20.1" || rows[2].Useful != 1 || rows[2].Not != 0 {
		t.Errorf("rows[2] = %+v, want 2026-10-20.1 review: 1 useful", rows[2])
	}
}

func TestSummarizeRatingsNoModeReadsReview(t *testing.T) {
	rows := SummarizeRatings([]CouncilBenchRating{{Harness: "h", Council: "c1", Rating: RatingUseful}})
	if len(rows) != 1 || rows[0].Mode != "review" {
		t.Errorf("rows = %+v, want the mode read as review", rows)
	}
}
