// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"context"
	"errors"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/council"
)

// CouncilBenchRejudge is a "rejudge" line: a run line's report judged again, as Judge judges one now. The run line stays
// as it was written; reading the file back puts these scores in it (applyRejudges). Council, Case, Variant and Run name
// the run line.
type CouncilBenchRejudge struct {
	Kind        string         `json:"kind"`
	Date        string         `json:"date"` // RFC 3339
	Council     string         `json:"council"`
	Case        string         `json:"case"`
	Variant     string         `json:"variant"`
	Run         int            `json:"run"`
	Recall      int            `json:"recall"`  // recall@all
	Recall5     int            `json:"recall5"` // the key lines matched at rank 1 to TopReview
	Keys        int            `json:"keys"`
	Judged      int            `json:"judged"`
	Wrong       int            `json:"wrong"`
	Matches     map[string]int `json:"matches,omitempty"`
	JudgeTokens int64          `json:"judgetokens"`
}

// JudgedWhole says a run line's recall is recall@all: a line judged on its whole list says how many items it was shown
// (Judged), and a Review team's report never holds more than TopReview items (teamprompt.go), so its Recall is its whole
// list's even on a line written before Judged existed.
func JudgedWhole(r CouncilBenchResult) bool {
	return r.Judged > 0 || r.Variant == VariantTeam
}

// HeadRecall is a Review run line's key lines matched at rank 1 to TopReview. A line judged whole names them in Recall5;
// a line scored before Review reports were judged whole was cut at TopReview, so its Recall is that head recall; a
// team's list is no longer than the cut, so its Recall is too. A Brainstorm line has no Recall5: its head recall is its
// Recall.
func HeadRecall(r CouncilBenchResult) int {
	if r.Judged > 0 && r.Variant != VariantTeam && r.Mode != council.ModeBrainstorm {
		return r.Recall5
	}
	return r.Recall
}

// NeedsRejudge says a run line's report can and should be judged again: a done Review run of a council (the council or
// solo variant), so its report is a saved council, scored before Review reports were judged whole. mode is the line's
// own mode, else its case's.
func NeedsRejudge(r CouncilBenchResult, mode string) bool {
	return mode == council.ModeReview && r.State == string(council.StateDone) && r.Council != "" &&
		(r.Variant == VariantCouncil || r.Variant == VariantSolo) && r.Judged == 0
}

// Rejudge judges a run line's report again with judge (Judge, or a test's fake) and returns the line that records it. A
// report that is not the run's council, or one with no summary, is an error, and so is a failed judging: nothing is
// recorded then, and the run line keeps its old score.
func Rejudge(ctx context.Context, judge JudgeFunc, c Case, r CouncilBenchResult, report *council.Council) (CouncilBenchRejudge, error) {
	if report == nil || report.Id != r.Council {
		return CouncilBenchRejudge{}, fmt.Errorf("the report is not council %s", r.Council)
	}
	if report.Summary == nil {
		return CouncilBenchRejudge{}, errors.New("council " + r.Council + " has no summary to judge")
	}
	v, err := judge(ctx, c, report)
	line := CouncilBenchRejudge{Council: r.Council, Case: r.Case, Variant: r.Variant, Run: r.Run, JudgeTokens: v.Tokens}
	if err != nil {
		return line, err
	}
	line.Recall = v.Recall()
	line.Recall5 = v.RecallAt(TopReview)
	line.Keys = len(c.KeyLines)
	line.Judged = v.Judged
	line.Wrong = v.Wrong()
	line.Matches = v.Matches
	return line, nil
}

// AppendRejudge adds a rejudge line. The kind is always "rejudge", and an empty Date is now. One with no council is
// refused: reading would skip it.
func AppendRejudge(dataDir string, r CouncilBenchRejudge) error {
	if r.Council == "" {
		return errors.New("a rejudge needs the council it judged")
	}
	r.Kind = KindRejudge
	if r.Date == "" {
		r.Date = stamp()
	}
	return appendLine(dataDir, r)
}

// applyRejudges puts each rejudge line's scores in the done run line it names, the last line written winning when a
// report was judged again more than once; the judge's tokens of every rejudge add to the run line's JudgeTokens, since
// each was spent. A rejudge that names no done run line is ignored.
func applyRejudges(runs []CouncilBenchResult, rejudges []CouncilBenchRejudge) {
	type runKey struct {
		council, caseId, variant string
		run                      int
	}
	index := map[runKey]int{}
	for i, r := range runs {
		if r.Council != "" && r.State == string(council.StateDone) {
			index[runKey{r.Council, r.Case, r.Variant, r.Run}] = i
		}
	}
	for _, rj := range rejudges {
		i, ok := index[runKey{rj.Council, rj.Case, rj.Variant, rj.Run}]
		if !ok {
			continue
		}
		r := &runs[i]
		r.JudgeTokens += rj.JudgeTokens
		r.Recall, r.Recall5, r.Judged, r.Wrong, r.Matches = rj.Recall, rj.Recall5, rj.Judged, rj.Wrong, rj.Matches
		if rj.Keys > 0 {
			r.Keys = rj.Keys
		}
	}
}
