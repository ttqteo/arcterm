// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"strings"
)

// Each parser takes the model's whole reply, finds the JSON in it and reads the shape prompts.go asks for. The
// parsers set no Id, Author, Ts or At: the runner owns those.

// noEvidenceNote is the note on the weak chip a round 1 proposal gets when it cites nothing.
const noEvidenceNote = "cites no evidence"

// Round2Stance is one expert's position on another expert's proposal. Builds is a Brainstorm's "builds on it": Reason
// then holds what the expert adds to the idea.
type Round2Stance struct {
	ProposalId string
	Stance     CouncilStance
	Reason     string
	Evidence   []CouncilEvidence
	Builds     bool
}

// Round2Revision is an expert's change to one of its own proposals; Withdraw leaves Title, Argument and Change empty.
// Change is the expert's one line on what it changed and why, and may be empty.
type Round2Revision struct {
	ProposalId string
	Withdraw   bool
	Title      string
	Argument   string
	Change     string
}

// Answer is an expert's answer to one of the person's replies. Stance is empty when the expert does not take one.
type Answer struct {
	ReplyId  string
	Text     string
	Stance   CouncilStance
	Evidence []CouncilEvidence
}

// Round2Result is everything an expert's round 2 reply holds.
type Round2Result struct {
	Stances   []Round2Stance
	Revisions []Round2Revision
	Answers   []Answer
	Picks     []string // up to maxPicks proposal ids, best first; applyRound2 checks them
}

// maxPicks is how many of the others' proposals an expert names in round 2.
const maxPicks = 3

// maxDirections is how many directions a report holds in full: a Brainstorm's ideas worth trying, a Review's directions
// (the rest of a Review's go under Also raised, one line each).
const maxDirections = 3

// WeakNote is the coordinator's remark that a claim does not hold up. Ref names a proposal id, a reply id or an
// evidence ref; MarkWeak applies it.
type WeakNote struct {
	Ref  string `json:"ref"`
	Note string `json:"note"`
}

// evidenceList reads evidence as the prompts ask for it, [{"ref": "path:line"}], and also as bare strings, which
// models write often enough that failing the whole reply over it would only cost a retry.
type evidenceList []CouncilEvidence

func (l *evidenceList) UnmarshalJSON(b []byte) error {
	var raw []json.RawMessage
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	out := make([]CouncilEvidence, 0, len(raw))
	for _, r := range raw {
		var ref string
		if err := json.Unmarshal(r, &ref); err != nil {
			var obj struct {
				Ref string `json:"ref"`
			}
			if err := json.Unmarshal(r, &obj); err != nil {
				return fmt.Errorf("evidence item is neither a string nor an object: %s", r)
			}
			ref = obj.Ref
		}
		if ref = strings.TrimSpace(ref); ref != "" { // an item that cites nothing is no evidence
			out = append(out, CouncilEvidence{Ref: ref})
		}
	}
	*l = out
	return nil
}

// extractJSON returns the JSON the model ended its reply with: the last ```json fence, or, when the reply has no such
// fence, the last top-level object that is valid JSON.
func extractJSON(reply string) ([]byte, bool) {
	if b, ok := lastJSONFence(reply); ok {
		return b, true
	}
	return lastObject(reply)
}

// lastJSONFence returns the body of the last ```json fence. A fence the reply never closed (it was cut off) counts to
// the end of the text; the caller then sees invalid JSON and says so.
func lastJSONFence(reply string) ([]byte, bool) {
	var (
		last   []string
		cur    []string
		inJSON bool
		inFree bool // inside a fence of another language
		found  bool
	)
	for line := range strings.SplitSeq(reply, "\n") {
		t := strings.TrimSpace(line)
		switch {
		case !inJSON && !inFree && strings.HasPrefix(t, "```"):
			if strings.EqualFold(strings.TrimSpace(strings.TrimPrefix(t, "```")), "json") {
				inJSON, cur = true, nil
			} else {
				inFree = true
			}
		case inFree && t == "```":
			inFree = false
		case inJSON && t == "```":
			inJSON, found, last = false, true, cur
		case inJSON:
			cur = append(cur, line)
		}
	}
	if inJSON {
		found, last = true, cur
	}
	if !found {
		return nil, false
	}
	return []byte(strings.Join(last, "\n")), true
}

// lastObject scans left to right, reads a JSON object wherever a `{` starts one and skips past it, so what it keeps
// is the last top-level object and a stray brace in the prose is passed over.
func lastObject(reply string) ([]byte, bool) {
	var last []byte
	for i := 0; i < len(reply); i++ {
		if reply[i] != '{' {
			continue
		}
		dec := json.NewDecoder(strings.NewReader(reply[i:]))
		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			continue
		}
		last = raw
		i += int(dec.InputOffset()) - 1
	}
	return last, last != nil
}

// decodeReply finds the reply's JSON and decodes it into v. what names the round for the error.
func decodeReply(reply, what string, v any) error {
	b, ok := extractJSON(reply)
	if !ok {
		return fmt.Errorf("%s reply has no JSON block", what)
	}
	if err := json.Unmarshal(b, v); err != nil {
		return fmt.Errorf("%s reply: %w", what, err)
	}
	return nil
}

func parseStance(word string) (CouncilStance, error) {
	switch s := CouncilStance(strings.ToLower(strings.TrimSpace(word))); s {
	case StanceAccept, StanceChallenge, StanceOppose:
		return s, nil
	}
	return "", fmt.Errorf("unknown stance %q", word)
}

// ParseRound1 reads a round 1 reply into the expert's proposals and its overall view. A proposal that cites no
// evidence gets one weak chip saying so; the runner takes that chip off a Brainstorm's ideas, which need none. A
// proposal's wild flag is a Brainstorm's, and the runner clears it in a Review.
func ParseRound1(reply string) ([]CouncilProposal, string, error) {
	const what = "round 1"
	var r struct {
		Overview  string `json:"overview"`
		Proposals *[]struct {
			Title    string       `json:"title"`
			Argument string       `json:"argument"`
			Evidence evidenceList `json:"evidence"`
			Wild     bool         `json:"wild"`
		} `json:"proposals"`
	}
	if err := decodeReply(reply, what, &r); err != nil {
		return nil, "", err
	}
	if r.Proposals == nil {
		return nil, "", fmt.Errorf("%s reply has no proposals field", what)
	}
	out := make([]CouncilProposal, 0, len(*r.Proposals))
	for i, p := range *r.Proposals {
		if strings.TrimSpace(p.Title) == "" {
			return nil, "", fmt.Errorf("%s reply: proposal %d has no title", what, i+1)
		}
		ev := []CouncilEvidence(p.Evidence)
		if len(ev) == 0 {
			ev = []CouncilEvidence{{Weak: true, Note: noEvidenceNote}}
		}
		out = append(out, CouncilProposal{
			Title:    strings.TrimSpace(p.Title),
			Argument: strings.TrimSpace(p.Argument),
			Evidence: ev,
			Wild:     p.Wild,
		})
	}
	return out, strings.TrimSpace(r.Overview), nil
}

// answerEntry is the wire form of an Answer, shared by round 2 and the answers pass.
type answerEntry struct {
	ReplyId  string       `json:"replyid"`
	Text     string       `json:"text"`
	Stance   string       `json:"stance"`
	Evidence evidenceList `json:"evidence"`
}

func convertAnswers(what string, in []answerEntry) ([]Answer, error) {
	out := make([]Answer, 0, len(in))
	for _, a := range in {
		if strings.TrimSpace(a.ReplyId) == "" || strings.TrimSpace(a.Text) == "" {
			return nil, fmt.Errorf("%s reply: an answer needs a replyid and a text", what)
		}
		ans := Answer{ReplyId: strings.TrimSpace(a.ReplyId), Text: strings.TrimSpace(a.Text), Evidence: a.Evidence}
		if strings.TrimSpace(a.Stance) != "" {
			s, err := parseStance(a.Stance)
			if err != nil {
				return nil, fmt.Errorf("%s reply: answer to %s: %w", what, ans.ReplyId, err)
			}
			ans.Stance = s
		}
		out = append(out, ans)
	}
	return out, nil
}

// ParseRound2 reads a cross-review reply: a stance on each proposal reviewed, revisions of the expert's own, and
// answers to the person's replies. Only the stances field is required. A stance's builds flag is a Brainstorm's.
func ParseRound2(reply string) (Round2Result, error) {
	const what = "round 2"
	var r struct {
		Stances *[]struct {
			ProposalId string       `json:"proposalid"`
			Stance     string       `json:"stance"`
			Reason     string       `json:"reason"`
			Evidence   evidenceList `json:"evidence"`
			Builds     bool         `json:"builds"`
		} `json:"stances"`
		Revisions []struct {
			ProposalId string `json:"proposalid"`
			Withdraw   bool   `json:"withdraw"`
			Title      string `json:"title"`
			Argument   string `json:"argument"`
			Change     string `json:"change"`
		} `json:"revisions"`
		Answers []answerEntry `json:"answers"`
		Picks   []string      `json:"picks"`
	}
	if err := decodeReply(reply, what, &r); err != nil {
		return Round2Result{}, err
	}
	if r.Stances == nil {
		return Round2Result{}, fmt.Errorf("%s reply has no stances field", what)
	}
	res := Round2Result{
		Stances:   make([]Round2Stance, 0, len(*r.Stances)),
		Revisions: make([]Round2Revision, 0, len(r.Revisions)),
	}
	for _, s := range *r.Stances {
		if strings.TrimSpace(s.ProposalId) == "" {
			return Round2Result{}, fmt.Errorf("%s reply: a stance has no proposalid", what)
		}
		stance, err := parseStance(s.Stance)
		if err != nil {
			return Round2Result{}, fmt.Errorf("%s reply: stance on %s: %w", what, s.ProposalId, err)
		}
		res.Stances = append(res.Stances, Round2Stance{
			ProposalId: strings.TrimSpace(s.ProposalId),
			Stance:     stance,
			Reason:     strings.TrimSpace(s.Reason),
			Evidence:   s.Evidence,
			Builds:     s.Builds,
		})
	}
	for _, rv := range r.Revisions {
		if strings.TrimSpace(rv.ProposalId) == "" {
			return Round2Result{}, fmt.Errorf("%s reply: a revision has no proposalid", what)
		}
		out := Round2Revision{ProposalId: strings.TrimSpace(rv.ProposalId), Withdraw: rv.Withdraw}
		if !rv.Withdraw {
			out.Title, out.Argument, out.Change = strings.TrimSpace(rv.Title), strings.TrimSpace(rv.Argument), strings.TrimSpace(rv.Change)
			if out.Title == "" && out.Argument == "" {
				return Round2Result{}, fmt.Errorf("%s reply: revision of %s changes nothing and does not withdraw it", what, out.ProposalId)
			}
		}
		res.Revisions = append(res.Revisions, out)
	}
	answers, err := convertAnswers(what, r.Answers)
	if err != nil {
		return Round2Result{}, err
	}
	res.Answers = answers
	for _, id := range r.Picks {
		if id = strings.TrimSpace(id); id != "" && !slices.Contains(res.Picks, id) && len(res.Picks) < maxPicks {
			res.Picks = append(res.Picks, id)
		}
	}
	return res, nil
}

// ParseAnswers reads one expert's answers to the person's replies: the pass after the synthesis, and a follow-up.
func ParseAnswers(reply string) ([]Answer, error) {
	const what = "answers"
	var r struct {
		Answers *[]answerEntry `json:"answers"`
	}
	if err := decodeReply(reply, what, &r); err != nil {
		return nil, err
	}
	if r.Answers == nil {
		return nil, fmt.Errorf("%s reply has no answers field", what)
	}
	return convertAnswers(what, *r.Answers)
}

// ParseSynthesis reads the coordinator's round 3 reply into the Summary (its At left for the runner) and the weak
// notes. Directions come back ranked 1..n; a direction's Agreed is the coordinator's word, or, when it gave none,
// true when no expert challenges or opposes it. A Brainstorm's reply adds each direction's first step and the wild
// ideas kept aside, numbered 1..n; a kept idea with no title is skipped, since it names nothing.
func ParseSynthesis(reply string) (CouncilSummary, []WeakNote, error) {
	const what = "round 3"
	var r struct {
		Text       string `json:"text"`
		Directions *[]struct {
			Rank      int               `json:"rank"`
			Title     string            `json:"title"`
			Reasoning string            `json:"reasoning"`
			FirstStep string            `json:"firststep"`
			From      []string          `json:"from"`
			Stances   map[string]string `json:"stances"`
			Agreed    *bool             `json:"agreed"`
		} `json:"directions"`
		Kept []struct {
			Title     string   `json:"title"`
			Reasoning string   `json:"reasoning"`
			From      []string `json:"from"`
		} `json:"kept"`
		Outcomes map[string]string `json:"outcomes"`
		Answer   string            `json:"answer"`
		Weak     []WeakNote        `json:"weak"`
	}
	if err := decodeReply(reply, what, &r); err != nil {
		return CouncilSummary{}, nil, err
	}
	if r.Directions == nil {
		return CouncilSummary{}, nil, fmt.Errorf("%s reply has no directions field", what)
	}
	dirs := make([]CouncilDirection, 0, len(*r.Directions))
	ranked := true
	for i, d := range *r.Directions {
		if strings.TrimSpace(d.Title) == "" {
			return CouncilSummary{}, nil, fmt.Errorf("%s reply: direction %d has no title", what, i+1)
		}
		if d.Rank <= 0 {
			ranked = false
		}
		out := CouncilDirection{
			Rank:      d.Rank,
			Title:     strings.TrimSpace(d.Title),
			Reasoning: strings.TrimSpace(d.Reasoning),
			FirstStep: strings.TrimSpace(d.FirstStep),
			From:      append([]string{}, d.From...),
			Stances:   map[string]CouncilStance{},
		}
		split := false
		for expert, word := range d.Stances {
			s, err := parseStance(word)
			if err != nil {
				return CouncilSummary{}, nil, fmt.Errorf("%s reply: direction %q, %s: %w", what, out.Title, expert, err)
			}
			out.Stances[expert] = s
			split = split || s != StanceAccept
		}
		out.Agreed = !split
		if d.Agreed != nil {
			out.Agreed = *d.Agreed
		}
		dirs = append(dirs, out)
	}
	if ranked {
		sort.SliceStable(dirs, func(i, j int) bool { return dirs[i].Rank < dirs[j].Rank })
	}
	for i := range dirs {
		dirs[i].Rank = i + 1
	}
	outcomes := r.Outcomes
	if outcomes == nil {
		outcomes = map[string]string{}
	}
	var weak []WeakNote
	for _, w := range r.Weak {
		if w.Ref = strings.TrimSpace(w.Ref); w.Ref != "" {
			w.Note = strings.TrimSpace(w.Note)
			weak = append(weak, w)
		}
	}
	var kept []CouncilDirection
	for _, k := range r.Kept {
		title := strings.TrimSpace(k.Title)
		if title == "" {
			continue
		}
		kept = append(kept, CouncilDirection{
			Rank:      len(kept) + 1,
			Title:     title,
			Reasoning: strings.TrimSpace(k.Reasoning),
			From:      append([]string{}, k.From...),
			Stances:   map[string]CouncilStance{},
		})
	}
	return CouncilSummary{Text: strings.TrimSpace(r.Text), Directions: dirs, Kept: kept, Outcomes: outcomes, Answer: strings.TrimSpace(r.Answer)}, weak, nil
}

// MarkWeak applies the synthesis's weak notes to c. A note whose ref is the ref of some evidence marks that evidence
// weak; one whose ref is a proposal or reply id adds a weak chip to it. A ref that matches nothing is skipped, and
// so is a note already on the claim, so applying the same notes again changes nothing.
func MarkWeak(c *Council, notes []WeakNote) {
	for _, n := range notes {
		if markEvidence(c, n) {
			continue
		}
		for i := range c.Proposals {
			if p := &c.Proposals[i]; p.Id == n.Ref {
				p.Evidence = addWeak(p.Evidence, n.Note)
			}
		}
		for i := range c.Replies {
			if r := &c.Replies[i]; r.Id == n.Ref {
				r.Evidence = addWeak(r.Evidence, n.Note)
			}
		}
	}
}

func markEvidence(c *Council, n WeakNote) bool {
	hit := false
	mark := func(ev []CouncilEvidence) {
		for i := range ev {
			if ev[i].Ref == n.Ref {
				ev[i].Weak, ev[i].Note, hit = true, n.Note, true
			}
		}
	}
	for i := range c.Proposals {
		mark(c.Proposals[i].Evidence)
	}
	for i := range c.Replies {
		mark(c.Replies[i].Evidence)
	}
	return hit
}

func addWeak(ev []CouncilEvidence, note string) []CouncilEvidence {
	for _, e := range ev {
		if e.Weak && e.Note == note {
			return ev
		}
	}
	return append(ev, CouncilEvidence{Weak: true, Note: note})
}
