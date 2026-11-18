// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/remotemode"
)

// remoteTranscriptTestLines is n fixed-width lines "line-001\n" … (9 bytes each), so line i starts at byte
// (i-1)*9 and a test reads its offsets off the arithmetic.
func remoteTranscriptTestLines(from, to int) string {
	var sb strings.Builder
	for i := from; i <= to; i++ {
		fmt.Fprintf(&sb, "line-%03d\n", i)
	}
	return sb.String()
}

func remoteTranscriptTestNames(from, to int) []string {
	var names []string
	for i := from; i <= to; i++ {
		names = append(names, fmt.Sprintf("line-%03d", i))
	}
	return names
}

func remoteTranscriptTestWrite(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "s.jsonl")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func remoteTranscriptTestAppend(t *testing.T, path, content string) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err := f.WriteString(content); err != nil {
		t.Fatal(err)
	}
}

// remoteTranscriptTestStream runs RemoteTranscript from the given offset and hands back its chunks; the test
// ends it by calling stop.
func remoteTranscriptTestStream(t *testing.T, path string, from int64) (next func() remotemode.TranscriptChunk, stop func()) {
	t.Helper()
	chunks := make(chan remotemode.TranscriptChunk, 16)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- RemoteTranscript(ctx, path, from, func(c remotemode.TranscriptChunk) error { chunks <- c; return nil })
	}()
	next = func() remotemode.TranscriptChunk {
		t.Helper()
		select {
		case c := <-chunks:
			return c
		case <-time.After(5 * time.Second):
			t.Fatal("no chunk arrived")
			return remotemode.TranscriptChunk{}
		}
	}
	stop = func() {
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("RemoteTranscript = %v, want nil on ctx done", err)
			}
		case <-time.After(5 * time.Second):
			t.Error("RemoteTranscript did not return on cancel")
		}
	}
	return next, stop
}

func remoteTranscriptTestExpect(t *testing.T, what string, got remotemode.TranscriptChunk, lines []string, cursor, end int64, backlog bool) {
	t.Helper()
	if !reflect.DeepEqual(got.Lines, lines) || got.Cursor != cursor || got.End != end || got.Backlog != backlog {
		t.Fatalf("%s = lines %v cursor %d end %d backlog %v, want lines %v cursor %d end %d backlog %v",
			what, got.Lines, got.Cursor, got.End, got.Backlog, lines, cursor, end, backlog)
	}
}

// pages walk back from the end of the file: each ends where the one after it begins, and together they hold every
// line once, in order, down to cursor 0
func TestRemoteTranscriptPageWalksBackToTheStartWithoutGapOrDuplicate(t *testing.T) {
	path := remoteTranscriptTestWrite(t, remoteTranscriptTestLines(1, 10))
	size := int64(10 * 9)

	got, err := RemoteTranscriptPage(path, size, 3)
	if err != nil {
		t.Fatal(err)
	}
	remoteTranscriptTestExpect(t, "last page", got, remoteTranscriptTestNames(8, 10), 7*9, size, false)

	var walked []string
	before := size
	for pages := 0; before > 0; pages++ {
		if pages > 10 {
			t.Fatal("the pages never reached cursor 0")
		}
		page, err := RemoteTranscriptPage(path, before, 3)
		if err != nil {
			t.Fatal(err)
		}
		if page.Cursor >= before {
			t.Fatalf("a page ending at %d has cursor %d: it did not move back", before, page.Cursor)
		}
		walked = append(append([]string(nil), page.Lines...), walked...)
		before = page.Cursor
	}
	if !reflect.DeepEqual(walked, remoteTranscriptTestNames(1, 10)) {
		t.Fatalf("the pages hold %v, want every line once in order", walked)
	}
	// the page that reaches the start has the 10 mod 3 = 1 leftover line
	first, err := RemoteTranscriptPage(path, 9, 3)
	if err != nil {
		t.Fatal(err)
	}
	remoteTranscriptTestExpect(t, "page of the first line", first, []string{"line-001"}, 0, 9, false)
}

// a page for before 0 has no lines and cursor 0, which the phone reads as the start of the session
func TestRemoteTranscriptPageAtTheStartIsEmptyWithCursorZero(t *testing.T) {
	path := remoteTranscriptTestWrite(t, remoteTranscriptTestLines(1, 3))
	got, err := RemoteTranscriptPage(path, 0, 200)
	if err != nil {
		t.Fatal(err)
	}
	remoteTranscriptTestExpect(t, "page before 0", got, nil, 0, 0, false)

	empty := remoteTranscriptTestWrite(t, "")
	got, err = RemoteTranscriptPage(empty, 0, 200)
	if err != nil {
		t.Fatal(err)
	}
	remoteTranscriptTestExpect(t, "page of an empty file", got, nil, 0, 0, false)
}

// only whole newline-terminated lines: a last line with no newline yet is left for the stream, and a before inside a
// line stops at the line before it
func TestRemoteTranscriptPageHoldsOnlyCompleteLines(t *testing.T) {
	path := remoteTranscriptTestWrite(t, "aa\nbb\ncc")
	got, err := RemoteTranscriptPage(path, 8, 10)
	if err != nil {
		t.Fatal(err)
	}
	remoteTranscriptTestExpect(t, "page of a file with a partial last line", got, []string{"aa", "bb"}, 0, 6, false)

	// a before past the end of the file is the end of the file
	got, err = RemoteTranscriptPage(path, 1<<40, 10)
	if err != nil {
		t.Fatal(err)
	}
	remoteTranscriptTestExpect(t, "page with before past the end", got, []string{"aa", "bb"}, 0, 6, false)

	// byte 4 is inside "bb": the page is the complete lines before it
	got, err = RemoteTranscriptPage(path, 4, 10)
	if err != nil {
		t.Fatal(err)
	}
	remoteTranscriptTestExpect(t, "page with before inside a line", got, []string{"aa"}, 0, 3, false)

	// the file ends in the middle of its only line: no complete line, so an empty page at 0
	one := remoteTranscriptTestWrite(t, "unfinished")
	got, err = RemoteTranscriptPage(one, 10, 10)
	if err != nil {
		t.Fatal(err)
	}
	remoteTranscriptTestExpect(t, "page of a lone partial line", got, nil, 0, 0, false)
}

// blank lines count for nothing: not in maxLines, not in the page, and a carriage return is dropped as the stream drops it
func TestRemoteTranscriptPageSkipsBlankLines(t *testing.T) {
	path := remoteTranscriptTestWrite(t, "a\r\n\n  \nb\n\nc\n")
	got, err := RemoteTranscriptPage(path, 12, 2)
	if err != nil {
		t.Fatal(err)
	}
	// b starts at byte 7: "a\r\n"=0..2, "\n"=3, "  \n"=4..6, "b\n"=7..8
	remoteTranscriptTestExpect(t, "last two lines", got, []string{"b", "c"}, 7, 12, false)
	got, err = RemoteTranscriptPage(path, 7, 2)
	if err != nil {
		t.Fatal(err)
	}
	remoteTranscriptTestExpect(t, "the page before b", got, []string{"a"}, 0, 7, false)
}

// a few lines longer than the tail read's first block still page exactly
func TestRemoteTranscriptPageReadsLinesLongerThanABlock(t *testing.T) {
	long := func(c byte) string { return strings.Repeat(string(c), tailBlockSize+1000) }
	content := long('a') + "\n" + long('b') + "\n" + long('c') + "\n" + long('d') + "\n"
	path := remoteTranscriptTestWrite(t, content)
	lineLen := int64(tailBlockSize + 1000 + 1)
	got, err := RemoteTranscriptPage(path, int64(len(content)), 2)
	if err != nil {
		t.Fatal(err)
	}
	remoteTranscriptTestExpect(t, "last two long lines", got, []string{long('c'), long('d')}, 2*lineLen, 4*lineLen, false)
	got, err = RemoteTranscriptPage(path, got.Cursor, 2)
	if err != nil {
		t.Fatal(err)
	}
	remoteTranscriptTestExpect(t, "the two before", got, []string{long('a'), long('b')}, 0, 2*lineLen, false)
}

func TestRemoteTranscriptPageOfAFileNotThereIsAnError(t *testing.T) {
	_, err := RemoteTranscriptPage(filepath.Join(t.TempDir(), "none.jsonl"), 0, 200)
	if !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("err = %v, want one that wraps ErrNotExist", err)
	}
}

// the backlog and each append carry the byte offsets the phone resumes and pages by
func TestRemoteTranscriptChunksCarryCursorAndEnd(t *testing.T) {
	path := remoteTranscriptTestWrite(t, "one\ntwo\n")
	next, stop := remoteTranscriptTestStream(t, path, -1)
	defer stop()
	remoteTranscriptTestExpect(t, "backlog", next(), []string{"one", "two"}, 0, 8, true)
	remoteTranscriptTestAppend(t, path, "three\nfour\n")
	remoteTranscriptTestExpect(t, "append", next(), []string{"three", "four"}, 8, 19, false)
	remoteTranscriptTestAppend(t, path, "five\n")
	remoteTranscriptTestExpect(t, "second append", next(), []string{"five"}, 19, 24, false)
}

// a last line with no newline yet is held back: End stops before it, and the append that finishes it starts there
func TestRemoteTranscriptEndStopsBeforeAPartialLine(t *testing.T) {
	path := remoteTranscriptTestWrite(t, "one\ntwo")
	next, stop := remoteTranscriptTestStream(t, path, -1)
	defer stop()
	remoteTranscriptTestExpect(t, "backlog", next(), []string{"one"}, 0, 4, true)
	remoteTranscriptTestAppend(t, path, "\nthree\n")
	remoteTranscriptTestExpect(t, "append", next(), []string{"two", "three"}, 4, 14, false)
}

// the backlog is the last 200 complete lines, and its cursor is where the first of them starts
func TestRemoteTranscriptBacklogIsTheLastTwoHundredLines(t *testing.T) {
	path := remoteTranscriptTestWrite(t, remoteTranscriptTestLines(1, 250))
	next, stop := remoteTranscriptTestStream(t, path, -1)
	defer stop()
	remoteTranscriptTestExpect(t, "backlog", next(), remoteTranscriptTestNames(51, 250), 50*9, 250*9, true)
}

// a file made after the stream began: an empty backlog at offset 0, then the lines as an append from 0
func TestRemoteTranscriptOffsetsOfAFileCreatedLater(t *testing.T) {
	path := filepath.Join(t.TempDir(), "later.jsonl")
	next, stop := remoteTranscriptTestStream(t, path, -1)
	defer stop()
	remoteTranscriptTestExpect(t, "backlog of a file not there", next(), nil, 0, 0, true)
	if err := os.WriteFile(path, []byte("x\ny\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	remoteTranscriptTestExpect(t, "first lines", next(), []string{"x", "y"}, 0, 4, false)
}

// a stream that starts at an offset a chunk ended at sends what came after it: no line twice, none missed
func TestRemoteTranscriptResumesFromAnOffsetWithNoGapOrDuplicate(t *testing.T) {
	path := remoteTranscriptTestWrite(t, remoteTranscriptTestLines(1, 5))
	next, stop := remoteTranscriptTestStream(t, path, -1)
	first := next()
	remoteTranscriptTestExpect(t, "first backlog", first, remoteTranscriptTestNames(1, 5), 0, 5*9, true)
	stop() // the phone drops out
	remoteTranscriptTestAppend(t, path, remoteTranscriptTestLines(6, 8))

	next, stop = remoteTranscriptTestStream(t, path, first.End)
	defer stop()
	remoteTranscriptTestExpect(t, "resumed backlog", next(), remoteTranscriptTestNames(6, 8), 5*9, 8*9, true)
	remoteTranscriptTestAppend(t, path, remoteTranscriptTestLines(9, 9))
	remoteTranscriptTestExpect(t, "append after the resume", next(), remoteTranscriptTestNames(9, 9), 8*9, 9*9, false)
}

// resuming at the very end is an empty backlog that stays at the offset; the next append continues from it
func TestRemoteTranscriptResumeAtTheEndIsEmptyAtThatOffset(t *testing.T) {
	path := remoteTranscriptTestWrite(t, remoteTranscriptTestLines(1, 3))
	next, stop := remoteTranscriptTestStream(t, path, 27)
	defer stop()
	remoteTranscriptTestExpect(t, "resumed backlog", next(), nil, 27, 27, true)
	remoteTranscriptTestAppend(t, path, remoteTranscriptTestLines(4, 4))
	remoteTranscriptTestExpect(t, "append", next(), remoteTranscriptTestNames(4, 4), 27, 36, false)
}

// a resume beyond a file that shrank, or inside a line, is not trusted: it starts over with the last 200 lines
// instead of replaying the file from the top or opening on half a line
func TestRemoteTranscriptDistrustsAnOffsetThatIsNotALineBoundary(t *testing.T) {
	path := remoteTranscriptTestWrite(t, remoteTranscriptTestLines(1, 3))
	for name, from := range map[string]int64{"past the end": 1000, "inside a line": 13} {
		next, stop := remoteTranscriptTestStream(t, path, from)
		remoteTranscriptTestExpect(t, name, next(), remoteTranscriptTestNames(1, 3), 0, 27, true)
		stop()
	}
}

func TestRemoteTranscriptSendsBacklogAndAppends(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.jsonl")
	if err := os.WriteFile(path, []byte("one\ntwo\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	chunks := make(chan remotemode.TranscriptChunk, 8)
	sendErr := errors.New("phone gone")
	var failNext atomic.Bool
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- RemoteTranscript(ctx, path, -1, func(c remotemode.TranscriptChunk) error {
			if failNext.Load() {
				return sendErr
			}
			chunks <- c
			return nil
		})
	}()

	next := func() remotemode.TranscriptChunk {
		t.Helper()
		select {
		case c := <-chunks:
			return c
		case <-time.After(5 * time.Second):
			t.Fatal("no chunk arrived")
			return remotemode.TranscriptChunk{}
		}
	}
	if got := next(); !reflect.DeepEqual(got.Lines, []string{"one", "two"}) || !got.Backlog {
		t.Fatalf("backlog = %+v, want the first chunk, marked backlog, with both lines", got)
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString("three\n"); err != nil {
		t.Fatal(err)
	}
	f.Close()
	if got := next(); !reflect.DeepEqual(got.Lines, []string{"three"}) || got.Backlog {
		t.Fatalf("append = %+v, want the one new line and no backlog mark", got)
	}

	failNext.Store(true)
	f, err = os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString("four\n"); err != nil {
		t.Fatal(err)
	}
	f.Close()
	select {
	case err := <-done:
		if !errors.Is(err, sendErr) {
			t.Fatalf("err = %v, want the send error", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("RemoteTranscript did not return after a send error")
	}
}

func TestRemoteTranscriptReturnsNilOnCancel(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.jsonl")
	if err := os.WriteFile(path, []byte("one\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	got := make(chan struct{}, 1)
	done := make(chan error, 1)
	go func() {
		done <- RemoteTranscript(ctx, path, -1, func(remotemode.TranscriptChunk) error { got <- struct{}{}; return nil })
	}()
	<-got
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("err = %v, want nil on ctx done", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("RemoteTranscript did not return on cancel")
	}
}

// a file that is not there yet still gets its backlog chunk, empty: the page's stream opens on it
func TestRemoteTranscriptMarksTheFirstChunkBacklogEvenWhenEmpty(t *testing.T) {
	path := filepath.Join(t.TempDir(), "later.jsonl")
	chunks := make(chan remotemode.TranscriptChunk, 8)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- RemoteTranscript(ctx, path, -1, func(c remotemode.TranscriptChunk) error { chunks <- c; return nil })
	}()
	select {
	case c := <-chunks:
		if len(c.Lines) != 0 || !c.Backlog {
			t.Fatalf("first chunk = %+v, want an empty backlog", c)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no backlog chunk arrived for a file that is not there yet")
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("err = %v, want nil on ctx done", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("RemoteTranscript did not return on cancel")
	}
}
