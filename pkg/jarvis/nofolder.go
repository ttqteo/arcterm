// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
)

// No folder is where the launcher starts an agent or a terminal outside any project. It replaced the home folder:
// Claude Code never keeps folder trust for the home folder, so an agent there asked to be trusted on every launch, and
// could read and write all of it. Like Claude Desktop's "No folder", it is one empty folder of arcterm's own that is
// trusted once; unlike Desktop, every launch shares it, so the launcher's Session column lists and resumes the
// sessions held there.

// noFolderHome is the home directory No folder lives under. Package var so tests never touch the real one.
var noFolderHome = os.UserHomeDir

// NoFolderPath is the No folder's path; EnsureNoFolder creates it.
func NoFolderPath() (string, error) {
	home, err := noFolderHome()
	if err != nil {
		return "", fmt.Errorf("resolving home dir: %w", err)
	}
	return filepath.Join(home, ".arc", "no-folder"), nil
}

// EnsureNoFolder creates the No folder when it is missing and marks it trusted in Claude Code's config, then returns
// its path. A trust that cannot be written does not stop a launch: Claude Code then asks once, as it would anywhere.
func EnsureNoFolder() (string, error) {
	dir, err := NoFolderPath()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("creating %s: %w", dir, err)
	}
	if err := ensureClaudeDirTrusted(dir); err != nil {
		log.Printf("no folder: could not mark %s trusted for Claude Code: %v", dir, err)
	}
	return dir, nil
}
