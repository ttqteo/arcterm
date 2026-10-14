// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package claudecontext

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/learn"
	"github.com/wavetermdev/waveterm/pkg/sessiontrash"
)

// ErrNotMemory is DeleteMemory's answer for a path that is not one memory file of a project: the app only ever trashes
// ~/.claude/projects/<slug>/memory/<name>.md, and never the folder's MEMORY.md index.
var ErrNotMemory = errors.New("not a Claude project memory file")

// trashMeta is the meta.json the session trash writes beside an entry's files, in the same shape.
type trashMeta struct {
	OriginalPath string `json:"originalPath"`
	DeletedAt    string `json:"deletedAt"` // RFC 3339
}

// DeleteMemory moves one memory file of a project into trashDir as <unix-ms>-memory-<name>/, beside a meta.json saying
// where it came from (the session trash's layout, so its purge empties it), then drops the file's line from the
// folder's MEMORY.md. It returns the entry's path. This is the only write Setup → Project makes: a memory is fixed by
// asking Claude, never edited in the app.
func DeleteMemory(path, home, trashDir string, now time.Time) (string, error) {
	dir, name, err := memoryFile(path, home)
	if err != nil {
		return "", err
	}
	fi, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if !fi.Mode().IsRegular() {
		return "", fmt.Errorf("%w: %s is not a regular file", ErrNotMemory, path)
	}
	entry := filepath.Join(trashDir, fmt.Sprintf("%d-memory-%s", now.UnixMilli(), strings.TrimSuffix(name, filepath.Ext(name))))
	if err := os.MkdirAll(trashDir, 0o700); err != nil {
		return "", fmt.Errorf("creating the trash: %w", err)
	}
	if err := os.Mkdir(entry, 0o700); err != nil {
		return "", fmt.Errorf("creating the trash entry: %w", err)
	}
	// the meta first: an entry that exists says where its file came from, even if this is cut short
	raw, _ := json.MarshalIndent(trashMeta{OriginalPath: path, DeletedAt: now.UTC().Format(time.RFC3339)}, "", "  ")
	if err := os.WriteFile(filepath.Join(entry, "meta.json"), raw, 0o600); err != nil {
		_ = os.RemoveAll(entry)
		return "", fmt.Errorf("writing the trash entry: %w", err)
	}
	if err := sessiontrash.MoveEntry(path, filepath.Join(entry, name)); err != nil {
		_ = os.RemoveAll(entry)
		return "", fmt.Errorf("moving the memory to the trash: %w", err)
	}
	if err := learn.RemoveIndexLine(dir, name); err != nil {
		return entry, fmt.Errorf("the memory is in %s, but MEMORY.md still lists it: %w", entry, err)
	}
	return entry, nil
}

// memoryFile splits path into its memory folder and file name when it is <home>/.claude/projects/<slug>/memory/<name>.md
// and not MEMORY.md. A path with a ".." segment is refused outright rather than cleaned away.
func memoryFile(path, home string) (dir, name string, err error) {
	bad := func() (string, string, error) { return "", "", fmt.Errorf("%w: %s", ErrNotMemory, path) }
	if !filepath.IsAbs(path) || strings.Contains(filepath.ToSlash(path), "/../") {
		return bad()
	}
	rel, err := filepath.Rel(filepath.Join(home, ".claude", "projects"), filepath.Clean(path))
	if err != nil {
		return bad()
	}
	parts := strings.Split(filepath.ToSlash(rel), "/")
	if len(parts) != 3 || parts[0] == ".." || parts[0] == "." || parts[1] != "memory" {
		return bad()
	}
	name = parts[2]
	if !strings.EqualFold(filepath.Ext(name), ".md") || strings.EqualFold(name, "MEMORY.md") {
		return bad()
	}
	return filepath.Dir(filepath.Clean(path)), name, nil
}
