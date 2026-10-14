// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"os"
	"path/filepath"
	"testing"
)

// the package's shared test helpers: every task's tests use these and define no git or temp-repo
// helper of their own.

// initRepo makes a temp repo on branch main, hermetic against the user's git config, with one
// initial commit.
func initRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	for _, args := range [][]string{
		{"init", "-q", "--initial-branch=main"},
		{"config", "user.name", "dana k"},
		{"config", "user.email", "dana@example.com"},
		{"config", "commit.gpgsign", "false"},
		// git for windows defaults core.autocrlf=true, which would rewrite line endings the tests assert
		{"config", "core.autocrlf", "false"},
	} {
		if _, err := runGit(dir, args...); err != nil {
			t.Fatal(err)
		}
	}
	commit(t, dir, "initial", map[string]string{"README.md": "init\n"})
	return dir
}

// commit writes files (paths relative to dir), commits them, and returns the commit hash.
func commit(t *testing.T, dir, msg string, files map[string]string) string {
	t.Helper()
	for rel, content := range files {
		writeFile(t, filepath.Join(dir, rel), content)
	}
	if _, err := runGit(dir, "add", "-A"); err != nil {
		t.Fatal(err)
	}
	if _, err := runGit(dir, "commit", "-q", "--allow-empty", "-m", msg); err != nil {
		t.Fatal(err)
	}
	hash, err := runGit(dir, "rev-parse", "HEAD")
	if err != nil {
		t.Fatal(err)
	}
	return hash
}

// writeFile writes content to path, creating its parent dirs.
func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
