// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package telebot

import (
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/baseds"
)

func opts(labels ...string) []baseds.AgentAskOption {
	out := make([]baseds.AgentAskOption, len(labels))
	for i, l := range labels {
		out[i] = baseds.AgentAskOption{Label: l}
	}
	return out
}

func ask(id string, ts int64, qs ...baseds.AgentAskQuestion) agentask.PendingAsk {
	return agentask.PendingAsk{AskId: id, Ts: ts, Questions: qs}
}

func single(text string, labels ...string) baseds.AgentAskQuestion {
	return baseds.AgentAskQuestion{Question: text, Options: opts(labels...)}
}

func multi(text string, labels ...string) baseds.AgentAskQuestion {
	return baseds.AgentAskQuestion{Question: text, MultiSelect: true, Options: opts(labels...)}
}

// tracked starts tracking p under oref and records message ids 100, 101… for the questions sent so far (just the first).
func tracked(t *testing.T, tr *tracker, oref string, p agentask.PendingAsk) *askMsg {
	t.Helper()
	a := tr.track(dueAsk{Oref: oref, PendingAsk: p})
	tr.sent(a, 100+a.n*10)
	return a
}

func TestDueSkipsLeadOwnedGraceAndTracked(t *testing.T) {
	const now = int64(100_000)
	tr := newTracker()
	q := single("which?", "a", "b")
	lead := ask("lead", now-20_000, q)
	lead.Owner = agentask.AskOwner_Lead
	pending := map[string]agentask.PendingAsk{
		"block:lead":    lead,
		"block:young":   ask("young", now-3_000, q),
		"block:tracked": ask("tracked", now-20_000, q),
		"block:empty":   ask("empty", now-20_000),
		"block:ready":   ask("ready", now-GraceMs, q),
	}
	tracked(t, tr, "block:tracked", pending["block:tracked"])

	got := tr.due(pending, now)
	if len(got) != 1 || got[0].Oref != "block:ready" || got[0].AskId != "ready" {
		t.Fatalf("due = %+v, want only block:ready", got)
	}
}

func TestDueOldestFirst(t *testing.T) {
	const now = int64(100_000)
	tr := newTracker()
	q := single("which?", "a")
	got := tr.due(map[string]agentask.PendingAsk{
		"block:b": ask("b", now-30_000, q),
		"block:a": ask("a", now-50_000, q),
		"block:c": ask("c", now-20_000, q),
	}, now)
	var ids []string
	for _, d := range got {
		ids = append(ids, d.AskId)
	}
	if !reflect.DeepEqual(ids, []string{"a", "b", "c"}) {
		t.Fatalf("due order = %v, want [a b c]", ids)
	}
}

func TestDueTakesAskWhoseLeadHandedItToUser(t *testing.T) {
	const now = int64(100_000)
	tr := newTracker()
	p := ask("a1", now-20_000, single("which?", "a"))
	p.Owner = agentask.AskOwner_Lead
	if got := tr.due(map[string]agentask.PendingAsk{"block:x": p}, now); len(got) != 0 {
		t.Fatalf("lead-owned ask was due: %+v", got)
	}
	p.Owner = agentask.AskOwner_User
	if got := tr.due(map[string]agentask.PendingAsk{"block:x": p}, now); len(got) != 1 {
		t.Fatalf("ask handed to the user was not due: %+v", got)
	}
}

func TestGoneOnAnswerElsewhereAndReplace(t *testing.T) {
	tr := newTracker()
	q := single("which?", "a", "b")
	p1, p2 := ask("a1", 1, q), ask("a2", 1, q)
	a1 := tracked(t, tr, "block:1", p1)
	a2 := tracked(t, tr, "block:2", p2)

	// block:1's ask is gone from the registry; block:2's oref now holds a different ask.
	gone := tr.gone(map[string]agentask.PendingAsk{"block:2": ask("a2-new", 2, q)})
	if len(gone) != 2 || gone[0] != a1 || gone[1] != a2 {
		t.Fatalf("gone = %+v, want a1 then a2", gone)
	}
	if again := tr.gone(map[string]agentask.PendingAsk{}); len(again) != 0 {
		t.Fatalf("gone returned %d asks that were already forgotten", len(again))
	}
	if len(tr.byAsk) != 0 || len(tr.byN) != 0 || len(tr.byMsg) != 0 {
		t.Fatalf("forgotten asks are still tracked: %v %v %v", tr.byAsk, tr.byN, tr.byMsg)
	}
	// their messages answer "Already answered." now.
	if _, st := tr.onReply(a1.msgIDs[0], "x"); st.Reply != "Already answered." {
		t.Fatalf("reply to a forgotten ask: %+v", st)
	}
	// a gone ask leaves no tombstone: the same ask coming back pending is new business.
	if got := tr.due(map[string]agentask.PendingAsk{"block:1": ask("a1", 1, q)}, 100_000); len(got) != 1 {
		t.Fatalf("an ask that was answered elsewhere and is pending again was not due: %+v", got)
	}
}

func TestGoneKeepsLiveAsk(t *testing.T) {
	tr := newTracker()
	p := ask("a1", 1, single("which?", "a"))
	tracked(t, tr, "block:1", p)
	if gone := tr.gone(map[string]agentask.PendingAsk{"block:1": p}); len(gone) != 0 {
		t.Fatalf("a still-pending ask was reported gone: %+v", gone)
	}
}

func TestTapSingleSelectDelivers(t *testing.T) {
	tr := newTracker()
	a := tracked(t, tr, "block:1", ask("a1", 1, single("which?", "red", "green", "blue")))
	got, st := tr.onCallback("a:" + itoa(a.n) + ":0:1")
	if got != a {
		t.Fatalf("onCallback returned %v, want the ask", got)
	}
	if !st.Deliver || st.Next || st.Edit != "✓ green" {
		t.Fatalf("step = %+v, want Deliver with Edit ✓ green", st)
	}
	want := []baseds.AgentAnswerItem{{SelectedIndexes: []int{1}}}
	if !reflect.DeepEqual(a.answers, want) {
		t.Fatalf("answers = %+v, want %+v", a.answers, want)
	}
}

func TestProseTapDeliversLabelAsText(t *testing.T) {
	tr := newTracker()
	p := ask("a1", 1, single("which?", "red", "green"))
	p.Prose = true
	a := tracked(t, tr, "block:1", p)
	_, st := tr.onCallback("a:" + itoa(a.n) + ":0:1")
	if !st.Deliver {
		t.Fatalf("step = %+v, want Deliver", st)
	}
	want := []baseds.AgentAnswerItem{{Text: "green"}}
	if !reflect.DeepEqual(a.answers, want) {
		t.Fatalf("answers = %+v, want %+v", a.answers, want)
	}
}

func TestMultiSelectToggleThenSend(t *testing.T) {
	tr := newTracker()
	a := tracked(t, tr, "block:1", ask("a1", 1, multi("which?", "a", "b", "c")))
	n := itoa(a.n)

	if _, st := tr.onCallback("s:" + n + ":0"); st.Toast != "Pick at least one" || st.Deliver {
		t.Fatalf("Send with no picks: %+v", st)
	}
	if _, st := tr.onCallback("t:" + n + ":0:2"); !st.Rekey {
		t.Fatalf("toggle did not ask for a new keyboard: %+v", st)
	}
	if kb := keyboard(a); kb[2][0].Text != "☑ c" || kb[0][0].Text != "☐ a" {
		t.Fatalf("keyboard after toggling c = %+v", kb)
	}
	tr.onCallback("t:" + n + ":0:0")
	// toggling twice unticks.
	tr.onCallback("t:" + n + ":0:1")
	tr.onCallback("t:" + n + ":0:1")

	_, st := tr.onCallback("s:" + n + ":0")
	if !st.Deliver || st.Edit != "✓ a, c" {
		t.Fatalf("Send: %+v, want Deliver with Edit ✓ a, c", st)
	}
	want := []baseds.AgentAnswerItem{{SelectedIndexes: []int{0, 2}}}
	if !reflect.DeepEqual(a.answers, want) {
		t.Fatalf("answers = %+v, want %+v", a.answers, want)
	}
}

func TestMultiSelectProseSendsLabelsAsText(t *testing.T) {
	tr := newTracker()
	p := ask("a1", 1, multi("which?", "a", "b", "c"))
	p.Prose = true
	a := tracked(t, tr, "block:1", p)
	n := itoa(a.n)
	tr.onCallback("t:" + n + ":0:2")
	tr.onCallback("t:" + n + ":0:0")
	tr.onCallback("s:" + n + ":0")
	want := []baseds.AgentAnswerItem{{Text: "a, c"}}
	if !reflect.DeepEqual(a.answers, want) {
		t.Fatalf("answers = %+v, want %+v", a.answers, want)
	}
}

func TestMultiQuestionAdvances(t *testing.T) {
	tr := newTracker()
	a := tracked(t, tr, "block:1", ask("a1", 1, single("first?", "x", "y"), single("second?", "p", "q")))
	n := itoa(a.n)

	_, st := tr.onCallback("a:" + n + ":0:0")
	if !st.Next || st.Deliver || a.q != 1 {
		t.Fatalf("after the first tap: step %+v, q=%d, want Next with q=1", st, a.q)
	}
	if tr.byAsk["a1"] == nil {
		t.Fatalf("the ask was forgotten before its last question")
	}
	// the second question goes out as message 555.
	tr.sent(a, 555)
	if kb := keyboard(a); kb[0][0].Data != "a:"+n+":1:0" {
		t.Fatalf("second question keyboard = %+v", kb)
	}

	// a tap on the first question's old keyboard is refused.
	if _, st := tr.onCallback("a:" + n + ":0:1"); st.Toast != "Answer the latest question" || st.Deliver || st.Next {
		t.Fatalf("tap on an earlier question: %+v", st)
	}

	_, st = tr.onCallback("a:" + n + ":1:1")
	if !st.Deliver || st.Next {
		t.Fatalf("after the second tap: %+v, want Deliver", st)
	}
	want := []baseds.AgentAnswerItem{{SelectedIndexes: []int{0}}, {SelectedIndexes: []int{1}}}
	if !reflect.DeepEqual(a.answers, want) {
		t.Fatalf("answers = %+v, want %+v", a.answers, want)
	}
}

func TestReplyOnlyToCurrentQuestion(t *testing.T) {
	tr := newTracker()
	a := tracked(t, tr, "block:1", ask("a1", 1, single("first?", "x", "y"), single("second?", "p", "q")))
	first := a.msgIDs[0]
	tr.onCallback("a:" + itoa(a.n) + ":0:0") // answers question 0, now on question 1
	tr.sent(a, 777)

	if _, st := tr.onReply(first, "late"); st.Reply != "Answer the latest question." || st.Deliver || st.Next {
		t.Fatalf("reply to the earlier question: %+v", st)
	}
	if _, st := tr.onReply(424242, "hi"); st.Reply != FixedReply {
		t.Fatalf("reply to a message that is not ours: %+v", st)
	}
	got, st := tr.onReply(777, "  my own words \n")
	if got != a || !st.Deliver || st.Edit != `✓ "my own words"` {
		t.Fatalf("reply to the current question: ask %v, step %+v", got, st)
	}
	want := []baseds.AgentAnswerItem{{SelectedIndexes: []int{0}}, {Text: "my own words"}}
	if !reflect.DeepEqual(a.answers, want) {
		t.Fatalf("answers = %+v, want %+v", a.answers, want)
	}
}

func TestReplyAdvancesThroughQuestions(t *testing.T) {
	tr := newTracker()
	a := tracked(t, tr, "block:1", ask("a1", 1, single("first?", "x"), single("second?", "p")))
	_, st := tr.onReply(a.msgIDs[0], "free text")
	if !st.Next || st.Deliver || a.q != 1 {
		t.Fatalf("reply to the first question: %+v, q=%d", st, a.q)
	}
}

func TestReplyWithoutTextIsNotAnAnswer(t *testing.T) {
	tr := newTracker()
	a := tracked(t, tr, "block:1", ask("a1", 1, single("which?", "x")))
	_, st := tr.onReply(a.msgIDs[0], "   ")
	if st.Reply == "" || st.Deliver || st.Next || len(a.answers) != 0 {
		t.Fatalf("empty reply: %+v, answers %+v", st, a.answers)
	}
}

func TestReplyToForgottenAsk(t *testing.T) {
	tr := newTracker()
	a := tracked(t, tr, "block:1", ask("a1", 1, single("which?", "x")))
	msg := a.msgIDs[0]
	tr.forget(a)
	got, st := tr.onReply(msg, "too late")
	if got != nil || st.Reply != "Already answered." {
		t.Fatalf("reply to a forgotten ask: ask %v, step %+v", got, st)
	}
}

func TestClosedIsCapped(t *testing.T) {
	tr := newTracker()
	for i := range maxClosedIDs + 50 {
		a := tr.track(dueAsk{Oref: "block:x", PendingAsk: ask("a", 1, single("q", "x"))})
		tr.sent(a, i+1)
		tr.drop(a)
	}
	if len(tr.closed) != maxClosedIDs || len(tr.closedOrder) != maxClosedIDs {
		t.Fatalf("closed holds %d ids (order %d), want %d", len(tr.closed), len(tr.closedOrder), maxClosedIDs)
	}
	if tr.closed[1] || !tr.closed[maxClosedIDs+50] {
		t.Fatalf("the oldest id should have gone and the newest stayed")
	}
}

func TestDeliverForgetsAsk(t *testing.T) {
	tr := newTracker()
	p := ask("a1", 1, single("which?", "x", "y"))
	a := tracked(t, tr, "block:1", p)
	_, st := tr.onCallback("a:" + itoa(a.n) + ":0:0")
	if !st.Deliver {
		t.Fatalf("step = %+v, want Deliver", st)
	}
	// the delivered ask must not read as "answered elsewhere": the reconcile tick would overwrite its ✓ <label>.
	if gone := tr.gone(map[string]agentask.PendingAsk{}); len(gone) != 0 {
		t.Fatalf("gone returned the ask the bot just delivered: %+v", gone)
	}
}

func TestDeliveredAskIsNotSentAgainWhileStillPending(t *testing.T) {
	const now = int64(100_000)
	tr := newTracker()
	p := ask("a1", now-20_000, single("which?", "x", "y"))
	pending := map[string]agentask.PendingAsk{"block:1": p}
	a := tracked(t, tr, "block:1", p)
	if _, st := tr.onCallback("a:" + itoa(a.n) + ":0:0"); !st.Deliver {
		t.Fatalf("tap did not deliver")
	}

	// DeliverAnswer has not claimed the ask yet: a reconcile tick still finds it pending.
	if got := tr.due(pending, now); len(got) != 0 {
		t.Fatalf("a delivered ask that is still pending was due again: %+v", got)
	}
	if gone := tr.gone(pending); len(gone) != 0 {
		t.Fatalf("gone returned %+v for a delivered ask that is still pending", gone)
	}
	if !tr.delivered["a1"] {
		t.Fatalf("the tombstone went while the ask was still pending")
	}

	// the registry let it go: no edit, and the tombstone is cleared.
	if gone := tr.gone(map[string]agentask.PendingAsk{}); len(gone) != 0 {
		t.Fatalf("gone returned %+v once the delivered ask left pending", gone)
	}
	if len(tr.delivered) != 0 {
		t.Fatalf("the tombstone stayed after the ask left pending: %v", tr.delivered)
	}
}

func TestStaleCallback(t *testing.T) {
	tr := newTracker()
	got, st := tr.onCallback("a:999:0:0")
	if got != nil || st.Toast != "Already answered" || st.Edit != "✓ Answered in arcterm" {
		t.Fatalf("stale tap: ask %v, step %+v", got, st)
	}
	// a delivered ask's old buttons are stale too.
	a := tracked(t, tr, "block:1", ask("a1", 1, single("which?", "x", "y")))
	data := "a:" + itoa(a.n) + ":0:0"
	tr.onCallback(data)
	if got, st := tr.onCallback(data); got != nil || st.Toast != "Already answered" {
		t.Fatalf("second tap on a delivered ask: ask %v, step %+v", got, st)
	}
}

func TestMalformedCallbackIsIgnored(t *testing.T) {
	tr := newTracker()
	a := tracked(t, tr, "block:1", ask("a1", 1, single("which?", "x", "y")))
	n := itoa(a.n)
	for _, data := range []string{"", "a", "a:1", "a:" + n + ":0", "s:" + n + ":0:0", "a:x:0:0", "a:" + n + ":0:9", "a:" + n + ":0:-1", "t:" + n + ":0:9"} {
		if _, st := tr.onCallback(data); st != (step{}) {
			t.Errorf("onCallback(%q) = %+v, want no step", data, st)
		}
	}
	if len(a.answers) != 0 || a.q != 0 {
		t.Fatalf("a malformed tap changed the ask: %+v", a)
	}
}

func TestKeyboardCallbackDataUnder64Bytes(t *testing.T) {
	a := &askMsg{n: 999999, q: 9, questions: make([]baseds.AgentAskQuestion, 10)}
	labels := make([]string, 100)
	for i := range labels {
		labels[i] = "option"
	}
	a.questions[9] = multi("which?", labels...)
	a.picks = map[int]bool{99: true}
	kb := keyboard(a)
	if len(kb) != 101 {
		t.Fatalf("keyboard has %d rows, want 100 options + Send", len(kb))
	}
	for _, row := range kb {
		for _, b := range row {
			if len(b.Data) > 64 {
				t.Errorf("callback data %q is %d bytes", b.Data, len(b.Data))
			}
		}
	}
	if got := kb[99][0]; got.Data != "t:999999:9:99" || got.Text != "☑ option" {
		t.Errorf("last option button = %+v", got)
	}
	if got := kb[100][0]; got.Data != "s:999999:9" || got.Text != "Send" {
		t.Errorf("Send button = %+v", got)
	}
	a.questions[9].MultiSelect = false
	if got := keyboard(a)[99][0].Data; got != "a:999999:9:99" || len(got) > 64 {
		t.Errorf("single-select data = %q", got)
	}
}

func TestKeyboardCapsLabel(t *testing.T) {
	long := strings.Repeat("é", 60)
	a := &askMsg{n: 1, questions: []baseds.AgentAskQuestion{single("q", long, "short")}}
	kb := keyboard(a)
	if got := []rune(kb[0][0].Text); len(got) != 40 || got[39] != '…' {
		t.Fatalf("long label = %q (%d runes), want 40 ending in …", kb[0][0].Text, len(got))
	}
	if kb[1][0].Text != "short" {
		t.Fatalf("short label = %q", kb[1][0].Text)
	}
}

func TestQuestionTextCollapsesAndCaps(t *testing.T) {
	q := baseds.AgentAskQuestion{Header: "  Pick\n a   way ", Question: "Which\n\n  branch\tnow?"}
	want := "🤖 build agent\nPick a way\nWhich branch now?\n\nReply to this message to answer in your own words."
	if got := questionText("build  agent", q); got != want {
		t.Fatalf("questionText = %q, want %q", got, want)
	}
	if got := questionText("build agent", baseds.AgentAskQuestion{Question: "bare"}); strings.Contains(got, "\n\n\n") || !strings.HasPrefix(got, "🤖 build agent\nbare\n\n") {
		t.Fatalf("a question with no header = %q", got)
	}

	long := baseds.AgentAskQuestion{Question: strings.Repeat("ê", 1500)}
	body := strings.Split(questionText("x", long), "\n")[1]
	if r := []rune(body); len(r) != 1000 || r[999] != '…' {
		t.Fatalf("long question is %d runes, want 1000 ending in …", len(r))
	}
	exact := baseds.AgentAskQuestion{Question: strings.Repeat("a", 1000)}
	if body := strings.Split(questionText("x", exact), "\n")[1]; body != exact.Question {
		t.Fatalf("a question of exactly 1000 runes was cut")
	}
}

func itoa(n int) string { return strconv.Itoa(n) }
