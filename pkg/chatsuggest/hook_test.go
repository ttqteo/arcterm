// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chatsuggest

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"time"
)

func fastHooks() *Hooks {
	h := NewHooks()
	h.appear = 200 * time.Millisecond
	h.max = 300 * time.Millisecond
	return h
}

const askReply = "Two ways.\n\nWant me to do A, or B?"

func TestHooksAwaitTakesTheModsAnswer(t *testing.T) {
	h := fastHooks()
	call := h.Begin("b1", Request{Reply: askReply, Recent: []string{"fix đi"}})
	if !call.Question || call.System != systemPrompt || !strings.Contains(call.Prompt, "fix đi") {
		t.Fatalf("Begin = %+v", call)
	}
	go func() {
		time.Sleep(20 * time.Millisecond)
		h.End("b1", call.Key, "làm A đi\nlàm B đi", false)
	}()
	out, ok := h.Await(context.Background(), "b1", askReply, true, true)
	if !ok || !reflect.DeepEqual(out.Replies, []string{"làm A đi", "làm B đi"}) {
		t.Fatalf("Await = %v %v", out, ok)
	}
}

// the mod's text is read by ParseAnswer when it ends, so the pick and the descriptions come back with the replies
func TestHooksEndKeepsThePickAndTheDescriptions(t *testing.T) {
	h := fastHooks()
	call := h.Begin("b1", Request{Reply: askReply})
	h.End("b1", call.Key, "làm A đi\n= sửa ở ba nơi\nlàm B đi\n= gom ở một nơi\nPICK 2: vì gom ở một nơi gọn hơn", false)
	out, ok := h.Await(context.Background(), "b1", askReply, true, false)
	want := Answer{
		Replies: []string{"làm A đi", "làm B đi"},
		Descs:   []string{"sửa ở ba nơi", "gom ở một nơi"},
		Pick:    "làm B đi",
		Reason:  "vì gom ở một nơi gọn hơn",
	}
	if !ok || !reflect.DeepEqual(out, want) {
		t.Fatalf("Await = %#v %v, want %#v", out, ok, want)
	}
}

// the key comes back as a process argument (`wsh chatsuggest end --key`), which holds no NUL or other control byte
func TestHooksKeyIsAProcessArgument(t *testing.T) {
	call := NewHooks().Begin("b1", Request{Reply: askReply})
	if strings.IndexFunc(call.Key, func(r rune) bool { return r < 0x21 || r == 0x7f }) >= 0 {
		t.Fatalf("Begin key %q holds a control byte or a space", call.Key)
	}
}

func TestHooksAwaitWaitsForABeginThatComesLate(t *testing.T) {
	h := fastHooks()
	go func() {
		time.Sleep(30 * time.Millisecond)
		call := h.Begin("b1", Request{Reply: askReply})
		h.End("b1", call.Key, "làm A đi", false)
	}()
	out, ok := h.Await(context.Background(), "b1", askReply, true, true)
	if !ok || !reflect.DeepEqual(out.Replies, []string{"làm A đi"}) {
		t.Fatalf("Await = %v %v", out, ok)
	}
}

func TestHooksAwaitGivesUp(t *testing.T) {
	cases := []struct {
		name   string
		expect bool
		begin  bool
		end    string // "" none, "ok", "failed"
	}{
		{"not a Claude agent and no begin: no wait", false, false, ""},
		{"no begin within the wait", true, false, ""},
		{"begun but never ended", true, true, ""},
		{"the mod got no answer", true, true, "failed"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := fastHooks()
			if c.begin {
				call := h.Begin("b1", Request{Reply: askReply})
				if c.end == "failed" {
					h.End("b1", call.Key, "", true)
				}
			}
			start := time.Now()
			if out, ok := h.Await(context.Background(), "b1", askReply, true, c.expect); ok {
				t.Fatalf("Await = %v, want no answer", out)
			}
			if !c.expect && time.Since(start) > 50*time.Millisecond {
				t.Fatalf("waited %v for an agent with no mod", time.Since(start))
			}
		})
	}
}

func TestHooksAwaitMatchesTheTurn(t *testing.T) {
	h := fastHooks()
	call := h.Begin("b1", Request{Reply: askReply})
	h.End("b1", call.Key, "làm A đi", false)
	// the same reply with other spacing is the same turn
	if out, ok := h.Await(context.Background(), "b1", "Two ways.\n\n  Want me to do A, or B?\n", true, false); !ok ||
		len(out.Replies) != 1 {
		t.Fatalf("respaced reply: %v %v", out, ok)
	}
	// another block, another reply, or a question read differently are not
	if _, ok := h.Await(context.Background(), "b2", askReply, true, false); ok {
		t.Fatal("another block took the answer")
	}
	if _, ok := h.Await(context.Background(), "b1", "Done, tests pass.", false, false); ok {
		t.Fatal("another reply took the answer")
	}
	if _, ok := h.Await(context.Background(), "b1", askReply, false, false); ok {
		t.Fatal("a reply Chat reads as no question took a question's answers")
	}
}

func TestHooksEndForAnOlderBeginIsDropped(t *testing.T) {
	h := fastHooks()
	old := h.Begin("b1", Request{Reply: "First turn. Run the tests?"})
	call := h.Begin("b1", Request{Reply: askReply})
	h.End("b1", old.Key, "chạy test đi", false)
	h.End("b1", call.Key, "làm A đi", false)
	h.End("b1", call.Key, "làm B đi", false) // a second end is dropped too
	out, ok := h.Await(context.Background(), "b1", askReply, true, false)
	if !ok || !reflect.DeepEqual(out.Replies, []string{"làm A đi"}) {
		t.Fatalf("Await = %v %v", out, ok)
	}
}

func TestHooksAwaitEndsWithTheAsk(t *testing.T) {
	h := fastHooks()
	h.Begin("b1", Request{Reply: askReply})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, ok := h.Await(ctx, "b1", askReply, true, true); ok {
		t.Fatal("a cancelled ask took an answer")
	}
}

func TestEndsWithQuestion(t *testing.T) {
	cases := []struct {
		reply string
		want  bool
	}{
		{"Want A or B?", true},
		{"Bạn muốn chờ hay làm luôn？", true},
		{"==Mình chạy A/B đó nhé?==", true},
		{"**Ship it?**", true},
		{"Which one?\n\n```arc-steps\n- [x] one\n```\n", true},
		{"Which one?\n\n```unclosed\ncode", true},
		{"Done. Tests pass.", false},
		{"Is it fixed? Yes, it is.", false},
		{"Muốn tôi chạy không? Mất khoảng 5 phút.", true},
		{"**Ship it?** Tests pass, and the build is green.", true},
		{"Run it? One. Two. Three.", false},
		{"Run it? " + strings.Repeat("a", 201), false},
		{"oracle có đáng tin không?'\"}},{\"type\":\"rectangle\"", false},
		{"Đã sửa chưa? Có, sửa rồi.", false},
		{"Sửa chưa? Không. Mai sửa.", false},
		{"", false},
	}
	for _, c := range cases {
		if got := EndsWithQuestion(c.reply); got != c.want {
			t.Errorf("EndsWithQuestion(%q) = %v, want %v", c.reply, got, c.want)
		}
	}
}

// the judge reads this sentence and never the ones before it, which may hold the agent's lean
func TestQuestionSentence(t *testing.T) {
	cases := []struct {
		name  string
		reply string
		want  string
	}{
		{"the lean before the question stays out", "Hướng B nhỏ hơn. Mình nghiêng A. A hay B?", "A hay B?"},
		{"a question before the last one stays out", "Bạn chọn gì? A hay B?", "A hay B?"},
		{"a colon ends a sentence, as the frontend reads it", "Hai cách: A hay B?", "A hay B?"},
		{"an ellipsis does not", "Còn… A hay B?", "Còn… A hay B?"},
		{"fullwidth question mark", "Hai hướng. Chọn A hay B？", "Chọn A hay B？"},
		{"fenced code after the question is no prose", "Mình nghiêng A. A hay B?\n\n```arc-steps\n- [x] một\n```\n", "A hay B?"},
		{"an unclosed fence after the question", "Mình nghiêng A. A hay B?\n\n```unclosed\ncode", "A hay B?"},
		{"highlight marks around it", "==Mình nghiêng A. A hay B?==", "A hay B?"},
		{"emphasis marks around it", "**Hướng nào, A hay B?**", "Hướng nào, A hay B?"},
		{"the last line of prose only", "Hai hướng:\n1. A\n2. B\n\nChọn A hay B?\n", "Chọn A hay B?"},
		{"marks inside the sentence stay", "Dùng **A** hay **B**?", "Dùng **A** hay **B**?"},
		{"a short tail after the question: the agent's lean", "Hỏi A hay B? Mình chọn A.", "Hỏi A hay B?"},
		{"a short tail after a marked question", "Mình nghiêng A. **A hay B?** Trả lời xong mình làm luôn.", "A hay B?"},
		{"the agent answers its own question", "Is it fixed? Yes, it is.", ""},
		{"a tail of three sentences", "A hay B? Một. Hai. Ba.", ""},
		{"a question on an earlier line", "A hay B?\nMình nghiêng A.", ""},
		{"only code after a statement", "Xong rồi.\n```go\nx := 1\n```", ""},
		{"empty", "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := QuestionSentence(c.reply); got != c.want {
				t.Errorf("QuestionSentence(%q) = %q, want %q", c.reply, got, c.want)
			}
			if c.want != "" && !EndsWithQuestion(c.reply) {
				t.Errorf("the case %q has a sentence but EndsWithQuestion says no: the two must agree", c.reply)
			}
			if c.want == "" && EndsWithQuestion(c.reply) {
				t.Errorf("the case %q has no sentence but EndsWithQuestion says yes: the two must agree", c.reply)
			}
		})
	}
}

func TestReplyKey(t *testing.T) {
	long := strings.Repeat("x ", 1000)
	if ReplyKey(long+"tail one") == ReplyKey(long+"tail two") {
		t.Fatal("the ends differ, the keys must")
	}
	if ReplyKey("head A "+long) != ReplyKey("head B "+long) {
		t.Fatal("only the reply's end names the turn")
	}
	if ReplyKey("a  b\n c") != ReplyKey("a b c") {
		t.Fatal("spacing must not matter")
	}
}

func TestHooksAwaitWhySaysWhyItTookNoAnswer(t *testing.T) {
	ctx := context.Background()
	wantWhy := func(t *testing.T, why, part string) {
		t.Helper()
		if !strings.Contains(why, part) {
			t.Fatalf("why = %q, want it to say %q", why, part)
		}
	}
	wantHeadless := func(t *testing.T, headless, want bool) {
		t.Helper()
		if headless != want {
			t.Fatalf("headless = %v, want %v", headless, want)
		}
	}
	t.Run("no begin", func(t *testing.T) {
		_, ok, why, headless := fastHooks().AwaitWhy(ctx, "b1", askReply, true, true)
		if ok {
			t.Fatal("took an answer")
		}
		wantWhy(t, why, "no begin within")
		wantHeadless(t, headless, true)
	})
	t.Run("no begin for a reply that asks nothing: no headless call", func(t *testing.T) {
		_, _, why, headless := fastHooks().AwaitWhy(ctx, "b1", "Done, the rail shows it.", false, true)
		wantWhy(t, why, "no begin within")
		wantHeadless(t, headless, false)
	})
	t.Run("not a Claude agent", func(t *testing.T) {
		_, _, why, headless := fastHooks().AwaitWhy(ctx, "b1", askReply, true, false)
		wantWhy(t, why, "not a Claude agent")
		wantHeadless(t, headless, true)
	})
	t.Run("not a Claude agent, a reply that asks nothing: still the headless call", func(t *testing.T) {
		_, _, _, headless := fastHooks().AwaitWhy(ctx, "b1", "Done, the rail shows it.", false, false)
		wantHeadless(t, headless, true)
	})
	t.Run("another reply begun: both ends shown, no headless call", func(t *testing.T) {
		h := fastHooks()
		h.Begin("b1", Request{Reply: "Done, the rail shows it."})
		_, _, why, headless := h.AwaitWhy(ctx, "b1", "Done, the rail shows it now.", false, true)
		wantWhy(t, why, "another reply's")
		wantWhy(t, why, `"Done, the rail shows it."`)
		wantWhy(t, why, `"Done, the rail shows it now."`)
		wantHeadless(t, headless, false)
	})
	t.Run("a stale ask: the mod begins a newer reply while it waits", func(t *testing.T) {
		h := fastHooks()
		go func() {
			time.Sleep(20 * time.Millisecond)
			h.Begin("b1", Request{Reply: askReply})
		}()
		_, ok, _, headless := h.AwaitWhy(ctx, "b1", "Building it now, then I'll merge.", false, true)
		if ok {
			t.Fatal("a stale ask took the newer reply's answer")
		}
		wantHeadless(t, headless, false)
	})
	t.Run("question differs", func(t *testing.T) {
		h := fastHooks()
		h.Begin("b1", Request{Reply: askReply})
		_, _, why, headless := h.AwaitWhy(ctx, "b1", askReply, false, true)
		wantWhy(t, why, "question differs")
		// Chat reads no question: the mod alone answers such a reply
		wantHeadless(t, headless, false)
		h = fastHooks()
		h.Begin("b1", Request{Reply: "Done, the rail shows it."})
		_, _, why, headless = h.AwaitWhy(ctx, "b1", "Done, the rail shows it.", true, true)
		wantWhy(t, why, "question differs")
		wantHeadless(t, headless, true)
	})
	t.Run("the mod got no answer", func(t *testing.T) {
		h := fastHooks()
		call := h.Begin("b1", Request{Reply: askReply})
		if got := h.End("b1", call.Key, "", true); got != "taken: the mod got no answer" {
			t.Fatalf("End = %q", got)
		}
		_, _, why, headless := h.AwaitWhy(ctx, "b1", askReply, true, true)
		wantWhy(t, why, "the mod got no answer")
		wantHeadless(t, headless, true)
	})
	t.Run("no end in time", func(t *testing.T) {
		h := fastHooks()
		h.Begin("b1", Request{Reply: askReply})
		_, _, why, headless := h.AwaitWhy(ctx, "b1", askReply, true, true)
		wantWhy(t, why, "did not end its turn within")
		wantHeadless(t, headless, true)
	})
	t.Run("taken", func(t *testing.T) {
		h := fastHooks()
		call := h.Begin("b1", Request{Reply: askReply})
		wantWhy(t, h.End("b1", call.Key, "làm A đi", false), "taken: 1 chips")
		out, ok, why, headless := h.AwaitWhy(ctx, "b1", askReply, true, true)
		if !ok || why != "" || headless || len(out.Replies) != 1 {
			t.Fatalf("AwaitWhy = %v %v %q %v", out, ok, why, headless)
		}
		wantWhy(t, h.End("b1", call.Key, "làm B đi", false), "already ended")
		wantWhy(t, h.End("b2", call.Key, "làm B đi", false), "no turn begun")
	})
}
