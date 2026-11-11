// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package services

import (
	"os"
	"path/filepath"
	"strings"
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

// an entry an older build wrote when the person stopped the service still reads as that Stop (Off), the port kept, and
// a write after it carries Off, not the older key
func TestStateFileReadsAnOldStoppedEntry(t *testing.T) {
	path := filepath.Join(t.TempDir(), "services.json")
	old := `{"portfolio": {"port": 8386, "stopped": true}, "dev": {"stopped": true}, "web": {"port": 41207}}`
	if err := os.WriteFile(path, []byte(old), 0o644); err != nil {
		t.Fatal(err)
	}
	s := NewFileStore(path)
	if got := s.Get("portfolio"); got != (Remembered{Port: 8386, Off: true}) {
		t.Errorf("portfolio = %+v, want the port and Off", got)
	}
	if got := s.Get("dev"); got != (Remembered{Off: true}) {
		t.Errorf("dev = %+v, want Off", got)
	}
	if got := s.Get("web"); got != (Remembered{Port: 41207}) {
		t.Errorf("web = %+v, want the port only", got)
	}
	if err := s.Set("web", Remembered{Port: 41208}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "stopped") {
		t.Errorf("the file still holds the older key:\n%s", raw)
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
