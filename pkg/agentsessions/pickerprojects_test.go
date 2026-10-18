// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"os"
	"path/filepath"
	"testing"
)

// The picker offers only projects: a folder Claude Code ran in under a repo counts as the repo, and home, the
// filesystem root, a folder with no project above it and a tree under a skipped root (the engine's arc-wt) are left
// out.
func TestPickerProjects(t *testing.T) {
	home := t.TempDir()
	mkdirAll(t, home, ".git")
	work := t.TempDir()
	trees := t.TempDir()

	repo := mkdirAll(t, work, "repo")
	mkdirAll(t, repo, ".git")
	services := mkdirAll(t, repo, "src", "services")
	loose := mkdirAll(t, work, "notes")
	other := mkdirAll(t, work, "other")
	if err := os.WriteFile(filepath.Join(other, "package.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	runTree := mkdirAll(t, trees, "d09b9dd1-t-3")
	mkdirAll(t, runTree, ".git")

	found := []ClaudeProject{
		{Path: services, Name: "services", LastActiveTs: 50, Sessions: 3},
		{Path: other, Name: "other", LastActiveTs: 40, Sessions: 1},
		{Path: repo, Name: "repo", LastActiveTs: 30, Sessions: 2},
		{Path: home, Name: filepath.Base(home), LastActiveTs: 60, Sessions: 8},
		{Path: string(filepath.Separator), Name: string(filepath.Separator), LastActiveTs: 60, Sessions: 188},
		{Path: loose, Name: "notes", LastActiveTs: 60, Sessions: 1},
		{Path: runTree, Name: "d09b9dd1-t-3", LastActiveTs: 60, Sessions: 3},
	}
	got := PickerProjects(found, home, []string{"", trees})
	want := []ClaudeProject{
		{Path: repo, Name: "repo", LastActiveTs: 50, Sessions: 5},
		{Path: other, Name: "other", LastActiveTs: 40, Sessions: 1},
	}
	if len(got) != len(want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("[%d] = %+v, want %+v", i, got[i], want[i])
		}
	}
}
