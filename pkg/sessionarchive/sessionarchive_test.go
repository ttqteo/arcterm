// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionarchive

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
)

type fixture struct {
	t       *testing.T
	root    string
	archive string
	rules   Rules
	now     time.Time
}

func newFixture(t *testing.T) *fixture {
	base := t.TempDir()
	f := &fixture{
		t:       t,
		root:    filepath.Join(base, "projects"),
		archive: filepath.Join(base, "archive"),
		now:     time.Now(),
		rules: Rules{
			TempDir:      filepath.Join(base, "tmp"),
			WorktreeRoot: filepath.Join(base, "arc-wt"),
			HeadlessSlug: agentobserve.SlugifyCwd(filepath.Join(base, "data", "headless")),
		},
	}
	return f
}

// session writes a transcript for cwd under its store folder, last written age ago, and returns its folder name
func (f *fixture) session(cwd, id string, age time.Duration) string {
	f.t.Helper()
	slug := agentobserve.SlugifyCwd(cwd)
	dir := filepath.Join(f.root, slug)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		f.t.Fatal(err)
	}
	line, _ := json.Marshal(map[string]string{"type": "user", "cwd": cwd})
	path := filepath.Join(dir, id+".jsonl")
	if err := os.WriteFile(path, append(line, '\n'), 0o644); err != nil {
		f.t.Fatal(err)
	}
	when := f.now.Add(-age)
	if err := os.Chtimes(path, when, when); err != nil {
		f.t.Fatal(err)
	}
	return slug
}

func (f *fixture) sweep() int {
	f.t.Helper()
	n, err := Sweep(f.root, f.archive, f.rules, f.now)
	if err != nil {
		f.t.Fatalf("Sweep: %v", err)
	}
	return n
}

func exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func TestSweepMovesAFinishedRunsTree(t *testing.T) {
	f := newFixture(t)
	slug := f.session(filepath.Join(f.rules.WorktreeRoot, "0f74867d-t-1"), "a", time.Hour) // the tree is gone
	if n := f.sweep(); n != 1 {
		t.Fatalf("moved %d, want 1", n)
	}
	if exists(filepath.Join(f.root, slug)) || !exists(filepath.Join(f.archive, slug, "a.jsonl")) {
		t.Fatal("the finished run's folder should be in the archive")
	}
}

func TestSweepKeepsATreeStillOnDisk(t *testing.T) {
	f := newFixture(t)
	tree := filepath.Join(f.rules.WorktreeRoot, "0f74867d-t-2")
	if err := os.MkdirAll(tree, 0o755); err != nil {
		t.Fatal(err)
	}
	slug := f.session(tree, "a", 48*time.Hour) // a held run's tree: it can still resume
	if n := f.sweep(); n != 0 || !exists(filepath.Join(f.root, slug)) {
		t.Fatalf("moved %d; a tree still on disk keeps its sessions", n)
	}
}

func TestSweepKeepsAFolderWrittenRecently(t *testing.T) {
	f := newFixture(t)
	slug := f.session(filepath.Join(f.rules.WorktreeRoot, "0f74867d-t-3"), "a", time.Minute)
	if n := f.sweep(); n != 0 || !exists(filepath.Join(f.root, slug)) {
		t.Fatalf("moved %d; a session written a minute ago may still run", n)
	}
}

func TestSweepMovesALegacyInProjectTree(t *testing.T) {
	f := newFixture(t)
	slug := f.session(filepath.Join(t.TempDir(), "portal", ".waveterm", "worktrees", "0f74867d-8320-t-1"), "a", time.Hour)
	if n := f.sweep(); n != 1 || !exists(filepath.Join(f.archive, slug)) {
		t.Fatalf("moved %d; a legacy run tree that is gone should move", n)
	}
}

func TestSweepTempFolders(t *testing.T) {
	f := newFixture(t)
	removed := f.session(filepath.Join(f.rules.TempDir, "verify-office-x1"), "a", time.Hour)
	left := filepath.Join(f.rules.TempDir, "verify-office-x2")
	idleDir := filepath.Join(f.rules.TempDir, "verify-office-x3")
	for _, d := range []string{left, idleDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	leftRecent := f.session(left, "b", time.Hour)
	leftIdle := f.session(idleDir, "c", 25*time.Hour)
	if n := f.sweep(); n != 2 {
		t.Fatalf("moved %d, want 2 (the removed folder and the one idle a day)", n)
	}
	if !exists(filepath.Join(f.archive, removed)) || !exists(filepath.Join(f.archive, leftIdle)) {
		t.Fatal("the removed and the day-idle temp folders should move")
	}
	if !exists(filepath.Join(f.root, leftRecent)) {
		t.Fatal("a temp folder still on disk and used within the day stays")
	}
}

func TestSweepNeverTouchesAProject(t *testing.T) {
	f := newFixture(t)
	slug := f.session(filepath.Join(t.TempDir()+"-gone", "myproject"), "a", 30*24*time.Hour)
	// a project outside the temp dir: the fixture's TempDir is its own folder, so this one is not under it
	if n := f.sweep(); n != 0 || !exists(filepath.Join(f.root, slug)) {
		t.Fatalf("moved %d; the user's project folder must stay even when its folder is gone", n)
	}
}

func TestSweepHeadlessMovesQuietTranscriptsOnly(t *testing.T) {
	f := newFixture(t)
	dir := filepath.Join(f.root, f.rules.HeadlessSlug)
	if err := os.MkdirAll(filepath.Join(dir, "old", "subagents"), 0o755); err != nil {
		t.Fatal(err)
	}
	for name, age := range map[string]time.Duration{"old.jsonl": time.Hour, "new.jsonl": time.Minute} {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte("{}\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		when := f.now.Add(-age)
		_ = os.Chtimes(p, when, when)
	}
	if n := f.sweep(); n != 1 {
		t.Fatalf("moved %d, want 1", n)
	}
	if !exists(filepath.Join(f.archive, f.rules.HeadlessSlug, "old.jsonl")) || !exists(filepath.Join(f.archive, f.rules.HeadlessSlug, "old", "subagents")) {
		t.Fatal("the quiet transcript and its sibling folder should move")
	}
	if !exists(filepath.Join(dir, "new.jsonl")) {
		t.Fatal("a pass written a minute ago stays")
	}
}

func TestSweepMergesIntoAnEarlierArchive(t *testing.T) {
	f := newFixture(t)
	cwd := filepath.Join(f.rules.WorktreeRoot, "0f74867d")
	slug := f.session(cwd, "a", time.Hour)
	f.sweep()
	f.session(cwd, "b", time.Hour)
	if n := f.sweep(); n != 1 {
		t.Fatalf("moved %d, want 1", n)
	}
	for _, id := range []string{"a", "b"} {
		if !exists(filepath.Join(f.archive, slug, id+".jsonl")) {
			t.Fatalf("%s.jsonl missing from the merged archive folder", id)
		}
	}
	if exists(filepath.Join(f.root, slug)) {
		t.Fatal("the merged folder should leave the projects folder")
	}
}

func TestArchiveOfOnlyTheRealProjectsRoot(t *testing.T) {
	if got := ArchiveOf(ProjectsRoot()); got != Dir() {
		t.Fatalf("ArchiveOf(ProjectsRoot()) = %q, want %q", got, Dir())
	}
	if got := ArchiveOf(t.TempDir()); got != "" {
		t.Fatalf("ArchiveOf(a temp root) = %q, want none", got)
	}
}
