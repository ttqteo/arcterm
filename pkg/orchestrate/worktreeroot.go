// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// engine trees live under one short root outside the project: nested under <project>\.waveterm\worktrees\<run id>-t-N
// a tree's deep paths passed 260 chars, past which Windows cannot start an .exe or resolve Node's #imports
const (
	worktreeRootName = "arc-wt"
	runIDLen         = 36
	runPrefixLen     = 8
	runMarkerExt     = ".run"
)

// runMarkerMu makes a marker's create and write one step for this process: two lanes of one run claim at once, and
// the one reading the marker between the other's create and write would take it for another run's
var runMarkerMu sync.RWMutex

var worktreeRootState struct {
	once       sync.Once
	mu         sync.Mutex
	resolved   string
	overridden bool
	override   string
}

// worktreeRoot is the directory engine trees are created in; empty means the legacy in-project layout.
func worktreeRoot() string {
	s := &worktreeRootState
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.overridden {
		return s.override
	}
	s.once.Do(func() {
		cache, err := os.UserCacheDir()
		if err != nil {
			log.Printf("no user cache dir, engine worktrees stay under each project's .waveterm/worktrees: %v", err)
			return
		}
		s.resolved = filepath.Join(cache, worktreeRootName)
	})
	return s.resolved
}

// UseWorktreeRootForTest points engine trees at dir (empty = the legacy layout) and returns the restore func.
func UseWorktreeRootForTest(dir string) (restore func()) {
	s := &worktreeRootState
	s.mu.Lock()
	prevSet, prev := s.overridden, s.override
	s.overridden, s.override = true, dir
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		s.overridden, s.override = prevSet, prev
		s.mu.Unlock()
	}
}

// WorktreeDir is worktreeDir, for other packages' tests.
func WorktreeDir(projectPath, key string) string {
	return worktreeDir(projectPath, key)
}

func legacyWorktreeDir(projectPath, key string) string {
	return filepath.Join(projectPath, ".waveterm", "worktrees", key)
}

// worktreeDir is the engine tree for key. A legacy in-project tree wins, so a run in flight when the root moved
// keeps its trees until it removes them. It only reads: creation goes through claimWorktreeDir.
func worktreeDir(projectPath, key string) string {
	legacy := legacyWorktreeDir(projectPath, key)
	root := worktreeRoot()
	if root == "" {
		return legacy
	}
	if _, err := os.Stat(legacy); err == nil {
		return legacy
	}
	return shortWorktreeDir(root, key)
}

// claimWorktreeDir is worktreeDir for a tree about to be created: it creates the root and claims the key's run
// prefix, so the path it returns is the one worktreeDir resolves from then on.
func claimWorktreeDir(projectPath, key string) (string, error) {
	legacy := legacyWorktreeDir(projectPath, key)
	root := worktreeRoot()
	if root == "" {
		return legacy, nil
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return "", fmt.Errorf("creating the worktree root %s: %w", root, err)
	}
	if _, err := os.Stat(legacy); err == nil {
		return legacy, nil
	}
	if runID, _, ok := splitRunKey(key); ok {
		if err := claimRunPrefix(root, runID); err != nil {
			return "", err
		}
	}
	return shortWorktreeDir(root, key), nil
}

// splitRunKey splits an engine key into its run id and the suffix after it ("", "-t-3", "-final").
func splitRunKey(key string) (string, string, bool) {
	if len(key) < runIDLen {
		return "", "", false
	}
	runID, suffix := key[:runIDLen], key[runIDLen:]
	if _, err := uuid.Parse(runID); err != nil {
		return "", "", false
	}
	if suffix != "" && !strings.HasPrefix(suffix, "-") {
		return "", "", false
	}
	return runID, suffix, true
}

func runMarkerPath(root, runID string) string {
	return filepath.Join(root, runID[:runPrefixLen]+runMarkerExt)
}

// shortWorktreeDir is <root>/<8><suffix> while the prefix is free or this run's, else <root>/<full key>: a removal
// resolving the same way can never reach another run's tree.
func shortWorktreeDir(root, key string) string {
	runID, suffix, ok := splitRunKey(key)
	if !ok {
		return filepath.Join(root, key)
	}
	runMarkerMu.RLock()
	owner, err := os.ReadFile(runMarkerPath(root, runID))
	runMarkerMu.RUnlock()
	if errors.Is(err, fs.ErrNotExist) || (err == nil && string(owner) == runID) {
		return filepath.Join(root, runID[:runPrefixLen]+suffix)
	}
	// another run's, or one a crash left empty or unreadable
	return filepath.Join(root, key)
}

// claimRunPrefix writes the prefix marker naming runID unless one exists. Only SweepWorktreeRoot deletes one, once
// no folder is left under the prefix: a run's leftover trees can outlive it, and a later run taking the freed
// prefix would resolve, and remove, them.
func claimRunPrefix(root, runID string) error {
	marker := runMarkerPath(root, runID)
	runMarkerMu.Lock()
	defer runMarkerMu.Unlock()
	f, err := os.OpenFile(marker, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if errors.Is(err, fs.ErrExist) {
		// whoever won, the marker's content now decides the path
		return nil
	}
	if err != nil {
		return fmt.Errorf("claiming worktree prefix %s: %w", marker, err)
	}
	_, werr := f.WriteString(runID)
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	if werr != nil {
		return fmt.Errorf("writing worktree prefix marker %s: %w", marker, werr)
	}
	return nil
}

// SweepWorktreeRoot deletes what finished runs left under the worktree root. A land or cancel can fail to delete a
// tree a process still holds, on Windows most often the lead, whose session stays in its landing tree after it
// completes; git has already unregistered that tree, so its folder has no .git and nothing in it is kept. Each
// finished run's folder with no .git goes, then each finished run's marker with no folder left under its prefix.
// A folder still held is logged and left for the next sweep.
func SweepWorktreeRoot(ctx context.Context) {
	root := worktreeRoot()
	if root == "" {
		return
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			log.Printf("sweeping worktrees: %v", err)
		}
		return
	}
	finished := finishedRuns(ctx)
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		key, ok := RunKeyForTreeDir(root, e.Name())
		if !ok {
			continue
		}
		runID, _, _ := splitRunKey(key)
		dir := filepath.Join(root, e.Name())
		if _, err := os.Lstat(filepath.Join(dir, ".git")); !errors.Is(err, fs.ErrNotExist) || !finished(runID) {
			continue
		}
		if err := RemoveDirExclusive(dir); err != nil {
			log.Printf("sweeping worktrees: run %s: %v", runID, err)
		}
	}
	sweepRunMarkers(root, finished)
}

// finishedRuns reports whether a run is done or cancelled, reading each run once. A run it cannot read, or that
// is not stored, is not finished.
func finishedRuns(ctx context.Context) func(runID string) bool {
	seen := map[string]bool{}
	return func(runID string) bool {
		if done, ok := seen[runID]; ok {
			return done
		}
		run, err := wstore.DBGet[*waveobj.Run](ctx, runID)
		if err != nil {
			log.Printf("sweeping worktrees: reading run %s: %v", runID, err)
		}
		done := err == nil && run != nil && (run.Status == jarvis.RunStatus_Done || run.Status == jarvis.RunStatus_Cancelled)
		seen[runID] = done
		return done
	}
}

// sweepRunMarkers deletes the marker of each finished run with no folder under its prefix, its own or another
// run's full-key one: a marker decides where every key with its prefix resolves.
func sweepRunMarkers(root string, finished func(runID string) bool) {
	// held across the listing and the deletes, so no claim lands between them
	runMarkerMu.Lock()
	defer runMarkerMu.Unlock()
	entries, err := os.ReadDir(root)
	if err != nil {
		log.Printf("sweeping worktree markers: %v", err)
		return
	}
	inUse := map[string]bool{}
	for _, e := range entries {
		if e.IsDir() && len(e.Name()) >= runPrefixLen {
			inUse[e.Name()[:runPrefixLen]] = true
		}
	}
	for _, e := range entries {
		prefix, ok := strings.CutSuffix(e.Name(), runMarkerExt)
		if e.IsDir() || !ok || inUse[prefix] {
			continue
		}
		marker := filepath.Join(root, e.Name())
		owner, err := os.ReadFile(marker)
		if err != nil {
			log.Printf("sweeping worktree markers: %v", err)
			continue
		}
		if !finished(string(owner)) {
			continue
		}
		if err := os.Remove(marker); err != nil {
			log.Printf("sweeping worktree markers: %v", err)
		}
	}
}
