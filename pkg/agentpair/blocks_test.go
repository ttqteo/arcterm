// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentpair

import (
	"reflect"
	"strings"
	"testing"
)

func pairBlock(lines ...string) string {
	return "```arc-pair\n" + strings.Join(lines, "\n") + "\n```"
}

func judgeBlock(lines ...string) string {
	return "```arc-judge\n" + strings.Join(lines, "\n") + "\n```"
}

func TestWorkerBlockEachLineForm(t *testing.T) {
	raw := "I checked both findings.\n\n" + pairBlock(
		"D1 Lock the threshold before the pilot",
		"O2 Take pilot cases outside the test split — the judge's second point",
		"A3 Is a 50% threshold fine? -- the only decision left [Yes, 50% | No, keep 70%]",
		"D4 Em dash and double dash — first note -- second",
		"- O5 a bullet before the item",
		"d6: lower case and a colon",
		"A7 asks with one chip [Yes]",
		"A8 a bracket that holds no chip [ ]",
		"D9 a trailing bracket on a D item [kept in the text]",
	)
	got, ok := WorkerBlock(raw)
	if !ok {
		t.Fatal("no block read")
	}
	want := []BlockItem{
		{Num: 1, Kind: KindAgreed, Text: "Lock the threshold before the pilot"},
		{Num: 2, Kind: KindOpen, Text: "Take pilot cases outside the test split", Note: "the judge's second point"},
		{Num: 3, Kind: KindAsks, Text: "Is a 50% threshold fine?", Note: "the only decision left", Chips: []string{"Yes, 50%", "No, keep 70%"}},
		{Num: 4, Kind: KindAgreed, Text: "Em dash and double dash", Note: "first note -- second"},
		{Num: 5, Kind: KindOpen, Text: "a bullet before the item"},
		{Num: 6, Kind: KindAgreed, Text: "lower case and a colon"},
		{Num: 7, Kind: KindAsks, Text: "asks with one chip", Chips: []string{"Yes"}},
		{Num: 8, Kind: KindAsks, Text: "a bracket that holds no chip [ ]"},
		{Num: 9, Kind: KindAgreed, Text: "a trailing bracket on a D item [kept in the text]"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("items =\n%#v\nwant\n%#v", got, want)
	}
}

func TestWorkerBlockSkipsALineThatDoesNotParse(t *testing.T) {
	raw := pairBlock(
		"D1 first",
		"a line of prose the agent slipped in",
		"D2first with no space",
		"X3 an unknown letter",
		"D0 number zero is not an item",
		"D99999999999999999999999 a number that overflows",
		"D 4 a space inside the label",
		"O5 last",
	)
	got, ok := WorkerBlock(raw)
	if !ok || len(got) != 2 || got[0].Num != 1 || got[1].Num != 5 {
		t.Fatalf("got %#v, ok %v; want items 1 and 5 only", got, ok)
	}
}

func TestWorkerBlockWithoutAFenceOrWithoutItems(t *testing.T) {
	for name, raw := range map[string]string{
		"no fence":            "D1 a line of prose with no fence",
		"another fence":       "```go\nD1 not a block\n```",
		"a longer name":       "```arc-pairs\nD1 a different fence\n```",
		"an empty fence":      "```arc-pair\n```",
		"nothing parses":      pairBlock("just words", "more words"),
		"the last lists none": "```arc-pair\nD1 first\n```\n" + pairBlock("nothing here"),
	} {
		if items, ok := WorkerBlock(raw); ok {
			t.Errorf("%s: read a block %#v", name, items)
		}
	}
}

func TestWorkerBlockTheLastFenceCounts(t *testing.T) {
	raw := pairBlock("D1 old", "O2 old") + "\nsome prose\n" + pairBlock("D1 new")
	got, ok := WorkerBlock(raw)
	if !ok || len(got) != 1 || got[0].Text != "new" {
		t.Fatalf("got %#v, ok %v; want the last block alone", got, ok)
	}
}

func TestWorkerBlockIgnoresAFenceNestedInALongerOne(t *testing.T) {
	// a reply quoting the format inside a four-backtick fence holds no block of its own
	quoted := "The format is:\n````md\n" + pairBlock("D1 an example") + "\n````\n"
	if items, ok := WorkerBlock(quoted); ok {
		t.Fatalf("read a nested block %#v", items)
	}
	// the real block after it is the one that counts
	got, ok := WorkerBlock(quoted + pairBlock("D1 the real one"))
	if !ok || len(got) != 1 || got[0].Text != "the real one" {
		t.Fatalf("got %#v, ok %v", got, ok)
	}
	// a shorter closing fence does not close a longer opening one
	short := "````text\n```\n" + pairBlock("D1 still inside") + "\n````\n"
	if items, ok := WorkerBlock(short); ok {
		t.Fatalf("a short fence closed a longer one: %#v", items)
	}
}

func TestWorkerBlockAnOpenFenceRunsToTheEnd(t *testing.T) {
	got, ok := WorkerBlock("on it\n```arc-pair\nD1 agreed\nO2 not finished writ")
	if !ok || len(got) != 2 || got[1].Text != "not finished writ" {
		t.Fatalf("got %#v, ok %v", got, ok)
	}
}

func TestWorkerBlockTildeFenceAndCRLF(t *testing.T) {
	got, ok := WorkerBlock("text\r\n~~~arc-pair\r\nD1 one\r\nO2 two\r\n~~~\r\n")
	if !ok || len(got) != 2 || got[0].Text != "one" || got[1].Text != "two" {
		t.Fatalf("got %#v, ok %v", got, ok)
	}
}

func TestJudgeMarksEachLineForm(t *testing.T) {
	raw := "Finding 1 is wrong.\n\n" + judgeBlock(
		"reopen D2: the threshold is picked after the pilot",
		"Reopen 3: no D prefix",
		"REOPEN d4: any case",
		"reopen D5",
		"- reopen D6: after a bullet",
		"new: the pilot cases overlap the test split",
		"NEW:   spaces are trimmed   ",
		"No new points.",
	)
	m, ok := JudgeMarks(raw)
	if !ok {
		t.Fatal("no marks read")
	}
	want := Marks{
		Reopen: []Reopen{
			{Num: 2, Why: "the threshold is picked after the pilot"},
			{Num: 3, Why: "no D prefix"},
			{Num: 4, Why: "any case"},
			{Num: 5},
			{Num: 6, Why: "after a bullet"},
		},
		New:         []string{"the pilot cases overlap the test split", "spaces are trimmed"},
		NoNewPoints: true,
	}
	if !reflect.DeepEqual(m, want) {
		t.Fatalf("marks =\n%#v\nwant\n%#v", m, want)
	}
}

func TestJudgeMarksSkipsALineThatDoesNotParse(t *testing.T) {
	m, ok := JudgeMarks(judgeBlock(
		"reopen D2 because there is no colon and a reason",
		"reopen Dx: not a number",
		"reopen 0: number zero",
		"new:",
		"new point without a colon",
		"there are new points",
		"reopen D7: the only good one",
	))
	if !ok || len(m.Reopen) != 1 || m.Reopen[0].Num != 7 || len(m.New) != 0 || m.NoNewPoints {
		t.Fatalf("marks = %#v, ok %v; want only reopen D7", m, ok)
	}
}

func TestJudgeMarksFenceOptions(t *testing.T) {
	if m, ok := JudgeMarks("reopen D2: marks outside a fence are prose"); ok {
		t.Fatalf("read marks %#v with no fence", m)
	}
	if m, ok := JudgeMarks(pairBlock("D1 the worker's fence is not a judge's")); ok {
		t.Fatalf("read marks %#v from an arc-pair fence", m)
	}
	// a fence with nothing to mark is still the judge's word on the list
	if m, ok := JudgeMarks("```arc-judge\n```"); !ok || m.raises() || m.NoNewPoints {
		t.Fatalf("empty fence: marks %#v, ok %v", m, ok)
	}
	// the last fence counts, and one nested in a longer fence is not one
	raw := judgeBlock("reopen D1: old") + "\n" + judgeBlock("no new points")
	if m, _ := JudgeMarks(raw); len(m.Reopen) != 0 || !m.NoNewPoints {
		t.Fatalf("the last fence did not count: %#v", m)
	}
	nested := "````md\n" + judgeBlock("reopen D1: an example") + "\n````"
	if m, ok := JudgeMarks(nested); ok {
		t.Fatalf("read a nested fence %#v", m)
	}
	if m, ok := JudgeMarks("```arc-judge\nnew: left open"); !ok || len(m.New) != 1 {
		t.Fatalf("open fence: %#v, ok %v", m, ok)
	}
}

func TestBodyTakesOutTheFencesAndTheQuoteLine(t *testing.T) {
	cases := []struct {
		name, raw, text, quote string
	}{
		{"nothing to take", "Just prose.\nTwo lines.", "Just prose.\nTwo lines.", ""},
		{"the worker's block", "Done.\n\n" + pairBlock("D1 x"), "Done.", ""},
		{"the judge's marks", "Finding.\n\n" + judgeBlock("no new points"), "Finding.", ""},
		{"a quote line", "> Is 50% fine?\n\nYes, it is.", "Yes, it is.", "Is 50% fine?"},
		{"a quote line without a space", ">Is 50% fine?\nYes.", "Yes.", "Is 50% fine?"},
		{"a quote line after a blank line and before a block", "\n\n> the line\nAnswer\n" + pairBlock("D1 x"), "Answer", "the line"},
		{"only the first quote line", "> first\n> second\nBody", "> second\nBody", "first"},
		{"a quote that is not leading stays", "Body\n> a quote inside", "Body\n> a quote inside", ""},
		{"a block first and then a quote", pairBlock("D1 x") + "\n> the line\nBody", "Body", "the line"},
		{"both fences", "> q\nText\n" + judgeBlock("new: a") + "\n" + pairBlock("D1 x"), "Text", "q"},
		{"only the last fence of a name", pairBlock("D1 an example") + "\nprose\n" + pairBlock("D1 real"), pairBlock("D1 an example") + "\nprose", ""},
		{"a nested fence stays", "````md\n" + pairBlock("D1 x") + "\n````\nafter", "````md\n" + pairBlock("D1 x") + "\n````\nafter", ""},
		{"an open fence is dropped to the end", "Text\n```arc-pair\nD1 half", "Text", ""},
		{"another fence stays", "```go\nx := 1\n```\nText", "```go\nx := 1\n```\nText", ""},
		{"an indented first line keeps its indent", "    code\nmore", "    code\nmore", ""},
		{"windows line ends", "> q\r\nText\r\n" + pairBlock("D1 x"), "Text", "q"},
		{"nothing left", pairBlock("D1 x"), "", ""},
	}
	for _, c := range cases {
		text, quote := Body(c.raw)
		if text != c.text || quote != c.quote {
			t.Errorf("%s:\n got text %q quote %q\nwant text %q quote %q", c.name, text, quote, c.text, c.quote)
		}
	}
}
