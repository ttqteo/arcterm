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
	got := Parse("1. B, và ẩn thẻ Pin\n- A\n\"C\"\n\nD\n", true)
	want := []string{"B, và ẩn thẻ Pin", "A", "C"}
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
	if !strings.HasSuffix(p, "give up to 3 replies that answer it.") {
		t.Fatalf("want the question's instruction last:\n%s", p)
	}
	if strings.Contains(BuildPrompt(Request{Reply: "done"}), "person's last messages") {
		t.Fatal("no messages: no messages block")
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
	if out, err := s.Suggest(context.Background(), Request{Reply: "  "}); err != nil || len(out) != 0 {
		t.Fatalf("Suggest = %q, %v", out, err)
	}
}
