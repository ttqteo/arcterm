// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
)

func exportPaths(got []DigestSession) []string {
	paths := make([]string, len(got))
	for i, s := range got {
		paths[i] = s.Path
	}
	return paths
}

// the walk is stat only, claude's live root and its archive, never another runtime, newest first
func TestDigestExportCandidates(t *testing.T) {
	live, archive, piRoot := t.TempDir(), t.TempDir(), t.TempDir()
	now := time.Now()
	older := writeDigestSession(t, live, "older", "/p/a", "deploy", "ok", now.Add(-5*24*time.Hour))
	newer := writeDigestSession(t, live, "newer", "/p/a", "deploy", "ok", now.Add(-time.Hour))
	archived := writeDigestSession(t, archive, "archived", "/p/b", "deploy", "ok", now.Add(-24*time.Hour))
	writeDigestSession(t, live, "aged", "/p/a", "deploy", "ok", now.AddDate(0, 0, -(DigestWindowDays+5)))
	writeDigestPiSession(t, piRoot, "pi", "/p/a", "deploy", "ok", now.Add(-time.Hour))
	reads := recordReads(t)
	archiveProvider := claudeProvider(archive)
	archiveProvider.archive = true
	digestEnv(t, claudeProvider(live), archiveProvider, piProvider(piRoot))

	got := ClaudeDigestCandidates(DigestWindowDays)
	if want := []string{newer, archived, older}; !slices.Equal(exportPaths(got), want) {
		t.Fatalf("claude's live and archived transcripts of the window, newest first: got %v, want %v", exportPaths(got), want)
	}
	for i, wantArchived := range []bool{false, true, false} {
		if got[i].Archived != wantArchived {
			t.Errorf("%s: Archived = %v, want %v", got[i].Path, got[i].Archived, wantArchived)
		}
	}
	info, err := os.Stat(newer)
	if err != nil {
		t.Fatal(err)
	}
	if s := got[0]; s.Stem != "newer" || s.Size != info.Size() || !s.Mtime.Equal(info.ModTime()) {
		t.Errorf("stem, size and mtime come from the file: %+v, stat %v %v", s, info.Size(), info.ModTime())
	}
	for _, s := range got {
		if s.Session != nil || s.Turns != nil {
			t.Errorf("a candidate holds no digest: %+v", s)
		}
	}
	if n := len(reads()); n != 0 {
		t.Errorf("the walk reads no transcript, read %d", n)
	}
	if names := digestFiles(t); len(names) != 0 {
		t.Errorf("the walk writes no digest, wrote %v", names)
	}

	if narrow := ClaudeDigestCandidates(1); !slices.Equal(exportPaths(narrow), []string{newer, archived}) {
		t.Errorf("the window argument narrows the walk: got %v", exportPaths(narrow))
	}
}

func TestDigestExportReadDigestForBuildsOnceThenReadsTheDigest(t *testing.T) {
	root := t.TempDir()
	path := writeDigestSession(t, root, "a", "/p/a", "why did the deploy fail", "the deploy timed out", time.Now().Add(-2*time.Hour))
	reads := recordReads(t)
	digestEnv(t, claudeProvider(root))

	got, err := ReadDigestFor(path)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.Path != path || got.Stem != "a" || got.Archived || got.Size != info.Size() || !got.Mtime.Equal(info.ModTime()) {
		t.Errorf("the file's own fields: %+v", got)
	}
	if got.Session == nil || got.Session.ID != "a" || got.Session.ProjectPath != "/p/a" || got.Session.TranscriptPath != path {
		t.Fatalf("the session as search shows it: %+v", got.Session)
	}
	if len(got.Turns) != 2 || got.Turns[0].Speaker != "user" || got.Turns[0].Text != "why did the deploy fail" ||
		got.Turns[1].Speaker != "agent" || got.Turns[1].Text != "the deploy timed out" {
		t.Errorf("the prompt and the reply: %+v", got.Turns)
	}
	if _, err := os.Stat(digestPath(path)); err != nil {
		t.Errorf("the first read writes the digest: %v", err)
	}
	if n := len(reads()); n != 1 {
		t.Fatalf("the first read parses the transcript once, %d reads", n)
	}

	again, err := ReadDigestFor(path)
	if err != nil {
		t.Fatal(err)
	}
	if n := len(reads()); n != 1 {
		t.Fatalf("a fresh digest is read without parsing the transcript, %d reads in all", n)
	}
	if again.Session == nil || again.Session.ID != "a" || len(again.Turns) != 2 {
		t.Errorf("the digest answers as the build did: %+v", again)
	}
	// a search after the read reuses the digest the read wrote
	if found, _ := searchDigest(t, "deploy", DigestSearch{}); !slices.Equal(digestIDs(found), []string{"a"}) {
		t.Errorf("search finds it: %v", digestIDs(found))
	}
	if n := len(reads()); n != 1 {
		t.Errorf("search reuses the digest ReadDigestFor wrote, %d reads in all", n)
	}
}

func TestDigestExportReadDigestForRebuildsAGrownTranscript(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	path := writeDigestSession(t, root, "a", "/p/a", "first question", "first answer", now.Add(-time.Hour))
	reads := recordReads(t)
	digestEnv(t, claudeProvider(root))

	if _, err := ReadDigestFor(path); err != nil {
		t.Fatal(err)
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString("\n" + `{"type":"user","timestamp":"` + now.UTC().Format(time.RFC3339Nano) + `","message":{"role":"user","content":"and a rollback plan"}}`); err != nil {
		t.Fatal(err)
	}
	f.Close()
	if err := os.Chtimes(path, now, now); err != nil {
		t.Fatal(err)
	}

	got, err := ReadDigestFor(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Turns) != 3 || got.Turns[2].Text != "and a rollback plan" {
		t.Errorf("the appended prompt is in the digest: %+v", got.Turns)
	}
	if n := len(reads()); n != 2 {
		t.Errorf("the grown transcript is parsed again once, %d reads in all", n)
	}
}

func TestDigestExportReadDigestForAnArchivedTranscript(t *testing.T) {
	live, archive := t.TempDir(), t.TempDir()
	path := writeDigestSession(t, archive, "a", "/p/a", "deploy", "ok", time.Now().Add(-time.Hour))
	archiveProvider := claudeProvider(archive)
	archiveProvider.archive = true
	digestEnv(t, claudeProvider(live), archiveProvider)

	got, err := ReadDigestFor(path)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Archived || got.Session == nil {
		t.Errorf("a transcript of the archive is Archived: %+v", got)
	}
}

// a transcript with no session is a digest answer, not an error: Session is nil and the digest is kept
func TestDigestExportReadDigestForATranscriptWithNoSession(t *testing.T) {
	root := t.TempDir()
	dir := mkProjectDir(t, root, agentobserve.SlugifyCwd("/p/a"))
	path := writeJSONL(t, dir, "tool-only.jsonl", `{"type":"assistant","message":{"content":[{"type":"text","text":"deploy notes"}]}}`)
	digestEnv(t, claudeProvider(root))

	got, err := ReadDigestFor(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.Session != nil || got.Turns != nil || got.Stem != "tool-only" {
		t.Errorf("no session, no turns: %+v", got)
	}
	if _, err := os.Stat(digestPath(path)); err != nil {
		t.Errorf("the digest is kept so it is never read again: %v", err)
	}
}

func TestDigestExportReadDigestForErrors(t *testing.T) {
	root, elsewhere := t.TempDir(), t.TempDir()
	path := writeDigestSession(t, root, "a", "/p/a", "deploy", "ok", time.Now().Add(-time.Hour))
	outside := writeDigestSession(t, elsewhere, "b", "/p/a", "deploy", "ok", time.Now().Add(-time.Hour))
	digestEnv(t, claudeProvider(root))

	if _, err := ReadDigestFor(filepath.Join(filepath.Dir(path), "gone.jsonl")); err == nil {
		t.Error("a missing transcript is an error")
	}
	if _, err := ReadDigestFor(outside); err == nil {
		t.Error("a transcript under no claude root is an error")
	}
	if _, err := ReadDigestFor(filepath.Dir(path)); err == nil {
		t.Error("a folder is an error")
	}
	if names := digestFiles(t); len(names) != 0 {
		t.Errorf("a failed read writes no digest: %v", names)
	}

	orig := readLines
	var failing atomic.Bool
	failing.Store(true)
	readLines = func(p string) ([]string, error) {
		if failing.Load() {
			return nil, errors.New("sharing violation")
		}
		return orig(p)
	}
	t.Cleanup(func() { readLines = orig })
	if _, err := ReadDigestFor(path); err == nil {
		t.Error("an unreadable transcript is an error")
	}
	if _, err := os.Stat(digestPath(path)); err == nil {
		t.Error("no digest for a transcript that could not be read")
	}
	failing.Store(false)
	if got, err := ReadDigestFor(path); err != nil || got.Session == nil {
		t.Errorf("read again once it can be: %+v, %v", got, err)
	}
}
