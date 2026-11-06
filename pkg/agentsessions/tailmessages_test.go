// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// peekPrompt, peekAnswer, peekToolUse and peekToolResult are the transcript records the Quick look reads, in the shape
// Claude Code writes them.
func peekPrompt(t testing.TB, text string) string {
	return `{"type":"user","timestamp":"2026-11-06T10:00:00.000Z","origin":{"kind":"human"},"message":{"role":"user","content":` + jsonStr(t, text) + `}}`
}

func peekAnswer(t testing.TB, text string) string {
	return `{"type":"assistant","timestamp":"2026-11-06T10:00:01.000Z","message":{"role":"assistant","content":[{"type":"text","text":` + jsonStr(t, text) + `}]}}`
}

func peekToolUse() string {
	return `{"type":"assistant","timestamp":"2026-11-06T10:00:01.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}`
}

func peekToolResult(t testing.TB, size int) string {
	return `{"type":"user","timestamp":"2026-11-06T10:00:02.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":` + jsonStr(t, strings.Repeat("x", size)) + `}]}}`
}

func jsonStr(t testing.TB, s string) string {
	t.Helper()
	b, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// writePeekFile writes the lines, each ending in "\n", plus tail as is (an unterminated last line when not "").
func writePeekFile(t testing.TB, dir string, lines []string, tail string) string {
	t.Helper()
	path := filepath.Join(dir, "s.jsonl")
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"+tail), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func peekSummary(msgs []PeekMessage) []string {
	out := make([]string, len(msgs))
	for i, m := range msgs {
		out[i] = m.Role + ": " + m.Text
	}
	return out
}

func assertPeek(t *testing.T, got []PeekMessage, want ...string) {
	t.Helper()
	g := peekSummary(got)
	if strings.Join(g, "\n|") != strings.Join(want, "\n|") {
		t.Fatalf("messages:\n got %q\nwant %q", g, want)
	}
}

func readPeek(t *testing.T, path string, n int) ([]PeekMessage, bool) {
	t.Helper()
	msgs, capped, err := ClaudeTailMessages(path, n)
	if err != nil {
		t.Fatal(err)
	}
	return msgs, capped
}

func TestClaudeTailMessagesSmallFile(t *testing.T) {
	path := writePeekFile(t, t.TempDir(), []string{
		peekPrompt(t, "first"),
		peekAnswer(t, "one"),
		peekPrompt(t, "second\nwith a line break"),
		peekAnswer(t, "two"),
	}, "")
	msgs, capped := readPeek(t, path, 5)
	if capped {
		t.Fatal("capped on a file read to its start")
	}
	assertPeek(t, msgs, "user: first", "assistant: one", "user: second\nwith a line break", "assistant: two")
	if msgs[0].Ts == 0 || msgs[1].Ts <= msgs[0].Ts {
		t.Fatalf("timestamps: %d, %d", msgs[0].Ts, msgs[1].Ts)
	}
	msgs, _ = readPeek(t, path, 3)
	assertPeek(t, msgs, "assistant: one", "user: second\nwith a line break", "assistant: two")
}

func TestClaudeTailMessagesSkipsALineOver256KB(t *testing.T) {
	path := writePeekFile(t, t.TempDir(), []string{
		peekPrompt(t, "before"),
		peekAnswer(t, "answer before"),
		peekPrompt(t, "run it"),
		peekToolUse(),
		peekToolResult(t, 900<<10),
		peekAnswer(t, "it ran"),
		peekPrompt(t, "after"),
		peekAnswer(t, "answer after"),
	}, "")
	msgs, capped := readPeek(t, path, 6)
	if capped {
		t.Fatal("capped")
	}
	assertPeek(t, msgs, "user: before", "assistant: answer before", "user: run it", "assistant: it ran",
		"user: after", "assistant: answer after")
}

// A huge answer is skipped like any line over 256 KB; the turn's answer is then the text before it, if any.
func TestClaudeTailMessagesSkipsAHugeAnswerLine(t *testing.T) {
	path := writePeekFile(t, t.TempDir(), []string{
		peekPrompt(t, "go"),
		peekAnswer(t, strings.Repeat("y", 300<<10)),
		peekPrompt(t, "next"),
	}, "")
	msgs, _ := readPeek(t, path, 5)
	assertPeek(t, msgs, "user: go", "user: next")
}

func TestClaudeTailMessagesMessageAcrossAChunkBoundary(t *testing.T) {
	answer := strings.Repeat("abcdefghij", 150) // 1,500 characters: kept whole
	target := peekAnswer(t, answer)
	// the filler after the answer leaves the boundary 64 KB from the end inside the answer's line
	filler := peekToolResult(t, peekChunkSize-len(target)/2-200)
	path := writePeekFile(t, t.TempDir(), []string{
		peekPrompt(t, "spanning"),
		target,
		peekPrompt(t, "after"),
		filler,
	}, "")
	info, _ := os.Stat(path)
	boundary := info.Size() - peekChunkSize
	data, _ := os.ReadFile(path)
	start := int64(strings.Index(string(data), target))
	if !(start < boundary && boundary < start+int64(len(target))) {
		t.Fatalf("test setup: boundary %d not inside the answer [%d, %d)", boundary, start, start+int64(len(target)))
	}
	msgs, _ := readPeek(t, path, 5)
	assertPeek(t, msgs, "user: spanning", "assistant: "+answer, "user: after")
}

func TestClaudeTailMessagesClipsALongMessage(t *testing.T) {
	long := strings.Repeat("line of words\n", 20000) // ~280 KB of JSON is over the line cap, so keep it under
	long = long[:150<<10]
	path := writePeekFile(t, t.TempDir(), []string{peekPrompt(t, "explain"), peekAnswer(t, long)}, "")
	msgs, _ := readPeek(t, path, 5)
	if len(msgs) != 2 {
		t.Fatalf("got %d messages", len(msgs))
	}
	got := []rune(msgs[1].Text)
	if len(got) != peekMaxText || !strings.HasSuffix(msgs[1].Text, "…") {
		t.Fatalf("clipped answer: %d runes, ends %q", len(got), string(got[len(got)-3:]))
	}
	if !strings.Contains(msgs[1].Text, "words\nline") {
		t.Fatal("clipping lost the line breaks")
	}
}

func TestClaudeTailMessagesIgnoresAnUnterminatedLastLine(t *testing.T) {
	path := writePeekFile(t, t.TempDir(), []string{peekPrompt(t, "done"), peekAnswer(t, "yes")},
		peekPrompt(t, "still writing"))
	msgs, _ := readPeek(t, path, 5)
	assertPeek(t, msgs, "user: done", "assistant: yes")
}

func TestClaudeTailMessagesStopsAtThe8MBCap(t *testing.T) {
	var noise []string
	for range 90 { // ~9 MB of tool results, every line under the 256 KB line cap
		noise = append(noise, peekToolResult(t, 100<<10))
	}
	dir := t.TempDir()

	// nothing in the last 8 MB
	lines := append([]string{peekPrompt(t, "long ago"), peekAnswer(t, "old")}, noise...)
	msgs, capped := readPeek(t, writePeekFile(t, dir, lines, ""), 5)
	if !capped || len(msgs) != 0 {
		t.Fatalf("capped %v, %d messages; want capped with none", capped, len(msgs))
	}

	// one message inside the last 8 MB, fewer than asked for
	lines = append(append([]string{peekPrompt(t, "long ago"), peekAnswer(t, "old")}, noise...),
		peekPrompt(t, "recent"), peekToolUse())
	msgs, capped = readPeek(t, writePeekFile(t, dir, lines, ""), 5)
	if !capped {
		t.Fatal("not capped")
	}
	assertPeek(t, msgs, "user: recent")

	// the file's start reached under the cap: not capped
	lines = append([]string{peekPrompt(t, "start")}, noise[:20]...)
	msgs, capped = readPeek(t, writePeekFile(t, dir, lines, ""), 5)
	if capped {
		t.Fatal("capped on a file under 8 MB")
	}
	assertPeek(t, msgs, "user: start")
}

func TestClaudeTailMessagesLeavesOutRecordsNoPersonWrote(t *testing.T) {
	path := writePeekFile(t, t.TempDir(), []string{
		peekPrompt(t, "real one"),
		`{"type":"user","timestamp":"2026-11-06T10:00:00.000Z","isMeta":true,"message":{"role":"user","content":[{"type":"text","text":"# Skill body"}]}}`,
		`{"type":"user","timestamp":"2026-11-06T10:00:00.000Z","isSidechain":true,"message":{"role":"user","content":"subagent task"}}`,
		`{"type":"assistant","timestamp":"2026-11-06T10:00:01.000Z","isSidechain":true,"message":{"role":"assistant","content":[{"type":"text","text":"subagent answer"}]}}`,
		`{"type":"user","timestamp":"2026-11-06T10:00:00.000Z","origin":{"kind":"task-notification"},"message":{"role":"user","content":"a background command finished"}}`,
		`{"type":"user","timestamp":"2026-11-06T10:00:00.000Z","origin":{"kind":"human"},"message":{"role":"user","content":"<task-notification>\n<task-id>b1</task-id>\n</task-notification>"}}`,
		`{"type":"user","timestamp":"2026-11-06T10:00:00.000Z","message":{"role":"user","content":"<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>"}}`,
		`{"type":"user","timestamp":"2026-11-06T10:00:00.000Z","message":{"role":"user","content":"<local-command-stdout>ok</local-command-stdout>"}}`,
		peekPrompt(t, "<system-reminder>\nYou have tools.\n</system-reminder>"),
		peekPrompt(t, "<system-reminder>\nnote\n</system-reminder>\nkept part"),
		peekAnswer(t, "main answer"),
	}, "")
	msgs, _ := readPeek(t, path, 10)
	assertPeek(t, msgs, "user: real one", "user: kept part", "assistant: main answer")
}

// Each turn gives its last text-bearing answer; the narration between tool calls and a tool-only turn give none.
func TestClaudeTailMessagesOneAnswerPerTurn(t *testing.T) {
	path := writePeekFile(t, t.TempDir(), []string{
		peekPrompt(t, "fix it"),
		peekAnswer(t, "Let me check X."),
		peekToolUse(),
		peekToolResult(t, 100),
		peekAnswer(t, "Now Y."),
		peekToolUse(),
		peekToolResult(t, 100),
		peekAnswer(t, "Fixed."),
		peekPrompt(t, "commit"),
		peekToolUse(),
		peekToolResult(t, 100),
		peekPrompt(t, "and now?"),
		peekToolUse(), // a turn still running: only its prompt
	}, "")
	msgs, _ := readPeek(t, path, 5)
	assertPeek(t, msgs, "user: fix it", "assistant: Fixed.", "user: commit", "user: and now?")
}

func TestClaudeTailMessagesClampsTheCount(t *testing.T) {
	var lines []string
	for i := range 15 {
		lines = append(lines, peekPrompt(t, fmt.Sprintf("p%d", i)), peekAnswer(t, fmt.Sprintf("a%d", i)))
	}
	path := writePeekFile(t, t.TempDir(), lines, "") // 30 messages
	msgs, _ := readPeek(t, path, 0)
	assertPeek(t, msgs, "assistant: a12", "user: p13", "assistant: a13", "user: p14", "assistant: a14")
	msgs, _ = readPeek(t, path, 25)
	if len(msgs) != 20 || msgs[0].Text != "p5" || msgs[19].Text != "a14" {
		t.Fatalf("n=25: %d messages, %q", len(msgs), peekSummary(msgs))
	}
}

func TestClaudeTailMessagesMissingFile(t *testing.T) {
	_, _, err := ClaudeTailMessages(filepath.Join(t.TempDir(), "gone.jsonl"), 5)
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("err = %v, want not-exist", err)
	}
}

// BenchmarkClaudeTailMessages reads the Quick look's 5 messages from a synthetic ~52 MB, ~5,300-line transcript shaped
// like a long real one: turns of narration, tool calls and long tool results. B/op is the allocation of one read;
// nothing is held between reads.
func BenchmarkClaudeTailMessages(b *testing.B) {
	var sb strings.Builder
	// tool results of 1 KB to 300 KB (one in 20 over the line cap), 29 KB on average
	var sizes []int
	for _, kb := range []int{1, 2, 4, 8, 16, 30, 50, 90, 300, 12, 1, 2, 4, 8, 16, 20, 1, 2, 4, 8} {
		sizes = append(sizes, kb<<10)
	}
	lines := 0
	for turn := 0; sb.Len() < 52<<20; turn++ {
		sb.WriteString(peekPrompt(b, fmt.Sprintf("prompt %d: look at the panel again", turn)) + "\n")
		for step := range 8 {
			sb.WriteString(peekAnswer(b, "Let me check the next file.") + "\n")
			sb.WriteString(peekToolUse() + "\n")
			sb.WriteString(peekToolResult(b, sizes[(turn*8+step)%len(sizes)]) + "\n")
		}
		sb.WriteString(peekAnswer(b, strings.Repeat("The answer, in a few lines.\n", 30)) + "\n")
		lines += 26
	}
	path := filepath.Join(b.TempDir(), "long.jsonl")
	if err := os.WriteFile(path, []byte(sb.String()), 0o644); err != nil {
		b.Fatal(err)
	}
	b.Logf("transcript: %.1f MB, %d lines", float64(sb.Len())/(1<<20), lines)
	b.ReportAllocs()
	for b.Loop() {
		msgs, _, err := ClaudeTailMessages(path, 5)
		if err != nil || len(msgs) != 5 {
			b.Fatalf("%d messages, %v", len(msgs), err)
		}
	}
}
