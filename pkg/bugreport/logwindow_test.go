// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bugreport

import (
	"strings"
	"testing"
	"time"
)

// at is a time on 2026-11-19 in the local zone, the zone waveapp.log's stamps are in.
func at(h, m, s int) time.Time {
	return time.Date(2026, 11, 19, h, m, s, 0, time.Local)
}

// logLine is one waveapp.log line as the host writes it.
func logLine(ts time.Time, text string) string {
	return ts.Format(logLayout) + " " + text + "\n"
}

func TestCutWindowInsideOneFile(t *testing.T) {
	current := logLine(at(15, 20, 0), "too early") +
		logLine(at(15, 26, 0), "in window one") +
		logLine(at(15, 28, 30), "in window two") +
		logLine(at(15, 31, 0), "after the save")
	got := string(CutWindow(nil, []byte(current), at(15, 25, 12), at(15, 30, 12), 1<<20))
	want := logLine(at(15, 26, 0), "in window one") + logLine(at(15, 28, 30), "in window two")
	if got != want {
		t.Fatalf("got %q\nwant %q", got, want)
	}
}

func TestCutWindowKeepsTheEdges(t *testing.T) {
	current := logLine(at(15, 25, 12), "at the start") + logLine(at(15, 30, 12), "at the end")
	got := string(CutWindow(nil, []byte(current), at(15, 25, 12), at(15, 30, 12), 1<<20))
	if got != current {
		t.Fatalf("a line stamped exactly at either edge is in the window: got %q", got)
	}
}

func TestCutWindowAcrossTheRoll(t *testing.T) {
	older := logLine(at(15, 24, 0), "before the window") +
		logLine(at(15, 26, 0), "older, in window")
	current := logLine(at(15, 27, 0), "current one") + logLine(at(15, 29, 0), "current two")
	got := string(CutWindow([]byte(older), []byte(current), at(15, 25, 12), at(15, 30, 12), 1<<20))
	want := logLine(at(15, 26, 0), "older, in window") + logLine(at(15, 27, 0), "current one") + logLine(at(15, 29, 0), "current two")
	if got != want {
		t.Fatalf("got %q\nwant %q", got, want)
	}
}

func TestCutWindowAcrossTheRollWhenTheOlderFileEndsWithoutANewline(t *testing.T) {
	older := strings.TrimSuffix(logLine(at(15, 26, 0), "older, in window"), "\n")
	current := logLine(at(15, 27, 0), "current one")
	got := string(CutWindow([]byte(older), []byte(current), at(15, 25, 12), at(15, 30, 12), 1<<20))
	want := logLine(at(15, 26, 0), "older, in window") + logLine(at(15, 27, 0), "current one")
	if got != want {
		t.Fatalf("two lines must not run together: got %q\nwant %q", got, want)
	}
}

func TestCutWindowReadsTheOlderFileOnlyWhenNeeded(t *testing.T) {
	// the current file already starts before the window, so nothing in the older one can be inside it; this older
	// text is not a real log, it only proves the function never looks at it
	older := logLine(at(15, 27, 0), "must not appear")
	current := logLine(at(15, 20, 0), "starts before the window") + logLine(at(15, 28, 0), "in window")
	got := string(CutWindow([]byte(older), []byte(current), at(15, 25, 12), at(15, 30, 12), 1<<20))
	want := logLine(at(15, 28, 0), "in window")
	if got != want {
		t.Fatalf("got %q\nwant %q", got, want)
	}
}

func TestCutWindowReadsTheOlderFileWhenTheCurrentOneHasNoStamps(t *testing.T) {
	// a file that just rolled holds nothing yet, or only a continuation line: the window is in the older one
	older := logLine(at(15, 28, 0), "older, in window")
	got := string(CutWindow([]byte(older), []byte("   at frame\n"), at(15, 25, 12), at(15, 30, 12), 1<<20))
	want := logLine(at(15, 28, 0), "older, in window") + "   at frame\n"
	if got != want {
		t.Fatalf("got %q\nwant %q", got, want)
	}
	if got := string(CutWindow([]byte(older), nil, at(15, 25, 12), at(15, 30, 12), 1<<20)); got != older {
		t.Fatalf("an empty current file leaves the older one: got %q", got)
	}
}

func TestCutWindowKeepsAPanicFrameWithItsLine(t *testing.T) {
	current := logLine(at(15, 20, 0), "early panic") + "goroutine 1 [running]:\n\tmain.early()\n" +
		logLine(at(15, 27, 0), "[wavesrv] panic: boom") + "goroutine 7 [running]:\n\tmain.boom()\n\t\tfile.go:12\n" +
		logLine(at(15, 28, 0), "next line")
	got := string(CutWindow(nil, []byte(current), at(15, 25, 12), at(15, 30, 12), 1<<20))
	want := logLine(at(15, 27, 0), "[wavesrv] panic: boom") + "goroutine 7 [running]:\n\tmain.boom()\n\t\tfile.go:12\n" +
		logLine(at(15, 28, 0), "next line")
	if got != want {
		t.Fatalf("frames follow the line before them, in or out: got %q\nwant %q", got, want)
	}
}

func TestCutWindowDropsAnUnstampedLineBeforeTheFirstStamp(t *testing.T) {
	current := "orphan frame\n" + logLine(at(15, 27, 0), "kept")
	got := string(CutWindow(nil, []byte(current), at(15, 25, 12), at(15, 30, 12), 1<<20))
	if want := logLine(at(15, 27, 0), "kept"); got != want {
		t.Fatalf("got %q\nwant %q", got, want)
	}
}

func TestCutWindowKeepsALastLineWithoutANewline(t *testing.T) {
	current := logLine(at(15, 27, 0), "one") + strings.TrimSuffix(logLine(at(15, 28, 0), "two"), "\n")
	got := string(CutWindow(nil, []byte(current), at(15, 25, 12), at(15, 30, 12), 1<<20))
	if got != current {
		t.Fatalf("got %q\nwant %q", got, current)
	}
}

func TestCutWindowCapKeepsTheTail(t *testing.T) {
	var b strings.Builder
	for i := 0; i < 60; i++ {
		b.WriteString(logLine(at(15, 26, 0).Add(time.Duration(i)*time.Second), "line number "+strings.Repeat("x", 20)+" "+string(rune('a'+i%26))))
	}
	current := b.String()
	const max = 500
	got := string(CutWindow(nil, []byte(current), at(15, 25, 12), at(15, 30, 12), max))
	if len(got) == 0 || len(got) > max {
		t.Fatalf("the cap is %d bytes, got %d", max, len(got))
	}
	if !strings.HasSuffix(current, got) {
		t.Fatalf("the capped log is the end of the window:\n%q", got)
	}
	if !strings.HasPrefix(got, "2026-11-19 ") {
		t.Fatalf("the cut falls on a line boundary, so the first line is whole: %q", got)
	}
	// the newest line is kept
	lines := strings.Split(strings.TrimSuffix(current, "\n"), "\n")
	if !strings.HasSuffix(strings.TrimSuffix(got, "\n"), lines[len(lines)-1]) {
		t.Fatalf("the newest line must survive the cap: %q", got)
	}
}

func TestCutWindowCapOnALineBoundary(t *testing.T) {
	one := logLine(at(15, 27, 0), "one")
	two := logLine(at(15, 28, 0), "two")
	got := string(CutWindow(nil, []byte(one+two), at(15, 25, 12), at(15, 30, 12), len(two)))
	if got != two {
		t.Fatalf("a cap that lands exactly between two lines keeps the second whole: got %q", got)
	}
}

func TestCutWindowCapKeepsTheTailOfOneHugeLine(t *testing.T) {
	huge := logLine(at(15, 27, 0), strings.Repeat("é", 400)) // 2-byte runes: a byte cut can split one
	got := CutWindow(nil, []byte(huge), at(15, 25, 12), at(15, 30, 12), 101)
	if len(got) == 0 || len(got) > 101 {
		t.Fatalf("want 1..101 bytes, got %d", len(got))
	}
	if !strings.HasSuffix(huge, string(got)) {
		t.Fatalf("the tail of the line is kept")
	}
	if s := string(got); strings.ContainsRune(s, '�') {
		t.Fatalf("a cut must not split a rune: %q", s)
	}
}

func TestCutWindowEmptyInputs(t *testing.T) {
	if got := CutWindow(nil, nil, at(15, 25, 12), at(15, 30, 12), 1<<20); len(got) != 0 {
		t.Fatalf("no input, no output: %q", got)
	}
	if got := CutWindow([]byte{}, []byte{}, at(15, 25, 12), at(15, 30, 12), 1<<20); len(got) != 0 {
		t.Fatalf("empty files, no output: %q", got)
	}
	only := logLine(at(15, 20, 0), "outside")
	if got := CutWindow(nil, []byte(only), at(15, 25, 12), at(15, 30, 12), 1<<20); len(got) != 0 {
		t.Fatalf("nothing in the window, no output: %q", got)
	}
}

func TestCutWindowAZeroCapMeansNoCap(t *testing.T) {
	current := logLine(at(15, 27, 0), "one") + logLine(at(15, 28, 0), "two")
	if got := string(CutWindow(nil, []byte(current), at(15, 25, 12), at(15, 30, 12), 0)); got != current {
		t.Fatalf("got %q", got)
	}
}

func TestParseStamp(t *testing.T) {
	cases := []struct {
		line string
		ok   bool
	}{
		{"2026-11-19 15:30:12.345 [tauri] hello", true},
		{"2026-11-19 15:30:12.345", true},
		{"2026-11-19 15:30:12.345\n", true},
		{"2026-11-19 15:30:12 no millis", false},
		{"2026-13-45 15:30:12.345 not a date", false},
		{"   at frame", false},
		{"", false},
		{"2026-11-19 15:30:12.3456 five digits", false},
	}
	for _, c := range cases {
		if _, ok := parseStamp([]byte(c.line)); ok != c.ok {
			t.Errorf("parseStamp(%q) ok = %v, want %v", c.line, ok, c.ok)
		}
	}
	got, ok := parseStamp([]byte("2026-11-19 15:30:12.345 x"))
	if !ok || !got.Equal(time.Date(2026, 11, 19, 15, 30, 12, 345_000_000, time.Local)) {
		t.Fatalf("got %v %v", got, ok)
	}
}
