// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memgate

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestLearnedFilePath(t *testing.T) {
	got := LearnedPath(filepath.Join("home", "me"))
	want := filepath.Join("home", "me", ".arc", "jobslot-learned.json")
	if got != want {
		t.Fatalf("LearnedPath = %q, want %q", got, want)
	}
}

func TestLearnedFileRoundTrip(t *testing.T) {
	path := LearnedPath(t.TempDir()) // <home>/.arc does not exist yet: WriteLearned creates it
	if err := WriteLearned(path, []string{"make build", "gradle build", "make build"}); err != nil {
		t.Fatalf("WriteLearned: %v", err)
	}
	got := ReadLearned(path)
	want := map[string]bool{"make build": true, "gradle build": true}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ReadLearned = %v, want %v", got, want)
	}
}

func TestLearnedFileWritesSortedPatternsWithoutRepeats(t *testing.T) {
	path := LearnedPath(t.TempDir())
	if err := WriteLearned(path, []string{"mvn package", "gradle build", "make build", "gradle build"}); err != nil {
		t.Fatalf("WriteLearned: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"patterns":["gradle build","make build","mvn package"]}`
	if got := string(data); got != want && got != want+"\n" {
		t.Fatalf("file = %q, want %q", got, want)
	}
}

func TestLearnedFileMissingReadsEmpty(t *testing.T) {
	got := ReadLearned(filepath.Join(t.TempDir(), "nope", "jobslot-learned.json"))
	if got == nil || len(got) != 0 {
		t.Fatalf("ReadLearned of a missing file = %#v, want an empty, non-nil set", got)
	}
}

func TestLearnedFileBrokenReadsEmpty(t *testing.T) {
	path := filepath.Join(t.TempDir(), "jobslot-learned.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	got := ReadLearned(path)
	if got == nil || len(got) != 0 {
		t.Fatalf("ReadLearned of a broken file = %#v, want an empty, non-nil set", got)
	}
}

func TestLearnedFileUnreadableReadsEmpty(t *testing.T) {
	// a directory where the file should be: reading it fails
	got := ReadLearned(t.TempDir())
	if got == nil || len(got) != 0 {
		t.Fatalf("ReadLearned of a directory = %#v, want an empty, non-nil set", got)
	}
}

func TestLearnedFileSecondWriteReplacesFirst(t *testing.T) {
	path := LearnedPath(t.TempDir())
	if err := WriteLearned(path, []string{"make build", "gradle build"}); err != nil {
		t.Fatal(err)
	}
	if err := WriteLearned(path, []string{"mvn package"}); err != nil {
		t.Fatal(err)
	}
	got := ReadLearned(path)
	want := map[string]bool{"mvn package": true}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("after a second write ReadLearned = %v, want %v", got, want)
	}
	// the rename leaves no temp file behind
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		names := make([]string, 0, len(entries))
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Fatalf("dir holds %v, want only the learned file", names)
	}
}

func TestLearnedFileEmptyWriteReadsEmpty(t *testing.T) {
	path := LearnedPath(t.TempDir())
	if err := WriteLearned(path, []string{"make build"}); err != nil {
		t.Fatal(err)
	}
	if err := WriteLearned(path, nil); err != nil {
		t.Fatal(err)
	}
	got := ReadLearned(path)
	if got == nil || len(got) != 0 {
		t.Fatalf("ReadLearned after writing no patterns = %#v, want an empty, non-nil set", got)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if want := `{"patterns":[]}`; string(data) != want && string(data) != want+"\n" {
		t.Fatalf("file = %q, want %q (an empty list, not null)", data, want)
	}
}

func TestLearnedFileBytesIsOneGiB(t *testing.T) {
	if LearnedBytes != gib {
		t.Fatalf("LearnedBytes = %d, want 1 GiB", LearnedBytes)
	}
}
