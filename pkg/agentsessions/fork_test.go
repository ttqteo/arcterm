// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func forkLines() []string {
	return []string{
		`{"type":"mode"}`,
		`{"type":"user","uuid":"u1","cwd":"D:/p","message":{"content":"first"}}`,
		`{"type":"assistant","uuid":"a1","parentUuid":"u1","cwd":"D:/p","message":{"content":[{"type":"text","text":"one"}]}}`,
		`{"type":"user","uuid":"u2","parentUuid":"a1","cwd":"D:/p","message":{"content":"second"}}`,
		`{"type":"assistant","uuid":"a2","parentUuid":"u2","cwd":"D:/p","message":{"content":[{"type":"text","text":"two"}]}}`,
	}
}

func TestCutTranscript(t *testing.T) {
	lines := forkLines()
	cases := []struct {
		name, uuid, keep string
		want             int // lines kept; -1 = error
	}{
		{"before your second message", "u2", "before", 3},
		{"through the first reply", "a1", "through", 3},
		{"through the last reply", "a2", "through", 5},
		{"before the first message keeps no message", "u1", "before", -1},
		{"a uuid no longer in the file", "gone", "through", -1},
		{"an unknown keep", "a1", "after", -1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := CutTranscript(lines, c.uuid, c.keep)
			if c.want < 0 {
				if err == nil {
					t.Fatalf("want an error, got %d lines", len(got))
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if len(got) != c.want {
				t.Fatalf("kept %d lines, want %d", len(got), c.want)
			}
		})
	}
}

func TestForkCommandWholeSession(t *testing.T) {
	home := t.TempDir()
	src := filepath.Join(t.TempDir(), "s1.jsonl")
	os.WriteFile(src, []byte(strings.Join(forkLines(), "\n")+"\n"), 0o644)
	got, err := ForkCommand(src, "", "", home)
	if err != nil {
		t.Fatal(err)
	}
	want := `claude --resume "` + filepath.ToSlash(src) + `" --fork-session`
	if got.Command != want {
		t.Fatalf("command %q, want %q", got.Command, want)
	}
	if got.ProjectPath != "D:/p" {
		t.Fatalf("project %q, want D:/p", got.ProjectPath)
	}
	if entries, _ := os.ReadDir(filepath.Join(home, ".arc", "forks")); len(entries) != 0 {
		t.Fatalf("a whole-session fork wrote %d copies", len(entries))
	}
}

func TestForkCommandFromAMessage(t *testing.T) {
	home := t.TempDir()
	src := filepath.Join(t.TempDir(), "s1.jsonl")
	os.WriteFile(src, []byte(strings.Join(forkLines(), "\n")+"\n"), 0o644)
	got, err := ForkCommand(src, "u2", "before", home)
	if err != nil {
		t.Fatal(err)
	}
	copies, _ := filepath.Glob(filepath.Join(home, ".arc", "forks", "*", "s1.jsonl"))
	if len(copies) != 1 {
		t.Fatalf("want one copy named after the source, got %v", copies)
	}
	data, _ := os.ReadFile(copies[0])
	if n := len(strings.Split(strings.TrimRight(string(data), "\n"), "\n")); n != 3 {
		t.Fatalf("copy has %d lines, want 3", n)
	}
	if !strings.Contains(got.Command, `--resume "`+filepath.ToSlash(copies[0])+`"`) {
		t.Fatalf("command %q does not resume the copy", got.Command)
	}
	if b, _ := os.ReadFile(src); len(strings.Split(strings.TrimRight(string(b), "\n"), "\n")) != 5 {
		t.Fatal("the source transcript changed")
	}
}

func TestForkCommandPrunesOldCopies(t *testing.T) {
	home := t.TempDir()
	old := filepath.Join(home, ".arc", "forks", "old")
	os.MkdirAll(old, 0o755)
	past := time.Now().Add(-25 * time.Hour)
	os.Chtimes(old, past, past)
	src := filepath.Join(t.TempDir(), "s1.jsonl")
	os.WriteFile(src, []byte(strings.Join(forkLines(), "\n")+"\n"), 0o644)
	if _, err := ForkCommand(src, "a1", "through", home); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatal("a copy older than a day was kept")
	}
}

func TestForkCommandHomeKeepsAskSettings(t *testing.T) {
	home := t.TempDir()
	src := filepath.Join(t.TempDir(), "s1.jsonl")
	line := `{"type":"user","uuid":"u1","cwd":` + strconv.Quote(home) + `,"message":{"content":"hi"}}`
	os.WriteFile(src, []byte(line+"\n"), 0o644)
	got, err := ForkCommand(src, "", "", home)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got.Command, "--settings "+claudeAskSettingsArg) {
		t.Fatalf("a home session's fork lost the ask-only settings: %q", got.Command)
	}
}
