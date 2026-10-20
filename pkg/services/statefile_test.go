// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package services

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStateFileRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "services.json")
	if got := NewFileStore(path).Get("portfolio"); got != (Remembered{}) {
		t.Fatalf("a missing file reads %+v, want empty", got)
	}
	s := NewFileStore(path)
	if err := s.Set("portfolio", Remembered{Port: 8386}); err != nil {
		t.Fatal(err)
	}
	if err := s.Set("dev", Remembered{Port: 41207}); err != nil {
		t.Fatal(err)
	}
	fresh := NewFileStore(path)
	if got := fresh.Get("portfolio"); got != (Remembered{Port: 8386}) {
		t.Errorf("portfolio = %+v", got)
	}
	if got := fresh.Get("dev"); got != (Remembered{Port: 41207}) {
		t.Errorf("dev = %+v", got)
	}
	left, _ := filepath.Glob(filepath.Join(filepath.Dir(path), "*.tmp"))
	if len(left) != 0 {
		t.Errorf("temp files left behind: %v", left)
	}
}

// an entry written when a Stop was remembered still reads: the flag is ignored, the port kept
func TestStateFileReadsAnOldStoppedEntry(t *testing.T) {
	path := filepath.Join(t.TempDir(), "services.json")
	old := `{"portfolio": {"port": 8386, "stopped": true}, "dev": {"stopped": true}}`
	if err := os.WriteFile(path, []byte(old), 0o644); err != nil {
		t.Fatal(err)
	}
	s := NewFileStore(path)
	if got := s.Get("portfolio"); got != (Remembered{Port: 8386}) {
		t.Errorf("portfolio = %+v, want the port only", got)
	}
	if got := s.Get("dev"); got != (Remembered{}) {
		t.Errorf("dev = %+v, want nothing remembered", got)
	}
}

func TestStateFileForgetsAnEmptyEntryAndSurvivesGarbage(t *testing.T) {
	path := filepath.Join(t.TempDir(), "services.json")
	s := NewFileStore(path)
	_ = s.Set("a", Remembered{Port: 1})
	_ = s.Set("a", Remembered{})
	if got := NewFileStore(path).Get("a"); got != (Remembered{}) {
		t.Errorf("a = %+v, want forgotten", got)
	}
	if err := os.WriteFile(path, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := NewFileStore(path).Get("a"); got != (Remembered{}) {
		t.Errorf("garbage reads %+v", got)
	}
}
