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

// a reply the agent has gone on from: one paragraph before the paste names the transcript and the record, and the paste
// is "the agent's reply", not "the latest"
func TestJudgeBriefOfAnOlderReplyNamesTheTranscript(t *testing.T) {
	in := JudgeBriefInput{
		WorkerName: "w", WorkerTab: "t", Reply: "An older reply.",
		Transcript: `C:\Users\me\.claude\projects\p\s1.jsonl`, Record: "a1b2-c3", Later: true,
	}
	got := JudgeBrief(in)
	paragraph := `The agent has gone on since this reply. Its transcript is C:\Users\me\.claude\projects\p\s1.jsonl and the reply is the record a1b2-c3 in it: ` +
		"read what it did after it there if it bears on your judgement, and judge the code as it is now."
	paste := "\n--- the agent's reply ---\nAn older reply.\n--- end of the reply ---"
	for _, want := range []string{paragraph, paste} {
		if !strings.Contains(got, want) {
			t.Errorf("the brief does not hold %q:\n%s", want, got)
		}
	}
	if strings.Index(got, paragraph) > strings.Index(got, paste) {
		t.Errorf("the paragraph comes after the paste:\n%s", got)
	}
	if strings.Contains(got, "latest reply") {
		t.Errorf("a brief of an older reply says it is the latest:\n%s", got)
	}
	// the rest of the brief is today's
	today := JudgeBrief(JudgeBriefInput{WorkerName: "w", WorkerTab: "t", Reply: "An older reply."})
	if head := strings.SplitN(today, "\n--- the agent's latest reply ---", 2)[0]; !strings.HasPrefix(got, head) {
		t.Errorf("the brief of an older reply does not open as today's does")
	}
}

// with no Later the brief is byte for byte the one it was: the transcript and the record are not mentioned
func TestJudgeBriefWithoutLaterIsTodays(t *testing.T) {
	plain := JudgeBriefInput{WorkerName: "w", WorkerTab: "t", Reply: "The latest.", Docs: []string{"docs/plans/a.md"}, Note: "mind it"}
	withFacts := plain
	withFacts.Transcript, withFacts.Record = "/t/s1.jsonl", "a1"
	if JudgeBrief(plain) != JudgeBrief(withFacts) {
		t.Errorf("a transcript and a record with no Later change the brief:\n%s\n---\n%s", JudgeBrief(plain), JudgeBrief(withFacts))
	}
	if !strings.Contains(JudgeBrief(plain), "\n--- the agent's latest reply ---\nThe latest.\n--- end of the reply ---\n") {
		t.Errorf("today's brief lost its delimiters:\n%s", JudgeBrief(plain))
	}
	// no reply, no paragraph: it points at the reply that is pasted
	empty := JudgeBrief(JudgeBriefInput{WorkerName: "w", WorkerTab: "t", Later: true, Transcript: "/t/s1.jsonl", Record: "a1"})
	if strings.Contains(empty, "gone on since") || strings.Contains(empty, "--- the agent's") {
		t.Errorf("a brief with no reply holds the paragraph or the paste:\n%s", empty)
	}
}

// the working agent is told, in its first prompt, which of its replies the judge is judging
func TestOlderReplyNoteSaysFromWhenAndToWeighIt(t *testing.T) {
	ts := time.Date(2026, 11, 26, 15, 4, 0, 0, time.Local).UnixMilli()
	got := OlderReplyNote(ts)
	for _, want := range []string{"judging your reply from 15:04", "weigh its judgement against what you have done since"} {
		if !strings.Contains(got, want) {
			t.Errorf("the note does not hold %q: %s", want, got)
		}
	}
	// no time known: it still says the reply is an older one, and shows no time
	if none := OlderReplyNote(0); !strings.Contains(none, "an earlier reply of yours") || strings.Contains(none, "from") {
		t.Errorf("a note with no time reads %q", none)
	}
}

// at no new points the judge first sums the pair up for the person, in a summary line of the same block; a message of the
// person that arrives with the agent's answer is judged through that answer
func TestJudgeBriefAsksForASummaryAtNoNewPoints(t *testing.T) {
	got := JudgeBrief(JudgeBriefInput{WorkerName: "w", WorkerTab: "t"})
	for _, want := range []string{
		"a few sentences",
		"the person's language",
		"agent's answer to it", // a person's message reaches the judge with the answer
		"judge that answer",
		"do not answer the person yourself",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("the brief does not hold %q:\n%s", want, got)
		}
	}
	// the summary line is asked for in the bullet that explains no new points, above that line
	var bullet string
	for line := range strings.SplitSeq(got, "\n") {
		if strings.HasPrefix(line, "- `no new points`") {
			bullet = line
		}
	}
	if bullet == "" || !strings.Contains(bullet, "`summary: ") || !strings.Contains(bullet, "above it") {
		t.Errorf("the no-new-points bullet does not ask for a summary line above it: %q", bullet)
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
