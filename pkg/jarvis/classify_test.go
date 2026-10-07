// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func TestResolveGatekeeperPrinciplesFreshPerAsk(t *testing.T) {
	dir := t.TempDir()
	withConfigHome(t, dir)
	write := func(text string) {
		t.Helper()
		writeVaultProfile(t, dir, `{"principles":[{"id":"live","text":"`+text+`"}]}`)
	}

	write("first")
	if got := RenderPrinciples(resolveGatekeeperPrinciples(&waveobj.Channel{})); got != "- first" {
		t.Fatalf("first ask principles = %q", got)
	}
	write("second")
	if got := RenderPrinciples(resolveGatekeeperPrinciples(&waveobj.Channel{})); got != "- second" {
		t.Fatalf("second ask should resolve current principles, got %q", got)
	}
}

func aQuestion() baseds.AgentAskQuestion {
	return baseds.AgentAskQuestion{
		Question: "Which migration?",
		Options:  []baseds.AgentAskOption{{Label: "Use existing"}, {Label: "Create new"}},
	}
}

func TestBuildClassifyPrompt_Contents(t *testing.T) {
	c := &waveobj.Channel{Name: "payments-api"}
	p := BuildClassifyPrompt([]baseds.AgentAskQuestion{aQuestion()}, "harden webhooks", c, nil, nil)
	for _, want := range []string{"Which migration?", "0", "Use existing", "1", "Create new", "harden webhooks", "JSON"} {
		if !contains(p, want) {
			t.Fatalf("prompt missing %q\n---\n%s", want, p)
		}
	}
}

func TestBuildClassifyPrompt_IncludesPrinciples(t *testing.T) {
	c := &waveobj.Channel{Name: "payments-api"}
	p := BuildClassifyPrompt([]baseds.AgentAskQuestion{aQuestion()}, "harden webhooks", c, nil, waveobj.PrincipleList{{ID: "clean", Text: "prefer the clean fix"}})
	if !contains(p, "prefer the clean fix") {
		t.Fatalf("prompt missing principles\n---\n%s", p)
	}
}

func TestBuildClassifyPromptRendersEffectivePrinciplesOnly(t *testing.T) {
	c := &waveobj.Channel{Name: "payments-api"}
	resolved, _ := ResolvePrinciples(
		waveobj.PrincipleList{{ID: "simple", Text: "Prefer simple."}, {ID: "measure", Text: "Measure first."}},
		&waveobj.PrinciplePatch{
			Replacements: map[string]string{"simple": "Prefer direct fixes."},
			Disabled:     []string{"measure"},
			Additions:    waveobj.PrincipleList{{ID: "project", Text: "Preserve compatibility."}},
		},
	)
	p := BuildClassifyPrompt([]baseds.AgentAskQuestion{aQuestion()}, "harden webhooks", c, nil, resolved)
	if contains(p, "Prefer simple.") || contains(p, "Measure first.") {
		t.Fatalf("prompt contains superseded principles\n---\n%s", p)
	}
	if !contains(p, "- Prefer direct fixes.\n- Preserve compatibility.") {
		t.Fatalf("prompt does not render effective principles in order\n---\n%s", p)
	}
}

func TestBuildClassifyPrompt_OmitsEmptyPrinciples(t *testing.T) {
	c := &waveobj.Channel{Name: "payments-api"}
	p := BuildClassifyPrompt([]baseds.AgentAskQuestion{aQuestion()}, "harden webhooks", c, nil, nil)
	if contains(p, "principles") {
		t.Fatalf("empty principles should add no principles text\n---\n%s", p)
	}
}

// The prompt shows the judge every question, how many picks each takes, and every option by index, and offers a
// one-line text answer.
func TestBuildClassifyPrompt_RendersEveryQuestionAndMode(t *testing.T) {
	c := &waveobj.Channel{Name: "payments-api"}
	questions := []baseds.AgentAskQuestion{
		aQuestion(),
		{Question: "Which checks?", MultiSelect: true, Options: []baseds.AgentAskOption{{Label: "lint"}, {Label: "vet"}}},
	}
	p := BuildClassifyPrompt(questions, "harden webhooks", c, nil, nil)
	for _, want := range []string{
		"Question 1 (pick exactly one): Which migration?", "  0: Use existing", "  1: Create new",
		"Question 2 (pick one or more): Which checks?", "  0: lint", "  1: vet",
		`{"text":"<one line>"}`, `{"human":true}`,
	} {
		if !contains(p, want) {
			t.Fatalf("prompt missing %q\n---\n%s", want, p)
		}
	}
}

func TestParseDecision_ValidAnswer(t *testing.T) {
	d := ParseDecision(`{"action":"answer","answers":[{"picks":[0]}],"reason":"routine"}`)
	want := []baseds.AgentAnswerItem{{SelectedIndexes: []int{0}}}
	if d.Action != "answer" || !reflect.DeepEqual(d.Answers, want) || d.Reason != "routine" {
		t.Fatalf("want answer %+v, got %+v", want, d)
	}
}

// Each question's answer comes through in order, whether picks or text.
func TestParseDecision_ReadsEveryAnswer(t *testing.T) {
	d := ParseDecision(`{"action":"answer","answers":[{"picks":[1]},{"picks":[0,2]},{"text":"use the v2 schema"}],"reason":"routine"}`)
	want := []baseds.AgentAnswerItem{{SelectedIndexes: []int{1}}, {SelectedIndexes: []int{0, 2}}, {Text: "use the v2 schema"}}
	if d.Action != "answer" || !reflect.DeepEqual(d.Answers, want) {
		t.Fatalf("want answers %+v, got %+v", want, d)
	}
}

// All or nothing: one question marked for the human escalates the whole ask, even under action "answer".
func TestParseDecision_AnyHumanQuestionEscalatesAll(t *testing.T) {
	d := ParseDecision(`{"action":"answer","answers":[{"picks":[0]},{"human":true}],"reason":"q2 is a scope call"}`)
	if d.Action != "escalate" || d.Answers != nil || d.Reason != "q2 is a scope call" {
		t.Fatalf("want escalate with no answers, got %+v", d)
	}
}

func TestParseDecision_FailsSafe(t *testing.T) {
	cases := []string{
		``,                                    // empty
		`not json at all`,                     // prose
		`{"action":"answer"}`,                 // missing answers
		`{"action":"answer","answers":[]}`,    // empty answers
		`{"answers":[{"picks":[0]}]}`,         // missing action
		`{"action":"answer","answers":"a"}`,   // answers not a list
		`{"action":"maybe","answers":[{}]}`,   // unknown action
		`{"action":"answer","optionindex":0}`, // the retired single-index shape
	}
	for _, in := range cases {
		if d := ParseDecision(in); d.Action != "escalate" {
			t.Fatalf("want escalate for %q, got %+v", in, d)
		}
	}
}

func TestParseDecision_ProseWrappedJSON(t *testing.T) {
	// the model sometimes wraps JSON in prose; we extract the object
	d := ParseDecision("Sure!\n```json\n{\"action\":\"escalate\",\"reason\":\"ambiguous\"}\n```")
	if d.Action != "escalate" {
		t.Fatalf("want escalate, got %+v", d)
	}
}

func contains(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && indexOf(s, sub) >= 0)
}
func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func TestRecentTimeline_TruncatesLongLines(t *testing.T) {
	long := strings.Repeat("x", 5000)
	out := recentTimeline([]*waveobj.ChannelMessage{
		{Author: "worker", Text: long},
		{Author: "human", Text: "short"},
	})
	if !strings.Contains(out, "short") {
		t.Fatalf("short message dropped: %q", out)
	}
	if strings.Contains(out, long) {
		t.Fatalf("long message not truncated")
	}
	for _, line := range strings.Split(strings.TrimRight(out, "\n"), "\n") {
		if len([]rune(line)) > maxTimelineLine+len(line[:strings.Index(line, ": ")])+3 { // ": " + ellipsis
			t.Fatalf("line exceeds cap: %d runes", len([]rune(line)))
		}
	}
}

func TestRecentTimeline_MultibyteTruncation(t *testing.T) {
	long := strings.Repeat("é", maxTimelineLine+50)
	out := recentTimeline([]*waveobj.ChannelMessage{{Author: "w", Text: long}})
	if got := len([]rune(out)); got != 4+maxTimelineLine { // author + ": " + capped + ellipsis
		t.Fatalf("multibyte line not capped: %d runes", got)
	}
}
