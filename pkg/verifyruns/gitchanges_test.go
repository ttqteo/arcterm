// pkg/verifyruns/gitchanges_test.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package verifyruns

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func gitIn(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func writeFile(t *testing.T, dir, rel, body string) {
	t.Helper()
	full := filepath.Join(dir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

// newRepo makes a repo on main holding the verify config, a watched ui/a.tsx, an unwatched ui/b.ts and docs/a.md,
// all committed.
func newRepo(t *testing.T, config string) string {
	t.Helper()
	dir := t.TempDir()
	gitIn(t, dir, "init", "-q", "-b", "main")
	writeFile(t, dir, ".arc/verify.json", config)
	writeFile(t, dir, "ui/a.tsx", "a\n")
	writeFile(t, dir, "ui/b.ts", "b\n")
	writeFile(t, dir, "docs/a.md", "doc\n")
	gitIn(t, dir, "add", ".")
	gitIn(t, dir, "commit", "-q", "-m", "init")
	return dir
}

var uiConfig = &Config{Watch: []string{"ui/**/*.tsx", "ui/**/*.css"}}

func paths(cs []Change) []string {
	var out []string
	for _, c := range cs {
		out = append(out, c.Path)
	}
	return out
}

func samePaths(got []Change, want ...string) bool {
	g := map[string]bool{}
	for _, p := range paths(got) {
		g[p] = true
	}
	if len(g) != len(want) || len(got) != len(want) {
		return false
	}
	for _, w := range want {
		if !g[w] {
			return false
		}
	}
	return true
}

func TestWatchedChangesUncommittedEdit(t *testing.T) {
	dir := newRepo(t, `{}`)
	writeFile(t, dir, "ui/a.tsx", "edited\n")
	stamp := time.Now().Add(-2 * time.Hour).Truncate(time.Second)
	if err := os.Chtimes(filepath.Join(dir, "ui", "a.tsx"), stamp, stamp); err != nil {
		t.Fatal(err)
	}
	changes, branch, deflt, err := WatchedChanges(context.Background(), dir, uiConfig)
	if err != nil {
		t.Fatal(err)
	}
	if branch != "main" || deflt != "main" {
		t.Errorf("branch/default = %q/%q", branch, deflt)
	}
	if !samePaths(changes, "ui/a.tsx") {
		t.Fatalf("changes = %v, want ui/a.tsx", paths(changes))
	}
	if changes[0].Mtime != stamp.UnixMilli() {
		t.Errorf("mtime = %d, want %d", changes[0].Mtime, stamp.UnixMilli())
	}
}

func TestWatchedChangesLeavesUnwatchedFilesOut(t *testing.T) {
	dir := newRepo(t, `{}`)
	writeFile(t, dir, "docs/a.md", "edited\n")
	writeFile(t, dir, "ui/b.ts", "edited\n")
	changes, _, _, err := WatchedChanges(context.Background(), dir, uiConfig)
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 0 {
		t.Errorf("changes = %v, want none (docs/a.md and ui/b.ts are not watched)", paths(changes))
	}
}

func TestWatchedChangesSeesAnUntrackedFileInANewFolder(t *testing.T) {
	dir := newRepo(t, `{}`)
	writeFile(t, dir, "ui/fresh/deep/c.tsx", "new\n")
	changes, _, _, err := WatchedChanges(context.Background(), dir, uiConfig)
	if err != nil {
		t.Fatal(err)
	}
	if !samePaths(changes, "ui/fresh/deep/c.tsx") {
		t.Errorf("changes = %v, want the file inside the untracked folder, not the folder", paths(changes))
	}
}

func TestWatchedChangesStagedAndUnstagedAreBothCounted(t *testing.T) {
	dir := newRepo(t, `{}`)
	writeFile(t, dir, "ui/a.tsx", "staged\n")
	gitIn(t, dir, "add", "ui/a.tsx")
	writeFile(t, dir, "ui/x.tsx", "x\n")
	gitIn(t, dir, "add", "ui/x.tsx")
	writeFile(t, dir, "ui/a.tsx", "staged and edited again\n")
	changes, _, _, err := WatchedChanges(context.Background(), dir, uiConfig)
	if err != nil {
		t.Fatal(err)
	}
	if !samePaths(changes, "ui/a.tsx", "ui/x.tsx") {
		t.Errorf("changes = %v", paths(changes))
	}
}

func TestWatchedChangesCommittedEditOnABranch(t *testing.T) {
	dir := newRepo(t, `{}`)
	gitIn(t, dir, "checkout", "-q", "-b", "feat/x")
	writeFile(t, dir, "ui/a.tsx", "committed on the branch\n")
	gitIn(t, dir, "commit", "-q", "-am", "edit a")
	writeFile(t, dir, "ui/c.tsx", "uncommitted\n")
	changes, branch, deflt, err := WatchedChanges(context.Background(), dir, uiConfig)
	if err != nil {
		t.Fatal(err)
	}
	if branch != "feat/x" || deflt != "main" {
		t.Errorf("branch/default = %q/%q", branch, deflt)
	}
	if !samePaths(changes, "ui/a.tsx", "ui/c.tsx") {
		t.Errorf("changes = %v, want the committed and the uncommitted edit", paths(changes))
	}
}

func TestWatchedChangesOnTheDefaultBranchOnlyUncommittedCount(t *testing.T) {
	dir := newRepo(t, `{}`)
	writeFile(t, dir, "ui/a.tsx", "committed on main\n")
	gitIn(t, dir, "commit", "-q", "-am", "edit a")
	changes, _, _, err := WatchedChanges(context.Background(), dir, uiConfig)
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 0 {
		t.Errorf("changes = %v, want none: a commit on the default branch is not part of this agent's change", paths(changes))
	}
	writeFile(t, dir, "ui/a.tsx", "uncommitted on main\n")
	changes, _, _, err = WatchedChanges(context.Background(), dir, uiConfig)
	if err != nil || !samePaths(changes, "ui/a.tsx") {
		t.Errorf("changes = %v, %v, want the uncommitted ui/a.tsx", paths(changes), err)
	}
}

func TestWatchedChangesDoesNotCountWhatMainGainedAfterTheBranchLeftIt(t *testing.T) {
	dir := newRepo(t, `{}`)
	gitIn(t, dir, "checkout", "-q", "-b", "feat/x")
	gitIn(t, dir, "checkout", "-q", "main")
	writeFile(t, dir, "ui/m.tsx", "main moved on\n")
	gitIn(t, dir, "add", ".")
	gitIn(t, dir, "commit", "-q", "-m", "main one")
	gitIn(t, dir, "checkout", "-q", "feat/x")
	changes, _, _, err := WatchedChanges(context.Background(), dir, uiConfig)
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 0 {
		t.Errorf("changes = %v, want none: the diff is from the merge base, not from main's tip", paths(changes))
	}
}

func TestWatchedChangesDeletedFileDoesNotAlwaysReadAsNow(t *testing.T) {
	dir := newRepo(t, `{}`)
	gitIn(t, dir, "checkout", "-q", "-b", "feat/x")
	if err := os.Remove(filepath.Join(dir, "ui", "a.tsx")); err != nil {
		t.Fatal(err)
	}
	gitIn(t, dir, "commit", "-q", "-am", "remove a")
	first, _, _, err := WatchedChanges(context.Background(), dir, uiConfig)
	if err != nil || !samePaths(first, "ui/a.tsx") {
		t.Fatalf("changes = %v, %v, want the deleted ui/a.tsx", paths(first), err)
	}
	time.Sleep(20 * time.Millisecond)
	second, _, _, err := WatchedChanges(context.Background(), dir, uiConfig)
	if err != nil || len(second) != 1 {
		t.Fatalf("second read = %v, %v", paths(second), err)
	}
	if first[0].Mtime != second[0].Mtime {
		t.Errorf("a deleted file's time moved between reads (%d, %d): every run would read as out of date forever", first[0].Mtime, second[0].Mtime)
	}
	if first[0].Mtime > time.Now().UnixMilli() || first[0].Mtime <= 0 {
		t.Errorf("deleted file's time = %d", first[0].Mtime)
	}
}

func TestWatchedChangesStripsOriginFromARemoteOnlyDefault(t *testing.T) {
	upstream := newRepo(t, `{}`)
	clone := t.TempDir()
	if out, err := exec.Command("git", "clone", "-q", upstream, clone).CombinedOutput(); err != nil {
		t.Fatalf("clone: %v\n%s", err, out)
	}
	gitIn(t, clone, "checkout", "-q", "-b", "work")
	gitIn(t, clone, "branch", "-q", "-D", "main") // no local main: the default resolves as origin/main
	writeFile(t, clone, "ui/a.tsx", "work\n")
	gitIn(t, clone, "commit", "-q", "-am", "work")
	changes, branch, deflt, err := WatchedChanges(context.Background(), clone, uiConfig)
	if err != nil {
		t.Fatal(err)
	}
	if branch != "work" || deflt != "main" {
		t.Errorf("branch/default = %q/%q, want work/main (origin/ stripped)", branch, deflt)
	}
	if !samePaths(changes, "ui/a.tsx") {
		t.Errorf("changes = %v", paths(changes))
	}
}

func TestWatchedChangesWithNoConfigOrWatchListIsEmpty(t *testing.T) {
	dir := newRepo(t, `{}`)
	writeFile(t, dir, "ui/a.tsx", "edited\n")
	for _, cfg := range []*Config{nil, {}} {
		changes, branch, _, err := WatchedChanges(context.Background(), dir, cfg)
		if err != nil || len(changes) != 0 || branch != "main" {
			t.Errorf("cfg %+v: changes = %v, branch = %q, err = %v", cfg, paths(changes), branch, err)
		}
	}
}

func TestWatchedChangesOutsideARepoIsAnError(t *testing.T) {
	if _, _, _, err := WatchedChanges(context.Background(), t.TempDir(), uiConfig); err == nil {
		t.Error("WatchedChanges outside a repo = nil error")
	}
}

func TestRepoRootOfASubfolder(t *testing.T) {
	dir := newRepo(t, `{}`)
	got, err := RepoRoot(context.Background(), filepath.Join(dir, "ui"))
	if err != nil {
		t.Fatal(err)
	}
	want, _ := filepath.EvalSymlinks(dir)
	gotReal, _ := filepath.EvalSymlinks(got)
	if gotReal != want {
		t.Errorf("RepoRoot = %q, want %q", gotReal, want)
	}
}

// Watched changes in a subfolder are still found from the repo root's view: paths are relative to the root.
func TestWatchedChangesFromASubfolder(t *testing.T) {
	dir := newRepo(t, `{}`)
	writeFile(t, dir, "ui/a.tsx", "edited\n")
	changes, _, _, err := WatchedChanges(context.Background(), filepath.Join(dir, "docs"), uiConfig)
	if err != nil || !samePaths(changes, "ui/a.tsx") {
		t.Errorf("changes = %v, %v", paths(changes), err)
	}
}
