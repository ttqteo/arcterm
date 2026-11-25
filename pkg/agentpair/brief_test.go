// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentpair

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestJudgeBriefHoldsWhatTheSpecSays(t *testing.T) {
	reply := "Plan done. > not a quote\n\n" + pairBlock("D1 lock the threshold", "O2 pilot split")
	got := JudgeBrief(JudgeBriefInput{
		WorkerName: "Plan oracle-tightening",
		WorkerTab:  "61483cd6",
		Reply:      reply,
		Docs:       []string{"docs/superpowers/plans/2026-11-25-a.md", `C:\work\docs\superpowers\specs\b.md`},
		Note:       "  mind the §16 threshold  ",
	})
	for _, want := range []string{
		`"Plan oracle-tightening" (tab 61483cd6)`, // whose work it judges
		"docs/superpowers/plans/2026-11-25-a.md",  // the plan and the spec, by path
		`C:\work\docs\superpowers\specs\b.md`,
		"it is not pasted",
		"Read the real code before you conclude",
		"cite file:line",
		"rank your findings",
		"do not edit files",
		"do not run heavy commands",
		"never with wsh agents send",
		"mark items by their number", // it reads the block and marks by number
		"you write no list of your own",
		"Start your reply with `> `",
		"A note from the person:\nmind the §16 threshold\n",
		"--- the agent's latest reply ---\n" + reply + "\n--- end of the reply ---",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("the brief does not hold %q:\n%s", want, got)
		}
	}
}

// the example fence of the brief is a block arcterm reads, and it reads it the way the brief says
func TestJudgeBriefExampleFenceParses(t *testing.T) {
	brief := JudgeBrief(JudgeBriefInput{WorkerName: "w", WorkerTab: "t"})
	marks, ok := JudgeMarks(brief)
	if !ok || len(marks.Reopen) != 1 || marks.Reopen[0].Num != 2 || len(marks.New) != 1 {
		t.Fatalf("the example fence reads as %#v, ok %v", marks, ok)
	}
}

func TestJudgeBriefLeavesOutWhatItHasNot(t *testing.T) {
	got := JudgeBrief(JudgeBriefInput{WorkerName: "w", WorkerTab: "t", Note: "  "})
	for _, absent := range []string{"The plan or spec at hand", "A note from the person", "latest reply"} {
		if strings.Contains(got, absent) {
			t.Errorf("a brief with no docs, note or reply holds %q", absent)
		}
	}
}

func TestDocsAtHandNewestFirstAndDistinct(t *testing.T) {
	texts := []string{
		"Read docs/superpowers/specs/2026-11-01-old.md and `docs/superpowers/plans/2026-11-02-mid.md`.",
		"nothing here",
		"The plan is (docs/superpowers/plans/2026-11-02-mid.md), the spec C:\\work\\docs\\superpowers\\specs\\2026-11-25-new.md.",
		"also specs/short.md and the first one again: docs/superpowers/specs/2026-11-01-old.md",
	}
	got := DocsAtHand(texts)
	want := []string{
		"docs/superpowers/specs/2026-11-01-old.md",
		"specs/short.md",
		`C:\work\docs\superpowers\specs\2026-11-25-new.md`,
		"docs/superpowers/plans/2026-11-02-mid.md",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestDocsAtHandSkipsWhatIsNotAPlanOrSpecPath(t *testing.T) {
	got := DocsAtHand([]string{
		"the glob docs/superpowers/plans/*.md",
		"myplans/x.md and docs/myspecs/y.md",
		"docs/superpowers/plans/readme.mdx and docs/superpowers/plans/notes.txt",
		"docs/superpowers/briefs/z.md",
		"a sentence ending in docs/superpowers/plans/end.md.",
	})
	want := []string{"docs/superpowers/plans/end.md"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
	if got := DocsAtHand(nil); got == nil || len(got) != 0 {
		t.Fatalf("no texts: got %#v, want an empty slice", got)
	}
}

func TestWorkerBriefHoldsWhatTheSpecSays(t *testing.T) {
	got := WorkerBrief([]string{"4c6ba858"})
	for _, want := range []string{
		`a judge, "4c6ba858"`,
		"relayed",
		"never with wsh agents send",
		"End every reply with an `arc-pair` block",
		"never reuse one",
		"List every item each time",
		"naming its number",
		"A item does not stop the exchange",
		"Held:",
		"light commands",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("the worker brief does not hold %q:\n%s", want, got)
		}
	}
	if two := WorkerBrief([]string{"a", "b"}); !strings.Contains(two, `judges, "a" and "b"`) {
		t.Errorf("two judges: %s", two)
	}
	if three := WorkerBrief([]string{"a", "b", "c"}); !strings.Contains(three, `judges, "a", "b" and "c"`) {
		t.Errorf("three judges: %s", three)
	}
	if none := WorkerBrief(nil); !strings.Contains(none, "paired you with a judge.") {
		t.Errorf("no names: %s", none)
	}
}

// the example fence of the brief is a block arcterm reads, and it reads it the way the brief says
func TestWorkerBriefExampleFenceParses(t *testing.T) {
	items, ok := WorkerBlock(WorkerBrief([]string{"j"}))
	if !ok || len(items) != 3 {
		t.Fatalf("the example fence reads as %#v, ok %v", items, ok)
	}
	if items[0].Kind != KindAgreed || items[1].Kind != KindOpen || items[1].Note == "" || items[2].Kind != KindAsks || len(items[2].Chips) != 2 {
		t.Fatalf("the example fence reads as %#v", items)
	}
}

func TestRelayPromptOneBatchWithHeads(t *testing.T) {
	ts1 := time.Date(2026, 11, 25, 14, 5, 0, 0, time.Local).UnixMilli()
	ts2 := time.Date(2026, 11, 25, 14, 9, 0, 0, time.Local).UnixMilli()
	got := RelayPrompt([]RelayItem{
		{From: FromJudge, Name: "oracle review", Tab: "j1", Ts: ts1, Text: "> the plan\nReopen it.\n" + judgeBlock("reopen D2: no")},
		{From: FromPerson, Ts: ts2, Text: "50% is fine"},
		{From: FromJudge, Tab: "j2", Text: "second judge, no name or time"},
	}, "")
	want := "From the judge \"oracle review\", 14:05:\n> the plan\nReopen it.\n" + judgeBlock("reopen D2: no") +
		"\n\nFrom the person (typed in arcterm, not an agent), 14:09:\n50% is fine" +
		"\n\nFrom the judge \"j2\":\nsecond judge, no name or time"
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
}

func TestRelayPromptWorkerMessageAndFirstPrompt(t *testing.T) {
	brief := WorkerBrief([]string{"j"})
	got := RelayPrompt([]RelayItem{{From: FromWorker, Name: "Plan", Text: "Plan A"}}, brief)
	if !strings.HasPrefix(got, brief+"\n\nFrom the working agent \"Plan\":\nPlan A") || !strings.HasSuffix(got, "Plan A") {
		t.Fatalf("got\n%s", got)
	}
	if !strings.Contains(RelayPrompt([]RelayItem{{From: FromPerson, Text: "x"}}, ""), "typed in arcterm, not an agent") {
		t.Fatal("the person's message is not marked as the person's")
	}
	if strings.Contains(RelayPrompt([]RelayItem{{From: FromWorker, Name: "Plan", Text: "x"}}, ""), "arc-pair") {
		t.Fatal("a prompt with no first-prompt text holds the brief")
	}
	if RelayPrompt(nil, "") != "" {
		t.Fatal("an empty batch is not empty")
	}
}
