// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessiontrash

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var testNow = time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)

type fixture struct {
	root       string // holds projects/ and trash/
	projects   string
	trash      string
	transcript string // <projects>/proj/abc.jsonl, last written an hour before testNow
}

func writeFile(t *testing.T, path, body string, mtime time.Time) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, mtime, mtime); err != nil {
		t.Fatal(err)
	}
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	root := t.TempDir()
	f := fixture{root: root, projects: filepath.Join(root, "projects"), trash: filepath.Join(root, "trash")}
	f.transcript = filepath.Join(f.projects, "proj", "abc.jsonl")
	writeFile(t, f.transcript, `{"type":"user"}`+"\n", testNow.Add(-time.Hour))
	return f
}

func (f fixture) opts(live ...string) Options {
	return Options{ProjectsDirs: []string{f.projects}, TrashDir: f.trash, LiveTranscripts: live, Now: testNow}
}

func exists(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}

func TestDeleteMovesTranscriptAndSiblingDir(t *testing.T) {
	f := newFixture(t)
	writeFile(t, filepath.Join(f.projects, "proj", "abc", "subagents", "agent-1.jsonl"), "sub", testNow.Add(-time.Hour))
	writeFile(t, filepath.Join(f.projects, "proj", "abc", "tool-results", "r.txt"), "res", testNow.Add(-time.Hour))
	writeFile(t, filepath.Join(f.projects, "proj", "other.jsonl"), "keep", testNow.Add(-time.Hour))

	entry, err := Delete(f.opts(), f.transcript)
	if err != nil {
		t.Fatal(err)
	}
	wantEntry := filepath.Join(f.trash, fmt.Sprintf("%d-abc", testNow.UnixMilli()))
	if entry != wantEntry {
		t.Fatalf("entry = %s, want %s", entry, wantEntry)
	}
	if exists(f.transcript) || exists(filepath.Join(f.projects, "proj", "abc")) {
		t.Fatal("the transcript or its sibling dir is still in the projects dir")
	}
	if !exists(filepath.Join(f.projects, "proj", "other.jsonl")) {
		t.Fatal("another session was touched")
	}
	if b, err := os.ReadFile(filepath.Join(entry, "abc.jsonl")); err != nil || !strings.Contains(string(b), "user") {
		t.Fatalf("trashed transcript: %q, %v", b, err)
	}
	if b, err := os.ReadFile(filepath.Join(entry, "abc", "subagents", "agent-1.jsonl")); err != nil || string(b) != "sub" {
		t.Fatalf("trashed subagent: %q, %v", b, err)
	}
	if b, err := os.ReadFile(filepath.Join(entry, "abc", "tool-results", "r.txt")); err != nil || string(b) != "res" {
		t.Fatalf("trashed tool result: %q, %v", b, err)
	}
	raw, err := os.ReadFile(filepath.Join(entry, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	var meta struct {
		OriginalPath string `json:"originalPath"`
		DeletedAt    string `json:"deletedAt"`
	}
	if err := json.Unmarshal(raw, &meta); err != nil {
		t.Fatal(err)
	}
	if meta.OriginalPath != f.transcript {
		t.Fatalf("originalPath = %q, want %q", meta.OriginalPath, f.transcript)
	}
	if at, err := time.Parse(time.RFC3339, meta.DeletedAt); err != nil || !at.Equal(testNow) {
		t.Fatalf("deletedAt = %q (%v), want %v", meta.DeletedAt, err, testNow)
	}
}

func TestDeleteWithoutSiblingDir(t *testing.T) {
	f := newFixture(t)
	entry, err := Delete(f.opts(), f.transcript)
	if err != nil {
		t.Fatal(err)
	}
	if !exists(filepath.Join(entry, "abc.jsonl")) || !exists(filepath.Join(entry, "meta.json")) {
		t.Fatal("transcript or meta.json missing from the trash entry")
	}
	if exists(filepath.Join(entry, "abc")) {
		t.Fatal("a sibling dir appeared from nowhere")
	}
}

func TestDeleteLeavesAFileNamedLikeTheSiblingDirAlone(t *testing.T) {
	f := newFixture(t)
	// "abc" as a plain file is not a session's directory
	writeFile(t, filepath.Join(f.projects, "proj", "abc"), "not a dir", testNow.Add(-time.Hour))
	entry, err := Delete(f.opts(), f.transcript)
	if err != nil {
		t.Fatal(err)
	}
	if exists(filepath.Join(entry, "abc")) || !exists(filepath.Join(f.projects, "proj", "abc")) {
		t.Fatal("a file was moved as if it were the session's directory")
	}
}

func TestDeleteRefusesAPathOutsideTheProjectsDir(t *testing.T) {
	f := newFixture(t)
	cases := map[string]string{
		"another dir":       filepath.Join(f.root, "elsewhere", "proj", "abc.jsonl"),
		"the projects root": filepath.Join(f.projects, "abc.jsonl"),
		"too deep":          filepath.Join(f.projects, "proj", "sub", "abc.jsonl"),
		"a sibling prefix":  filepath.Join(f.root, "projects-evil", "proj", "abc.jsonl"),
	}
	for _, path := range cases {
		writeFile(t, path, "x", testNow.Add(-time.Hour))
	}
	cases["relative"] = filepath.Join("proj", "abc.jsonl")
	for name, path := range cases {
		if _, err := Delete(f.opts(), path); !errors.Is(err, ErrOutsideProjects) {
			t.Errorf("%s: err = %v, want ErrOutsideProjects", name, err)
		}
		if name != "relative" && !exists(path) {
			t.Errorf("%s: the file was moved", name)
		}
	}
	if !exists(f.transcript) || exists(f.trash) {
		t.Fatal("something was moved")
	}
}

func TestDeleteRefusesDotDotSegments(t *testing.T) {
	f := newFixture(t)
	outside := filepath.Join(f.root, "outside", "abc.jsonl")
	writeFile(t, outside, "x", testNow.Add(-time.Hour))
	for name, path := range map[string]string{
		"leaving the dir": filepath.Join(f.projects, "..", "outside", "abc.jsonl"),
		"returning":       f.projects + string(filepath.Separator) + "proj" + string(filepath.Separator) + ".." + string(filepath.Separator) + "proj" + string(filepath.Separator) + "abc.jsonl",
		"forward slashes": strings.ReplaceAll(f.projects, `\`, "/") + "/proj/../proj/abc.jsonl",
	} {
		if _, err := Delete(f.opts(), path); !errors.Is(err, ErrOutsideProjects) {
			t.Errorf("%s: err = %v, want ErrOutsideProjects", name, err)
		}
	}
	if !exists(outside) || !exists(f.transcript) {
		t.Fatal("a file was moved")
	}
}

func TestDeleteRefusesAFileThatIsNotATranscript(t *testing.T) {
	f := newFixture(t)
	for _, name := range []string{"notes.txt", "abc.jsonl.bak", ".jsonl", "abc.JSON"} {
		path := filepath.Join(f.projects, "proj", name)
		writeFile(t, path, "x", testNow.Add(-time.Hour))
		if _, err := Delete(f.opts(), path); !errors.Is(err, ErrNotTranscript) {
			t.Errorf("%s: err = %v, want ErrNotTranscript", name, err)
		}
		if !exists(path) {
			t.Errorf("%s was moved", name)
		}
	}
	if _, err := Delete(f.opts(), ""); !errors.Is(err, ErrNotTranscript) {
		t.Errorf("empty path: err = %v, want ErrNotTranscript", err)
	}
	// a directory named like a transcript
	dir := filepath.Join(f.projects, "proj", "dir.jsonl")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := Delete(f.opts(), dir); !errors.Is(err, ErrNotTranscript) {
		t.Errorf("a directory: err = %v, want ErrNotTranscript", err)
	}
}

func TestDeleteRefusesAMissingTranscript(t *testing.T) {
	f := newFixture(t)
	_, err := Delete(f.opts(), filepath.Join(f.projects, "proj", "gone.jsonl"))
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
	_, err = Delete(f.opts(), filepath.Join(f.projects, "noproj", "gone.jsonl"))
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing project dir: err = %v, want ErrNotFound", err)
	}
}

func TestDeleteRefusesASessionAnOpenTabHas(t *testing.T) {
	f := newFixture(t)
	// the block's path may differ in case and in separators from the one the archive lists
	live := strings.ToUpper(strings.ReplaceAll(f.transcript, `\`, "/"))
	if os.PathSeparator != '\\' {
		live = f.transcript
	}
	if _, err := Delete(f.opts("/some/other.jsonl", live), f.transcript); !errors.Is(err, ErrLive) {
		t.Fatalf("err = %v, want ErrLive", err)
	}
	if !exists(f.transcript) || exists(f.trash) {
		t.Fatal("a live session was moved")
	}
}

func TestDeleteRefusesASessionWrittenInTheLastTwoMinutes(t *testing.T) {
	cases := []struct {
		age  time.Duration
		live bool
	}{
		{5 * time.Second, true},
		{time.Minute, true},
		{119 * time.Second, true},
		{-30 * time.Second, true}, // a clock a little ahead of the file system's
		{2*time.Minute + time.Second, false},
		{10 * time.Minute, false},
	}
	for _, c := range cases {
		f := newFixture(t)
		mtime := testNow.Add(-c.age)
		if err := os.Chtimes(f.transcript, mtime, mtime); err != nil {
			t.Fatal(err)
		}
		_, err := Delete(f.opts(), f.transcript)
		if c.live {
			if !errors.Is(err, ErrLive) || !exists(f.transcript) {
				t.Errorf("written %v ago: err = %v, want ErrLive and the file left alone", c.age, err)
			}
			continue
		}
		if err != nil || exists(f.transcript) {
			t.Errorf("written %v ago: err = %v, want it moved", c.age, err)
		}
	}
}

func TestDeleteAcceptsEitherProjectsDir(t *testing.T) {
	f := newFixture(t)
	other := filepath.Join(f.root, "config", "projects")
	path := filepath.Join(other, "p", "zzz.jsonl")
	writeFile(t, path, "x", testNow.Add(-time.Hour))
	o := f.opts()
	o.ProjectsDirs = []string{other, f.projects}
	if _, err := Delete(o, path); err != nil {
		t.Fatal(err)
	}
	if _, err := Delete(o, f.transcript); err != nil {
		t.Fatal(err)
	}
}

func TestDeleteRefusesASymlinkedTranscript(t *testing.T) {
	f := newFixture(t)
	target := filepath.Join(f.root, "target.jsonl")
	writeFile(t, target, "x", testNow.Add(-time.Hour))
	link := filepath.Join(f.projects, "proj", "link.jsonl")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("no symlinks here: %v", err)
	}
	if _, err := Delete(f.opts(), link); err == nil {
		t.Fatal("a symlink was moved")
	}
	if !exists(target) {
		t.Fatal("the link's target was touched")
	}
}

func TestCopyThenRemoveMovesATreeAcrossVolumes(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "src")
	writeFile(t, filepath.Join(src, "a.txt"), "a", testNow)
	writeFile(t, filepath.Join(src, "deep", "b.txt"), "b", testNow)
	dst := filepath.Join(root, "dst")
	if err := copyThenRemove(src, dst); err != nil {
		t.Fatal(err)
	}
	if exists(src) {
		t.Fatal("the source is still there")
	}
	if b, err := os.ReadFile(filepath.Join(dst, "deep", "b.txt")); err != nil || string(b) != "b" {
		t.Fatalf("copied file: %q, %v", b, err)
	}
	file := filepath.Join(root, "one.jsonl")
	writeFile(t, file, "one", testNow)
	if err := copyThenRemove(file, filepath.Join(root, "two.jsonl")); err != nil {
		t.Fatal(err)
	}
	if b, err := os.ReadFile(filepath.Join(root, "two.jsonl")); err != nil || string(b) != "one" || exists(file) {
		t.Fatalf("copied file: %q, %v", b, err)
	}
}

func TestPurgeRemovesEntriesOlderThanTheRetention(t *testing.T) {
	trash := t.TempDir()
	day := 24 * time.Hour
	mk := func(name string) string {
		dir := filepath.Join(trash, name)
		writeFile(t, filepath.Join(dir, "abc.jsonl"), "x", testNow)
		return dir
	}
	old := mk(fmt.Sprintf("%d-old", testNow.Add(-8*day).UnixMilli()))
	edge := mk(fmt.Sprintf("%d-edge", testNow.Add(-7*day-time.Second).UnixMilli()))
	young := mk(fmt.Sprintf("%d-young", testNow.Add(-6*day).UnixMilli()))
	today := mk(fmt.Sprintf("%d-today", testNow.UnixMilli()))
	// not ours: no timestamp prefix, so it is never touched
	stranger := mk("notes")
	junk := mk("abc-123")
	file := filepath.Join(trash, fmt.Sprintf("%d-file", testNow.Add(-30*day).UnixMilli()))
	writeFile(t, file, "x", testNow)

	n, err := Purge(trash, Retention, testNow)
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("purged %d, want 2", n)
	}
	for _, gone := range []string{old, edge} {
		if exists(gone) {
			t.Errorf("%s survived", gone)
		}
	}
	for _, kept := range []string{young, today, stranger, junk, file} {
		if !exists(kept) {
			t.Errorf("%s was removed", kept)
		}
	}
}

func TestPurgeOfAMissingTrashIsQuiet(t *testing.T) {
	n, err := Purge(filepath.Join(t.TempDir(), "nope"), Retention, testNow)
	if err != nil || n != 0 {
		t.Fatalf("n = %d, err = %v", n, err)
	}
}

func TestProjectsDirsHonorsClaudeConfigDir(t *testing.T) {
	t.Setenv("CLAUDE_CONFIG_DIR", "")
	dirs := ProjectsDirs()
	if len(dirs) != 1 || !strings.HasSuffix(filepath.ToSlash(dirs[0]), ".claude/projects") {
		t.Fatalf("default dirs = %v", dirs)
	}
	cfg := filepath.Join(t.TempDir(), "cfg")
	t.Setenv("CLAUDE_CONFIG_DIR", cfg)
	dirs = ProjectsDirs()
	if len(dirs) != 2 || dirs[0] != filepath.Join(cfg, "projects") || !strings.HasSuffix(filepath.ToSlash(dirs[1]), ".claude/projects") {
		t.Fatalf("dirs with CLAUDE_CONFIG_DIR = %v", dirs)
	}
}

func TestTrashDirIsUnderDotArc(t *testing.T) {
	if got := filepath.ToSlash(TrashDir()); !strings.HasSuffix(got, "/.arc/trash") {
		t.Fatalf("TrashDir = %s", got)
	}
}
