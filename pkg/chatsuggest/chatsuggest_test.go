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
	"unicode/utf8"
)

func TestParseAnswersAQuestion(t *testing.T) {
	got := Parse("1. B, và ẩn thẻ Pin\n- A\n\"C\"\n\nD\nE\nF\n", true, false).Replies
	want := []string{"B, và ẩn thẻ Pin", "A", "C", "D", "E"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Parse = %q, want %q", got, want)
	}
}

func TestParseNextStepKeepsOneAndNeverCommits(t *testing.T) {
	if got := Parse("commit đi\nvẽ tôi xem\nchạy test đi", false, false).Replies; !reflect.DeepEqual(got, []string{"vẽ tôi xem"}) {
		t.Fatalf("Parse = %q, want only the drawing", got)
	}
	if got := Parse("ok, push it", false, false).Replies; len(got) != 0 {
		t.Fatalf("Parse = %q, want nothing: a push is the rules' chip", got)
	}
}

func TestParseAQuestionMayAnswerWithACommit(t *testing.T) {
	// "muốn tôi commit không?" is answered with a commit: the rules hold back on a question
	if got := Parse("có, commit đi", true, false).Replies; !reflect.DeepEqual(got, []string{"có, commit đi"}) {
		t.Fatalf("Parse = %q", got)
	}
}

func TestParseSkipsNoneLongAndRepeated(t *testing.T) {
	long := strings.Repeat("x", replyRunes+1)
	if got := Parse("NONE", false, false).Replies; len(got) != 0 {
		t.Fatalf("Parse(NONE) = %q", got)
	}
	if got := Parse("None.\n"+long+"\nOK\nok\nB", true, false).Replies; !reflect.DeepEqual(got, []string{"OK", "B"}) {
		t.Fatalf("Parse = %q, want OK then B", got)
	}
}

func TestParseDropsMarkupThatSaysNothing(t *testing.T) {
	// "Bạn có muốn tôi xoá AEM9… không?" came back as "có" and "</br>", and the tag showed as a chip
	got := Parse("có\n</br>\n<br/>\n---\n…", true, false).Replies
	if !reflect.DeepEqual(got, []string{"có"}) {
		t.Fatalf("Parse = %q, want only có", got)
	}
	// a tag stuck to a real reply comes off it
	if got := Parse("không<br>\n<b>xoá đi</b>", true, false).Replies; !reflect.DeepEqual(got, []string{"không", "xoá đi"}) {
		t.Fatalf("Parse = %q, want the replies without their tags", got)
	}
	// a comparison is not a tag
	if got := Parse("a < b", true, false).Replies; !reflect.DeepEqual(got, []string{"a < b"}) {
		t.Fatalf("Parse = %q", got)
	}
}

func TestParseKeepsOneOfRepliesThatSayTheSame(t *testing.T) {
	// "build luôn rồi push không?" answered three ways that all say build
	got := Parse("build di\nok build đi\nchưa push, build thôi\nBuild đi!", true, false).Replies
	want := []string{"build di", "chưa push, build thôi"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Parse = %q, want %q", got, want)
	}
	if got := Parse("ok\nOK nhé\nB", true, false).Replies; !reflect.DeepEqual(got, []string{"ok", "OK nhé", "B"}) {
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

func TestParseSplitsTheSummaryLineOffTheReplies(t *testing.T) {
	got := Parse("SUMMARY: Lỗi do hai arcterm cùng chạy.   Mình chưa sửa code.\nA\nB", true, true)
	if got.Summary != "Lỗi do hai arcterm cùng chạy. Mình chưa sửa code." {
		t.Fatalf("Summary = %q, want the line folded to one, marker off", got.Summary)
	}
	if !reflect.DeepEqual(got.Replies, []string{"A", "B"}) {
		t.Fatalf("Replies = %q, want the replies without the summary line", got.Replies)
	}
	// the marker is case-insensitive and may sit after blanks; the summary may come after a blank line
	got = Parse("\n  summary:  Done, tests not run.\n\nchạy test đi", false, true)
	if got.Summary != "Done, tests not run." || !reflect.DeepEqual(got.Replies, []string{"chạy test đi"}) {
		t.Fatalf("Parse = %+v", got)
	}
	// the reply lines keep every rule of Parse: NONE, a commit on a next step, repeats
	got = Parse("Summary: Built it.\nNONE", false, true)
	if got.Summary != "Built it." || len(got.Replies) != 0 || got.Replies == nil {
		t.Fatalf("Parse = %+v, want the summary and empty (non-nil) replies", got)
	}
	got = Parse("SUMMARY: x\ncommit đi\nvẽ tôi xem", false, true)
	if got.Summary != "x" || !reflect.DeepEqual(got.Replies, []string{"vẽ tôi xem"}) {
		t.Fatalf("Parse = %+v", got)
	}
}

func TestParseWithoutASummaryRequestDropsTheSummaryLine(t *testing.T) {
	// a model that writes one anyway: it is never a chip, and nothing carries it
	got := Parse("SUMMARY: ok\nA\nB", true, false)
	if got.Summary != "" || !reflect.DeepEqual(got.Replies, []string{"A", "B"}) {
		t.Fatalf("Parse = %+v, want the replies only and no summary", got)
	}
	// a short summary line must not slip through as a chip either
	if got := Parse("summary: build đi", false, false); len(got.Replies) != 0 || got.Summary != "" {
		t.Fatalf("Parse = %+v", got)
	}
}

func TestParseTakesTheFirstSummaryLineAndAnEmptyOneIsNone(t *testing.T) {
	got := Parse("SUMMARY: first\nSUMMARY: second\nA", true, true)
	if got.Summary != "first" || !reflect.DeepEqual(got.Replies, []string{"A"}) {
		t.Fatalf("Parse = %+v: the first summary line wins and the second is no reply", got)
	}
	for _, text := range []string{"SUMMARY:\nA", "SUMMARY:    \nA", "A"} {
		got := Parse(text, true, true)
		if got.Summary != "" || !reflect.DeepEqual(got.Replies, []string{"A"}) {
			t.Fatalf("Parse(%q) = %+v, want no summary and the reply", text, got)
		}
	}
}

func TestParseOnlyAMarkerAtTheStartOfALineIsASummary(t *testing.T) {
	// no colon: "SUMMARY" is a word, so this line is an ordinary reply
	got := Parse("SUMMARY of it\nA", true, true)
	if got.Summary != "" || !reflect.DeepEqual(got.Replies, []string{"SUMMARY of it", "A"}) {
		t.Fatalf("Parse = %+v: a marker with no colon is no summary", got)
	}
	// mid-line: the line is a reply (or dropped), never the summary
	got = Parse("Xem SUMMARY: nó\nA", true, true)
	if got.Summary != "" || !reflect.DeepEqual(got.Replies, []string{"Xem SUMMARY: nó", "A"}) {
		t.Fatalf("Parse = %+v: a marker mid-line is no summary", got)
	}
}

func TestParseAPlainReplyLineIsNeverTheSummary(t *testing.T) {
	// the model skipped the summary and went straight to the replies: the first line is a chip, not the summary
	got := Parse("Chạy test đi\nBuild đi", true, true)
	if got.Summary != "" || !reflect.DeepEqual(got.Replies, []string{"Chạy test đi", "Build đi"}) {
		t.Fatalf("Parse = %+v, want both lines as replies and no summary", got)
	}
}

func TestParseCutsAnOverlongSummaryAtAWord(t *testing.T) {
	// exactly summaryRunes is kept whole
	exact := strings.Repeat("a", summaryRunes)
	if got := Parse("SUMMARY: "+exact, false, true); got.Summary != exact {
		t.Fatalf("a summary of %d runes was cut to %d", summaryRunes, utf8.RuneCountInString(got.Summary))
	}
	// past it: cut at a word, an ellipsis last, within the limit, and no word half-said
	words := strings.TrimSpace(strings.Repeat("từ khoá ", 60))
	got := Parse("SUMMARY: "+words+"\nA", true, true)
	n := utf8.RuneCountInString(got.Summary)
	if n > summaryRunes || !strings.HasSuffix(got.Summary, "…") || n < summaryRunes-12 {
		t.Fatalf("Summary has %d runes, want a word-boundary cut just under %d ending in …: %q", n, summaryRunes, got.Summary)
	}
	for _, w := range strings.Fields(strings.TrimSuffix(got.Summary, "…")) {
		if w != "từ" && w != "khoá" {
			t.Fatalf("a word was cut in half: %q in %q", w, got.Summary)
		}
	}
	if !reflect.DeepEqual(got.Replies, []string{"A"}) {
		t.Fatalf("Replies = %q: the long summary is not a reply", got.Replies)
	}
	// no space to cut at (a run of one script with no spaces): a plain cut, still within the limit
	long := strings.Repeat("字", 400)
	if got := Parse("SUMMARY: "+long, false, true); utf8.RuneCountInString(got.Summary) != summaryRunes || !strings.HasSuffix(got.Summary, "…") {
		t.Fatalf("Summary = %d runes %q, want %d ending in …", utf8.RuneCountInString(got.Summary), got.Summary, summaryRunes)
	}
}

func TestBuildPromptAsksForASummaryOnlyWhenToldTo(t *testing.T) {
	plain := BuildPrompt(Request{Reply: "Đã sửa xong lỗi.", Recent: []string{"sửa lỗi đi"}, Question: true})
	if strings.Contains(plain, "SUMMARY") {
		t.Fatalf("no Summary, no instruction:\n%s", plain)
	}
	p := BuildPrompt(Request{Reply: "Đã sửa xong lỗi.", Recent: []string{"sửa lỗi đi"}, Question: true, Summary: true})
	for _, want := range []string{"SUMMARY: ", "240 characters", "one or two sentences", "language", "did", "left undone", "never repeat the question"} {
		if !strings.Contains(strings.ToLower(p), strings.ToLower(want)) {
			t.Fatalf("a Summary request lacks %q:\n%s", want, p)
		}
	}
	if !strings.HasSuffix(p, "give up to 5 replies that answer it.") {
		t.Fatalf("the replies' own instruction stays last:\n%s", p)
	}
	// the rule is in the message: the system prompt, and with it every chip-only call's cache key, is the same
	if strings.Contains(systemPrompt, "SUMMARY") {
		t.Fatal("the summary instruction belongs in the user message, not the system prompt")
	}
	// a short reply is sent whole, as a chip-only call sends it
	if !strings.Contains(p, "The end of the agent's last reply:\n<reply>\nĐã sửa xong lỗi.\n</reply>") {
		t.Fatalf("a short reply is sent whole:\n%s", p)
	}
}

func TestBuildPromptOfALongReplyForASummarySendsItsHeadAndItsTail(t *testing.T) {
	head := "ĐẦU-" + strings.Repeat("h", 700)
	middle := strings.Repeat("giữa giữa giữa\n", 400)
	tailText := strings.Repeat("dòng cuối cùng\n", 200) + "Bạn chọn A hay B?"
	reply := head + "\n" + middle + tailText
	p := BuildPrompt(Request{Reply: reply, Question: true, Summary: true})

	if !strings.Contains(p, "The start and the end of the agent's last reply") {
		t.Fatalf("a reply with its middle left out says so:\n%.300s", p)
	}
	body := p[strings.Index(p, "<reply>\n")+len("<reply>\n") : strings.Index(p, "\n</reply>")]
	if n := utf8.RuneCountInString(body); n >= 2500 {
		t.Fatalf("the reply sent is %d runes, want under 2,500", n)
	}
	if !strings.HasPrefix(body, "ĐẦU-") {
		t.Fatalf("want the head of the reply first:\n%.80s", body)
	}
	// the head is its first summaryHeadRunes, no more: the 700 h's are cut
	if got := strings.Count(body, "h"); got < 500 || got > summaryHeadRunes {
		t.Fatalf("the head has %d h's, want the first %d runes of the reply", got, summaryHeadRunes)
	}
	if !strings.HasSuffix(body, "Bạn chọn A hay B?") {
		t.Fatalf("want the end of the reply last:\n%s", body[len(body)-80:])
	}
	// the gap is marked by a line of its own
	if !strings.Contains(body, "\n…\n") {
		t.Fatalf("want an ellipsis line between the head and the tail:\n%s", body)
	}
	// the tail is the end: the middle is not
	if strings.Count(body, "dòng cuối cùng") < 100 {
		t.Fatal("want the tail's lines")
	}
	if strings.Count(body, "giữa giữa giữa") != 0 {
		t.Fatal("the middle of a long reply is left out")
	}
	// a request with no Summary still sends only its tail (and none of the head)
	plain := BuildPrompt(Request{Reply: reply, Question: true})
	if strings.Contains(plain, "ĐẦU-") {
		t.Fatal("a chip-only call sends the tail of the reply alone")
	}
}

func TestBuildPromptSendsAReplyThatFitsWholeForASummary(t *testing.T) {
	// longer than the 1,500-rune tail a chip-only call sends, but under head + tail: nothing is left out
	reply := "ĐẦU\n" + strings.Repeat("x", 1900) + "\nCUỐI"
	p := BuildPrompt(Request{Reply: reply, Summary: true})
	if !strings.Contains(p, "<reply>\n"+reply+"\n</reply>") {
		t.Fatal("a reply under head + tail runes goes whole, with no ellipsis line")
	}
}

func TestBuildPromptOfAChipOnlyCallIsUnchanged(t *testing.T) {
	// the summary work must not touch the prompt a chip-only call sends: its text is the cache key and the model's input
	got := BuildPrompt(Request{Reply: "Done.", Recent: []string{"build đi"}})
	want := "The person's last messages to the agent, oldest first:\n- build đi\n\n" +
		"The end of the agent's last reply:\n<reply>\nDone.\n</reply>\n\n" +
		"The reply does not end with a question: give at most 1 reply, or NONE."
	if got != want {
		t.Fatalf("BuildPrompt =\n%q\nwant\n%q", got, want)
	}
	if strings.Contains(got, "SUMMARY") {
		t.Fatal("a call with no Summary asks for no summary")
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
	if out, err := s.Suggest(context.Background(), req); err != nil || !reflect.DeepEqual(out.Replies, []string{"A"}) {
		t.Fatalf("retry = %q, %v", out, err)
	}
}

func TestSuggestKeepsAskedWithAndWithoutASummaryApart(t *testing.T) {
	var calls atomic.Int32
	s := New(func(ctx context.Context, prompt string) (string, error) {
		calls.Add(1)
		if strings.Contains(prompt, "SUMMARY:") {
			return "SUMMARY: Đã sửa lỗi, chưa chạy test.\nchạy test đi", nil
		}
		return "chạy test đi", nil
	})
	plain := Request{Reply: "Đã sửa lỗi."}
	withSummary := Request{Reply: "Đã sửa lỗi.", Summary: true}
	a, err := s.Suggest(context.Background(), plain)
	if err != nil {
		t.Fatalf("Suggest: %v", err)
	}
	b, err := s.Suggest(context.Background(), withSummary)
	if err != nil {
		t.Fatalf("Suggest: %v", err)
	}
	if calls.Load() != 2 {
		t.Fatalf("calls = %d, want one per request: they are two cache entries", calls.Load())
	}
	if a.Summary != "" || !reflect.DeepEqual(a.Replies, []string{"chạy test đi"}) {
		t.Fatalf("without a summary = %+v", a)
	}
	if b.Summary != "Đã sửa lỗi, chưa chạy test." || !reflect.DeepEqual(b.Replies, []string{"chạy test đi"}) {
		t.Fatalf("with a summary = %+v", b)
	}
	// both are kept now: asking again calls nothing, and each gets its own answer back
	a2, _ := s.Suggest(context.Background(), plain)
	b2, _ := s.Suggest(context.Background(), withSummary)
	if calls.Load() != 2 || !reflect.DeepEqual(a, a2) || !reflect.DeepEqual(b, b2) {
		t.Fatalf("calls = %d, a2 = %+v, b2 = %+v: want both cached", calls.Load(), a2, b2)
	}
}

func TestSuggestAsksNothingForAnEmptyReply(t *testing.T) {
	s := New(func(ctx context.Context, prompt string) (string, error) {
		t.Fatal("no call for an empty reply")
		return "", nil
	})
	out, err := s.Suggest(context.Background(), Request{Reply: "  ", Summary: true})
	if err != nil || out.Replies == nil || len(out.Replies) != 0 || out.Summary != "" {
		t.Fatalf("Suggest = %+v, %v: want empty replies (not nil: the wire sends [])", out, err)
	}
}
