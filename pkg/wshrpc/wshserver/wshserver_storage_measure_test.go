// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/storage"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// TestStorageMeasure times Storage's scan on the owner's real home, the way a dev app runs it (the Final stage's
// settings-storage scenario waits on one). Opt in, since it walks ~/.claude/projects and the build output of every
// folder an agent worked in:
//
//	ARC_STORAGE_MEASURE=1    go test ./pkg/wshrpc/wshserver -run TestStorageMeasure -v -count=1   the quick scans only
//	ARC_STORAGE_MEASURE=full go test ./pkg/wshrpc/wshserver -run TestStorageMeasure -v -count=1   plus one full scan
//
// Each scan logs "storage scan took …: <category> <time>, …", which the test prints. The quick scans leave out the build
// output and the package caches (minutes of walking): they run with no unscanned hook and with the server's, three times
// each, and the gap in the sessions time is the hook's cost. The full scan runs once, with the hook, as the app does.
// Measure only reads and stats; nothing is cleaned. The package's TestMain points HOME at a temp dir, so the real home
// is passed in ARC_STORAGE_MEASURE_HOME.
func TestStorageMeasure(t *testing.T) {
	mode := os.Getenv("ARC_STORAGE_MEASURE")
	if mode == "" {
		t.Skip("set ARC_STORAGE_MEASURE=1 (quick scans) or full (plus one full scan) to measure on the real ~/.claude/projects")
	}
	home := os.Getenv("ARC_STORAGE_MEASURE_HOME")
	if home == "" {
		t.Fatal("set ARC_STORAGE_MEASURE_HOME to the real home dir: TestMain points HOME at a temp dir")
	}
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	dataDir := wavebase.GetWaveDataDir()
	env := func(withBuildAndCaches bool) *storage.Env {
		e := &storage.Env{
			Now:           time.Now,
			ProjectPaths:  func() []string { return nil },
			RunOfWorktree: orchestrate.RunOfWorktree,
			RunState: func(context.Context, string) (storage.RunState, error) {
				return storage.RunState{}, nil
			},
			BusyProjects:     func(context.Context) (map[string]string, error) { return map[string]string{}, nil },
			LiveTranscripts:  func(context.Context) ([]string, error) { return nil, nil },
			WorktreeRoot:     orchestrate.WorktreeRoot,
			DataDir:          dataDir,
			TrashDir:         filepath.Join(home, ".arc", "trash"),
			AttachmentsDir:   filepath.Join(home, ".arc", "attachments"),
			SessionDirs:      []string{filepath.Join(home, ".claude", "projects")},
			WebviewCacheDirs: storage.WebviewCacheDirs(runtime.GOOS, home, dataDir),
		}
		if withBuildAndCaches {
			e.AgentProjects = storageAgentProjects
			e.PackageCaches = storage.PackageCacheDirs(runtime.GOOS, home, os.Getenv)
		}
		return e
	}
	scan := func(label string, withBuildAndCaches bool, hook func(string, int64, time.Time) bool) {
		prev := storage.SessionUnscanned
		storage.SessionUnscanned = hook
		defer func() { storage.SessionUnscanned = prev }()
		buf := captureLog(t)
		rep := storage.NewScanner(env(withBuildAndCaches), nil).ScanNow(context.Background())
		for ln := range strings.SplitSeq(buf.String(), "\n") {
			if strings.Contains(ln, "storage scan took") {
				t.Logf("%s: %s", label, ln)
			}
		}
		for _, c := range rep.Categories {
			unscanned := 0
			for _, it := range c.Items {
				if it.Unscanned {
					unscanned++
				}
			}
			t.Logf("%s: %s: %d items (%d unscanned), %d bytes, error %q", label, c.Category, len(c.Items), unscanned, c.Bytes, c.Error)
		}
	}
	for i := 1; i <= 3; i++ {
		scan("quick, hook nil", false, nil)
		scan("quick, server's hook", false, sessionIdeasUnscanned)
	}
	if mode == "full" {
		scan("full, server's hook", true, sessionIdeasUnscanned)
	}
}
