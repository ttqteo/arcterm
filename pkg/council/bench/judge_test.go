// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/consult"
	"github.com/wavetermdev/waveterm/pkg/council"
)

// the rubric as the plan words it: a change to it is a change to what the bench measures
const phase0Rubric = "an item matches a key line only when it names the same problem (same terms, same sentence pattern, " +
	"same missing baseline, same bug), not the same topic; each item is `key:<Kn>`, `valid` or `wrong`"

func judgeCase(mode string) Case {
	return Case{
		Id: "judged", Mode: mode, Feature: "Council, for a first-time user",
		KeyLines: []KeyLine{
			{Id: "K1", Text: "Open a finished council on its report first."},
			{Id: "K2", Text: "Plain words instead of code words."},
			{Id: "K3", Text: "The vote as top-3 picks."},
		},
	}
}

// judgeReport is a done council whose Summary holds n directions titled "Direction title <i>" and the given kept ideas.
func judgeReport(mode string, n int, kept ...string) *council.Council {
	s := &council.CouncilSummary{Answer: "Open the report first.", Text: "The panel agrees the report leads."}
	for i := 1; i <= n; i++ {
		s.Directions = append(s.Directions, council.CouncilDirection{
			Rank: i, Title: fmt.Sprintf("Direction title %d", i), Reasoning: fmt.Sprintf("Reasoning for direction %d.", i),
		})
	}
	for i, k := range kept {
		s.Kept = append(s.Kept, council.CouncilDirection{Rank: i + 1, Title: k, Reasoning: "Why " + k + " stays."})
	}
	return &council.Council{Id: "c1", Mode: mode, State: council.StateDone, Summary: s}
}

func TestJudgePrompt(t *testing.T) {
	t.Run("review: the key, the rubric and the top 5", func(t *testing.T) {
		p := judgePrompt(judgeCase(council.ModeReview), judgeReport(council.ModeReview, 7, "A wild one"))
		for _, want := range []string{
			"K1: Open a finished council on its report first.", "K3: The vote as top-3 picks.",
			phase0Rubric,
			"Open the report first.", "The panel agrees the report leads.",
			"1. Direction title 1", "Reasoning for direction 1.", "5. Direction title 5",
		} {
			if !strings.Contains(p, want) {
				t.Errorf("prompt lacks %q:\n%s", want, p)
			}
		}
		if strings.Contains(p, "Direction title 6") || strings.Contains(p, "Direction title 7") {
			t.Errorf("a Review report is cut to its top 5 items, but the prompt holds a later one:\n%s", p)
		}
		if strings.Contains(p, "A wild one") || strings.Contains(strings.ToLower(p), "kept aside") {
			t.Errorf("a Review report has no Kept list, but the prompt mentions one:\n%s", p)
		}
	})

	t.Run("review: Also raised fills the top 5 after the directions", func(t *testing.T) {
		report := judgeReport(council.ModeReview, 3, "Also one", "Also two", "Also three")
		p := judgePrompt(judgeCase(council.ModeReview), report)
		if !strings.Contains(p, "3. Direction title 3") || !strings.Contains(p, "4. Also one") || !strings.Contains(p, "5. Also two") {
			t.Errorf("prompt lacks the directions then Also raised as items 4 and 5:\n%s", p)
		}
		if strings.Contains(p, "Also three") || strings.Contains(strings.ToLower(p), "kept aside") {
			t.Errorf("a Review is cut at 5 items and has no kept list apart:\n%s", p)
		}
		v, err := parseVerdict(`{"matches":{"K1":5,"K2":6},"items":[{"rank":5,"verdict":"key:K1"}]}`, judgeCase(council.ModeReview), report)
		if err != nil || len(v.Matches) != 1 || v.Matches["K1"] != 5 || len(v.Items) != 1 {
			t.Errorf("verdict = %+v, %v, want the match at item 5 kept and the one past the cut dropped", v, err)
		}
	})

	t.Run("a report with fewer items than the cut", func(t *testing.T) {
		p := judgePrompt(judgeCase(council.ModeReview), judgeReport(council.ModeReview, 2))
		if !strings.Contains(p, "2. Direction title 2") || strings.Contains(p, "3. Direction title 3") {
			t.Errorf("prompt should hold exactly the two items:\n%s", p)
		}
	})
}

func TestJudgeBrainstormCouncilJudgesDirectionsThenKeptAsOneList(t *testing.T) {
	// the K1 match is a wild idea kept aside, item 6 of the one list: it counts, and nothing is cut at 3
	f := &fakeClaude{reply: `{"matches":{"K1":6,"K2":2},"items":[{"rank":2,"verdict":"key:K2"},{"rank":6,"verdict":"key:K1"},{"rank":4,"verdict":"wrong"}]}`}
	useFakeClaude(t, f)

	v, err := Judge(context.Background(), judgeCase(council.ModeBrainstorm), judgeReport(council.ModeBrainstorm, 4, "Wild one", "Wild two"))
	if err != nil {
		t.Fatal(err)
	}

	p := f.prompt
	for _, want := range []string{
		"K1: Open a finished council on its report first.", phase0Rubric, "judge all 6 items",
		"1. Direction title 1", "Reasoning for direction 1.", "4. Direction title 4",
		"5. Wild one", "Why Wild one stays.", "6. Wild two",
	} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt lacks %q:\n%s", want, p)
		}
	}
	if strings.Contains(p, "7. ") || strings.Contains(p, "first 3 items") {
		t.Errorf("a Brainstorm report is not cut, but the prompt says it is:\n%s", p)
	}
	if strings.Contains(p, "Open the report first.") || strings.Contains(p, "The panel agrees the report leads.") {
		t.Errorf("a Brainstorm report is judged on its items alone, as a design is, but the prompt holds the answer or the text:\n%s", p)
	}
	if strings.Contains(strings.ToLower(p), "kept") {
		t.Errorf("the kept ideas are items of the one list, not a list apart, but the prompt mentions one:\n%s", p)
	}
	if strings.Index(p, "4. Direction title 4") > strings.Index(p, "5. Wild one") {
		t.Errorf("the directions come first, then the kept ideas:\n%s", p)
	}

	if v.Judged != 6 {
		t.Errorf("Judged = %d, want the 6 items shown", v.Judged)
	}
	if len(v.Matches) != 2 || v.Matches["K1"] != 6 || v.Matches["K2"] != 2 {
		t.Errorf("Matches = %v, want K1 at rank 6 and K2 at rank 2", v.Matches)
	}
	if v.Recall() != 2 || v.RecallAt(3) != 1 || v.Wrong() != 1 {
		t.Errorf("Recall/RecallAt(3)/Wrong = %d/%d/%d, want 2/1/1", v.Recall(), v.RecallAt(3), v.Wrong())
	}
}

func TestVerdictRecallAtCutsAtRank(t *testing.T) {
	v := Verdict{Matches: map[string]int{"K1": 1, "K2": 3, "K3": 5}}
	if v.Recall() != 3 {
		t.Errorf("Recall = %d, want 3: a match at rank 5 counts in recall@all", v.Recall())
	}
	for n, want := range map[int]int{0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 9: 3} {
		if got := v.RecallAt(n); got != want {
			t.Errorf("RecallAt(%d) = %d, want %d", n, got, want)
		}
	}
	if (Verdict{}).RecallAt(3) != 0 {
		t.Error("a verdict with no matches has no recall at any rank")
	}
}

func TestReadVerdictTakesTheLowestRank(t *testing.T) {
	c := judgeCase(council.ModeBrainstorm)
	for name, tc := range map[string]struct {
		reply string
		want  map[string]int
	}{
		"the item list names an earlier item than the map": {
			reply: `{"matches":{"K1":4},"items":[{"rank":2,"verdict":"Key:K1"},{"rank":4,"verdict":"key:K1"}]}`,
			want:  map[string]int{"K1": 2},
		},
		"the map names an earlier item than the item list": {
			reply: `{"matches":{"K1":1},"items":[{"rank":3,"verdict":"key:K1"}]}`,
			want:  map[string]int{"K1": 1},
		},
		"a key line only the item list names": {
			reply: `{"matches":{"K1":null},"items":[{"rank":5,"verdict":"key:K3"},{"rank":2,"verdict":"valid"}]}`,
			want:  map[string]int{"K3": 5},
		},
		"a key line only the map names": {
			reply: `{"matches":{"K2":3},"items":[{"rank":3,"verdict":"valid"}]}`,
			want:  map[string]int{"K2": 3},
		},
		"out of range or not in the key is dropped from both": {
			reply: `{"matches":{"K1":9,"K9":1},"items":[{"rank":7,"verdict":"key:K2"},{"rank":0,"verdict":"key:K2"},{"rank":2,"verdict":"key:K8"},{"rank":3,"verdict":"key:K3"}]}`,
			want:  map[string]int{"K3": 3},
		},
		"the id in a verdict is read without regard to case": {
			reply: `{"matches":{},"items":[{"rank":2,"verdict":" KEY:k2 "}]}`,
			want:  map[string]int{"K2": 2},
		},
	} {
		t.Run(name, func(t *testing.T) {
			v, err := readVerdict(tc.reply, c, 6)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(v.Matches, tc.want) {
				t.Errorf("Matches = %v, want %v", v.Matches, tc.want)
			}
			if v.Judged != 6 {
				t.Errorf("Judged = %d, want the 6 items shown", v.Judged)
			}
		})
	}
}

// fakeClaude replaces the consult call for one test and records what it was asked.
type fakeClaude struct {
	reply string
	err   error

	calls  int
	cwd    string
	prompt string
	opts   consult.CallOpts
}

func useFakeClaude(t *testing.T, f *fakeClaude) {
	t.Helper()
	orig := runClaude
	runClaude = func(ctx context.Context, cwd, prompt string, o consult.CallOpts, onTool func(string)) (string, consult.Usage, error) {
		f.calls++
		f.cwd, f.prompt, f.opts = cwd, prompt, o
		return f.reply, consult.Usage{TotalTokens: 1234}, f.err
	}
	t.Cleanup(func() { runClaude = orig })
}

func TestJudgeParse(t *testing.T) {
	// the reply of a judge that still answers a "kept" list, as one asked a round ago did: nothing reads it
	const reply = `{"matches":{"K1":1,"K2":null},"kept":{"K3":1},"items":[{"rank":1,"verdict":"key:K1"},{"rank":2,"verdict":"valid"},{"rank":3,"verdict":"wrong"}]}`
	f := &fakeClaude{reply: "Here is my verdict.\n```json\n" + reply + "\n```\n"}
	useFakeClaude(t, f)

	v, err := Judge(context.Background(), judgeCase(council.ModeBrainstorm), judgeReport(council.ModeBrainstorm, 4, "Wild"))
	if err != nil {
		t.Fatal(err)
	}
	if f.calls != 1 {
		t.Fatalf("consult calls = %d, want 1", f.calls)
	}
	if f.opts.Model != "opus" || len(f.opts.Tools) != 0 {
		t.Errorf("judge call opts = %+v, want opus and no tools", f.opts)
	}
	if len(v.Matches) != 1 || v.Matches["K1"] != 1 {
		t.Errorf("Matches = %v, want only K1 at rank 1 (K2's null is no match)", v.Matches)
	}
	if len(v.Items) != 3 || v.Items[0] != (ItemVerdict{Rank: 1, Verdict: "key:K1"}) || v.Items[2].Verdict != "wrong" {
		t.Errorf("Items = %+v", v.Items)
	}
	if v.Recall() != 1 || v.Wrong() != 1 || v.Judged != 5 {
		t.Errorf("Recall/Wrong/Judged = %d/%d/%d, want 1/1/5 (4 directions and the kept idea)", v.Recall(), v.Wrong(), v.Judged)
	}

	// the bare object, with no fence and no prose, parses too
	f.reply = reply
	if _, err := Judge(context.Background(), judgeCase(council.ModeBrainstorm), judgeReport(council.ModeBrainstorm, 4, "Wild")); err != nil {
		t.Errorf("a bare JSON reply: %v", err)
	}
}

func TestJudgeCarriesTheCallsTokens(t *testing.T) {
	// useFakeClaude's stub reports 1234 tokens for the one call
	useFakeClaude(t, &fakeClaude{reply: `{"matches":{"K1":1},"items":[{"rank":1,"verdict":"key:K1"}]}`})
	v, err := Judge(context.Background(), judgeCase(council.ModeReview), judgeReport(council.ModeReview, 3))
	if err != nil {
		t.Fatal(err)
	}
	if v.Tokens != 1234 {
		t.Errorf("Verdict.Tokens = %d, want the judge call's 1234", v.Tokens)
	}

	// a reply that holds no verdict is still spend
	useFakeClaude(t, &fakeClaude{reply: "no verdict here"})
	v, err = Judge(context.Background(), judgeCase(council.ModeReview), judgeReport(council.ModeReview, 3))
	if err == nil || v.Tokens != 1234 {
		t.Errorf("unreadable reply: Tokens = %d, err = %v, want an error and the call's 1234", v.Tokens, err)
	}
}

func TestJudgeParseErrors(t *testing.T) {
	for name, tc := range map[string]struct {
		reply string
		err   error
	}{
		"prose":             {reply: "K1 matches item 1, the rest do not."},
		"empty":             {reply: ""},
		"json without them": {reply: `{"verdict":"good"}`},
		"a list":            {reply: `[{"rank":1}]`},
		"matches not ranks": {reply: `{"matches":{"K1":"first"}}`},
		"call failed":       {err: errors.New("claude exited 1")},
	} {
		t.Run(name, func(t *testing.T) {
			useFakeClaude(t, &fakeClaude{reply: tc.reply, err: tc.err})
			if v, err := Judge(context.Background(), judgeCase(council.ModeReview), judgeReport(council.ModeReview, 3)); err == nil {
				t.Errorf("Judge = %+v, want an error", v)
			}
		})
	}
}

func TestJudgeDropsWhatTheReportCannotHold(t *testing.T) {
	// K9 is not in the key; rank 5 is past the 3 items shown; item 7 does not exist
	useFakeClaude(t, &fakeClaude{reply: `{"matches":{"K1":2,"K2":5,"K9":1},"items":[{"rank":1,"verdict":"wrong"},{"rank":7,"verdict":"wrong"},{"rank":2,"verdict":"Key:K1"}]}`})
	v, err := Judge(context.Background(), judgeCase(council.ModeReview), judgeReport(council.ModeReview, 3))
	if err != nil {
		t.Fatal(err)
	}
	if len(v.Matches) != 1 || v.Matches["K1"] != 2 {
		t.Errorf("Matches = %v, want only K1 at rank 2", v.Matches)
	}
	if len(v.Items) != 2 || v.Wrong() != 1 || v.Judged != 3 {
		t.Errorf("Items = %+v, Wrong = %d, Judged = %d, want the two real ranks, one wrong and the 3 items shown", v.Items, v.Wrong(), v.Judged)
	}
}

// designItems is n decisions of a design, titled "Decision title <i>".
func designItems(n int) []council.CouncilDirection {
	var items []council.CouncilDirection
	for i := 1; i <= n; i++ {
		items = append(items, council.CouncilDirection{
			Rank: i, Title: fmt.Sprintf("Decision title %d", i), Reasoning: fmt.Sprintf("Body of decision %d.", i),
		})
	}
	return items
}

func TestJudgeDesign(t *testing.T) {
	// a design is judged whole whatever the case's mode: no cut at 3 or 5, and no kept list to ask for
	for _, mode := range []string{council.ModeBrainstorm, council.ModeReview} {
		t.Run(mode, func(t *testing.T) {
			// K1 at rank 6 is the last item and stays; K2 at rank 7 is past the 6 items shown and goes; K3 sits in a kept
			// list the design does not have and is not read; rank 7's verdict goes with K2
			f := &fakeClaude{reply: `{"matches":{"K1":6,"K2":7,"K9":1},"kept":{"K3":1},"items":[{"rank":6,"verdict":"key:K1"},{"rank":1,"verdict":"wrong"},{"rank":7,"verdict":"valid"}]}`}
			useFakeClaude(t, f)

			v, err := JudgeDesign(context.Background(), judgeCase(mode), designItems(6))
			if err != nil {
				t.Fatal(err)
			}
			if f.calls != 1 {
				t.Fatalf("consult calls = %d, want 1", f.calls)
			}
			if f.opts.Model != "opus" || len(f.opts.Tools) != 0 {
				t.Errorf("judge call opts = %+v, want opus and no tools", f.opts)
			}

			p := f.prompt
			for _, want := range []string{
				"K1: Open a finished council on its report first.", "K3: The vote as top-3 picks.",
				phase0Rubric,
				"1. Decision title 1", "Body of decision 1.", "3. Decision title 3", "6. Decision title 6", "Body of decision 6.",
				"judge all 6 items",
			} {
				if !strings.Contains(p, want) {
					t.Errorf("prompt lacks %q:\n%s", want, p)
				}
			}
			if strings.Contains(p, "first 3 items") || strings.Contains(p, "first 5 items") || strings.Contains(p, "7. ") {
				t.Errorf("a design is not cut, but the prompt says it is:\n%s", p)
			}
			if strings.Contains(strings.ToLower(p), "kept") {
				t.Errorf("a design has no kept list, but the prompt mentions one:\n%s", p)
			}

			if len(v.Matches) != 1 || v.Matches["K1"] != 6 {
				t.Errorf("Matches = %v, want only K1 at rank 6 (rank 7 is past the 6 items)", v.Matches)
			}
			if len(v.Items) != 2 || v.Wrong() != 1 || v.Recall() != 1 || v.Judged != 6 {
				t.Errorf("Items = %+v, Wrong = %d, Recall = %d, Judged = %d, want the two real ranks, one wrong, one match and 6 judged", v.Items, v.Wrong(), v.Recall(), v.Judged)
			}
			if v.Tokens != 1234 {
				t.Errorf("Verdict.Tokens = %d, want the call's 1234", v.Tokens)
			}
		})
	}
}

func TestJudgeDesignCarriesTheCallsTokensOnFailure(t *testing.T) {
	// useFakeClaude's stub reports 1234 tokens for the one call, whether or not it succeeds
	for name, f := range map[string]*fakeClaude{
		"a reply with no verdict": {reply: "no verdict here"},
		"a failed call":           {err: errors.New("claude exited 1")},
	} {
		t.Run(name, func(t *testing.T) {
			useFakeClaude(t, f)
			v, err := JudgeDesign(context.Background(), judgeCase(council.ModeBrainstorm), designItems(4))
			if err == nil || v.Tokens != 1234 {
				t.Errorf("Tokens = %d, err = %v, want an error and the call's 1234", v.Tokens, err)
			}
		})
	}
}

func TestJudgeDesignNeedsItems(t *testing.T) {
	f := &fakeClaude{reply: `{"matches":{}}`}
	useFakeClaude(t, f)
	if v, err := JudgeDesign(context.Background(), judgeCase(council.ModeBrainstorm), nil); err == nil {
		t.Errorf("JudgeDesign = %+v, want an error for a design with no items", v)
	}
	if f.calls != 0 {
		t.Errorf("consult calls = %d, want none when there is nothing to judge", f.calls)
	}
}

func TestJudgeNeedsASummary(t *testing.T) {
	f := &fakeClaude{reply: `{"matches":{}}`}
	useFakeClaude(t, f)
	if _, err := Judge(context.Background(), judgeCase(council.ModeReview), &council.Council{Id: "c1", State: council.StateDone}); err == nil {
		t.Error("a council with no Summary has no report to judge: want an error")
	}
	if f.calls != 0 {
		t.Errorf("consult calls = %d, want none for a report with nothing in it", f.calls)
	}
}
