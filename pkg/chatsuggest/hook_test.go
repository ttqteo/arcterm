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
	if !ok || !reflect.DeepEqual(out, []string{"làm A đi", "làm B đi"}) {
		t.Fatalf("Await = %v %v", out, ok)
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
	if !ok || !reflect.DeepEqual(out, []string{"làm A đi"}) {
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
		len(out) != 1 {
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
	if !ok || !reflect.DeepEqual(out, []string{"làm A đi"}) {
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
		{"", false},
	}
	for _, c := range cases {
		if got := EndsWithQuestion(c.reply); got != c.want {
			t.Errorf("EndsWithQuestion(%q) = %v, want %v", c.reply, got, c.want)
		}
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
	t.Run("no begin", func(t *testing.T) {
		_, ok, why := fastHooks().AwaitWhy(ctx, "b1", askReply, true, true)
		if ok {
			t.Fatal("took an answer")
		}
		wantWhy(t, why, "no begin within")
	})
	t.Run("not a Claude agent", func(t *testing.T) {
		_, _, why := fastHooks().AwaitWhy(ctx, "b1", askReply, true, false)
		wantWhy(t, why, "not a Claude agent")
	})
	t.Run("another reply begun: both ends shown", func(t *testing.T) {
		h := fastHooks()
		h.Begin("b1", Request{Reply: "Done, the rail shows it."})
		_, _, why := h.AwaitWhy(ctx, "b1", "Done, the rail shows it now.", false, true)
		wantWhy(t, why, "another reply's")
		wantWhy(t, why, `"Done, the rail shows it."`)
		wantWhy(t, why, `"Done, the rail shows it now."`)
	})
	t.Run("question differs", func(t *testing.T) {
		h := fastHooks()
		h.Begin("b1", Request{Reply: askReply})
		_, _, why := h.AwaitWhy(ctx, "b1", askReply, false, true)
		wantWhy(t, why, "question differs")
	})
	t.Run("the mod got no answer", func(t *testing.T) {
		h := fastHooks()
		call := h.Begin("b1", Request{Reply: askReply})
		if got := h.End("b1", call.Key, "", true); got != "taken: the mod got no answer" {
			t.Fatalf("End = %q", got)
		}
		_, _, why := h.AwaitWhy(ctx, "b1", askReply, true, true)
		wantWhy(t, why, "the mod got no answer")
	})
	t.Run("no end in time", func(t *testing.T) {
		h := fastHooks()
		h.Begin("b1", Request{Reply: askReply})
		_, _, why := h.AwaitWhy(ctx, "b1", askReply, true, true)
		wantWhy(t, why, "did not end its turn within")
	})
	t.Run("taken", func(t *testing.T) {
		h := fastHooks()
		call := h.Begin("b1", Request{Reply: askReply})
		wantWhy(t, h.End("b1", call.Key, "làm A đi", false), "taken: 1 chips")
		out, ok, why := h.AwaitWhy(ctx, "b1", askReply, true, true)
		if !ok || why != "" || len(out) != 1 {
			t.Fatalf("AwaitWhy = %v %v %q", out, ok, why)
		}
		wantWhy(t, h.End("b1", call.Key, "làm B đi", false), "already ended")
		wantWhy(t, h.End("b2", call.Key, "làm B đi", false), "no turn begun")
	})
}
