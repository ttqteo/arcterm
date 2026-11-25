// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chatsuggest

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestParseAnswersAQuestion(t *testing.T) {
	got := ParseAnswer("1. B, và ẩn thẻ Pin\n- A\n\"C\"\n\nD\nE\nF\n", true).Replies
	want := []string{"B, và ẩn thẻ Pin", "A", "C", "D", "E"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ParseAnswer = %q, want %q", got, want)
	}
}

func TestParseNextStepKeepsOneAndNeverCommits(t *testing.T) {
	if got := ParseAnswer("commit đi\nvẽ tôi xem\nchạy test đi", false).Replies; !reflect.DeepEqual(got, []string{"vẽ tôi xem"}) {
		t.Fatalf("ParseAnswer = %q, want only the drawing", got)
	}
	if got := ParseAnswer("ok, push it", false).Replies; len(got) != 0 {
		t.Fatalf("ParseAnswer = %q, want nothing: a push is the rules' chip", got)
	}
}

func TestParseAQuestionMayAnswerWithACommit(t *testing.T) {
	// "muốn tôi commit không?" is answered with a commit: the rules hold back on a question
	if got := ParseAnswer("có, commit đi", true).Replies; !reflect.DeepEqual(got, []string{"có, commit đi"}) {
		t.Fatalf("ParseAnswer = %q", got)
	}
}

func TestParseSkipsNoneLongAndRepeated(t *testing.T) {
	long := strings.Repeat("x", replyRunes+1)
	if got := ParseAnswer("NONE", false).Replies; got == nil || len(got) != 0 {
		t.Fatalf("ParseAnswer(NONE) = %#v, want empty and not nil", got)
	}
	if got := ParseAnswer("None.\n"+long+"\nOK\nok\nB", true).Replies; !reflect.DeepEqual(got, []string{"OK", "B"}) {
		t.Fatalf("ParseAnswer = %q, want OK then B", got)
	}
}

func TestParseDropsMarkupThatSaysNothing(t *testing.T) {
	// "Bạn có muốn tôi xoá AEM9… không?" came back as "có" and "</br>", and the tag showed as a chip
	got := ParseAnswer("có\n</br>\n<br/>\n---\n…", true).Replies
	if !reflect.DeepEqual(got, []string{"có"}) {
		t.Fatalf("ParseAnswer = %q, want only có", got)
	}
	// a tag stuck to a real reply comes off it
	if got := ParseAnswer("không<br>\n<b>xoá đi</b>", true).Replies; !reflect.DeepEqual(got, []string{"không", "xoá đi"}) {
		t.Fatalf("ParseAnswer = %q, want the replies without their tags", got)
	}
	// a comparison is not a tag
	if got := ParseAnswer("a < b", true).Replies; !reflect.DeepEqual(got, []string{"a < b"}) {
		t.Fatalf("ParseAnswer = %q", got)
	}
}

func TestParseKeepsOneOfRepliesThatSayTheSame(t *testing.T) {
	// "build luôn rồi push không?" answered three ways that all say build
	got := ParseAnswer("build di\nok build đi\nchưa push, build thôi\nBuild đi!", true).Replies
	want := []string{"build di", "chưa push, build thôi"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ParseAnswer = %q, want %q", got, want)
	}
	if got := ParseAnswer("ok\nOK nhé\nB", true).Replies; !reflect.DeepEqual(got, []string{"ok", "OK nhé", "B"}) {
		t.Fatalf("ParseAnswer = %q: filler alone is its own reply", got)
	}
}

func TestParseAnswerPickAndDescs(t *testing.T) {
	text := "A, sửa parseFrame\n= sửa ở ba nơi gọi parseFrame\nB, gom byte ở readLoop\n= gom đủ byte ngay ở readLoop\n" +
		"PICK 2: readLoop đã gom đủ byte cho mọi khung khác"
	got := ParseAnswer(text, true)
	want := Answer{
		Replies: []string{"A, sửa parseFrame", "B, gom byte ở readLoop"},
		Descs:   []string{"sửa ở ba nơi gọi parseFrame", "gom đủ byte ngay ở readLoop"},
		Pick:    "B, gom byte ở readLoop",
		Reason:  "readLoop đã gom đủ byte cho mọi khung khác",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ParseAnswer =\n%#v\nwant\n%#v", got, want)
	}

	// a reply with no description gets "", the pick line is case-insensitive and takes `-` or `—` after the number, and
	// a bullet before a line comes off as it does for a reply
	got = ParseAnswer("- A\n- B\n- = chạy ở B\npick 1 — vì A ít đổi nhất", true)
	want = Answer{Replies: []string{"A", "B"}, Descs: []string{"", "chạy ở B"}, Pick: "A", Reason: "vì A ít đổi nhất"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ParseAnswer =\n%#v\nwant\n%#v", got, want)
	}
	if got := ParseAnswer("A\nB\nPICK 2 - vì B gọn", true); got.Pick != "B" || got.Reason != "vì B gọn" {
		t.Fatalf("a hyphen after the number: %#v", got)
	}

	// no description anywhere: Descs is nil, not a list of blanks; no pick line: no pick
	got = ParseAnswer("A\nB", true)
	if got.Descs != nil || got.Pick != "" || got.Reason != "" || !reflect.DeepEqual(got.Replies, []string{"A", "B"}) {
		t.Fatalf("ParseAnswer = %#v", got)
	}

	// the fifth answer's description and the pick line come after the limit is reached, and are still read
	got = ParseAnswer("A\n= a\nB\n= b\nC\n= c\nD\n= d\nE\n= e\nPICK 5: vì E", true)
	if len(got.Replies) != 5 || got.Descs[4] != "e" || got.Pick != "E" {
		t.Fatalf("ParseAnswer = %#v: the last answer's description and the pick are read", got)
	}
}

func TestParseAnswerDescOfDroppedReply(t *testing.T) {
	long := strings.Repeat("x", replyRunes+1)
	// a reply that is too long is dropped with its `=` line: the line never lands on the reply before or after it, and a
	// pick that names it gives no pick (and no reason: it would explain a chip that is not there)
	got := ParseAnswer("A\n= da\n"+long+"\n= dài\nB\n= db\nPICK 2: vì dài", true)
	want := Answer{Replies: []string{"A", "B"}, Descs: []string{"da", "db"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("too long: ParseAnswer =\n%#v\nwant\n%#v", got, want)
	}
	// a repeat is dropped with its line; the pick of the next reply still counts in the model's numbering
	got = ParseAnswer("build di\n= d1\nBuild đi!\n= d2\nB\n= db\nPICK 3: vì B", true)
	want = Answer{Replies: []string{"build di", "B"}, Descs: []string{"d1", "db"}, Pick: "B", Reason: "vì B"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("repeat: ParseAnswer =\n%#v\nwant\n%#v", got, want)
	}
	if got := ParseAnswer("build di\nBuild đi!\nB\nPICK 2: vì lặp", true); got.Pick != "" || got.Reason != "" {
		t.Fatalf("a pick that names the repeat: %#v", got)
	}
	// a sixth answer is past the limit: dropped with its line, and a pick that names it is no pick
	got = ParseAnswer("A\nB\nC\nD\nE\nF\n= df\nPICK 6: vì F", true)
	if len(got.Replies) != 5 || got.Descs != nil || got.Pick != "" || got.Reason != "" {
		t.Fatalf("past the limit: ParseAnswer = %#v", got)
	}
	// a number that names no reply is no pick
	for _, line := range []string{"PICK 9: vì xa", "PICK 0: vì không"} {
		if got := ParseAnswer("A\nB\n"+line, true); got.Pick != "" || got.Reason != "" {
			t.Fatalf("%q: %#v", line, got)
		}
	}
	// a description with no reply before it is dropped
	if got := ParseAnswer("= mồ côi\nA", true); got.Descs != nil || !reflect.DeepEqual(got.Replies, []string{"A"}) {
		t.Fatalf("a description before any reply: %#v", got)
	}
}

func TestParseAnswerNoPickOutsideQuestion(t *testing.T) {
	// a turn that asks nothing reads neither line, and neither becomes a reply
	got := ParseAnswer("vẽ tôi xem\n= một bố cục ba cột\nPICK 1: vì nó rõ", false)
	if !reflect.DeepEqual(got, Answer{Replies: []string{"vẽ tôi xem"}}) {
		t.Fatalf("ParseAnswer = %#v", got)
	}
	got = ParseAnswer("= mô tả\nPICK 1: vì sao", false)
	if got.Replies == nil || len(got.Replies) != 0 || got.Descs != nil || got.Pick != "" || got.Reason != "" {
		t.Fatalf("ParseAnswer = %#v: want no replies (not nil), no pick", got)
	}
	// a question's own `=` line never becomes a chip either
	if got := ParseAnswer("A\n= một mô tả\nB", true); !reflect.DeepEqual(got.Replies, []string{"A", "B"}) {
		t.Fatalf("Replies = %q", got.Replies)
	}
}

func TestBuildPromptKeepsTheEndAndTheLastMessages(t *testing.T) {
	reply := strings.Repeat("đầu câu trả lời\n", 200) + "Bạn chọn A, B hay C?"
	recent := []string{"m1", "m2", "m3", "m4", "m5", "m6", "m7 with\na newline"}
	p := BuildPrompt(Request{Reply: reply, Recent: recent, Question: true})
	if strings.Contains(p, "- m1\n") || !strings.Contains(p, "- m2\n") || !strings.Contains(p, "- m7 with a newline\n") {
		t.Fatalf("want the last %d messages on one line each:\n%s", recentMax, p)
	}
	if !strings.Contains(p, "\n…") || !strings.Contains(p, "Bạn chọn A, B hay C?\n</reply>") {
		t.Fatalf("want the reply's end, marked as cut:\n%s", p)
	}
	if !strings.HasSuffix(p, "give up to 5 replies that answer it.") {
		t.Fatalf("want the question's instruction last:\n%s", p)
	}
	if strings.Contains(BuildPrompt(Request{Reply: "done"}), "person's last messages") {
		t.Fatal("no messages: no messages block")
	}
}

func TestSystemPromptGivesEveryOptionAReply(t *testing.T) {
	// "Bạn chọn A hay B, và có muốn thêm hai chỗ trên không?" came back as four chips that all picked A, varying only the
	// side question: every option named gets its own reply, and the main choice varies first
	for _, rule := range []string{"Every option the question names gets a reply of its own", "change the main choice before the side questions"} {
		if !strings.Contains(systemPrompt, rule) {
			t.Fatalf("system prompt lost the rule %q", rule)
		}
	}
}

func TestBuildPromptNoRecommendFirst(t *testing.T) {
	// the chips no longer open with the agent's own lean: the model orders the answers and picks for itself. (The rule
	// "even when the agent recommends another" stays, so the word alone is no test.)
	if strings.Contains(systemPrompt, "First the answer the agent recommends") {
		t.Fatal("system prompt still puts the agent's recommendation first")
	}
	if !strings.Contains(systemPrompt, "even when the agent recommends another") {
		t.Fatal("system prompt lost the rule that every option gets a reply, the agent's lean or not")
	}
	for _, part := range []string{"PICK <n>:", "= <"} {
		if !strings.Contains(systemPrompt, part) {
			t.Fatalf("system prompt does not ask for the %q line", part)
		}
	}
	if strings.Contains(BuildPrompt(Request{Reply: "A hay B?", Question: true}), "PICK") {
		t.Fatal("the pick format is the system prompt's, not each call's message")
	}
}

func TestBuildPromptOfAChipOnlyCall(t *testing.T) {
	// the prompt a call sends, whole: its text is the cache key and the model's input
	got := BuildPrompt(Request{Reply: "Done.", Recent: []string{"build đi"}})
	want := "The person's last messages to the agent, oldest first:\n- build đi\n\n" +
		"The end of the agent's last reply:\n<reply>\nDone.\n</reply>\n\n" +
		"The reply does not end with a question: give at most 1 reply, or NONE."
	if got != want {
		t.Fatalf("BuildPrompt =\n%q\nwant\n%q", got, want)
	}
}

func TestSuggestKeepsTheAnswerAndJoinsACallInFlight(t *testing.T) {
	var calls atomic.Int32
	release := make(chan struct{})
	s := New(func(ctx context.Context, prompt string) (string, error) {
		calls.Add(1)
		<-release
		return "vẽ tôi xem", nil
	})
	req := Request{Reply: "Đây là layout ba cột."}
	var wg sync.WaitGroup
	results := make([]Answer, 2)
	for i := range results {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			out, err := s.Suggest(context.Background(), req)
			if err != nil {
				t.Errorf("Suggest: %v", err)
			}
			results[i] = out
		}(i)
	}
	time.Sleep(20 * time.Millisecond)
	close(release)
	wg.Wait()
	if out, _ := s.Suggest(context.Background(), req); !reflect.DeepEqual(out.Replies, []string{"vẽ tôi xem"}) {
		t.Fatalf("cached = %q", out.Replies)
	}
	if calls.Load() != 1 || !reflect.DeepEqual(results[0], results[1]) {
		t.Fatalf("calls = %d, results = %q: want one call shared", calls.Load(), results)
	}
}

func TestSuggestKeepsThePickWithTheAnswer(t *testing.T) {
	var calls atomic.Int32
	s := New(func(ctx context.Context, prompt string) (string, error) {
		calls.Add(1)
		return "A\n= sửa ở ba nơi\nB\n= gom ở readLoop\nPICK 2: vì readLoop đủ byte", nil
	})
	req := Request{Reply: "Hai hướng. A hay B?", Question: true}
	for i := 0; i < 2; i++ { // the second is the cached answer
		out, err := s.Suggest(context.Background(), req)
		if err != nil || out.Pick != "B" || out.Reason != "vì readLoop đủ byte" || !reflect.DeepEqual(out.Descs, []string{"sửa ở ba nơi", "gom ở readLoop"}) {
			t.Fatalf("Suggest #%d = %#v, %v", i, out, err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("calls = %d, want one", calls.Load())
	}
}

func TestSuggestDoesNotKeepAFailure(t *testing.T) {
	var calls atomic.Int32
	s := New(func(ctx context.Context, prompt string) (string, error) {
		if calls.Add(1) == 1 {
			return "", errors.New("claude not found")
		}
		return "A", nil
	})
	req := Request{Reply: "A hay B?", Question: true}
	if _, err := s.Suggest(context.Background(), req); err == nil {
		t.Fatal("want the first call's error")
	}
	if out, err := s.Suggest(context.Background(), req); err != nil || !reflect.DeepEqual(out.Replies, []string{"A"}) {
		t.Fatalf("retry = %q, %v", out.Replies, err)
	}
}

func TestSuggestAsksNothingForAnEmptyReply(t *testing.T) {
	s := New(func(ctx context.Context, prompt string) (string, error) {
		t.Fatal("no call for an empty reply")
		return "", nil
	})
	out, err := s.Suggest(context.Background(), Request{Reply: "  "})
	if err != nil || out.Replies == nil || len(out.Replies) != 0 {
		t.Fatalf("Suggest = %+v, %v: want empty replies (not nil: the wire sends [])", out, err)
	}
}
