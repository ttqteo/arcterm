// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/google/uuid"
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

// claimRunPrefix writes the prefix marker naming runID unless one exists. The marker is never deleted: a run's
// leftover trees can outlive it, and a later run taking the freed prefix would resolve, and remove, them.
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
