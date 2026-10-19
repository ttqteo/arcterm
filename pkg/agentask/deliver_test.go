// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentask

import (
	"errors"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

func oneQuestion() []baseds.AgentAskQuestion {
	return []baseds.AgentAskQuestion{{
		Question: "A or B?",
		Options:  []baseds.AgentAskOption{{Label: "A"}, {Label: "B"}},
	}}
}

func TestDeliverAnswer_NoPending(t *testing.T) {
	GlobalRegistry = MakeRegistry()
	delivered, err := DeliverAnswer("tab:none", "", []baseds.AgentAnswerItem{{SelectedIndexes: []int{0}}})
	if delivered || !errors.Is(err, ErrNoPendingAsk) {
		t.Fatalf("an answer to nothing must fail with ErrNoPendingAsk, got delivered=%v err=%v", delivered, err)
	}
}

func TestDeliverAnswer_Delivers(t *testing.T) {
	GlobalRegistry = MakeRegistry()
	GlobalRegistry.Set("tab:t1", PendingAsk{AskId: "a1", BlockId: "b1", Questions: oneQuestion()})
	var got [][]byte
	orig := sendInput
	sendInput = func(blockId string, data []byte) error { got = append(got, data); return nil }
	defer func() { sendInput = orig }()

	delivered, err := DeliverAnswer("tab:t1", "", []baseds.AgentAnswerItem{{SelectedIndexes: []int{1}}})
	if err != nil || !delivered {
		t.Fatalf("want (true,nil), got (%v,%v)", delivered, err)
	}
	// index 1 => one downArrow + enter
	if len(got) != 2 {
		t.Fatalf("want 2 keystrokes for index 1, got %d", len(got))
	}
}

func TestDeliverAnswer_RestoresOnEncodeError(t *testing.T) {
	GlobalRegistry = MakeRegistry()
	GlobalRegistry.Set("tab:t1", PendingAsk{AskId: "a1", BlockId: "b1", Questions: oneQuestion()})
	// index 5 is out of range for the 2-option question -> EncodeAnswer errors AFTER Claim.
	delivered, err := DeliverAnswer("tab:t1", "", []baseds.AgentAnswerItem{{SelectedIndexes: []int{5}}})
	if delivered || err == nil {
		t.Fatalf("want (false, err) on encode failure, got (%v, %v)", delivered, err)
	}
	if _, ok := GlobalRegistry.Get("tab:t1"); !ok {
		t.Fatalf("encode error must restore the pending ask (no keystrokes were sent)")
	}
}

func TestDeliverAnswer_NoRestoreOnInjectError(t *testing.T) {
	GlobalRegistry = MakeRegistry()
	GlobalRegistry.Set("tab:t1", PendingAsk{AskId: "a1", BlockId: "b1", Questions: oneQuestion()})
	orig := sendInput
	sendInput = func(string, []byte) error { return errors.New("pty gone") }
	defer func() { sendInput = orig }()

	delivered, err := DeliverAnswer("tab:t1", "", []baseds.AgentAnswerItem{{SelectedIndexes: []int{1}}})
	if delivered || err == nil {
		t.Fatalf("want (false, err) on inject failure, got (%v, %v)", delivered, err)
	}
	if _, ok := GlobalRegistry.Get("tab:t1"); ok {
		t.Fatalf("mid-inject error must NOT restore (a retry would double-send); entry stays claimed")
	}
}

func TestDeliverAnswer_ConcurrentInjectsOnce(t *testing.T) {
	GlobalRegistry = MakeRegistry()
	GlobalRegistry.Set("tab:t1", PendingAsk{AskId: "a1", BlockId: "b1", Questions: oneQuestion()})
	var mu sync.Mutex
	var writes int
	orig := sendInput
	sendInput = func(string, []byte) error { mu.Lock(); writes++; mu.Unlock(); return nil }
	defer func() { sendInput = orig }()

	const n = 16
	var delivers int32
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			if ok, _ := DeliverAnswer("tab:t1", "", []baseds.AgentAnswerItem{{SelectedIndexes: []int{1}}}); ok {
				atomic.AddInt32(&delivers, 1)
			}
		}()
	}
	wg.Wait()
	if delivers != 1 {
		t.Fatalf("delivered=true count = %d, want exactly 1", delivers)
	}
	// index 1 => exactly one full sequence (downArrow + enter = 2 writes), never doubled.
	if writes != 2 {
		t.Fatalf("keystroke writes = %d, want 2 (one full sequence)", writes)
	}
}

func TestDeliverAnswerResolvesWaiterWithoutKeystrokes(t *testing.T) {
	GlobalRegistry = MakeRegistry()
	GlobalRegistry.Set("tab:t1", PendingAsk{AskId: "a1", BlockId: "b1", Questions: oneQuestion()})
	var writes int
	orig := sendInput
	sendInput = func(string, []byte) error { writes++; return nil }
	defer func() { sendInput = orig }()
	ch := GlobalRegistry.RegisterWaiter("a1")

	delivered, err := DeliverAnswer("tab:t1", "", []baseds.AgentAnswerItem{{SelectedIndexes: []int{1}}})
	if err != nil || !delivered {
		t.Fatalf("want (true,nil), got (%v,%v)", delivered, err)
	}
	if writes != 0 {
		t.Fatalf("waiter path must not inject keystrokes, got %d writes", writes)
	}
	select {
	case res := <-ch:
		if res.Cancelled || len(res.Answers) != 1 {
			t.Fatalf("bad waiter result: %#v", res)
		}
	default:
		t.Fatal("waiter must be resolved")
	}
	// claim semantics preserved: the pending ask is gone after delivery
	if _, ok := GlobalRegistry.Get("tab:t1"); ok {
		t.Fatal("pending ask must be claimed")
	}
}

const quotedNotesAnswer = "Approve\n\n> a passage\nreword it"

// a terminal takes one line, so an answer carrying quoted notes is folded onto it rather than refused after the
// cockpit already showed it as sent.
func TestDeliverAnswerFoldsMultilineText(t *testing.T) {
	const want = "Approve | > a passage | reword it"
	cases := map[string]PendingAsk{
		"picker": {AskId: "a1", BlockId: "b1", Questions: oneQuestion()},
		"prose":  prosePending(),
	}
	for name, pending := range cases {
		GlobalRegistry = MakeRegistry()
		GlobalRegistry.Set("tab:t1", pending)
		var typed []byte
		var last []byte
		orig := sendInput
		sendInput = func(blockId string, data []byte) error {
			last = data
			if string(data) != string(downArrow) && data[0] != enter {
				typed = append(typed, data...)
			}
			return nil
		}
		delivered, err := DeliverAnswer("tab:t1", "", []baseds.AgentAnswerItem{{Text: quotedNotesAnswer}})
		sendInput = orig
		if err != nil || !delivered {
			t.Fatalf("%s: want (true,nil), got (%v,%v)", name, delivered, err)
		}
		if string(typed) != want {
			t.Fatalf("%s: typed %q, want %q", name, typed, want)
		}
		if len(last) != 1 || last[0] != enter {
			t.Fatalf("%s: want enter last, got %q", name, last)
		}
	}
}

func TestDeliverAnswerWaiterKeepsMultilineText(t *testing.T) {
	GlobalRegistry = MakeRegistry()
	GlobalRegistry.Set("tab:t1", PendingAsk{AskId: "a1", BlockId: "b1", Questions: oneQuestion()})
	stubKeys(t)
	ch := GlobalRegistry.RegisterWaiter("a1")
	answers := []baseds.AgentAnswerItem{{Text: quotedNotesAnswer}}

	if delivered, err := DeliverAnswer("tab:t1", "", answers); err != nil || !delivered {
		t.Fatalf("want (true,nil), got (%v,%v)", delivered, err)
	}
	select {
	case res := <-ch:
		if len(res.Answers) != 1 || res.Answers[0].Text != quotedNotesAnswer {
			t.Fatalf("a waiter reads the answer as JSON, so its line breaks stay: %#v", res)
		}
	default:
		t.Fatal("waiter must be resolved")
	}
}

func TestFoldAnswerLines(t *testing.T) {
	cases := map[string]string{
		"no break at all":       "no break at all",
		"  padded, no break  ":  "  padded, no break  ",
		"":                      "",
		"a\r\nb":                "a | b",
		"a\n\n\n\nb":            "a | b",
		"a \t\n\t b":            "a | b",
		"a\rb":                  "a | b",
		"\n\na\nb\r\n":          "a | b",
		"a  \n \n  b c":         "a | b c",
		"\n":                    "",
		"a | b\nc":              "a | b | c",
		quotedNotesAnswer:       "Approve | > a passage | reword it",
		"Approve\n\n> q\n\n> r": "Approve | > q | > r",
	}
	for in, want := range cases {
		if got := foldAnswerLines(in); got != want {
			t.Errorf("foldAnswerLines(%q) = %q, want %q", in, got, want)
		}
	}
}

// a typed answer never mutates what the caller holds: the same slice is what a waiter would have received.
func TestDeliverAnswerFoldsMultilineTextLeavesCallerAnswers(t *testing.T) {
	GlobalRegistry = MakeRegistry()
	GlobalRegistry.Set("tab:t1", prosePending())
	stubKeys(t)
	answers := []baseds.AgentAnswerItem{{Text: quotedNotesAnswer}}
	if delivered, err := DeliverAnswer("tab:t1", "", answers); err != nil || !delivered {
		t.Fatalf("want (true,nil), got (%v,%v)", delivered, err)
	}
	if answers[0].Text != quotedNotesAnswer {
		t.Fatalf("caller's answer was rewritten to %q", answers[0].Text)
	}
}

// a session answer the agent does not clear within the timeout comes back to the human with the note —
// the RPC already returned true on the last keystroke, so this is the only signal that it never landed.
func TestDeliverAnswer_SessionAskAwaitsClear(t *testing.T) {
	GlobalRegistry = MakeRegistry()
	GlobalRegistry.Set("tab:t1", PendingAsk{AskId: "a1", BlockId: "b1", Questions: oneQuestion()})
	orig := sendInput
	sendInput = func(string, []byte) error { return nil }
	defer func() { sendInput = orig }()

	if ok, err := DeliverAnswer("tab:t1", "", []baseds.AgentAnswerItem{{SelectedIndexes: []int{1}}}); err != nil || !ok {
		t.Fatalf("want (true,nil), got (%v,%v)", ok, err)
	}
	later := time.Now().Add(AnswerClearTimeout + time.Second).UnixMilli()
	got, ok := GlobalRegistry.ExpireClears(later, AnswerClearTimeout)["tab:t1"]
	if !ok || got.Note != AnswerUnconfirmedNote {
		t.Fatalf("want the unconfirmed session answer restored with its note, got %+v (ok=%v)", got, ok)
	}
}

func TestDeliverAnswer_SessionAskConfirmedClearIsNotRestored(t *testing.T) {
	GlobalRegistry = MakeRegistry()
	GlobalRegistry.Set("tab:t1", PendingAsk{AskId: "a1", BlockId: "b1", Questions: oneQuestion()})
	orig := sendInput
	sendInput = func(string, []byte) error { return nil }
	defer func() { sendInput = orig }()

	if ok, err := DeliverAnswer("tab:t1", "", []baseds.AgentAnswerItem{{SelectedIndexes: []int{1}}}); err != nil || !ok {
		t.Fatalf("want (true,nil), got (%v,%v)", ok, err)
	}
	if !GlobalRegistry.ConfirmClear("tab:t1") {
		t.Fatal("want the clear confirmed")
	}
	later := time.Now().Add(AnswerClearTimeout + time.Second).UnixMilli()
	if got := GlobalRegistry.ExpireClears(later, AnswerClearTimeout); len(got) != 0 {
		t.Fatalf("a confirmed clear must not be restored, got %+v", got)
	}
}

func prosePending() PendingAsk {
	return PendingAsk{AskId: "p1", BlockId: "b1", Prose: true, Questions: oneQuestion()}
}

func TestDeliverAnswer_ProseTypesText(t *testing.T) {
	GlobalRegistry = MakeRegistry()
	GlobalRegistry.Set("tab:t1", prosePending())
	var got [][]byte
	orig := sendInput
	sendInput = func(blockId string, data []byte) error { got = append(got, data); return nil }
	defer func() { sendInput = orig }()

	delivered, err := DeliverAnswer("tab:t1", "", []baseds.AgentAnswerItem{{Text: "B"}})
	if err != nil || !delivered {
		t.Fatalf("want (true,nil), got (%v,%v)", delivered, err)
	}
	// prose: raw text + enter, NO arrow prefix
	if len(got) != 2 || string(got[0]) != "B" || got[1][0] != enter {
		t.Fatalf("want [B, enter], got %q", got)
	}
}

func TestDeliverAnswer_ProseResolvesIndexToLabel(t *testing.T) {
	GlobalRegistry = MakeRegistry()
	GlobalRegistry.Set("tab:t1", prosePending())
	var got [][]byte
	orig := sendInput
	sendInput = func(blockId string, data []byte) error { got = append(got, data); return nil }
	defer func() { sendInput = orig }()

	delivered, err := DeliverAnswer("tab:t1", "", []baseds.AgentAnswerItem{{SelectedIndexes: []int{1}}})
	if err != nil || !delivered {
		t.Fatalf("want (true,nil), got (%v,%v)", delivered, err)
	}
	if len(got) != 2 || string(got[0]) != "B" {
		t.Fatalf("want typed label B, got %q", got)
	}
}

func TestDeliverAnswer_ProseRejectsInvalidAnswers(t *testing.T) {
	GlobalRegistry = MakeRegistry()
	GlobalRegistry.Set("tab:t1", prosePending())
	cases := [][]baseds.AgentAnswerItem{
		{{Text: ""}},                     // empty text, no index
		{{Text: "a\x01b"}},               // control char
		{{SelectedIndexes: []int{9}}},    // out of range
		{{SelectedIndexes: []int{0, 1}}}, // multi-select shape
		{},                              // no answers
	}
	for _, answers := range cases {
		GlobalRegistry = MakeRegistry()
		GlobalRegistry.Set("tab:t1", prosePending())
		if _, err := DeliverAnswer("tab:t1", "", answers); err == nil {
			t.Fatalf("want error for answers %+v", answers)
		}
	}
}

// a prose answer typed for a dag task is the engine's to skip exactly once when it reads the child's transcript; an
// answer that never reached the terminal leaves nothing behind to hide the human's own words.
func TestDeliverAnswer_ProseForADagTaskIsTakenOnce(t *testing.T) {
	GlobalRegistry = MakeRegistry()
	stubKeys(t)
	p := prosePending()
	p.DagOID, p.TaskId = "g1", "t-0"
	GlobalRegistry.Set("block:b1", p)
	before := time.Now().UnixMilli()
	if ok, err := DeliverAnswer("block:b1", "", []baseds.AgentAnswerItem{{Text: "B"}}); !ok || err != nil {
		t.Fatalf("want (true,nil), got (%v,%v)", ok, err)
	}
	if GlobalRegistry.TakeTypedAnswer("g1", "t-0", "B", before-1) {
		t.Fatal("a prompt from before the answer was typed is not the answer")
	}
	if GlobalRegistry.TakeTypedAnswer("g1", "t-1", "B", time.Now().UnixMilli()) {
		t.Fatal("another task's prompt is not this task's answer")
	}
	if !GlobalRegistry.TakeTypedAnswer("g1", "t-0", " B ", time.Now().UnixMilli()) {
		t.Fatal("want the typed answer taken")
	}
	if GlobalRegistry.TakeTypedAnswer("g1", "t-0", "B", time.Now().UnixMilli()) {
		t.Fatal("the same words typed again are the human's")
	}

	GlobalRegistry.Set("block:b1", p)
	sendInput = func(string, []byte) error { return errors.New("pty gone") }
	if _, err := DeliverAnswer("block:b1", "", []baseds.AgentAnswerItem{{Text: "B"}}); err == nil {
		t.Fatal("want the send error")
	}
	if GlobalRegistry.TakeTypedAnswer("g1", "t-0", "B", time.Now().UnixMilli()) {
		t.Fatal("an answer that was never submitted must not hide a prompt")
	}
}

// only an answer typed for a known dag task is recorded: without both ids there is no task whose transcript to read
func TestDeliverAnswer_ProseWithoutDagIsNotTaken(t *testing.T) {
	GlobalRegistry = MakeRegistry()
	stubKeys(t)
	p := prosePending()
	p.TaskId = "t-0"
	GlobalRegistry.Set("block:b1", p)
	if ok, err := DeliverAnswer("block:b1", "", []baseds.AgentAnswerItem{{Text: "B"}}); !ok || err != nil {
		t.Fatalf("want (true,nil), got (%v,%v)", ok, err)
	}
	if GlobalRegistry.TakeTypedAnswer("", "t-0", "B", time.Now().UnixMilli()) {
		t.Fatal("an answer for a task with no dag must not be recorded")
	}
}

// a picker answer types no prompt, so even for a dag task there is nothing for the engine to skip
func TestDeliverAnswer_PickerAnswerForADagTaskIsNotTaken(t *testing.T) {
	GlobalRegistry = MakeRegistry()
	stubKeys(t)
	GlobalRegistry.Set("block:b1", PendingAsk{AskId: "a1", BlockId: "b1", Questions: oneQuestion(), DagOID: "g1", TaskId: "t-0"})
	if ok, err := DeliverAnswer("block:b1", "", []baseds.AgentAnswerItem{{SelectedIndexes: []int{0}}}); !ok || err != nil {
		t.Fatalf("want (true,nil), got (%v,%v)", ok, err)
	}
	if GlobalRegistry.TakeTypedAnswer("g1", "t-0", "", time.Now().UnixMilli()) {
		t.Fatal("a picker answer must not be recorded as typed")
	}
}

// keystrokes go one per write with KeystrokeDelay between each, and the first goes before any sleep.
// the sleep has no seam, so the delivering goroutine's stack is watched for it rather than timing the
// first keystroke: a stalled scheduler can only make the watcher miss a sleep, never invent one.
func TestDeliverAnswer_SpacesKeystrokes(t *testing.T) {
	GlobalRegistry = MakeRegistry()
	GlobalRegistry.Set("tab:t1", PendingAsk{AskId: "a1", BlockId: "b1", Questions: oneQuestion()})
	var mu sync.Mutex
	var at []time.Time
	orig := sendInput
	sendInput = func(string, []byte) error { mu.Lock(); at = append(at, time.Now()); mu.Unlock(); return nil }
	defer func() { sendInput = orig }()
	sent := func() int { mu.Lock(); defer mu.Unlock(); return len(at) }

	type result struct {
		ok  bool
		err error
	}
	done := make(chan result, 1)
	go func() {
		ok, err := DeliverAnswer("tab:t1", "", []baseds.AgentAnswerItem{{SelectedIndexes: []int{1}}})
		done <- result{ok, err}
	}()
	sleptFirst := false
	var res result
	returned := false
	buf := make([]byte, 1<<20)
	for !returned {
		// the stack is read before the count, so a sleep seen while nothing was sent came before the first key
		stacks := string(buf[:runtime.Stack(buf, true)])
		if sent() > 0 {
			break
		}
		select {
		case res = <-done:
			// a return with nothing sent would otherwise spin this loop until go's test timeout
			if n := sent(); n == 0 {
				t.Fatalf("DeliverAnswer returned (%v,%v) with %d keystrokes sent", res.ok, res.err, n)
			}
			returned = true
			continue
		default:
		}
		for _, g := range strings.Split(stacks, "\n\n") {
			if strings.Contains(g, "time.Sleep(") && strings.Contains(g, "agentask.injectAnswer(") {
				sleptFirst = true
			}
		}
		runtime.Gosched()
	}
	if !returned {
		res = <-done
	}
	if !res.ok || res.err != nil {
		t.Fatalf("want (true,nil), got (%v,%v)", res.ok, res.err)
	}
	if sleptFirst {
		t.Fatal("the first keystroke must not wait, but a sleep ran before it")
	}
	if len(at) != 2 {
		t.Fatalf("want 2 keystrokes for index 1, got %d", len(at))
	}
	if gap := at[1].Sub(at[0]); gap < KeystrokeDelay {
		t.Fatalf("want at least %v between keystrokes, got %v", KeystrokeDelay, gap)
	}
}

// free text to a preview question lands as a prompt, so for a dag task it is the engine's to skip like a prose answer
func TestDeliverAnswer_FreeTextToPreviewQuestionIsTakenAsTyped(t *testing.T) {
	GlobalRegistry = MakeRegistry()
	stubKeys(t)
	qs := oneQuestion()
	qs[0].Options[0].Preview = "shown beside the list"
	GlobalRegistry.Set("block:b1", PendingAsk{AskId: "a1", BlockId: "b1", Questions: qs, DagOID: "g1", TaskId: "t-0"})
	if ok, err := DeliverAnswer("block:b1", "", []baseds.AgentAnswerItem{{Text: "use B"}}); !ok || err != nil {
		t.Fatalf("want (true,nil), got (%v,%v)", ok, err)
	}
	if !GlobalRegistry.TakeTypedAnswer("g1", "t-0", "use B", time.Now().UnixMilli()) {
		t.Fatal("want the typed answer taken")
	}
}
