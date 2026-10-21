// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"reflect"
	"strings"
	"testing"
)

func jsonFence(body string) string {
	return "My review follows.\n\n```json\n" + body + "\n```\n"
}

func TestExtractJSONTakesTheLastJSONFence(t *testing.T) {
	reply := "First I thought:\n```json\n{\"n\": 1}\n```\nBut on reflection:\n```json\n{\"n\": 2}\n```\nDone."
	b, ok := extractJSON(reply)
	if !ok || strings.TrimSpace(string(b)) != `{"n": 2}` {
		t.Fatalf("extractJSON = %q, %v; want the last fence", b, ok)
	}
}

func TestExtractJSONLeavesOtherFencesAlone(t *testing.T) {
	reply := "```json\n{\"n\": 1}\n```\nThe code is:\n```go\nfunc f() { return }\n```\n```text\n{\"n\": 9}\n```\n"
	b, ok := extractJSON(reply)
	if !ok || strings.TrimSpace(string(b)) != `{"n": 1}` {
		t.Fatalf("extractJSON = %q, %v; want the json fence, not the go or text ones", b, ok)
	}
}

func TestExtractJSONWithoutAFenceTakesTheLastTopLevelObject(t *testing.T) {
	reply := `Use { to open a block. {"n": 1} was my first draft, {"n": 2, "in": {"deep": "}"}} is my answer. Note {x}.`
	b, ok := extractJSON(reply)
	if !ok || string(b) != `{"n": 2, "in": {"deep": "}"}}` {
		t.Fatalf("extractJSON = %q, %v; want the last top-level object, a stray brace and a nested one passed over", b, ok)
	}
}

func TestExtractJSONNothing(t *testing.T) {
	if b, ok := extractJSON("I could not find anything {worth} saying."); ok {
		t.Fatalf("extractJSON found %q in a reply with no JSON", b)
	}
}

func TestExtractJSONUnclosedFenceIsTheRestOfTheReply(t *testing.T) {
	b, ok := extractJSON("```json\n{\"n\": 1")
	if !ok || strings.TrimSpace(string(b)) != `{"n": 1` {
		t.Fatalf("extractJSON = %q, %v; want the cut-off body, for the parser to reject", b, ok)
	}
}

func TestParsersNameTheRoundWhenThereIsNoJSON(t *testing.T) {
	const prose = "I have no opinion."
	_, _, err1 := ParseRound1(prose)
	_, err2 := ParseRound2(prose)
	_, _, err3 := ParseSynthesis(prose)
	_, err4 := ParseAnswers(prose)
	for _, c := range []struct {
		err  error
		want string
	}{{err1, "round 1"}, {err2, "round 2"}, {err3, "round 3"}, {err4, "answers"}} {
		if c.err == nil || !strings.Contains(c.err.Error(), c.want) {
			t.Errorf("error = %v, want one naming %q", c.err, c.want)
		}
	}
}

func TestParseRound1(t *testing.T) {
	reply := jsonFence(`{
	  "overview": "  It works, but it is slow. ",
	  "proposals": [
	    {"title": "Sleep sooner", "argument": "Saves RAM", "evidence": [{"ref": "pkg/services/idle.go:12"}, "screenshot:a.png#top", {"ref": "  "}]},
	    {"title": "Show the sleep state", "argument": "People wonder", "evidence": []}
	  ]
	}`)
	props, overview, err := ParseRound1(reply)
	if err != nil {
		t.Fatal(err)
	}
	if overview != "It works, but it is slow." {
		t.Errorf("overview = %q", overview)
	}
	want := []CouncilProposal{
		{Title: "Sleep sooner", Argument: "Saves RAM", Evidence: []CouncilEvidence{{Ref: "pkg/services/idle.go:12"}, {Ref: "screenshot:a.png#top"}}},
		{Title: "Show the sleep state", Argument: "People wonder", Evidence: []CouncilEvidence{{Weak: true, Note: "cites no evidence"}}},
	}
	if !reflect.DeepEqual(props, want) {
		t.Errorf("proposals = %+v\nwant %+v", props, want)
	}
}

func TestParseRound1GivesAProposalWithNoEvidenceFieldTheWeakChip(t *testing.T) {
	props, _, err := ParseRound1(jsonFence(`{"overview": "", "proposals": [{"title": "T", "argument": "A"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if want := []CouncilEvidence{{Weak: true, Note: "cites no evidence"}}; !reflect.DeepEqual(props[0].Evidence, want) {
		t.Errorf("evidence = %+v, want %+v", props[0].Evidence, want)
	}
}

func TestParseRound1NoProposalsIsFine(t *testing.T) {
	props, overview, err := ParseRound1(jsonFence(`{"overview": "nothing to change", "proposals": []}`))
	if err != nil || len(props) != 0 || overview != "nothing to change" {
		t.Fatalf("got %v, %q, %v", props, overview, err)
	}
}

func TestParseRound1Rejects(t *testing.T) {
	for name, body := range map[string]string{
		"no proposals field":         `{"overview": "x"}`,
		"a proposal without a title": `{"proposals": [{"title": " ", "argument": "A"}]}`,
		"invalid JSON":               `{"proposals": [`,
		"evidence of a number":       `{"proposals": [{"title": "T", "evidence": [7]}]}`,
	} {
		if _, _, err := ParseRound1(jsonFence(body)); err == nil || !strings.Contains(err.Error(), "round 1") {
			t.Errorf("%s: error = %v, want one naming round 1", name, err)
		}
	}
}

func TestParseRound2(t *testing.T) {
	reply := jsonFence(`{
	  "stances": [
	    {"proposalid": "P2", "stance": "Challenge", "reason": " Costs RAM. ", "evidence": [{"ref": "a.go:1"}]},
	    {"proposalid": "P3", "stance": "accept", "reason": "Fine."}
	  ],
	  "revisions": [
	    {"proposalid": "P1", "withdraw": false, "title": "New title", "argument": "New argument"},
	    {"proposalid": "P4", "withdraw": true}
	  ],
	  "answers": [{"replyid": "r2", "text": "Because it saves RAM."}]
	}`)
	got, err := ParseRound2(reply)
	if err != nil {
		t.Fatal(err)
	}
	want := Round2Result{
		Stances: []Round2Stance{
			{ProposalId: "P2", Stance: StanceChallenge, Reason: "Costs RAM.", Evidence: []CouncilEvidence{{Ref: "a.go:1"}}},
			{ProposalId: "P3", Stance: StanceAccept, Reason: "Fine."},
		},
		Revisions: []Round2Revision{
			{ProposalId: "P1", Title: "New title", Argument: "New argument"},
			{ProposalId: "P4", Withdraw: true},
		},
		Answers: []Answer{{ReplyId: "r2", Text: "Because it saves RAM."}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v\nwant %+v", got, want)
	}
}

func TestParseRound2OnlyStancesIsEnough(t *testing.T) {
	got, err := ParseRound2(jsonFence(`{"stances": []}`))
	if err != nil || len(got.Stances) != 0 || len(got.Revisions) != 0 || len(got.Answers) != 0 {
		t.Fatalf("got %+v, %v", got, err)
	}
}

func TestParseRound2Rejects(t *testing.T) {
	for name, body := range map[string]string{
		"an unknown stance word":       `{"stances": [{"proposalid": "P2", "stance": "maybe"}]}`,
		"an empty stance":              `{"stances": [{"proposalid": "P2", "stance": ""}]}`,
		"a stance with no proposal":    `{"stances": [{"stance": "accept"}]}`,
		"no stances field":             `{"answers": []}`,
		"a revision that does nothing": `{"stances": [], "revisions": [{"proposalid": "P1"}]}`,
		"an answer with no text":       `{"stances": [], "answers": [{"replyid": "r1"}]}`,
		"an answer with a bad stance":  `{"stances": [], "answers": [{"replyid": "r1", "text": "x", "stance": "meh"}]}`,
	} {
		if _, err := ParseRound2(jsonFence(body)); err == nil || !strings.Contains(err.Error(), "round 2") {
			t.Errorf("%s: error = %v, want one naming round 2", name, err)
		}
	}
	_, err := ParseRound2(jsonFence(`{"stances": [{"proposalid": "P2", "stance": "maybe"}]}`))
	if err == nil || !strings.Contains(err.Error(), `"maybe"`) {
		t.Errorf("error = %v, want one quoting the unknown stance word", err)
	}
}

func TestParseAnswers(t *testing.T) {
	got, err := ParseAnswers(jsonFence(`{"answers": [
	  {"replyid": "r3", "text": "Yes.", "stance": "accept", "evidence": ["a.go:3"]},
	  {"replyid": "r4", "text": "No."}
	]}`))
	if err != nil {
		t.Fatal(err)
	}
	want := []Answer{
		{ReplyId: "r3", Text: "Yes.", Stance: StanceAccept, Evidence: []CouncilEvidence{{Ref: "a.go:3"}}},
		{ReplyId: "r4", Text: "No."},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v\nwant %+v", got, want)
	}
	if _, err := ParseAnswers(jsonFence(`{"stances": []}`)); err == nil {
		t.Error("a reply with no answers field was accepted")
	}
}

const synthesisReply = `{
  "text": " The panel prefers sleeping sooner. ",
  "directions": [
    {"rank": 2, "title": "Show the state", "reasoning": "People wonder", "from": ["P2"], "stances": {"ux": "accept", "ram": "accept"}},
    {"rank": 1, "title": "Sleep sooner", "reasoning": "Saves RAM", "from": ["P1", "P3"], "stances": {"ux": "accept", "skeptic": "Challenge"}},
    {"rank": 3, "title": "Drop it", "from": ["P4"], "stances": {"ux": "oppose"}, "agreed": true}
  ],
  "outcomes": {"P1": "Direction 1", "P2": "Direction 2", "P3": "Merged into direction 1", "P4": "Withdrawn in round 2"},
  "weak": [{"ref": "P3", "note": " \"about 3 s\" has no measurement "}, {"ref": "  ", "note": "dropped"}]
}`

func TestParseSynthesis(t *testing.T) {
	sum, weak, err := ParseSynthesis(jsonFence(synthesisReply))
	if err != nil {
		t.Fatal(err)
	}
	if sum.Text != "The panel prefers sleeping sooner." || sum.At != 0 {
		t.Errorf("text = %q, at = %d", sum.Text, sum.At)
	}
	want := []CouncilDirection{
		{Rank: 1, Title: "Sleep sooner", Reasoning: "Saves RAM", From: []string{"P1", "P3"},
			Stances: map[string]CouncilStance{"ux": StanceAccept, "skeptic": StanceChallenge}, Agreed: false},
		{Rank: 2, Title: "Show the state", Reasoning: "People wonder", From: []string{"P2"},
			Stances: map[string]CouncilStance{"ux": StanceAccept, "ram": StanceAccept}, Agreed: true},
		{Rank: 3, Title: "Drop it", From: []string{"P4"},
			Stances: map[string]CouncilStance{"ux": StanceOppose}, Agreed: true}, // the coordinator's word stands
	}
	if !reflect.DeepEqual(sum.Directions, want) {
		t.Errorf("directions = %+v\nwant %+v", sum.Directions, want)
	}
	if sum.Outcomes["P3"] != "Merged into direction 1" || len(sum.Outcomes) != 4 {
		t.Errorf("outcomes = %v", sum.Outcomes)
	}
	if wantWeak := []WeakNote{{Ref: "P3", Note: `"about 3 s" has no measurement`}}; !reflect.DeepEqual(weak, wantWeak) {
		t.Errorf("weak = %+v, want %+v", weak, wantWeak)
	}
}

func TestParseSynthesisRenumbersWithoutRanks(t *testing.T) {
	sum, _, err := ParseSynthesis(jsonFence(`{"directions": [{"title": "B"}, {"title": "A"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(sum.Directions) != 2 || sum.Directions[0].Title != "B" || sum.Directions[0].Rank != 1 || sum.Directions[1].Rank != 2 {
		t.Errorf("directions = %+v, want the given order numbered 1, 2", sum.Directions)
	}
}

func TestParseSynthesisFillsTheMapsAndSlices(t *testing.T) {
	sum, weak, err := ParseSynthesis(jsonFence(`{"text": "x", "directions": [{"title": "A"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	d := sum.Directions[0]
	if d.From == nil || d.Stances == nil || sum.Outcomes == nil || weak != nil {
		t.Errorf("From %v, Stances %v, Outcomes %v, weak %v: the record's arrays and maps must not be null on the wire", d.From, d.Stances, sum.Outcomes, weak)
	}
	if !d.Agreed {
		t.Error("a direction nobody challenges was not Agreed")
	}
	empty, _, err := ParseSynthesis(jsonFence(`{"text": "nothing", "directions": []}`))
	if err != nil || empty.Directions == nil || len(empty.Directions) != 0 {
		t.Errorf("empty directions = %v, %v", empty.Directions, err)
	}
}

func TestParseSynthesisRejects(t *testing.T) {
	for name, body := range map[string]string{
		"no directions field":         `{"text": "x"}`,
		"a direction without a title": `{"directions": [{"rank": 1}]}`,
		"an unknown stance":           `{"directions": [{"title": "A", "stances": {"ux": "love"}}]}`,
	} {
		if _, _, err := ParseSynthesis(jsonFence(body)); err == nil || !strings.Contains(err.Error(), "round 3") {
			t.Errorf("%s: error = %v, want one naming round 3", name, err)
		}
	}
}

func TestMarkWeak(t *testing.T) {
	c := &Council{
		Proposals: []CouncilProposal{
			{Id: "P1", Evidence: []CouncilEvidence{{Ref: "a.go:1"}, {Ref: "b.go:2"}}},
			{Id: "P2", Evidence: []CouncilEvidence{{Ref: "a.go:1"}}},
			{Id: "P3"},
		},
		Replies: []CouncilReply{{Id: "r1", Evidence: []CouncilEvidence{{Ref: "c.go:3"}}}, {Id: "r2"}},
	}
	notes := []WeakNote{
		{Ref: "a.go:1", Note: "shows nothing of the claim"},
		{Ref: "P3", Note: "cites nothing"},
		{Ref: "r2", Note: "no measurement"},
		{Ref: "nowhere", Note: "ignored"},
	}
	MarkWeak(c, notes)
	MarkWeak(c, notes) // the same notes twice change nothing more

	weakA := CouncilEvidence{Ref: "a.go:1", Weak: true, Note: "shows nothing of the claim"}
	if !reflect.DeepEqual(c.Proposals[0].Evidence, []CouncilEvidence{weakA, {Ref: "b.go:2"}}) {
		t.Errorf("P1 evidence = %+v", c.Proposals[0].Evidence)
	}
	if !reflect.DeepEqual(c.Proposals[1].Evidence, []CouncilEvidence{weakA}) {
		t.Errorf("P2 evidence = %+v: every evidence with that ref is marked", c.Proposals[1].Evidence)
	}
	if !reflect.DeepEqual(c.Proposals[2].Evidence, []CouncilEvidence{{Weak: true, Note: "cites nothing"}}) {
		t.Errorf("P3 evidence = %+v", c.Proposals[2].Evidence)
	}
	if !reflect.DeepEqual(c.Replies[0].Evidence, []CouncilEvidence{{Ref: "c.go:3"}}) {
		t.Errorf("r1 evidence = %+v, want it untouched", c.Replies[0].Evidence)
	}
	if !reflect.DeepEqual(c.Replies[1].Evidence, []CouncilEvidence{{Weak: true, Note: "no measurement"}}) {
		t.Errorf("r2 evidence = %+v", c.Replies[1].Evidence)
	}
}

// TestShapesParse feeds each JSON shape a prompt asks for back through its parser: the prompt and the parser
// describe one shape, or this fails.
func TestShapesParse(t *testing.T) {
	if props, _, err := ParseRound1(jsonFence(round1Shape)); err != nil || len(props) != 1 || props[0].Evidence[0].Weak {
		t.Errorf("round1Shape: %+v, %v", props, err)
	}
	if r, err := ParseRound2(jsonFence(round2Shape)); err != nil || len(r.Stances) != 1 || len(r.Revisions) != 1 || len(r.Answers) != 1 {
		t.Errorf("round2Shape: %+v, %v", r, err)
	}
	if a, err := ParseAnswers(jsonFence(answersShape)); err != nil || len(a) != 1 || a[0].Stance != StanceAccept || len(a[0].Evidence) != 1 {
		t.Errorf("answersShape: %+v, %v", a, err)
	}
	sum, weak, err := ParseSynthesis(jsonFence(synthesisShape))
	if err != nil || len(sum.Directions) != 1 || len(sum.Outcomes) != 3 || len(weak) != 1 || sum.Directions[0].Agreed {
		t.Errorf("synthesisShape: %+v, %+v, %v", sum, weak, err)
	}
}
