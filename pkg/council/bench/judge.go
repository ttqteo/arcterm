// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/consult"
	"github.com/wavetermdev/waveterm/pkg/council"
)

// How many of a Review's items are judged. A Brainstorm is judged whole, every item of its one list; TopBrainstorm is how
// many items a Brainstorm's team lead is told to keep (teamprompt.go) and the figure `wsh council bench results` names
// in its note on rows of earlier harnesses, which cut a council's report there.
const (
	TopReview     = 5
	TopBrainstorm = 3
)

// recallCut is the rank a Brainstorm row's Recall3 counts up to: a key line matched by an item ranked 1 to 3.
const recallCut = 3

// judgeModel is opus even though the councils are Claude too (the spec's call).
const judgeModel = "opus"

// judgeTimeout bounds the judge's one call.
var judgeTimeout = 10 * time.Minute

// judgeRubric is Phase 0's rubric, word for word.
const judgeRubric = "an item matches a key line only when it names the same problem (same terms, same sentence pattern, " +
	"same missing baseline, same bug), not the same topic; each item is `key:<Kn>`, `valid` or `wrong`"

// the seam a test replaces
var runClaude = consult.RunClaude

// ItemVerdict is the judge's verdict on one report item: `key:K1` (it names that key line's problem), `valid` (a real
// point the key does not hold) or `wrong`.
type ItemVerdict struct {
	Rank    int    `json:"rank"`
	Verdict string `json:"verdict"`
}

// Verdict is what the judge said of one report. Matches holds only the key lines something matched, each with the lowest
// rank of the items that matched it (a null in the judge's answer is no match); it is cut down to what the report can
// hold, so a rank past the items shown or a key line the case does not have is not counted.
type Verdict struct {
	Matches map[string]int // key line id -> rank of the first item that names it, among the items shown
	Items   []ItemVerdict  // one per item the judge gave a verdict
	Judged  int            // the items the judge was shown: the denominator of Wrong
	Tokens  int64          // what the judge's call consumed, so a bench's spend counts it
}

// Recall is the key lines any item shown matched: recall@all.
func (v Verdict) Recall() int { return len(v.Matches) }

// RecallAt is the key lines matched by an item ranked n or better.
func (v Verdict) RecallAt(n int) int {
	count := 0
	for _, rank := range v.Matches {
		if rank <= n {
			count++
		}
	}
	return count
}

// Wrong is the items the judge called wrong.
func (v Verdict) Wrong() int {
	n := 0
	for _, it := range v.Items {
		if strings.EqualFold(strings.TrimSpace(it.Verdict), "wrong") {
			n++
		}
	}
	return n
}

// judgedItems is the report's items the judge scores. A Brainstorm is judged whole: its directions, then its wild ideas
// kept aside, as the one list a design's decisions make, with nothing cut, so a variant that writes a longer list is not
// marked down for it and both sides are scored alike. A Review is cut at TopReview: the directions, then its Also
// raised, which holds the directions past the first three, so a Review is judged on the same five items as before the
// cap.
func judgedItems(c Case, s *council.CouncilSummary) []council.CouncilDirection {
	items := append(slices.Clone(s.Directions), s.Kept...)
	if c.Mode == council.ModeBrainstorm {
		return items
	}
	return items[:min(TopReview, len(items))]
}

// Judge scores a done council's report against the case's key with one opus call and no tools. A call that fails, and a
// reply that does not hold the verdict JSON, are errors: the run is then not scored, never scored as nothing found. The
// returned Verdict carries the call's Tokens even then, so the spend of a failed judging still counts.
func Judge(ctx context.Context, c Case, report *council.Council) (Verdict, error) {
	if report == nil || report.Summary == nil {
		return Verdict{}, errors.New("the council has no summary to judge")
	}
	reply, tokens, err := askJudge(ctx, judgePrompt(c, report))
	if err != nil {
		return Verdict{Tokens: tokens}, err
	}
	v, err := parseVerdict(reply, c, report)
	v.Tokens = tokens // spent whether or not the reply could be read
	return v, err
}

// JudgeDesign scores a Brainstorm design's decisions against the case's key with one opus call and no tools, through
// the prompt and parser Judge uses, and shown the same way a Brainstorm council's report is: one list, every item
// judged. There is no cut, so a design that makes more decisions is not marked down for it and a match at any rank
// counts. No items is an error (there is nothing to judge); so are a failed call and a reply with no verdict, and the
// returned Verdict carries the call's Tokens even then.
func JudgeDesign(ctx context.Context, c Case, items []council.CouncilDirection) (Verdict, error) {
	if len(items) == 0 {
		return Verdict{}, errors.New("the design has no items to judge")
	}
	reply, tokens, err := askJudge(ctx, buildJudgePrompt(c, wholeList(items)))
	if err != nil {
		return Verdict{Tokens: tokens}, err
	}
	v, err := readVerdict(reply, c, len(items))
	v.Tokens = tokens
	return v, err
}

// wholeList is the judge's input for items judged as one list with nothing cut and no text around them: a design's
// decisions, and a Brainstorm council's directions and kept ideas.
func wholeList(items []council.CouncilDirection) judgeInput {
	return judgeInput{cut: fmt.Sprintf("judge all %d items", len(items)), items: items}
}

// askJudge is the one call to the judge model: no tools, and a folder of nobody's, so the judge reads the prompt and
// nothing of the project. It returns the reply and what the call consumed, which is known whether or not it succeeded.
func askJudge(ctx context.Context, prompt string) (string, int64, error) {
	callCtx, cancel := context.WithTimeout(ctx, judgeTimeout)
	defer cancel()
	reply, usage, err := runClaude(callCtx, os.TempDir(), prompt, consult.CallOpts{Model: judgeModel}, nil)
	tokens := int64(usage.TotalTokens)
	if err != nil {
		return "", tokens, fmt.Errorf("the judge's call failed: %w", err)
	}
	return reply, tokens, nil
}

// judgeInput is what one judging call shows the judge, apart from the key: a Review's report (Judge) and a list of items
// judged whole (wholeList) both come down to this.
type judgeInput struct {
	answer string                     // the report's answer, ahead of its items; a list judged whole has none
	text   string                     // the report's text, after the answer; a list judged whole has none
	cut    string                     // how many items the judge is told to judge, as the heading words it
	items  []council.CouncilDirection // what is judged, by rank in this list
}

// judgePrompt is the whole of the judge's input for a council's report: the rubric, the key and the report's items
// (judgedItems). A Brainstorm's are one list with no text around them, as a design's are; a Review's are its top five,
// built as Phase 0 built them: the Summary's answer and text, then each direction's rank, title and reasoning.
func judgePrompt(c Case, report *council.Council) string {
	s := report.Summary
	items := judgedItems(c, s)
	if c.Mode == council.ModeBrainstorm {
		return buildJudgePrompt(c, wholeList(items))
	}
	return buildJudgePrompt(c, judgeInput{
		answer: s.Answer,
		text:   s.Text,
		cut:    fmt.Sprintf("judge its first %d items only", TopReview),
		items:  items,
	})
}

// buildJudgePrompt writes the judge's prompt: the rubric, the key, then what in holds, then the shape of the reply.
func buildJudgePrompt(c Case, in judgeInput) string {
	var b strings.Builder
	b.WriteString("You are the judge of a benchmark. Below are an answer key and one report. Say which key lines the report names.\n\n")
	b.WriteString("Rubric: " + judgeRubric + ".\n\n")

	b.WriteString("Answer key:\n")
	for _, k := range c.KeyLines {
		fmt.Fprintf(&b, "%s: %s\n", k.Id, k.Text)
	}

	fmt.Fprintf(&b, "\nReport (%s):\n\n", in.cut)
	if a := strings.TrimSpace(in.answer); a != "" {
		fmt.Fprintf(&b, "Answer: %s\n\n", a)
	}
	if t := strings.TrimSpace(in.text); t != "" {
		b.WriteString(t + "\n\n")
	}
	b.WriteString("Items:\n")
	for i, d := range in.items {
		writeJudged(&b, i+1, d)
	}

	b.WriteString("\nReply with one JSON object and nothing else. ")
	b.WriteString(`"matches" maps every key line to the rank of the first item that names its problem, or null when none does. `)
	b.WriteString(`"items" gives one verdict per item.`)
	b.WriteString("\n")
	b.WriteString(`{"matches": {"K1": 1, "K2": null}, "items": [{"rank": 1, "verdict": "key:K1"}, {"rank": 2, "verdict": "valid"}, {"rank": 3, "verdict": "wrong"}]}`)
	b.WriteString("\n")
	return b.String()
}

// writeJudged is one numbered item: its title, then its reasoning indented under it.
func writeJudged(b *strings.Builder, n int, d council.CouncilDirection) {
	fmt.Fprintf(b, "%d. %s\n", n, strings.TrimSpace(d.Title))
	if r := strings.TrimSpace(d.Reasoning); r != "" {
		b.WriteString("   " + strings.ReplaceAll(r, "\n", "\n   ") + "\n")
	}
}

// verdictJSON is the shape of the judge's answer. A rank is a pointer so a null reads as no match.
type verdictJSON struct {
	Matches map[string]*int `json:"matches"`
	Items   []ItemVerdict   `json:"items"`
}

// decodeVerdict finds the verdict in a reply: the last JSON object that has a "matches" map, so prose around it, a
// fence and a stray brace in the prose are all passed over.
func decodeVerdict(reply string) (verdictJSON, bool) {
	var found verdictJSON
	ok := false
	for i := 0; i < len(reply); i++ {
		if reply[i] != '{' {
			continue
		}
		dec := json.NewDecoder(strings.NewReader(reply[i:]))
		var raw verdictJSON
		if err := dec.Decode(&raw); err != nil {
			continue
		}
		i += int(dec.InputOffset()) - 1 // past this object: what it holds is not another answer
		if raw.Matches != nil {
			found, ok = raw, true
		}
	}
	return found, ok
}

// parseVerdict reads the judge's reply to a council's report and keeps only what the case and the report can hold.
func parseVerdict(reply string, c Case, report *council.Council) (Verdict, error) {
	return readVerdict(reply, c, len(judgedItems(c, report.Summary)))
}

// readVerdict reads the judge's reply and keeps only what the case and the prompt can hold: a key line the case has and a
// rank among the shown items. A key line is matched at the lowest rank among the "matches" map and the items whose
// verdict is `key:<Kn>`, in any case, so a reply whose map and item list disagree still counts the earliest match.
func readVerdict(reply string, c Case, shown int) (Verdict, error) {
	raw, ok := decodeVerdict(reply)
	if !ok {
		return Verdict{}, fmt.Errorf("the judge's reply holds no verdict JSON (an object with a \"matches\" map): %s", abbreviate(reply))
	}
	known := map[string]string{} // lower-cased key line id -> the id as the case writes it
	for _, k := range c.KeyLines {
		known[strings.ToLower(k.Id)] = k.Id
	}

	v := Verdict{Matches: map[string]int{}, Judged: shown}
	match := func(id string, rank int) {
		key, ok := known[strings.ToLower(strings.TrimSpace(id))]
		if !ok || rank < 1 || rank > shown {
			return
		}
		if have, seen := v.Matches[key]; !seen || rank < have {
			v.Matches[key] = rank
		}
	}
	for id, rank := range raw.Matches {
		if rank != nil {
			match(id, *rank)
		}
	}
	for _, it := range raw.Items {
		if it.Rank < 1 || it.Rank > shown {
			continue
		}
		verdict := strings.TrimSpace(it.Verdict)
		v.Items = append(v.Items, ItemVerdict{Rank: it.Rank, Verdict: verdict})
		if len(verdict) >= len(keyVerdictPrefix) && strings.EqualFold(verdict[:len(keyVerdictPrefix)], keyVerdictPrefix) {
			match(verdict[len(keyVerdictPrefix):], it.Rank)
		}
	}
	return v, nil
}

// keyVerdictPrefix starts the verdict of an item that names a key line: `key:K1`.
const keyVerdictPrefix = "key:"

// abbreviate is a reply cut to one line for an error message.
func abbreviate(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > 200 {
		s = string(r[:200]) + "…"
	}
	return s
}
