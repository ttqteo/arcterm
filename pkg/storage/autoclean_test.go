// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestAutoCleanTakesOnlyTheSafeParts(t *testing.T) {
	repo := newRepo(t)
	done := addTree(t, repo, runDone)
	dirty := addTree(t, repo, runDirtyID)
	writeFile(t, filepath.Join(dirty, "uncommitted.txt"), 10)
	env := worktreeEnv(repo, map[string]RunState{
		runDone:    {Found: true, Finished: true, Status: "done"},
		runDirtyID: {Found: true, Finished: true, Status: "done"},
	})
	base := t.TempDir()
	env.DataDir = filepath.Join(base, "data")
	env.TrashDir = filepath.Join(base, "trash")
	env.SessionDirs = []string{filepath.Join(base, "projects")}
	env.LiveTranscripts = func(context.Context) ([]string, error) { return nil, nil }
	env.BusyProjects = func(context.Context) (map[string]string, error) { return nil, nil }
	oldLog := filepath.Join(env.DataDir, "waveapp.1.log")
	writeFile(t, oldLog, 40)
	aged(t, oldLog, 8*24*time.Hour)
	writeFile(t, filepath.Join(env.TrashDir, "1700000000000-abc", "abc.jsonl"), 60)
	writeFile(t, filepath.Join(repo, "frontend", "node_modules", "x.js"), 10)

	s := NewScanner(env, nil)
	res := s.AutoClean(context.Background())
	if res.Reclaimed < 140 || res.Error != "" {
		t.Fatalf("got %+v, want the done tree and the old log reclaimed", res)
	}
	if fileExists(done) || fileExists(oldLog) {
		t.Fatal("the finished clean tree and the old rolled log must be gone")
	}
	if !fileExists(dirty) || !fileExists(filepath.Join(env.TrashDir, "1700000000000-abc")) ||
		!fileExists(filepath.Join(repo, "frontend", "node_modules")) || fileExists(filepath.Join(env.DataDir, CacheMarkerName)) {
		t.Fatal("auto-clean touched a dirty tree, the trash, build output or the cache")
	}
	if r := s.Report(); r.LastAuto == nil || r.LastAuto.Reclaimed != res.Reclaimed {
		t.Fatalf("the report must carry the last auto-clean: %+v", r.LastAuto)
	}
	// AutoClean ends with a background rescan: let it finish before TempDir cleanup removes what it walks.
	waitFor(t, func() bool { return !s.Report().Scanning })
}

// A scheduled scan waits while a heavy job runs, starts once none does, gives up waiting after max, and stops with
// its context.
func TestWaitForIdle(t *testing.T) {
	ctx := context.Background()
	if !waitForIdle(ctx, nil, time.Millisecond, time.Second) {
		t.Fatal("no busy reading should not wait")
	}
	var asks atomic.Int32
	busyFor := func(n int32) func() string {
		return func() string {
			if asks.Add(1) <= n {
				return "a build or install is running"
			}
			return ""
		}
	}
	start := time.Now()
	if !waitForIdle(ctx, busyFor(3), 5*time.Millisecond, time.Minute) {
		t.Fatal("waitForIdle gave up while the context lives")
	}
	if took := time.Since(start); took < 10*time.Millisecond || took > 5*time.Second {
		t.Fatalf("waited %v for three busy asks at 5 ms", took)
	}
	start = time.Now()
	if !waitForIdle(ctx, func() string { return "busy" }, 5*time.Millisecond, 30*time.Millisecond) {
		t.Fatal("past max the scan should run anyway")
	}
	if took := time.Since(start); took > 5*time.Second {
		t.Fatalf("a never-idle machine held the scan %v, past max", took)
	}
	cctx, cancel := context.WithCancel(ctx)
	cancel()
	if waitForIdle(cctx, func() string { return "busy" }, time.Millisecond, time.Minute) {
		t.Fatal("an ended context should stop the wait")
	}
}

func TestAutoCleanSkipsCanvases(t *testing.T) {
	project, topic := canvasProject(t, "old-feature", "Main")
	aged(t, filepath.Join(topic, "project", "Main.dc.html"), 90*24*time.Hour)
	env := canvasEnv(t, project)
	env.DataDir = filepath.Join(t.TempDir(), "data")
	env.SessionDirs = []string{filepath.Join(t.TempDir(), "projects")}
	env.LiveTranscripts = func(context.Context) ([]string, error) { return nil, nil }
	env.BusyProjects = func(context.Context) (map[string]string, error) { return nil, nil }
	env.RunOfWorktree = func(string) (string, bool) { return "", false }

	s := NewScanner(env, nil)
	if res := s.AutoClean(context.Background()); res.Reclaimed != 0 || res.Error != "" {
		t.Fatalf("got %+v, want nothing reclaimed: a canvas waits for the person however old", res)
	}
	if !fileExists(filepath.Join(topic, "project", "Main.dc.html")) {
		t.Fatal("auto-clean removed a design canvas")
	}
	waitFor(t, func() bool { return !s.Report().Scanning })
}
