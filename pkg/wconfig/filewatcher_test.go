// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
)

func TestNewWatcherReturnsConstructionError(t *testing.T) {
	sentinel := errors.New("watcher unavailable")
	watcher, err := newWatcher(func() (*fsnotify.Watcher, error) {
		return nil, sentinel
	})
	if watcher != nil {
		t.Fatal("failed construction must not return a watcher")
	}
	if !errors.Is(err, sentinel) {
		t.Fatalf("error = %v, want sentinel", err)
	}
}

// the read windows gives a file just replaced by a rename: its open is refused, so its part is missing
var refusedOpen = ConfigError{File: ProjectsFile, Err: "open projects.json: The process cannot access the file because it is being used by another process."}

func TestReadFullConfigSettledRetriesAnOpenFailure(t *testing.T) {
	calls := 0
	got := readFullConfigSettled(func() FullConfigType {
		calls++
		if calls < 3 {
			return FullConfigType{ConfigErrors: []ConfigError{refusedOpen}}
		}
		return FullConfigType{Projects: map[string]ProjectKeywords{"p": {Path: "C:/p"}}}
	})
	if calls != 3 || got.Projects["p"].Path != "C:/p" || len(got.ConfigErrors) != 0 {
		t.Fatalf("calls = %d, config = %+v; want the third read, with the project and no error", calls, got)
	}
}

func TestReadFullConfigSettledGivesUpAfterTheDeadline(t *testing.T) {
	start := time.Now()
	got := readFullConfigSettled(func() FullConfigType {
		return FullConfigType{ConfigErrors: []ConfigError{refusedOpen}}
	})
	if waited := time.Since(start); waited < openRetryFor || waited > openRetryFor+time.Second {
		t.Fatalf("waited %v, want about %v", waited, openRetryFor)
	}
	if len(got.ConfigErrors) != 1 {
		t.Fatalf("errors = %v, want the refused open reported", got.ConfigErrors)
	}
}

func TestReadFullConfigSettledDoesNotRetryAParseError(t *testing.T) {
	calls := 0
	parseErr := ConfigError{File: ProjectsFile, Err: "json syntax error at line 1, col 2: invalid character"}
	got := readFullConfigSettled(func() FullConfigType {
		calls++
		return FullConfigType{ConfigErrors: []ConfigError{parseErr}}
	})
	if calls != 1 || len(got.ConfigErrors) != 1 {
		t.Fatalf("calls = %d, errors = %v; a parse error is the file's content and reads once", calls, got.ConfigErrors)
	}
}

// the settle re-read is what repairs a watcher whose last event read missed the write that caused it
func TestRereadIfChangedPicksUpAMissedWrite(t *testing.T) {
	configDir, _ := setupLayers(t, nil)
	w, err := newWatcher(fsnotify.NewWatcher)
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	w.fullConfig = ReadFullConfig()
	projDir := t.TempDir()
	writeJSONFile(t, filepath.Join(configDir, ProjectsFile), map[string]any{"late": map[string]any{"path": projDir}})
	if _, has := w.GetFullConfig().Projects["late"]; has {
		t.Fatal("the held config already has the project; the test would prove nothing")
	}
	w.rereadIfChanged()
	if got := w.GetFullConfig().Projects["late"].Path; got != projDir {
		t.Fatalf("held project path = %q, want %q", got, projDir)
	}
}
