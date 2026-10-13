// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package notestore

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavevault"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const testDay = "2026-10-08"

func useTempRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	t.Cleanup(UseRootForTest(root))
	prev := now
	now = func() time.Time { return time.Date(2026, 10, 8, 9, 30, 0, 0, time.UTC) }
	t.Cleanup(func() { now = prev })
	return root
}

func TestAddWritesAMarkdownFileAndPokesSync(t *testing.T) {
	root := useTempRoot(t)
	wavevault.PokedForTest()
	note, err := Add("  Debug port: measurement steps ", "1. quit Arc\n2. relaunch\n")
	if err != nil {
		t.Fatal(err)
	}
	wantID := testDay + "-debug-port-measurement-steps"
	if note.ID != wantID || note.Title != "Debug port: measurement steps" || note.Day != testDay {
		t.Fatalf("note = %+v", note)
	}
	b, err := os.ReadFile(filepath.Join(root, NotesDir, wantID+".md"))
	if err != nil {
		t.Fatal(err)
	}
	if want := "# Debug port: measurement steps\n\n1. quit Arc\n2. relaunch\n"; string(b) != want {
		t.Fatalf("file = %q, want %q", b, want)
	}
	if !wavevault.PokedForTest() {
		t.Fatal("add did not poke the vault sync")
	}
}

func TestAddNumbersASecondNoteWithTheSameTitle(t *testing.T) {
	useTempRoot(t)
	first, err := Add("Steps", "one")
	if err != nil {
		t.Fatal(err)
	}
	second, err := Add("Steps", "two")
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == second.ID || second.ID != testDay+"-steps-2" {
		t.Fatalf("ids = %q, %q", first.ID, second.ID)
	}
	notes, err := List()
	if err != nil {
		t.Fatal(err)
	}
	if len(notes) != 2 || notes[0].Body != "two" || notes[1].Body != "one" {
		t.Fatalf("both notes must survive, got %+v", notes)
	}
}

func TestAddRejectsABadTitle(t *testing.T) {
	useTempRoot(t)
	for _, title := range []string{"", "   ", "two\nlines", strings.Repeat("x", maxTitleLen+1)} {
		if _, err := Add(title, "body"); err == nil {
			t.Errorf("title %q was accepted", title)
		}
	}
}

func TestAddSlugsATitleWithNoLettersOrDigits(t *testing.T) {
	useTempRoot(t)
	note, err := Add("???", "")
	if err != nil {
		t.Fatal(err)
	}
	if note.ID != testDay+"-note" {
		t.Fatalf("id = %q", note.ID)
	}
}

func TestListIsNewestDayFirstAndSkipsOtherFiles(t *testing.T) {
	root := useTempRoot(t)
	dir := filepath.Join(root, NotesDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"2026-10-01-old.md":     "# Old\n\nbody\n",
		"2026-10-07-by-hand.md": "no heading here\r\nsecond line\r\n",
		"README.md":             "not a note",
		"2026-10-07-x.md.tmp":   "half written",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := Add("New", "fresh"); err != nil {
		t.Fatal(err)
	}
	notes, err := List()
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, n := range notes {
		ids = append(ids, n.ID)
	}
	if got, want := strings.Join(ids, ","), testDay+"-new,2026-10-07-by-hand,2026-10-01-old"; got != want {
		t.Fatalf("ids = %s, want %s", got, want)
	}
	byHand := notes[1]
	if byHand.Title != "2026-10-07-by-hand" || byHand.Body != "no heading here\nsecond line" || byHand.Day != "2026-10-07" {
		t.Fatalf("a file with no heading is all body, titled by its id: %+v", byHand)
	}
}

func TestListOrdersOneDayByModifiedTimeNewestFirst(t *testing.T) {
	root := useTempRoot(t)
	dir := filepath.Join(root, NotesDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 10, 8, 8, 0, 0, 0, time.UTC)
	files := map[string]time.Duration{
		"2026-10-08-alpha.md": 0,
		"2026-10-08-bravo.md": 2 * time.Hour,
		"2026-10-08-zulu.md":  time.Hour,
		"2026-10-09-later.md": -time.Hour,
	}
	for name, offset := range files {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte("# x\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, base.Add(offset), base.Add(offset)); err != nil {
			t.Fatal(err)
		}
	}
	notes, err := List()
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, n := range notes {
		ids = append(ids, n.ID)
	}
	want := "2026-10-09-later,2026-10-08-bravo,2026-10-08-zulu,2026-10-08-alpha"
	if got := strings.Join(ids, ","); got != want {
		t.Fatalf("ids = %s, want %s", got, want)
	}
}

func TestListOfAVaultWithNoNotesIsEmpty(t *testing.T) {
	useTempRoot(t)
	notes, err := List()
	if err != nil || len(notes) != 0 {
		t.Fatalf("notes = %v, err = %v", notes, err)
	}
}

func TestUpdateRewritesTitleAndBodyAndKeepsTheID(t *testing.T) {
	useTempRoot(t)
	note, err := Add("Draft", "old body")
	if err != nil {
		t.Fatal(err)
	}
	if err := Update(note.ID, "Final title", "new body"); err != nil {
		t.Fatal(err)
	}
	notes, err := List()
	if err != nil {
		t.Fatal(err)
	}
	if len(notes) != 1 || notes[0].ID != note.ID || notes[0].Title != "Final title" || notes[0].Body != "new body" {
		t.Fatalf("notes = %+v", notes)
	}
}

func TestUpdateAndDeleteOfAMissingNoteAreNotFound(t *testing.T) {
	useTempRoot(t)
	missing := testDay + "-missing"
	if err := Update(missing, "t", "b"); !errors.Is(err, wstore.ErrNotFound) {
		t.Fatalf("update err = %v", err)
	}
	if err := Delete(missing); !errors.Is(err, wstore.ErrNotFound) {
		t.Fatalf("delete err = %v", err)
	}
	if notes, _ := List(); len(notes) != 0 {
		t.Fatalf("an update of a missing note must not create it: %+v", notes)
	}
}

func TestDeleteRemovesTheFile(t *testing.T) {
	useTempRoot(t)
	note, err := Add("Gone", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := Delete(note.ID); err != nil {
		t.Fatal(err)
	}
	if notes, _ := List(); len(notes) != 0 {
		t.Fatalf("notes = %+v", notes)
	}
}

func TestAnIDThatWouldLeaveTheNotesDirIsRejected(t *testing.T) {
	root := useTempRoot(t)
	outside := filepath.Join(root, "outside.md")
	if err := os.WriteFile(outside, []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"../outside", `..\outside`, "2026-10-08-a/../../outside", "", "outside", "2026-10-08-"} {
		if err := Delete(id); err == nil || errors.Is(err, wstore.ErrNotFound) {
			t.Errorf("delete %q: err = %v, want an invalid id", id, err)
		}
		if err := Update(id, "t", "b"); err == nil || errors.Is(err, wstore.ErrNotFound) {
			t.Errorf("update %q: err = %v, want an invalid id", id, err)
		}
	}
	if b, err := os.ReadFile(outside); err != nil || string(b) != "keep" {
		t.Fatalf("a file outside notes/ was touched: %q, %v", b, err)
	}
}
