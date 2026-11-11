// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/council"
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
	if !reflect.DeepEqual(runs[0], run) {
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

func TestResultMatchesRoundTrip(t *testing.T) {
	dir := t.TempDir()
	// a line from before the match maps: it must still read, with both maps nil
	old := `{"kind":"run","date":"2026-10-22T10:00:00Z","harness":"2026-10-22.1","case":"old","variant":"council","run":1,"council":"c0","state":"done","recall":1,"keys":3,"wrong":0,"tokens":10,"minutes":1,"messages":2}` + "\n"
	if err := os.WriteFile(resultsPath(dir), []byte(old), 0o644); err != nil {
		t.Fatal(err)
	}
	run := CouncilBenchResult{
		Date: "2026-11-06T10:00:00Z", Harness: "2026-11-06.1", Case: "brainstorm", Variant: VariantCouncil, Run: 1,
		Council: "c1", State: "done", Recall: 2, Keys: 4, Kept: 1,
		Matches: map[string]int{"k1": 1, "k3": 3}, KeptMatches: map[string]int{"k2": 1},
	}
	if err := AppendResult(dir, run); err != nil {
		t.Fatal(err)
	}
	runs, _, err := LoadResults(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 2 {
		t.Fatalf("runs = %d, want 2", len(runs))
	}
	if runs[0].Case != "old" || runs[0].Matches != nil || runs[0].KeptMatches != nil {
		t.Errorf("old line = %+v, want case old and both maps nil", runs[0])
	}
	run.Kind = KindRun
	if !reflect.DeepEqual(runs[1], run) {
		t.Errorf("run round trip:\n got %+v\nwant %+v", runs[1], run)
	}
}

func TestResultRoundTripBrainstormFields(t *testing.T) {
	dir := t.TempDir()
	run := CouncilBenchResult{
		Date: "2026-11-10T10:00:00Z", Harness: "2026-11-06.1", Case: "run-pause", Variant: VariantBrainstorm, Run: 1,
		Council: "9f0c1d2e-session", State: "done", Recall: 3, Keys: 5, Wrong: 1, Tokens: 4_200_000, Minutes: 38.5, Messages: 21,
		JudgeTokens: 16_000, Matches: map[string]int{"K1": 1, "K2": 4, "K5": 2},
		Mode: "brainstorm", Skill: "3f9a01bc superpowers@4.0.3", Decisions: 7, RecallDone: 2, MatchesDone: map[string]int{"K1": 1, "K2": 4}, Questions: 9,
	}
	if err := AppendResult(dir, run); err != nil {
		t.Fatal(err)
	}
	runs, _, err := LoadResults(dir)
	if err != nil || len(runs) != 1 {
		t.Fatalf("runs = %+v, err = %v, want 1", runs, err)
	}
	run.Kind = KindRun
	if !reflect.DeepEqual(runs[0], run) {
		t.Errorf("run round trip:\n got %+v\nwant %+v", runs[0], run)
	}

	raw, err := os.ReadFile(resultsPath(dir))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"mode":"brainstorm"`, `"skill":"3f9a01bc superpowers@4.0.3"`, `"decisions":7`, `"recall_done":2`, `"matches_done":{"K1":1,"K2":4}`, `"questions":9`} {
		if !strings.Contains(string(raw), want) {
			t.Errorf("line = %s, want it to carry %s (the spec's wire names)", raw, want)
		}
	}
}

func TestResultRoundTripOldLineAndEmptyNewFields(t *testing.T) {
	dir := t.TempDir()
	// a line written before the brainstorm fields existed: it still reads, every new field at its zero value
	old := `{"kind":"run","date":"2026-10-22T10:00:00Z","harness":"2026-10-22.1","case":"old","variant":"team","run":1,"council":"t0","state":"done","recall":2,"keys":3,"wrong":0,"tokens":10,"minutes":1,"messages":2,"matches":{"K1":1,"K2":2}}` + "\n"
	if err := os.WriteFile(resultsPath(dir), []byte(old), 0o644); err != nil {
		t.Fatal(err)
	}
	// a row that sets none of them writes none of them: council and team lines keep the shape they always had
	if err := AppendResult(dir, CouncilBenchResult{Date: "2026-11-10T10:00:00Z", Harness: "2026-11-06.1", Case: "plain", Variant: VariantCouncil, Run: 1, State: "done", Recall: 1, Keys: 2}); err != nil {
		t.Fatal(err)
	}
	runs, _, err := LoadResults(dir)
	if err != nil || len(runs) != 2 {
		t.Fatalf("runs = %+v, err = %v, want 2", runs, err)
	}
	r := runs[0]
	if r.Case != "old" || r.Recall != 2 || r.Matches["K2"] != 2 {
		t.Errorf("old line = %+v, want it read as before", r)
	}
	if r.Mode != "" || r.Skill != "" || r.Decisions != 0 || r.RecallDone != 0 || r.MatchesDone != nil || r.Questions != 0 {
		t.Errorf("old line = %+v, want every new field at its zero value", r)
	}
	raw, err := os.ReadFile(resultsPath(dir))
	if err != nil {
		t.Fatal(err)
	}
	_, second, _ := strings.Cut(string(raw), "\n")
	for _, absent := range []string{`"mode"`, `"skill"`, `"decisions"`, `"recall_done"`, `"matches_done"`, `"questions"`} {
		if strings.Contains(second, absent) {
			t.Errorf("a row with none of the new fields wrote %s: %s", absent, second)
		}
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
	done := func(h, variant string, recall, keys, wrong int, tokens int64) CouncilBenchResult {
		return CouncilBenchResult{Harness: h, Case: "c", Variant: variant, Run: 1, State: "done", Recall: recall, Keys: keys, Wrong: wrong, Tokens: tokens}
	}
	results := []CouncilBenchResult{
		done("2026-10-20.1", VariantCouncil, 1, 5, 1, 1_000_000),
		done("2026-10-22.1", VariantCouncil, 2, 5, 0, 1_500_000),
		done("2026-10-22.1", VariantSolo, 1, 5, 0, 500_000),
		done("2026-10-22.1", VariantCouncil, 3, 6, 2, 1_500_000),
		// a council that failed: it spent tokens but scored nothing, and its denominator does not count either
		{Harness: "2026-10-22.1", Case: "c", Variant: VariantCouncil, Run: 2, State: "failed", Tokens: 500_000},
		{Harness: "2026-10-22.1", Case: "c", Variant: VariantCouncil, Run: 3, State: "stopped", Tokens: 100_000, Recall: 4, Keys: 5},
	}
	rows := Summarize(results, nil)
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
	if council.Recall != 5 || council.Keys != 11 || council.Wrong != 2 {
		t.Errorf("council recall = %d/%d, wrong = %d, want 5/11, 2 (failed and stopped rows add none)",
			council.Recall, council.Keys, council.Wrong)
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

func TestSummarizeOrdersVariantsSoloCouncilTeam(t *testing.T) {
	// given in the opposite order, with one variant this build does not know
	var results []CouncilBenchResult
	for _, v := range []string{"zzz", VariantTeam, VariantCouncil, VariantSolo} {
		results = append(results, CouncilBenchResult{Harness: "2026-11-03.1", Variant: v, State: "done"})
	}
	var got []string
	for _, r := range Summarize(results, nil) {
		got = append(got, r.Variant)
	}
	if want := "solo council team zzz"; strings.Join(got, " ") != want {
		t.Errorf("variants = %v, want %s: a harness's rows list solo, council, team, then any other", got, want)
	}
}

func TestSummarizeOnlyFailedRunsScoreNothing(t *testing.T) {
	rows := Summarize([]CouncilBenchResult{
		{Harness: "h", Variant: VariantSolo, State: "failed", Tokens: 200_000},
	}, nil)
	if len(rows) != 1 || rows[0].Runs != 1 || rows[0].Scored != 0 || rows[0].Keys != 0 || rows[0].Recall != 0 || rows[0].RecallPerM != 0 {
		t.Errorf("rows = %+v, want one run, none scored, no recall and no division by zero", rows)
	}
	if len(Summarize(nil, nil)) != 0 {
		t.Error("no results: want no rows")
	}
}

func TestSummarizeHarnessOrder(t *testing.T) {
	var results []CouncilBenchResult
	for _, h := range []string{"", "2026-10-22.9", "2026-10-22.10", "2026-09-30.3", "2026-10-22.1"} {
		results = append(results, CouncilBenchResult{Harness: h, Variant: VariantSolo, State: "done"})
	}
	var got []string
	for _, r := range Summarize(results, nil) {
		got = append(got, r.Harness)
	}
	want := []string{"2026-10-22.10", "2026-10-22.9", "2026-10-22.1", "2026-09-30.3", ""}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("order = %q, want %q (the counter after the date counts as a number; no harness is oldest)", got, want)
	}
}

// summaryKeys spells rows as "harness/mode/variant/skill" so a test reads the order and the grouping at a glance.
func summaryKeys(rows []CouncilBenchRow) []string {
	var got []string
	for _, r := range rows {
		got = append(got, r.Harness+"/"+r.Mode+"/"+r.Variant+"/"+r.Skill)
	}
	return got
}

func TestSummarizeSplitsEachVariantByMode(t *testing.T) {
	// a council from a Review case and one from a Brainstorm case, and a brainstorm run, in no order
	results := []CouncilBenchResult{
		{Harness: "h2", Case: "run-pause", Mode: council.ModeBrainstorm, Variant: VariantBrainstorm, Skill: "s1", State: "done", Recall: 2, Keys: 4, Tokens: 4_000_000},
		{Harness: "h2", Case: "launcher", Mode: council.ModeBrainstorm, Variant: VariantCouncil, State: "done", Recall: 1, Keys: 4, Tokens: 1_000_000},
		{Harness: "h2", Case: "newcomer", Mode: council.ModeReview, Variant: VariantCouncil, State: "done", Recall: 3, Keys: 5, Tokens: 2_000_000},
		{Harness: "h2", Case: "newcomer", Mode: council.ModeReview, Variant: VariantSolo, State: "done", Recall: 1, Keys: 5, Tokens: 500_000},
		{Harness: "h2", Case: "run-pause", Mode: council.ModeBrainstorm, Variant: VariantTeam, State: "done", Recall: 2, Keys: 4, Tokens: 3_000_000},
		{Harness: "h1", Case: "newcomer", Mode: council.ModeReview, Variant: VariantCouncil, State: "done", Recall: 4, Keys: 5, Tokens: 2_500_000},
	}
	rows := Summarize(results, nil)
	got := summaryKeys(rows)
	// the newest harness first, then review before brainstorm, then solo, council, team, brainstorm
	want := []string{
		"h2/review/solo/", "h2/review/council/",
		"h2/brainstorm/council/", "h2/brainstorm/team/", "h2/brainstorm/brainstorm/s1",
		"h1/review/council/",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("rows = %q, want %q", got, want)
	}
	reviewCouncil, brainstormCouncil := rows[1], rows[2]
	if reviewCouncil.Recall != 3 || reviewCouncil.Keys != 5 || reviewCouncil.Tokens != 2_000_000 {
		t.Errorf("review council = %+v, want only the Review case's 3/5 on 2M tokens", reviewCouncil)
	}
	if brainstormCouncil.Recall != 1 || brainstormCouncil.Keys != 4 || brainstormCouncil.Tokens != 1_000_000 {
		t.Errorf("brainstorm council = %+v, want only the Brainstorm case's 1/4 on 1M tokens", brainstormCouncil)
	}
}

func TestSummarizeOrdersModesReviewBrainstormThenUnknown(t *testing.T) {
	var results []CouncilBenchResult
	for _, m := range []string{"", "other", council.ModeBrainstorm, council.ModeReview} {
		results = append(results, CouncilBenchResult{Harness: "h", Mode: m, Variant: VariantSolo, State: "done"})
	}
	got := summaryKeys(Summarize(results, nil))
	want := []string{"h/review/solo/", "h/brainstorm/solo/", "h/other/solo/", "h//solo/"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("rows = %q, want review, brainstorm, any other named mode, then no mode last", got)
	}
}

func TestSummarizeFillsAnOldLinesModeFromTheCases(t *testing.T) {
	modes := map[string]string{"alpha": council.ModeReview, "beta": council.ModeBrainstorm}
	results := []CouncilBenchResult{
		// written before the mode field existed: the cases say which mode each case is
		{Harness: "h", Case: "alpha", Variant: VariantCouncil, State: "done", Recall: 1, Keys: 2, Tokens: 100},
		{Harness: "h", Case: "beta", Variant: VariantCouncil, State: "done", Recall: 2, Keys: 3, Tokens: 200},
		// a case that is gone from cases.json: its own row, with no mode
		{Harness: "h", Case: "gone", Variant: VariantCouncil, State: "done", Recall: 1, Keys: 1, Tokens: 300},
		// a line's own mode wins over the map's, whatever the case file says now
		{Harness: "h", Case: "alpha", Mode: council.ModeBrainstorm, Variant: VariantCouncil, State: "done", Recall: 3, Keys: 3, Tokens: 400},
	}
	rows := Summarize(results, modes)
	got := summaryKeys(rows)
	want := []string{"h/review/council/", "h/brainstorm/council/", "h//council/"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("rows = %q, want %q", got, want)
	}
	if rows[0].Runs != 1 || rows[0].Recall != 1 {
		t.Errorf("review row = %+v, want only the old alpha line", rows[0])
	}
	if rows[1].Runs != 2 || rows[1].Recall != 5 || rows[1].Keys != 6 || rows[1].Tokens != 600 {
		t.Errorf("brainstorm row = %+v, want the old beta line and alpha's own brainstorm line added: 2 runs, 5/6, 600 tokens", rows[1])
	}
	if rows[2].Runs != 1 || rows[2].Recall != 1 {
		t.Errorf("no-mode row = %+v, want the gone case's line alone", rows[2])
	}

	// no cases at all (cases.json cannot be read): every old line has no mode, and a line with its own mode keeps it
	if got := summaryKeys(Summarize(results, nil)); !reflect.DeepEqual(got, []string{"h/brainstorm/council/", "h//council/"}) {
		t.Errorf("with no case map rows = %q, want the line's own mode and one row of no mode", got)
	}
}

func TestSummarizeNeverAddsTwoBrainstormSkillsUp(t *testing.T) {
	run := func(skill string, recall int, tokens int64) CouncilBenchResult {
		return CouncilBenchResult{Harness: "h", Case: "c", Mode: council.ModeBrainstorm, Variant: VariantBrainstorm, Skill: skill,
			State: "done", Recall: recall, Keys: 4, Tokens: tokens}
	}
	rows := Summarize([]CouncilBenchResult{
		run("3f9a01bc superpowers@4.0.3", 2, 4_000_000),
		run("77aa10de superpowers@4.0.3", 3, 5_000_000),
		run("3f9a01bc superpowers@4.0.3", 1, 6_000_000),
	}, nil)
	if len(rows) != 2 {
		t.Fatalf("rows = %+v, want one per skill text", rows)
	}
	// the two skills sort by name, so a table lists them in a steady order
	first, second := rows[0], rows[1]
	if first.Skill != "3f9a01bc superpowers@4.0.3" || first.Runs != 2 || first.Recall != 3 || first.Keys != 8 || first.Tokens != 10_000_000 {
		t.Errorf("first skill's row = %+v, want its own 2 runs, 3/8 on 10M tokens", first)
	}
	if second.Skill != "77aa10de superpowers@4.0.3" || second.Runs != 1 || second.Recall != 3 || second.Keys != 4 || second.Tokens != 5_000_000 {
		t.Errorf("second skill's row = %+v, want its own run alone, 3/4 on 5M tokens", second)
	}
}

func TestSummarizeSumsBrainstormFieldsOverScoredRunsOnly(t *testing.T) {
	brainstorm := func(state string, recall, recallDone, decisions, questions int, tokens int64) CouncilBenchResult {
		return CouncilBenchResult{Harness: "h", Case: "c", Mode: council.ModeBrainstorm, Variant: VariantBrainstorm, Skill: "s",
			State: state, Recall: recall, Keys: 4, RecallDone: recallDone, Decisions: decisions, Questions: questions, Tokens: tokens}
	}
	rows := Summarize([]CouncilBenchResult{
		brainstorm("done", 3, 2, 7, 9, 4_000_000),
		brainstorm("done", 2, 1, 5, 6, 5_000_000),
		// a run that did not finish keeps its tokens in and its other numbers out, even when the row carries some
		brainstorm("timed-out", 1, 1, 3, 4, 6_000_000),
		brainstorm("failed", 0, 0, 0, 0, 1_000_000),
	}, nil)
	if len(rows) != 1 {
		t.Fatalf("rows = %+v, want one", rows)
	}
	r := rows[0]
	if r.Runs != 4 || r.Scored != 2 || r.Recall != 5 || r.Keys != 8 {
		t.Errorf("row = %+v, want 4 runs, 2 scored, recall 5/8", r)
	}
	if r.RecallDone != 3 || r.Decisions != 12 || r.Questions != 15 {
		t.Errorf("row done recall = %d, decisions = %d, questions = %d, want 3, 12, 15 (the two done runs'; the timed-out run's 1, 3 and 4 stay out)",
			r.RecallDone, r.Decisions, r.Questions)
	}
	if r.Tokens != 16_000_000 || r.Mode != council.ModeBrainstorm || r.Skill != "s" {
		t.Errorf("row = %+v, want every run's 16M tokens, its mode and its skill", r)
	}
}

func TestSummarizeSumsRecall3AndJudged(t *testing.T) {
	brainstorm := func(state string, recall, recall3, judged int) CouncilBenchResult {
		return CouncilBenchResult{Harness: "h", Case: "c", Mode: council.ModeBrainstorm, Variant: VariantBrainstorm, Skill: "s",
			State: state, Recall: recall, Recall3: recall3, Keys: 5, Judged: judged, Wrong: 1, Tokens: 1_000_000}
	}
	rows := Summarize([]CouncilBenchResult{
		brainstorm("done", 4, 2, 9),
		brainstorm("done", 3, 1, 7),
		// a run that did not finish adds neither, even when its line carries some
		brainstorm("failed", 2, 2, 5),
	}, nil)
	if len(rows) != 1 {
		t.Fatalf("rows = %+v, want one", rows)
	}
	r := rows[0]
	if r.Runs != 3 || r.Scored != 2 || r.Recall != 7 || r.Keys != 10 {
		t.Errorf("row = %+v, want 3 runs, 2 scored, recall 7/10", r)
	}
	if r.Recall3 != 3 || r.Judged != 16 {
		t.Errorf("row recall3 = %d, judged = %d, want 3 and 16 (the two done runs'; the failed run's 2 and 5 stay out)", r.Recall3, r.Judged)
	}
	// RecallPerM stays recall@all per million tokens, over every run's tokens
	if want := 7 / 3.0; r.RecallPerM != want {
		t.Errorf("RecallPerM = %v, want %v (recall@all per million tokens)", r.RecallPerM, want)
	}
}

func TestLoadResultsReadsAnOldBrainstormLineWithKept(t *testing.T) {
	dir := t.TempDir()
	// a Brainstorm line of a harness before 2026-11-12.1: its council was cut at 3 items and its wild ideas judged apart
	old := `{"kind":"run","date":"2026-11-10T10:00:00Z","harness":"2026-11-06.1","case":"run-pause","variant":"council","run":1,"council":"c0","state":"done","recall":2,"keys":5,"kept":1,"wrong":1,"tokens":10,"minutes":1,"messages":2,"matches":{"K1":1,"K2":3},"keptmatches":{"K4":1},"mode":"brainstorm"}` + "\n"
	if err := os.WriteFile(resultsPath(dir), []byte(old), 0o644); err != nil {
		t.Fatal(err)
	}
	runs, _, err := LoadResults(dir)
	if err != nil || len(runs) != 1 {
		t.Fatalf("runs = %+v, err = %v, want 1", runs, err)
	}
	r := runs[0]
	if r.Kept != 1 || r.KeptMatches["K4"] != 1 || r.Recall != 2 || r.Matches["K2"] != 3 {
		t.Errorf("old line = %+v, want it read whole, kept and keptmatches included", r)
	}
	if r.Recall3 != 0 || r.Judged != 0 {
		t.Errorf("old line = %+v, want recall3 and judged at 0: the harness that wrote it had neither", r)
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
