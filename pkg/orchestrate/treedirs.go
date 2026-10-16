// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

// ErrTreeBusy is returned when the engine already holds a tree's removal lock.
var ErrTreeBusy = errors.New("the engine is removing it")

// RunKeyForTreeDir maps a folder name under the worktree root to its engine key: a full key as is, a
// <8-char prefix><suffix> name through the prefix's .run marker. ok=false: no marker, or not an engine name.
func RunKeyForTreeDir(root, name string) (string, bool) {
	if _, _, ok := splitRunKey(name); ok {
		return name, true
	}
	if len(name) < runPrefixLen {
		return "", false
	}
	prefix, suffix := name[:runPrefixLen], name[runPrefixLen:]
	if suffix != "" && !strings.HasPrefix(suffix, "-") {
		return "", false
	}
	runMarkerMu.RLock()
	owner, err := os.ReadFile(filepath.Join(root, prefix+runMarkerExt))
	runMarkerMu.RUnlock()
	if err != nil {
		return "", false
	}
	runID := string(owner)
	if _, perr := uuid.Parse(runID); perr != nil || len(runID) != runIDLen || runID[:runPrefixLen] != prefix {
		return "", false
	}
	return runID + suffix, true
}

// RemoveDirExclusive deletes a folder no git tracks: unlinkReparsePoints, then os.RemoveAll, under treeRemovals.
func RemoveDirExclusive(path string) error {
	if !treeRemovals.TryLock(path) {
		return ErrTreeBusy
	}
	defer treeRemovals.Unlock(path)
	if _, err := os.Lstat(path); errors.Is(err, os.ErrNotExist) {
		return nil
	}
	// before the delete: os.RemoveAll would follow a junction into its target
	if err := unlinkReparsePoints(path); err != nil {
		return fmt.Errorf("removing %s: %w", path, err)
	}
	if err := os.RemoveAll(path); err != nil {
		return fmt.Errorf("removing %s: %w", path, err)
	}
	return nil
}
