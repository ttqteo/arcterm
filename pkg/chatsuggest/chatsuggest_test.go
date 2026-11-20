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
	got := Parse("1. B, và ẩn thẻ Pin\n- A\n\"C\"\n\nD\nE\nF\n", true)
	want := []string{"B, và ẩn thẻ Pin", "A", "C", "D", "E"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Parse = %q, want %q", got, want)
	}
}

func TestParseNextStepKeepsOneAndNeverCommits(t *testing.T) {
	if got := Parse("commit đi\nvẽ tôi xem\nchạy test đi", false); !reflect.DeepEqual(got, []string{"vẽ tôi xem"}) {
		t.Fatalf("Parse = %q, want only the drawing", got)
	}
	if got := Parse("ok, push it", false); len(got) != 0 {
		t.Fatalf("Parse = %q, want nothing: a push is the rules' chip", got)
	}
}

func TestParseAQuestionMayAnswerWithACommit(t *testing.T) {
	// "muốn tôi commit không?" is answered with a commit: the rules hold back on a question
	if got := Parse("có, commit đi", true); !reflect.DeepEqual(got, []string{"có, commit đi"}) {
		t.Fatalf("Parse = %q", got)
	}
}

func TestParseSkipsNoneLongAndRepeated(t *testing.T) {
	long := strings.Repeat("x", replyRunes+1)
	if got := Parse("NONE", false); len(got) != 0 {
		t.Fatalf("Parse(NONE) = %q", got)
	}
	if got := Parse("None.\n"+long+"\nOK\nok\nB", true); !reflect.DeepEqual(got, []string{"OK", "B"}) {
		t.Fatalf("Parse = %q, want OK then B", got)
	}
}

func TestParseDropsMarkupThatSaysNothing(t *testing.T) {
	// "Bạn có muốn tôi xoá AEM9… không?" came back as "có" and "</br>", and the tag showed as a chip
	got := Parse("có\n</br>\n<br/>\n---\n…", true)
	if !reflect.DeepEqual(got, []string{"có"}) {
		t.Fatalf("Parse = %q, want only có", got)
	}
	// a tag stuck to a real reply comes off it
	if got := Parse("không<br>\n<b>xoá đi</b>", true); !reflect.DeepEqual(got, []string{"không", "xoá đi"}) {
		t.Fatalf("Parse = %q, want the replies without their tags", got)
	}
	// a comparison is not a tag
	if got := Parse("a < b", true); !reflect.DeepEqual(got, []string{"a < b"}) {
		t.Fatalf("Parse = %q", got)
	}
}

func TestParseKeepsOneOfRepliesThatSayTheSame(t *testing.T) {
	// "build luôn rồi push không?" answered three ways that all say build
	got := Parse("build di\nok build đi\nchưa push, build thôi\nBuild đi!", true)
	want := []string{"build di", "chưa push, build thôi"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Parse = %q, want %q", got, want)
	}
	if got := Parse("ok\nOK nhé\nB", true); !reflect.DeepEqual(got, []string{"ok", "OK nhé", "B"}) {
		t.Fatalf("Parse = %q: filler alone is its own reply", got)
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
	results := make([][]string, 2)
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
	if out, _ := s.Suggest(context.Background(), req); !reflect.DeepEqual(out, []string{"vẽ tôi xem"}) {
		t.Fatalf("cached = %q", out)
	}
	if calls.Load() != 1 || !reflect.DeepEqual(results[0], results[1]) {
		t.Fatalf("calls = %d, results = %q: want one call shared", calls.Load(), results)
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
	if out, err := s.Suggest(context.Background(), req); err != nil || !reflect.DeepEqual(out, []string{"A"}) {
		t.Fatalf("retry = %q, %v", out, err)
	}
}

func TestSuggestAsksNothingForAnEmptyReply(t *testing.T) {
	s := New(func(ctx context.Context, prompt string) (string, error) {
		t.Fatal("no call for an empty reply")
		return "", nil
	})
	out, err := s.Suggest(context.Background(), Request{Reply: "  "})
	if err != nil || out == nil || len(out) != 0 {
		t.Fatalf("Suggest = %+v, %v: want empty replies (not nil: the wire sends [])", out, err)
	}
}
