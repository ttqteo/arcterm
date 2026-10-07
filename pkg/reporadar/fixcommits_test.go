// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import (
	"context"
	"fmt"
	"reflect"
	"testing"
)

func gc(hash string, ts int64, subject string, paths ...string) gitCommit {
	c := gitCommit{hash: hash, ts: ts, subject: subject}
	for _, p := range paths {
		c.files = append(c.files, gitFile{path: p})
	}
	return c
}

func hashes(fcs []fixCommit) []string {
	var out []string
	for _, f := range fcs {
		out = append(out, f.Hash)
	}
	return out
}

func TestSelectFixCommitsSubjects(t *testing.T) {
	for _, s := range []string{"fix: x", "fix(radar): x", "fix(radar)!: x", "Fix: x"} {
		if got := selectFixCommits([]gitCommit{gc("a", 1, s, "pkg/a.go")}, nil, 10); len(got) != 1 {
			t.Errorf("%q should be selected", s)
		}
	}
	for _, s := range []string{"feat: fix x", "fixup: x", "prefix: x"} {
		if got := selectFixCommits([]gitCommit{gc("a", 1, s, "pkg/a.go")}, nil, 10); len(got) != 0 {
			t.Errorf("%q should not be selected", s)
		}
	}
}

func TestSelectFixCommitsCodeFilesOnly(t *testing.T) {
	if got := selectFixCommits([]gitCommit{gc("a", 1, "fix: x", "docs/a.md", "README.md")}, nil, 10); len(got) != 0 {
		t.Errorf("docs-only commit selected: %v", got)
	}
	if got := selectFixCommits([]gitCommit{gc("a", 1, "fix: x", "pkg/x/a_test.go", "frontend/a.test.ts")}, nil, 10); len(got) != 0 {
		t.Errorf("test-only commit selected: %v", got)
	}
	got := selectFixCommits([]gitCommit{gc("a", 1, "fix: x", "pkg/x/a.go", "pkg/x/a_test.go")}, nil, 10)
	if len(got) != 1 || !reflect.DeepEqual(got[0].Files, []string{"pkg/x/a.go"}) {
		t.Errorf("got %+v", got)
	}
}

func TestSelectFixCommitsRanking(t *testing.T) {
	var wide []string
	for i := 0; i < 10; i++ {
		wide = append(wide, fmt.Sprintf("pkg/w/f%d.go", i))
	}
	commits := []gitCommit{
		gc("wide", 100, "fix: sweep", wide...),
		gc("h1", 10, "fix: a", "pkg/hot.go"),
		gc("h2", 20, "fix: b", "pkg/hot.go"),
		gc("h3", 30, "fix: c", "pkg/hot.go"),
	}
	if got := hashes(selectFixCommits(commits, nil, 10)); !reflect.DeepEqual(got, []string{"h3", "h2", "h1", "wide"}) {
		t.Errorf("hot file should outrank sweep: %v", got)
	}
	ties := []gitCommit{
		gc("b", 5, "fix: x", "pkg/b.go"),
		gc("a", 5, "fix: x", "pkg/a.go"),
		gc("c", 9, "fix: x", "pkg/c.go"),
	}
	if got := hashes(selectFixCommits(ties, nil, 10)); !reflect.DeepEqual(got, []string{"c", "a", "b"}) {
		t.Errorf("tie order: %v", got)
	}
}

func TestSelectFixCommitsLimitAndAudited(t *testing.T) {
	var commits []gitCommit
	for i := 1; i <= 5; i++ {
		commits = append(commits, gc(fmt.Sprintf("h%d", i), int64(i), "fix: x", fmt.Sprintf("pkg/f%d.go", i)))
	}
	if got := hashes(selectFixCommits(commits, nil, 2)); !reflect.DeepEqual(got, []string{"h5", "h4"}) {
		t.Errorf("limit: %v", got)
	}
	got := hashes(selectFixCommits(commits, map[string]bool{"h5": true}, 2))
	if !reflect.DeepEqual(got, []string{"h4", "h3"}) {
		t.Errorf("audited should not use a slot: %v", got)
	}
}

func TestSelectFixCommitsAuditedStillHeatsFile(t *testing.T) {
	commits := []gitCommit{
		gc("old", 1, "fix: a", "pkg/hot.go"),
		gc("new", 2, "fix: b", "pkg/hot.go"),
		gc("solo", 3, "fix: c", "pkg/solo.go"),
	}
	got := hashes(selectFixCommits(commits, map[string]bool{"old": true}, 10))
	if !reflect.DeepEqual(got, []string{"new", "solo"}) {
		t.Errorf("got %v", got)
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
