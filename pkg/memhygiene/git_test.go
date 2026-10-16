// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"strings"
	"testing"
)

func TestRunGit(t *testing.T) {
	dir := initRepo(t)
	hash := commit(t, dir, "second", map[string]string{"docs/a.md": "a\n"})
	if branch, err := runGit(dir, "rev-parse", "--abbrev-ref", "HEAD"); err != nil || branch != "main" {
		t.Fatalf("branch = %q, %v; want main", branch, err)
	}
	if count, err := runGit(dir, "rev-list", "--count", hash); err != nil || count != "2" {
		t.Fatalf("commits = %q, %v; want 2", count, err)
	}
	_, err := runGit(dir, "cat-file", "-e", "deadbeef")
	if err == nil || !strings.Contains(err.Error(), "cat-file -e deadbeef") || !strings.Contains(err.Error(), "fatal") {
		t.Fatalf("err = %v, want one naming the args and git's stderr", err)
	}
}
