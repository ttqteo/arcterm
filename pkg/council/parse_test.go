// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"encoding/json"
	"reflect"
	"slices"
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

func TestRawLineBreaksInsideStringsAreRead(t *testing.T) {
	var v struct {
		Text string `json:"text"`
		N    int    `json:"n"`
	}
	// the Planner's round 1 failed on this: "invalid character '\n' in string literal"
	fenced := "```json\n{\"text\": \"first line\nsecond\tline \\\"quoted\\\"\",\n \"n\": 2}\n```"
	if err := decodeReply(fenced, "round 1", &v); err != nil || v.Text != "first line\nsecond\tline \"quoted\"" || v.N != 2 {
		t.Fatalf("fenced: %+v %v, want the text with its line break and tab", v, err)
	}
	v.Text, v.N = "", 0
	bare := "My answer: {\"text\": \"a\nb\", \"n\": 3} and then {stray} prose."
	if err := decodeReply(bare, "round 1", &v); err != nil || v.Text != "a\nb" || v.N != 3 {
		t.Fatalf("no fence: %+v %v, want the object read", v, err)
	}
	if err := decodeReply("```json\n{\"text\": \"a\nb\",}\n```", "round 1", &v); err == nil ||
		!strings.Contains(err.Error(), "round 1 reply: ") {
		t.Fatalf("a reply broken another way: %v, want the first error named", err)
	}
}

func TestEscapeControlsMapsBackToTheOriginal(t *testing.T) {
	s := "{\"a\": \"x\ny\"}\n"
	fixed, at := escapeControls(s)
	if fixed != "{\"a\": \"x\\ny\"}\n" {
		t.Fatalf("escapeControls = %q, want only the break inside the string escaped", fixed)
	}
	if len(at) != len(fixed)+1 || at[len(fixed)] != len(s) || at[strings.Index(fixed, "y")] != strings.Index(s, "y") {
		t.Fatalf("offsets %v do not map back to %q", at, s)
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
	    {"title": "Sleep sooner", "argument": "Saves RAM", "evidence": [{"ref": "pkg/services/idle.go:12"}, "screenshot:a.png#top", {"ref": "screenshot:a.png#save@0.72,0.08,0.12,0.05"}, {"ref": "  "}]},
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
		{Title: "Sleep sooner", Argument: "Saves RAM", Evidence: []CouncilEvidence{{Ref: "pkg/services/idle.go:12"}, {Ref: "screenshot:a.png#top"}, {Ref: "screenshot:a.png#save@0.72,0.08,0.12,0.05"}}},
		{Title: "Show the sleep state", Argument: "People wonder", Evidence: []CouncilEvidence{{Weak: true, Note: "cites no evidence"}}},
	}
	if !reflect.DeepEqual(props, want) {
		t.Errorf("proposals = %+v\nwant %+v", props, want)
	}
}

// an argument may hold a table and a mermaid diagram (visualRule): its fence sits inside a JSON string, escaped onto
// the line of its field, so the ```json fence around the reply still closes where it should
func TestParseRound1KeepsATableAndADiagramInAnArgument(t *testing.T) {
	arg := "I compare two checks:\n\n| | A | B |\n|---|---|---|\n| patch | yes | no |\n\n```mermaid\nflowchart LR\n  A[\"swap\"] --> B[\"trace\"]\n```\n\nB covers more."
	body, err := json.Marshal(map[string]any{"overview": "", "proposals": []map[string]any{{"title": "T", "argument": arg}}})
	if err != nil {
		t.Fatal(err)
	}
	props, _, err := ParseRound1("Some thoughts first.\n```mermaid\nA --> B\n```\n" + jsonFence(string(body)))
	if err != nil {
		t.Fatal(err)
	}
	if len(props) != 1 || props[0].Argument != arg {
		t.Errorf("proposals = %+v, want the argument whole: %q", props, arg)
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

func TestParseRound1Zone(t *testing.T) {
	reply := jsonFence(`{"overview": "x", "proposals": [
		{"title": "A", "argument": "a", "zone": "  First launch "},
		{"title": "B", "argument": "b", "zone": ""},
		{"title": "C", "argument": "c", "evidence": [{"ref": "a.go:1"}], "zone": "Idle cost"}
	]}`)
	props, _, err := ParseRound1(reply)
	if err != nil || len(props) != 3 {
		t.Fatalf("ParseRound1 = %+v, %v", props, err)
	}
	if props[0].Zone != "First launch" || props[1].Zone != "" || props[2].Zone != "Idle cost" {
		t.Errorf("zones = %q, %q, %q; want the trimmed names, and none for the second", props[0].Zone, props[1].Zone, props[2].Zone)
	}

	// the zoned shape reads through the parser too
	c := zonesCouncil()
	c.Zones = []CouncilZone{{Seat: "ux", Name: "First launch"}, {Seat: "ram", Name: "Idle cost"}, {Seat: "skeptic", Name: "Wake failures"}}
	if props, _, err := ParseRound1(jsonFence(brainstormRound1ShapeFor(c))); err != nil || len(props) != 2 || props[0].Zone == "" ||
		!strings.Contains(props[1].Argument, "| Idle wait |") {
		t.Errorf("zoned brainstorm shape: %+v, %v", props, err)
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

func TestParseRound1Verify(t *testing.T) {
	props, _, err := ParseRound1(jsonFence(`{"overview": "", "proposals": [
	  {"title": "Sleep sooner", "argument": "A", "evidence": [{"ref": "pkg/services/idle.go:12"}],
	   "verify": [
	     {"command": " go test ./pkg/services -run TestIdle ", "expect": "FAIL", "why": " it never sleeps "},
	     {"command": "npx vitest run frontend/a.test.ts", "expect": " pass "},
	     {"command": "   ", "expect": "pass"},
	     {"command": "cargo test idle_sleep", "expect": "maybe"},
	     {"command": "go test ./pkg/x -run TestZ"},
	     "go test ./pkg/y -run TestY",
	     {"command": "go test ./pkg/z -run TestZ", "expect": true}
	   ]},
	  {"title": "Show the state", "argument": "B"},
	  {"title": "Third", "argument": "C", "verify": []},
	  {"title": "Fourth", "argument": "D", "verify": "go test ./pkg/x -run TestY"}
	]}`))
	if err != nil {
		t.Fatalf("a verify list with slips in it failed the whole reply: %v", err)
	}
	if len(props) != 4 {
		t.Fatalf("proposals = %+v, want 4", props)
	}
	// a request keeps its words; a request with no command, an expect that is neither pass nor fail, or no expect to judge
	// the result by is no request, and neither is an item that is not an object. State stays empty: Go runs them later.
	want := []CouncilRun{
		{Command: "go test ./pkg/services -run TestIdle", Expect: RunFail, Why: "it never sleeps"},
		{Command: "npx vitest run frontend/a.test.ts", Expect: RunPass},
	}
	if !reflect.DeepEqual(props[0].Runs, want) {
		t.Errorf("runs = %+v\nwant %+v", props[0].Runs, want)
	}
	for i := 1; i < 4; i++ {
		if props[i].Runs != nil {
			t.Errorf("proposal %d runs = %+v, want none", i+1, props[i].Runs)
		}
	}
}

func TestParseRound1ReadsTheCheckerAndWhy(t *testing.T) {
	props, _, err := ParseRound1(jsonFence(`{"overview": "", "proposals": [
	  {"title": "Sleep sooner", "argument": "A", "checker": " ram ", "checkwhy": " it knows what stays in memory "},
	  {"title": "Show the state", "argument": "B"},
	  {"title": "Wake on hover", "argument": "C", "checker": "skeptic"}
	]}`))
	if err != nil || len(props) != 3 {
		t.Fatalf("got %+v, %v", props, err)
	}
	if props[0].Checker != "ram" || props[0].CheckWhy != "it knows what stays in memory" {
		t.Errorf("first proposal: checker %q, why %q; want both read, trimmed", props[0].Checker, props[0].CheckWhy)
	}
	if props[1].Checker != "" || props[1].CheckWhy != "" {
		t.Errorf("a proposal with neither: checker %q, why %q; want both empty", props[1].Checker, props[1].CheckWhy)
	}
	if props[2].Checker != "skeptic" || props[2].CheckWhy != "" {
		t.Errorf("a checker with no why: checker %q, why %q", props[2].Checker, props[2].CheckWhy)
	}
}

func TestParseRound1KeepsEveryRequestForTheRunnerToCap(t *testing.T) {
	// the cap of 2 per expert is Go's to apply when it runs them, with the reason on the third; parsing keeps all of them
	props, _, err := ParseRound1(jsonFence(`{"proposals": [{"title": "T", "argument": "A", "verify": [
	  {"command": "go test ./a -run TestA", "expect": "pass"},
	  {"command": "go test ./b -run TestB", "expect": "pass"},
	  {"command": "go test ./c -run TestC", "expect": "fail"}]}]}`))
	if err != nil || len(props) != 1 || len(props[0].Runs) != 3 {
		t.Fatalf("got %+v, %v; want the three requests", props, err)
	}
}

func TestParseQuote(t *testing.T) {
	// round 1: a quote rides on its evidence item, trimmed; a bare string has none; an item with no ref is dropped
	props, _, err := ParseRound1(jsonFence(`{"proposals": [{"title": "T", "argument": "A", "evidence": [
	  {"ref": "a.go:1", "quote": "  func f() {  "}, "b.go:2", {"ref": "", "quote": "orphan"}, {"ref": "c.go:3", "quote": "   "}]}]}`))
	if err != nil {
		t.Fatal(err)
	}
	want := []CouncilEvidence{{Ref: "a.go:1", Quote: "func f() {"}, {Ref: "b.go:2"}, {Ref: "c.go:3"}}
	if !reflect.DeepEqual(props[0].Evidence, want) {
		t.Errorf("round 1 evidence = %+v\nwant %+v", props[0].Evidence, want)
	}

	// round 2: a stance's evidence
	r2, err := ParseRound2(jsonFence(`{"stances": [{"proposalid": "P1", "stance": "challenge", "reason": "r",
	  "evidence": [{"ref": "d.go:4", "quote": "x := 1"}]}],
	  "answers": [{"replyid": "r3", "text": "t", "evidence": [{"ref": "e.go:5", "quote": "y := 2"}]}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if want := []CouncilEvidence{{Ref: "d.go:4", Quote: "x := 1"}}; !reflect.DeepEqual(r2.Stances[0].Evidence, want) {
		t.Errorf("round 2 stance evidence = %+v, want %+v", r2.Stances[0].Evidence, want)
	}
	if want := []CouncilEvidence{{Ref: "e.go:5", Quote: "y := 2"}}; !reflect.DeepEqual(r2.Answers[0].Evidence, want) {
		t.Errorf("round 2 answer evidence = %+v, want %+v", r2.Answers[0].Evidence, want)
	}

	// the answers pass
	ans, err := ParseAnswers(jsonFence(`{"answers": [{"replyid": "r3", "text": "t", "stance": "accept",
	  "evidence": [{"ref": "f.go:6", "quote": "z := 3"}]}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if want := []CouncilEvidence{{Ref: "f.go:6", Quote: "z := 3"}}; !reflect.DeepEqual(ans[0].Evidence, want) {
		t.Errorf("answers evidence = %+v, want %+v", ans[0].Evidence, want)
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

func TestParseRound2Picks(t *testing.T) {
	got, err := ParseRound2(jsonFence(`{"stances": [], "picks": ["P1", " P3 ", "P3", "", "P4", "P5"]}`))
	if err != nil || !slices.Equal(got.Picks, []string{"P1", "P3", "P4"}) {
		t.Fatalf("picks = %v, %v, want the first 3 distinct", got.Picks, err)
	}
	got, err = ParseRound2(jsonFence(`{"stances": []}`))
	if err != nil || len(got.Picks) != 0 {
		t.Fatalf("picks = %v, %v, want none", got.Picks, err)
	}
}

func TestParseSynthesisAnswer(t *testing.T) {
	with, _, err := ParseSynthesis(jsonFence(`{"answer": " Do P2 first. ", "text": "t", "directions": []}`))
	if err != nil || with.Answer != "Do P2 first." {
		t.Fatalf("answer = %q, %v", with.Answer, err)
	}
	without, _, err := ParseSynthesis(jsonFence(`{"text": "t", "directions": []}`))
	if err != nil || without.Answer != "" {
		t.Fatalf("answer = %q, %v, want none", without.Answer, err)
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
		"a doubt with no text":         `{"stances": [], "answers": [{"replyid": "r1", "stance": "challenge"}]}`,
		"an answer with no replyid":    `{"stances": [], "answers": [{"text": "x"}]}`,
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

// An answer's asks are the replies the thread offers the person next: trimmed, each once, the long and the empty left
// out, at most MaxReplyAsks; an answer with no words offers none.
func TestParseAnswersAsks(t *testing.T) {
	long := strings.Repeat("x", maxAskRunes+1)
	got, err := ParseAnswers(jsonFence(`{"answers": [
	  {"replyid": "r3", "text": "Yes.", "asks": ["  Run it on  M5? ", "", "Run it on M5?", "` + long + `", "Which tier first?", "Why not M4?", "One more"]},
	  {"replyid": "r4", "text": "", "asks": ["Ignored"]},
	  {"replyid": "r5", "text": "No."}
	]}`))
	if err != nil {
		t.Fatal(err)
	}
	want := []Answer{
		{ReplyId: "r3", Text: "Yes.", Asks: []string{"Run it on M5?", "Which tier first?", "Why not M4?"}},
		{ReplyId: "r4"},
		{ReplyId: "r5", Text: "No."},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v\nwant %+v", got, want)
	}
}

// An answer with no words is a seat that has nothing to add to what another already answered: it agrees. A doubt or an
// objection still needs its words.
func TestParseAnswersTakesAnAnswerWithNoWords(t *testing.T) {
	got, err := ParseAnswers(jsonFence(`{"answers": [
	  {"replyid": "r3", "text": ""},
	  {"replyid": "r4", "text": " ", "stance": "accept"}
	]}`))
	if err != nil {
		t.Fatal(err)
	}
	want := []Answer{{ReplyId: "r3"}, {ReplyId: "r4", Stance: StanceAccept}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v\nwant %+v", got, want)
	}
	for _, stance := range []string{"challenge", "oppose"} {
		if _, err := ParseAnswers(jsonFence(`{"answers": [{"replyid": "r3", "text": "", "stance": "` + stance + `"}]}`)); err == nil {
			t.Errorf("a %s with no words was accepted", stance)
		}
	}
	if _, err := ParseAnswers(jsonFence(`{"answers": [{"replyid": "", "text": "Yes."}]}`)); err == nil {
		t.Error("an answer with no replyid was accepted")
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

func TestParseSynthesisKeepsTheRoundOfAWithdrawal(t *testing.T) {
	sum, _, err := ParseSynthesis(jsonFence(`{"directions": [{"title": "A"}], "outcomes": {"P4": "Withdrawn in round 3"}}`))
	if err != nil || sum.Outcomes["P4"] != "Withdrawn in round 3" {
		t.Errorf("outcomes = %v, %v, want the round 3 withdrawal kept as the coordinator wrote it", sum.Outcomes, err)
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
	// the second idea of each round 1 shape is the example message with a table and a list (pictureCheck)
	hasPicture := func(arg string) bool {
		return strings.Contains(arg, "\n| 1 min | 40 MB | 2 s |\n") && strings.Contains(arg, "\n1. Log the idle gaps")
	}
	if props, _, err := ParseRound1(jsonFence(round1Shape)); err != nil || len(props) != 2 || props[0].Evidence[0].Weak ||
		!hasPicture(props[1].Argument) {
		t.Errorf("round1Shape: %+v, %v", props, err)
	} else {
		// the shape shows a quote on its evidence and one verify request, an allowed form with an expect to judge it by
		if props[0].Evidence[0].Quote == "" {
			t.Errorf("round1Shape: the first proposal's evidence has no quote: %+v", props[0].Evidence)
		}
		if len(props[0].Runs) != 1 || props[0].Runs[0].Expect != RunFail || props[0].Runs[0].State != "" {
			t.Errorf("round1Shape: the first proposal's runs = %+v, want one request that expects a fail", props[0].Runs)
		} else if cmd := props[0].Runs[0].Command; !strings.HasPrefix(cmd, "go test ") || !strings.Contains(cmd, " -run ") ||
			strings.ContainsAny(cmd, "|&;<>`$") {
			t.Errorf("round1Shape: its example command %q is not a plain `go test <package> -run <pattern>`", cmd)
		}
		// and, on each proposal, the seat that should check it and why
		for i, p := range props {
			if p.Checker == "" || p.CheckWhy == "" {
				t.Errorf("round1Shape: proposal %d has checker %q, why %q; want both shown", i+1, p.Checker, p.CheckWhy)
			}
		}
	}
	// the shape an agent seat gets asks for the quote and no verify request
	if props, _, err := ParseRound1(jsonFence(round1ShapeNoVerify)); err != nil || len(props) != 2 || props[0].Evidence[0].Weak ||
		props[0].Evidence[0].Quote == "" || props[0].Runs != nil || !hasPicture(props[1].Argument) {
		t.Errorf("round1ShapeNoVerify: %+v, %v", props, err)
	}
	if strings.Contains(round1ShapeNoVerify, "verify") || strings.Contains(round1ShapeNoVerify, "check") {
		t.Errorf("round1ShapeNoVerify still shows verify or a checker:\n%s", round1ShapeNoVerify)
	}
	// a Review with one seat has nobody to name: its shape keeps the verify request and shows no checker
	if props, _, err := ParseRound1(jsonFence(round1ShapeNoChecker)); err != nil || len(props) != 2 || len(props[0].Runs) != 1 ||
		props[0].Checker != "" || props[0].CheckWhy != "" || strings.Contains(round1ShapeNoChecker, "check") {
		t.Errorf("round1ShapeNoChecker: %+v, %v", props, err)
	}
	if r, err := ParseRound2(jsonFence(round2Shape)); err != nil || len(r.Stances) != 1 || len(r.Revisions) != 1 || len(r.Answers) != 1 || len(r.Picks) != 3 {
		t.Errorf("round2Shape: %+v, %v", r, err)
	}
	// a pass that asks for no picks shows none
	if r, err := ParseRound2(jsonFence(round2ShapeNoPicks)); err != nil || len(r.Stances) != 1 || len(r.Revisions) != 1 || len(r.Answers) != 1 ||
		len(r.Picks) != 0 || strings.Contains(round2ShapeNoPicks, "picks") {
		t.Errorf("round2ShapeNoPicks: %+v, %v", r, err)
	}
	if a, err := ParseAnswers(jsonFence(answersShape)); err != nil || len(a) != 1 || a[0].Stance != StanceAccept || len(a[0].Evidence) != 1 {
		t.Errorf("answersShape: %+v, %v", a, err)
	}
	sum, weak, err := ParseSynthesis(jsonFence(synthesisShape))
	// the lean shape holds no stances, agreed flags or outcomes: Go fills them (fill.go)
	if err != nil || len(sum.Directions) != 1 || sum.Directions[0].FirstStep == "" || len(sum.Kept) != 1 || len(sum.Outcomes) != 0 ||
		len(weak) != 1 || len(sum.Directions[0].Stances) != 0 || sum.Answer == "" || len(sum.Asks) != 2 || sum.Asks[0].To != "skeptic" ||
		sum.Asks[1].To != "" {
		t.Errorf("synthesisShape: %+v, %+v, %v", sum, weak, err)
	}
	for _, shape := range []string{synthesisShape, brainstormSynthesisShape} {
		for _, key := range []string{`"stances"`, `"agreed"`, `"outcomes"`} {
			if strings.Contains(shape, key) {
				t.Errorf("a synthesis shape asks for %s: Go fills it", key)
			}
		}
	}
	if _, _, err := ParseSynthesis(jsonFence(synthesisShapeNoQuestion)); err != nil {
		t.Errorf("synthesisShapeNoQuestion: %v", err)
	}

	// the Brainstorm shapes read through the same parsers
	if props, _, err := ParseRound1(jsonFence(brainstormRound1Shape)); err != nil || len(props) != 2 || props[0].Title == "" ||
		!hasPicture(props[1].Argument) {
		t.Errorf("brainstormRound1Shape: %+v, %v", props, err)
	}
	if r, err := ParseRound2(jsonFence(brainstormRound2Shape)); err != nil || len(r.Stances) != 2 || !r.Stances[0].Builds || r.Stances[1].Builds ||
		len(r.Revisions) != 1 || len(r.Answers) != 1 || len(r.Picks) != 3 {
		t.Errorf("brainstormRound2Shape: %+v, %v", r, err)
	}
	sum, _, err = ParseSynthesis(jsonFence(brainstormSynthesisShape))
	if err != nil || len(sum.Directions) != 1 || sum.Directions[0].FirstStep == "" || len(sum.Kept) != 1 || sum.Answer == "" ||
		len(sum.Asks) != 2 || sum.Asks[0].To != "contrarian" {
		t.Errorf("brainstormSynthesisShape: %+v, %v", sum, err)
	}
	sum, _, err = ParseSynthesis(jsonFence(brainstormSynthesisShapeNoQuestion))
	if err != nil || len(sum.Directions) != 1 || sum.Answer != "" {
		t.Errorf("brainstormSynthesisShapeNoQuestion: %+v, %v", sum, err)
	}
}

// A reply written to the lean shape holds no stances, agreed flags or outcomes; one from an older model or a test still
// holds them, and they read as before (Go's fill overwrites them later).
func TestParseSynthesisReadsTheLeanShapeAndAnOlderReply(t *testing.T) {
	lean, _, err := ParseSynthesis(jsonFence(`{"text": "Two.", "directions": [
		{"rank": 2, "title": "Poll less", "reasoning": "Saves RAM.", "firststep": "Log the gaps", "from": ["P3"]},
		{"rank": 1, "title": "Show the state", "reasoning": "Cheap.", "firststep": "Add the badge", "from": ["P1", "P2"]}],
		"kept": [{"title": "Rename the chip", "reasoning": "the name is wrong", "from": ["P5"]}]}`))
	if err != nil || len(lean.Directions) != 2 || lean.Directions[0].Title != "Show the state" || lean.Directions[0].Rank != 1 {
		t.Fatalf("lean reply = %+v, %v, want the directions ranked 1 and 2", lean, err)
	}
	if d := lean.Directions[0]; d.Stances == nil || len(d.Stances) != 0 || !d.Agreed || d.FirstStep != "Add the badge" {
		t.Errorf("direction = %+v, want empty stances, agreed and its first step", d)
	}
	if lean.Outcomes == nil || len(lean.Outcomes) != 0 || len(lean.Kept) != 1 {
		t.Errorf("outcomes = %v, kept = %+v, want no outcomes (not nil) and the kept line", lean.Outcomes, lean.Kept)
	}

	old, _, err := ParseSynthesis(jsonFence(`{"text": "One.", "directions": [
		{"rank": 1, "title": "Show", "from": ["P1"], "stances": {"ux": "accept", "skeptic": "challenge"}, "agreed": false}],
		"outcomes": {"P1": "Direction 1", "P4": "Withdrawn in round 2"}}`))
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]CouncilStance{"ux": StanceAccept, "skeptic": StanceChallenge}
	if d := old.Directions[0]; !reflect.DeepEqual(d.Stances, want) || d.Agreed {
		t.Errorf("older reply direction = %+v, want its stances %v and not agreed", d, want)
	}
	if old.Outcomes["P4"] != "Withdrawn in round 2" || len(old.Outcomes) != 2 {
		t.Errorf("older reply outcomes = %v, want both read", old.Outcomes)
	}
}

func TestParseSynthesisAsks(t *testing.T) {
	sum, _, err := ParseSynthesis(jsonFence(`{"directions": [], "asks": [
		{"text": "  Does one minute hold on a Mac?  ", "to": " skeptic "},
		{"text": "   ", "to": "ux"},
		{"text": "What do we log first?"}
	]}`))
	want := []CouncilAsk{{Text: "Does one minute hold on a Mac?", To: "skeptic"}, {Text: "What do we log first?"}}
	if err != nil || !reflect.DeepEqual(sum.Asks, want) {
		t.Errorf("asks = %+v, %v; want %+v (trimmed, an empty one dropped)", sum.Asks, err, want)
	}
	if sum, _, err := ParseSynthesis(jsonFence(`{"directions": []}`)); err != nil || sum.Asks != nil {
		t.Errorf("a report with no asks = %+v, %v", sum.Asks, err)
	}
}

func TestParseBrainstorm(t *testing.T) {
	props, _, err := ParseRound1(jsonFence(`{"overview": "x", "proposals": [
		{"title": "A tour", "argument": "Walk them through it", "wild": true},
		{"title": "A badge", "argument": "Say what is asleep"}]}`))
	if err != nil || len(props) != 2 {
		t.Fatalf("ParseRound1 = %+v, %v", props, err)
	}
	if !props[0].Wild || props[1].Wild {
		t.Errorf("wild flags = %v, %v, want true then false", props[0].Wild, props[1].Wild)
	}

	r2, err := ParseRound2(jsonFence(`{"stances": [
		{"proposalid": "P1", "stance": "accept", "builds": true, "reason": "Add a badge to the tour"},
		{"proposalid": "P2", "stance": "accept", "reason": ""},
		{"proposalid": "P3", "stance": "challenge", "reason": "It costs a screen"}],
		"picks": ["P1"]}`))
	if err != nil || len(r2.Stances) != 3 {
		t.Fatalf("ParseRound2 = %+v, %v", r2, err)
	}
	if !r2.Stances[0].Builds || r2.Stances[1].Builds || r2.Stances[2].Builds {
		t.Errorf("builds flags = %v %v %v, want true false false", r2.Stances[0].Builds, r2.Stances[1].Builds, r2.Stances[2].Builds)
	}

	sum, weak, err := ParseSynthesis(jsonFence(`{"text": "Three ideas.", "answer": "Start with the tour.",
		"directions": [
			{"rank": 1, "title": "A tour", "reasoning": "Cheap.", "firststep": "Sketch the first screen", "from": ["P1"], "stances": {"ux": "accept"}},
			{"rank": 2, "title": "A badge", "reasoning": "Clear.", "firststep": "  Add the label  ", "from": ["P2"]}],
		"kept": [
			{"title": "A mascot", "reasoning": "Odd, but it would make people smile.", "from": ["P5", "P6"]},
			{"title": "  ", "reasoning": "no title, no idea"},
			{"title": "Remove the pane"}],
		"outcomes": {"P1": "Direction 1", "P5": "Kept aside"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(sum.Directions) != 2 || sum.Directions[0].FirstStep != "Sketch the first screen" || sum.Directions[1].FirstStep != "Add the label" {
		t.Errorf("directions = %+v, want the first steps kept and trimmed", sum.Directions)
	}
	wantKept := []CouncilDirection{
		{Rank: 1, Title: "A mascot", Reasoning: "Odd, but it would make people smile.", From: []string{"P5", "P6"}, Stances: map[string]CouncilStance{}},
		{Rank: 2, Title: "Remove the pane", From: []string{}, Stances: map[string]CouncilStance{}},
	}
	if !reflect.DeepEqual(sum.Kept, wantKept) {
		t.Errorf("kept = %+v\nwant %+v: a kept idea with no title is skipped, the others numbered and never null on the wire", sum.Kept, wantKept)
	}
	if weak != nil || sum.Outcomes["P5"] != "Kept aside" {
		t.Errorf("weak = %+v, outcomes = %v", weak, sum.Outcomes)
	}

	// a reply with no kept ideas leaves Kept empty, so the report draws no empty section
	sum, _, err = ParseSynthesis(jsonFence(`{"text": "x", "directions": [{"title": "A"}], "kept": []}`))
	if err != nil || len(sum.Kept) != 0 {
		t.Errorf("kept = %+v, %v, want none", sum.Kept, err)
	}
	if sum.Directions[0].FirstStep != "" {
		t.Errorf("first step = %q, want none when the model gave none", sum.Directions[0].FirstStep)
	}
}

func TestPlainReply(t *testing.T) {
	for _, tc := range []struct{ name, in, want string }{
		{"free words", "  I would cache it.\n\nIt is cheap.  ", "I would cache it.\n\nIt is cheap."},
		{"words, then a block that did not read", "I would cache it.\n\n```json\n{ not json\n```", "I would cache it."},
		{"words, then an unclosed block", "I would cache it.\n```JSON\n{\"stances\": [", "I would cache it."},
		{"a block and no words keeps the whole reply", "```json\n{ not json\n```", "```json\n{ not json\n```"},
		{"another language's fence stays in the words", "Try:\n```go\nf()\n```\nThat is all.", "Try:\n```go\nf()\n```\nThat is all."},
	} {
		if got := PlainReply(tc.in); got != tc.want {
			t.Errorf("%s: PlainReply = %q, want %q", tc.name, got, tc.want)
		}
	}
	// what the shapes ask for does not read from it, which is how the runner knows to fall back
	if _, _, err := ParseRound1("I would cache it."); err == nil {
		t.Error("free words parsed as an ideas round")
	}
	if _, err := ParseRound2("I would cache it."); err == nil {
		t.Error("free words parsed as a reply pass")
	}
	if _, err := ParseAnswers("I would cache it."); err == nil {
		t.Error("free words parsed as answers")
	}
}
