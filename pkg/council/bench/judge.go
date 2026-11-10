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

// How many of a report's items are judged: the same cut for every variant, so a variant that writes a longer list gains
// nothing by it.
const (
	TopReview     = 5
	TopBrainstorm = 3
)

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

// Verdict is what the judge said of one report. Matches and Kept hold only the key lines something matched, each with
// the rank of the item that matched it (a null in the judge's answer is no match); both are cut down to what the report
// can hold, so a rank past the cut or a key line the case does not have is not counted.
type Verdict struct {
	Matches map[string]int // key line id -> rank among the top items
	Kept    map[string]int // Brainstorm: key line id -> rank among the wild ideas kept aside
	Items   []ItemVerdict  // one per top item
	Tokens  int64          // what the judge's call consumed, so a bench's spend counts it
}

// Recall is the key lines the top items matched.
func (v Verdict) Recall() int { return len(v.Matches) }

// KeptMatched is the key lines the wild ideas kept aside matched. They sit in a column of their own, outside recall.
func (v Verdict) KeptMatched() int { return len(v.Kept) }

// Wrong is the top items the judge called wrong.
func (v Verdict) Wrong() int {
	n := 0
	for _, it := range v.Items {
		if strings.EqualFold(strings.TrimSpace(it.Verdict), "wrong") {
			n++
		}
	}
	return n
}

// topItems is how many of a case's report items are judged.
func topItems(c Case) int {
	if c.Mode == council.ModeBrainstorm {
		return TopBrainstorm
	}
	return TopReview
}

// judgedItems is the report's items the judge scores, cut at topItems: the directions, then for a Review its Also
// raised, which holds the directions past the first three, so a Review is judged on the same five items as before the
// cap. A Brainstorm's Kept is judged apart.
func judgedItems(c Case, s *council.CouncilSummary) []council.CouncilDirection {
	items := s.Directions
	if c.Mode != council.ModeBrainstorm {
		items = append(slices.Clone(s.Directions), s.Kept...)
	}
	return items[:min(topItems(c), len(items))]
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
// the prompt and parser Judge uses. Every item given is judged: there is no cut at TopBrainstorm and no Kept list, so a
// design that makes more decisions is not marked down for it and a match at any rank counts. No items is an error
// (there is nothing to judge); so are a failed call and a reply with no verdict, and the returned Verdict carries the
// call's Tokens even then.
func JudgeDesign(ctx context.Context, c Case, items []council.CouncilDirection) (Verdict, error) {
	if len(items) == 0 {
		return Verdict{}, errors.New("the design has no items to judge")
	}
	in := judgeInput{
		cut:   fmt.Sprintf("judge all %d items", len(items)),
		items: items,
	}
	reply, tokens, err := askJudge(ctx, buildJudgePrompt(c, in))
	if err != nil {
		return Verdict{Tokens: tokens}, err
	}
	v, err := readVerdict(reply, c, len(items), 0)
	v.Tokens = tokens
	return v, err
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

// judgeInput is what one judging call shows the judge, apart from the key: a council's report (Judge) and a design's
// decisions (JudgeDesign) both come down to this.
type judgeInput struct {
	answer string                     // the report's answer, ahead of its items; a design has none
	text   string                     // the report's text, after the answer; a design has none
	cut    string                     // how many items the judge is told to judge, as the heading words it
	items  []council.CouncilDirection // what is judged, by rank in this list
	kept   []council.CouncilDirection // wild ideas judged apart from items, by rank in this list
	// askKept asks for a "kept" answer: a Brainstorm council's judge is asked for one even when nothing was kept, a
	// design's never
	askKept bool
}

// judgePrompt is the whole of the judge's input for a council's report: the rubric, the key, the report cut to its top
// items (judgedItems), and for a Brainstorm the Kept list apart from them. The report is built as Phase 0 built it: the
// Summary's answer and text, then each direction's rank, title and reasoning.
func judgePrompt(c Case, report *council.Council) string {
	s := report.Summary
	brainstorm := c.Mode == council.ModeBrainstorm
	in := judgeInput{
		answer:  s.Answer,
		text:    s.Text,
		cut:     fmt.Sprintf("judge its first %d items only", topItems(c)),
		items:   judgedItems(c, s),
		askKept: brainstorm,
	}
	if brainstorm {
		in.kept = s.Kept
	}
	return buildJudgePrompt(c, in)
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
	if len(in.kept) > 0 {
		b.WriteString("\nWild ideas kept aside (not part of the items above; judge them apart, by their rank in this list):\n")
		for i, d := range in.kept {
			writeJudged(&b, i+1, d)
		}
	}

	b.WriteString("\nReply with one JSON object and nothing else. ")
	b.WriteString(`"matches" maps every key line to the rank of the item that names its problem, or null when none does. `)
	b.WriteString(`"items" gives one verdict per item.`)
	if in.askKept {
		b.WriteString(` "kept" does what "matches" does for the wild ideas kept aside, by their rank in that list, and holds only the key lines one of them names.`)
	}
	b.WriteString("\n")
	if in.askKept {
		b.WriteString(`{"matches": {"K1": 1, "K2": null}, "kept": {"K3": 1}, "items": [{"rank": 1, "verdict": "key:K1"}, {"rank": 2, "verdict": "valid"}, {"rank": 3, "verdict": "wrong"}]}`)
	} else {
		b.WriteString(`{"matches": {"K1": 1, "K2": null}, "items": [{"rank": 1, "verdict": "key:K1"}, {"rank": 2, "verdict": "valid"}, {"rank": 3, "verdict": "wrong"}]}`)
	}
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
	Kept    map[string]*int `json:"kept"`
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
	keptShown := 0 // only a Brainstorm report has a Kept list to judge
	if c.Mode == council.ModeBrainstorm {
		keptShown = len(report.Summary.Kept)
	}
	return readVerdict(reply, c, len(judgedItems(c, report.Summary)), keptShown)
}

// readVerdict reads the judge's reply and keeps only what the case and the prompt can hold: a key line the case has, a
// rank among the shown items and, for a kept match, among the keptShown ideas judged apart (none: no kept match counts).
func readVerdict(reply string, c Case, shown, keptShown int) (Verdict, error) {
	raw, ok := decodeVerdict(reply)
	if !ok {
		return Verdict{}, fmt.Errorf("the judge's reply holds no verdict JSON (an object with a \"matches\" map): %s", abbreviate(reply))
	}
	known := map[string]bool{}
	for _, k := range c.KeyLines {
		known[k.Id] = true
	}

	v := Verdict{Matches: map[string]int{}, Kept: map[string]int{}}
	for id, rank := range raw.Matches {
		if rank != nil && known[id] && *rank >= 1 && *rank <= shown {
			v.Matches[id] = *rank
		}
	}
	for id, rank := range raw.Kept {
		if rank != nil && known[id] && *rank >= 1 && *rank <= keptShown {
			v.Kept[id] = *rank
		}
	}
	for _, it := range raw.Items {
		if it.Rank >= 1 && it.Rank <= shown {
			v.Items = append(v.Items, ItemVerdict{Rank: it.Rank, Verdict: strings.TrimSpace(it.Verdict)})
		}
	}
	return v, nil
}

// abbreviate is a reply cut to one line for an error message.
func abbreviate(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > 200 {
		s = string(r[:200]) + "…"
	}
	return s
}
