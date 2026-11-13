// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chatsuggest

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func prompt(text, entry string, at time.Time) string {
	b, _ := json.Marshal(map[string]any{
		"type":       "user",
		"entrypoint": entry,
		"timestamp":  at.UTC().Format(time.RFC3339Nano),
		"message":    map[string]any{"role": "user", "content": text},
	})
	return string(b)
}

func TestHabitKey(t *testing.T) {
	for in, want := range map[string]string{
		"Build đi!":         "build di",
		"build di":          "build di",
		"  sao   rồi?":      "sao roi",
		"Pull về và build.": "pull ve va build",
		"continue?":         "continue",
	} {
		if got := HabitKey(in); got != want {
			t.Errorf("HabitKey(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestHabitText(t *testing.T) {
	for _, s := range []string{"/model", "! ls", "<task-notification>", "brainstorm: check", "initiative: added x", "A",
		"[Image #1]", "two\nlines", strings.Repeat("x", habitRunes+1)} {
		if got := habitText(s); got != "" {
			t.Errorf("habitText(%q) = %q, want none", s, got)
		}
	}
	if got := habitText("  pull về và build "); got != "pull về và build" {
		t.Errorf("habitText kept %q", got)
	}
}

func TestScanHits(t *testing.T) {
	at := time.Date(2026, 11, 13, 10, 0, 0, 0, time.UTC)
	array, _ := json.Marshal(map[string]any{"type": "user", "entrypoint": "cli",
		"message": map[string]any{"content": []any{map[string]any{"type": "tool_result", "content": "ok"}}}})
	meta, _ := json.Marshal(map[string]any{"type": "user", "entrypoint": "cli", "isMeta": true,
		"message": map[string]any{"content": "build đi"}})
	long := prompt(strings.Repeat("y", habitLineMax*2), "cli", at)
	lines := []string{
		prompt("build đi", "cli", at),
		prompt("Reply with just: ok", "sdk-cli", at),
		string(array),
		string(meta),
		`{"type":"assistant","message":{"content":[{"type":"text","text":"build đi"}]}}`,
		long,
		prompt("sửa đi", "cli", at),
	}
	whole := strings.Join(lines, "\n") + "\n"
	partial := prompt("pull về", "cli", at)
	hits, off, err := scanHits(strings.NewReader(whole+partial), 0)
	if err != nil {
		t.Fatal(err)
	}
	if off != int64(len(whole)) {
		t.Errorf("read %d bytes, want %d: the line still being written waits", off, len(whole))
	}
	if len(hits) != 2 || hits[0].T != "build đi" || hits[1].T != "sửa đi" || hits[0].At != at.UnixMilli() {
		t.Errorf("hits = %+v", hits)
	}
}

func TestCountHabits(t *testing.T) {
	h := func(text string, at int64) hit { return hit{K: HabitKey(text), T: text, At: at} }
	hits := []hit{
		h("build đi", 10), h("build di", 11), h("build đi", 12), h("build đi", 13),
		h("sửa đi", 10), h("sửa đi", 11),
		h("pull về", 1), h("pull về", 10), h("pull về", 11), h("pull về", 12),
		h("ok làm đi", 10), h("ok làm đi", 11), h("ok làm đi", 12),
	}
	got := countHabits(hits, 5, map[string]bool{HabitKey("ok làm đi"): true})
	want := []Habit{{Text: "build đi", Key: "build di", Uses: 4}, {Text: "pull về", Key: "pull ve", Uses: 3}}
	if len(got) != len(want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("got[%d] = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestHabitIndex(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "projects")
	if err := os.MkdirAll(filepath.Join(root, "p"), 0o755); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	clock := now
	file := filepath.Join(root, "p", "s.jsonl")
	write := func(texts ...string) {
		f, err := os.OpenFile(file, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
		if err != nil {
			t.Fatal(err)
		}
		for _, s := range texts {
			f.WriteString(prompt(s, "cli", now) + "\n")
		}
		f.Close()
	}
	write("build đi", "build đi", "commit đi")
	index, hidden := filepath.Join(dir, "index.json"), filepath.Join(dir, "hidden.json")
	x := NewHabitIndex(root, index, hidden, func() time.Time { return clock })
	if got := x.Habits(); len(got) != 0 {
		t.Fatalf("two uses are no habit yet: %+v", got)
	}
	write("build di", "commit đi", "commit đi")
	if got := x.Habits(); len(got) != 0 {
		t.Fatalf("read again before habitRescan: %+v", got)
	}
	clock = clock.Add(habitRescan)
	got := x.Habits()
	if len(got) != 2 || got[0].Text != "build đi" || got[0].Uses != 3 || got[1].Key != "commit di" {
		t.Fatalf("after the appended lines: %+v", got)
	}
	if err := x.Hide("Commit đi"); err != nil {
		t.Fatal(err)
	}
	// a new index (wavesrv restarted) keeps what was read and what was hidden
	y := NewHabitIndex(root, index, hidden, func() time.Time { return clock })
	got = y.Habits()
	if len(got) != 1 || got[0].Key != "build di" {
		t.Fatalf("after a restart: %+v", got)
	}
}

func TestBuildPromptHabits(t *testing.T) {
	p := BuildPrompt(Request{Reply: "Layout xong.", Habits: []string{"vẽ tôi xem", "commit đi", "build đi"}})
	if !strings.Contains(p, "- vẽ tôi xem\n- build đi\n") {
		t.Errorf("prompt lacks the habits:\n%s", p)
	}
	if strings.Contains(p, "commit đi") {
		t.Errorf("a commit habit is given to the model:\n%s", p)
	}
	if strings.Contains(BuildPrompt(Request{Reply: "x"}), "often") {
		t.Errorf("no habits, no habit section")
	}
}
