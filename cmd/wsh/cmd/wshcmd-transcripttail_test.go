// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestReadTailLines(t *testing.T) {
	path := filepath.Join(t.TempDir(), "t.jsonl")
	if err := os.WriteFile(path, []byte("{\"a\":1}\n{\"b\":2}\n{\"c\":3}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	whole, err := readTailLines(path, 1024)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{`{"a":1}`, `{"b":2}`, `{"c":3}`, ""}; !reflect.DeepEqual(whole, want) {
		t.Fatalf("whole file = %q, want %q", whole, want)
	}
	// the last 10 bytes start inside {"b":2}, which is dropped rather than returned cut
	cut, err := readTailLines(path, 10)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{`{"c":3}`, ""}; !reflect.DeepEqual(cut, want) {
		t.Fatalf("tail = %q, want %q", cut, want)
	}
}

func TestClaudeTranscriptPath(t *testing.T) {
	configDir := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", configDir)
	const id = "b2fe5b5b-f10a-4c15-accf-76b1ff8f4276"
	want := filepath.Join(configDir, "projects", "C--work-repo", id+".jsonl")
	if err := os.MkdirAll(filepath.Dir(want), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(want, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := claudeTranscriptPath(id)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("path = %q, want %q", got, want)
	}
	if _, err := claudeTranscriptPath("8ea5c210-3edc-47fe-b037-b9ca9df9af09"); err == nil {
		t.Fatal("a session with no transcript resolved")
	}
	if _, err := claudeTranscriptPath("*"); err == nil {
		t.Fatal("a glob pattern was taken as a session id")
	}
}

func TestReadTailLinesMissing(t *testing.T) {
	if _, err := readTailLines(filepath.Join(t.TempDir(), "none.jsonl"), 1024); err == nil {
		t.Fatal("a missing transcript read without an error")
	}
}
