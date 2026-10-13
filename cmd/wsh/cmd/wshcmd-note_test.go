// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"os"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func TestNoteSubcommandsRegistered(t *testing.T) {
	for _, want := range []string{"add", "list", "show", "delete"} {
		if !hasSub(noteCmd, want) {
			t.Fatalf("`note %s` subcommand is not registered", want)
		}
	}
	if noteAddCmd.Flags().Lookup("body") == nil {
		t.Fatalf("missing --body flag")
	}
	for _, c := range []string{"add", "list", "show"} {
		sub, _, err := noteCmd.Find([]string{c})
		if err != nil || sub.Flags().Lookup("json") == nil {
			t.Fatalf("`note %s` is missing --json", c)
		}
	}
}

func TestFindNote(t *testing.T) {
	notes := []*waveobj.UserNote{{ID: "2026-10-08-a", Title: "A"}, {ID: "2026-10-08-b", Title: "B"}}
	got, err := findNote(notes, "2026-10-08-b")
	if err != nil || got.Title != "B" {
		t.Fatalf("findNote = %v, %v", got, err)
	}
	if _, err := findNote(notes, "2026-10-08-c"); err == nil || !strings.Contains(err.Error(), "2026-10-08-c") {
		t.Fatalf("a missing id must name itself, got %v", err)
	}
}

func TestNoteBodyFromFlag(t *testing.T) {
	t.Cleanup(func() { noteAddCmd.Flags().Set("body", "") })
	if err := noteAddCmd.Flags().Set("body", "one line"); err != nil {
		t.Fatal(err)
	}
	got, err := noteBody(noteAddCmd)
	if err != nil || got != "one line" {
		t.Fatalf("noteBody = %q, %v", got, err)
	}
}

func TestNoteBodyFromStdin(t *testing.T) {
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	stdin := os.Stdin
	os.Stdin = r
	t.Cleanup(func() {
		os.Stdin = stdin
		r.Close()
		noteAddCmd.Flags().Set("body", "")
	})
	const body = "# steps\n\n1. first\n2. second\n"
	if _, err := w.WriteString(body); err != nil {
		t.Fatal(err)
	}
	w.Close()
	if err := noteAddCmd.Flags().Set("body", noteBodyStdin); err != nil {
		t.Fatal(err)
	}
	got, err := noteBody(noteAddCmd)
	if err != nil || got != body {
		t.Fatalf("noteBody = %q, %v", got, err)
	}
}
