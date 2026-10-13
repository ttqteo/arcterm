// pkg/gitinfo/walk_test.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gitinfo

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func writeTree(t *testing.T, root string, files map[string]string) {
	t.Helper()
	for rel, body := range files {
		abs := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(abs, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestWalkFilesListsNestedFilesSortedWithForwardSlashes(t *testing.T) {
	dir := t.TempDir()
	writeTree(t, dir, map[string]string{
		"b.txt":       "",
		"a/x.go":      "",
		"a.txt":       "",
		"a/deep/y.md": "",
		".env":        "",
	})
	fl, err := WalkFiles(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{".env", "a.txt", "a/deep/y.md", "a/x.go", "b.txt"}
	if !reflect.DeepEqual(fl.Paths, want) {
		t.Errorf("Paths = %v, want %v", fl.Paths, want)
	}
	if fl.IsRepo || fl.Truncated {
		t.Errorf("IsRepo=%v Truncated=%v, want both false", fl.IsRepo, fl.Truncated)
	}
}

func TestWalkFilesSkipsBuildAndDotDirectories(t *testing.T) {
	dir := t.TempDir()
	files := map[string]string{"keep.txt": ""}
	for _, d := range []string{".git", "node_modules", "target", "dist", "build", "out", ".venv", "venv",
		"__pycache__", "vendor", ".next", ".cache", ".idea", "src/node_modules"} {
		files[d+"/f.txt"] = ""
	}
	writeTree(t, dir, files)
	fl, err := WalkFiles(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(fl.Paths, []string{"keep.txt"}) {
		t.Errorf("Paths = %v, want only keep.txt", fl.Paths)
	}
}

func TestWalkFilesDoesNotFollowSymlinks(t *testing.T) {
	dir := t.TempDir()
	writeTree(t, dir, map[string]string{"sub/f.txt": ""})
	if err := os.Symlink(dir, filepath.Join(dir, "sub", "loop")); err != nil {
		t.Skipf("cannot create a symlink here: %v", err)
	}
	fl, err := WalkFiles(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(fl.Paths, []string{"sub/f.txt"}) {
		t.Errorf("Paths = %v, want only sub/f.txt", fl.Paths)
	}
}

func TestWalkFilesTruncatesAtTheCap(t *testing.T) {
	dir := t.TempDir()
	files := map[string]string{}
	for i := range 5 {
		files[strings.Repeat("f", i+1)+".txt"] = ""
	}
	writeTree(t, dir, files)
	fl, err := walkFiles(context.Background(), dir, 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(fl.Paths) != 3 || !fl.Truncated {
		t.Errorf("len=%d Truncated=%v, want 3 and true", len(fl.Paths), fl.Truncated)
	}
}

func TestWalkFilesMissingRootIsAnError(t *testing.T) {
	if _, err := WalkFiles(context.Background(), filepath.Join(t.TempDir(), "gone")); err == nil {
		t.Error("a missing root must be an error, not an empty tree")
	}
}

func scanFixture(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	writeTree(t, dir, map[string]string{
		"a.txt":             "first\nhas NEEDLE here\r\nneedles plural\n",
		"src/b.go":          "package b // NEEDLE\n",
		"bin.dat":           "NEEDLE\x00binary",
		"node_modules/x.js": "NEEDLE",
	})
	return dir
}

func TestScanGrepFindsMatchesWithLineNumbers(t *testing.T) {
	res, err := ScanGrep(context.Background(), scanFixture(t), "needle", GrepOpts{})
	if err != nil {
		t.Fatal(err)
	}
	want := []GrepMatch{
		{Path: "a.txt", Line: 2, Text: "has NEEDLE here"},
		{Path: "a.txt", Line: 3, Text: "needles plural"},
		{Path: "src/b.go", Line: 1, Text: "package b // NEEDLE"},
	}
	if !reflect.DeepEqual(res.Matches, want) {
		t.Errorf("Matches = %+v, want %+v (binary and node_modules skipped)", res.Matches, want)
	}
}

func TestScanGrepHonorsOptions(t *testing.T) {
	dir := scanFixture(t)
	cases := []struct {
		name  string
		query string
		opts  GrepOpts
		want  int
	}{
		{"case sensitive", "needle", GrepOpts{CaseSensitive: true}, 1},
		{"whole word", "needle", GrepOpts{WholeWord: true}, 2},
		{"regex", "NEED.E h", GrepOpts{Regex: true}, 1},
		{"fixed string is literal", "NEED.E", GrepOpts{}, 0},
		{"include", "needle", GrepOpts{Include: []string{"*.go"}}, 1},
		{"include dir prefix", "needle", GrepOpts{Include: []string{"src"}}, 1},
		{"exclude", "needle", GrepOpts{Exclude: []string{"*.txt"}}, 1},
	}
	for _, c := range cases {
		res, err := ScanGrep(context.Background(), dir, c.query, c.opts)
		if err != nil {
			t.Fatal(err)
		}
		if len(res.Matches) != c.want {
			t.Errorf("%s: got %d matches %+v, want %d", c.name, len(res.Matches), res.Matches, c.want)
		}
	}
}

func TestScanGrepInvalidRegex(t *testing.T) {
	res, err := ScanGrep(context.Background(), scanFixture(t), "a(", GrepOpts{Regex: true})
	if err != nil {
		t.Fatal(err)
	}
	if !res.InvalidPattern {
		t.Error("an uncompilable regex must report InvalidPattern")
	}
}

func TestScanGrepTruncatesAtTheCap(t *testing.T) {
	dir := t.TempDir()
	writeTree(t, dir, map[string]string{"many.txt": strings.Repeat("NEEDLE\n", maxGrepMatches+10)})
	res, err := ScanGrep(context.Background(), dir, "NEEDLE", GrepOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Matches) != maxGrepMatches || !res.Truncated {
		t.Errorf("len=%d Truncated=%v, want %d and true", len(res.Matches), res.Truncated, maxGrepMatches)
	}
}

func TestIsWorkTree(t *testing.T) {
	if IsWorkTree(context.Background(), t.TempDir()) {
		t.Error("a plain temp directory is not a work tree")
	}
	if !IsWorkTree(context.Background(), repoWithChange(t)) {
		t.Error("a git repository is a work tree")
	}
}
