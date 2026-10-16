// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import (
	"context"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func gc(hash string, ts int64, subject string, paths ...string) gitCommit {
	c := gitCommit{hash: hash, ts: ts, subject: subject}
	for _, p := range paths {
		c.files = append(c.files, gitFile{path: p})
	}
	return c
}

func TestSelectSiblingAuditedStillHeatsFile(t *testing.T) {
	commits := []classifiedCommit{
		cc("solo", 3, true, false, 1, "pkg/solo.go"),
		cc("new", 2, true, false, 1, "pkg/hot.go"),
		cc("old", 1, true, false, 1, "pkg/hot.go"),
	}
	audited := map[string]bool{auditTarget{Kind: KindSibling, Commit: "old"}.Key(): true}
	got := targetCommits(targetsOfKind(selectAuditTargets(context.Background(), "", commits, audited), KindSibling))
	if !reflect.DeepEqual(got, []string{"new", "solo"}) {
		t.Errorf("an audited fix must still heat its file: got %v", got)
	}
}

func TestListWindowCommits(t *testing.T) {
	dir := t.TempDir()
	gitCmd(t, dir, "init", "-q", "-b", "main")
	t.Setenv("GIT_COMMITTER_DATE", "2020-01-01T00:00:00Z")
	t.Setenv("GIT_AUTHOR_DATE", "2020-01-01T00:00:00Z")
	writeFile(t, dir, "old.go", "package a\n")
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-q", "-m", "fix: old")
	t.Setenv("GIT_COMMITTER_DATE", "2024-01-01T00:00:00Z")
	t.Setenv("GIT_AUTHOR_DATE", "2024-01-01T00:00:00Z")
	gitCmd(t, dir, "checkout", "-q", "-b", "side")
	writeFile(t, dir, "side.go", "package a\n")
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-q", "-m", "fix: side")
	gitCmd(t, dir, "checkout", "-q", "main")
	writeFile(t, dir, "main.go", "package a\n")
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-q", "-m", "fix: main")
	gitCmd(t, dir, "merge", "-q", "--no-ff", "-m", "Merge side", "side")

	since := int64(1577836800000 + 86400000*30) // 2020-01-31
	got, err := listWindowCommits(context.Background(), dir, since)
	if err != nil {
		t.Fatal(err)
	}
	var subjects []string
	for _, c := range got {
		subjects = append(subjects, c.subject)
	}
	if len(got) != 2 {
		t.Fatalf("want side and main fix commits only, got %v", subjects)
	}
	for _, s := range subjects {
		if s != "fix: side" && s != "fix: main" {
			t.Errorf("unexpected commit %q", s)
		}
	}
}

// monorepo builds a repo with a project subfolder "proj" and a sibling folder "other".
func monorepo(t *testing.T) string {
	dir := t.TempDir()
	gitCmd(t, dir, "init", "-q", "-b", "main")
	writeFile(t, dir, "proj/a.go", "package a\n")
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-q", "-m", "feat: proj only")
	writeFile(t, dir, "other/b.go", "package b\n")
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-q", "-m", "fix: other only")
	writeFile(t, dir, "proj/a.go", "package a\n\nfunc A() {}\n")
	writeFile(t, dir, "other/b.go", "package b\n\nfunc B() {}\n")
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-q", "-m", "fix: both")
	return dir
}

// commitFiles renders each commit as "subject: path, path" for comparison.
func commitFiles(commits []gitCommit) []string {
	var out []string
	for _, c := range commits {
		var paths []string
		for _, f := range c.files {
			paths = append(paths, f.path)
		}
		out = append(out, c.subject+": "+strings.Join(paths, ", "))
	}
	return out
}

func TestListWindowCommitsScopedToSubfolder(t *testing.T) {
	dir := monorepo(t)
	got, err := listWindowCommits(context.Background(), filepath.Join(dir, "proj"), 0)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"fix: both: a.go", "feat: proj only: a.go"}
	if !reflect.DeepEqual(commitFiles(got), want) {
		t.Errorf("got %q, want %q", commitFiles(got), want)
	}
}

func TestListWindowCommitsAtRepoRoot(t *testing.T) {
	dir := monorepo(t)
	got, err := listWindowCommits(context.Background(), dir, 0)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"fix: both: other/b.go, proj/a.go", "fix: other only: other/b.go", "feat: proj only: proj/a.go"}
	if !reflect.DeepEqual(commitFiles(got), want) {
		t.Errorf("got %q, want %q", commitFiles(got), want)
	}
}

func TestCodeFilesExcludesGeneratedAndData(t *testing.T) {
	c := gc("a", 1, "x",
		"pkg/a.go", "package-lock.json", "yarn.lock", "src-tauri/Cargo.lock", "config/app.json", "ui/__snapshots__/x.snap",
		"src/locale/en.ts", "web/locales/fr/app.js", "app/i18n/de.ts", "frontend/types/gotypes.d.ts",
		"frontend/app/store/wshclientapi.ts", "pkg/wshrpc/wshclient/wshclient.go", "pkg/waveobj/metaconsts.go",
		"src/localeutil.ts", "docs/a.go", "README.md")
	if got, want := codeFiles(c), []string{"pkg/a.go", "src/localeutil.ts"}; !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestIsTestPathNewPatterns(t *testing.T) {
	for _, p := range []string{"test/helpers.go", "tests/conftest.py", "app/test_engine.py", "Tests/X.go", "pkg/a_test.go", "src/test/a.ts"} {
		if !isTestPath(p) {
			t.Errorf("%q should be a test path", p)
		}
	}
	for _, p := range []string{"pkg/testutil.go", "app/test_engine.go", "src/latest/a.py", "contest/a.go", "app/mytest_x.py"} {
		if isTestPath(p) {
			t.Errorf("%q should not be a test path", p)
		}
	}
}
