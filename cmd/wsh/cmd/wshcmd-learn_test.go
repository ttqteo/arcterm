// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestLearnSession(t *testing.T) {
	day := time.Date(2026, 10, 14, 23, 59, 0, 0, time.Local)
	if got := learnSession("blk-1", day); got != "blk-1:2026-10-14" {
		t.Fatalf("learnSession with a block = %q", got)
	}
	if got := learnSession("", day); got != "cli:2026-10-14" {
		t.Fatalf("learnSession without a block = %q", got)
	}
}

func TestLearnSubcommandsRegistered(t *testing.T) {
	for _, want := range []string{"note", "list"} {
		if !hasSub(learnCmd, want) {
			t.Fatalf("`learn %s` subcommand is not registered", want)
		}
	}
	for _, flag := range []string{"key", "skill", "memory", "quote"} {
		if learnNoteCmd.Flags().Lookup(flag) == nil {
			t.Fatalf("`learn note` is missing --%s", flag)
		}
	}
	for _, flag := range []string{"skill", "memory", "json"} {
		if learnListCmd.Flags().Lookup(flag) == nil {
			t.Fatalf("`learn list` is missing --%s", flag)
		}
	}
}

func TestLearnNoteStatus(t *testing.T) {
	cases := []struct {
		rtn  wshrpc.CommandLearnNoteRtnData
		want string
	}{
		{wshrpc.CommandLearnNoteRtnData{}, "Noted."},
		{wshrpc.CommandLearnNoteRtnData{Proposed: true}, "Noted; it is waiting for the user's yes in Needs you."},
		{wshrpc.CommandLearnNoteRtnData{Muted: true}, "Not noted: the user dismissed this before."},
	}
	for _, c := range cases {
		if got := learnNoteStatus(c.rtn); got != c.want {
			t.Fatalf("learnNoteStatus(%+v) = %q, want %q", c.rtn, got, c.want)
		}
	}
}

func TestLearnTarget(t *testing.T) {
	if _, _, err := learnTarget("", false); err == nil || !strings.Contains(err.Error(), "--skill") {
		t.Fatalf("neither target: err = %v", err)
	}
	if _, _, err := learnTarget("notes", true); err == nil || !strings.Contains(err.Error(), "not both") {
		t.Fatalf("both targets: err = %v", err)
	}
	skill, cwd, err := learnTarget("notes", false)
	if err != nil || skill != "notes" || cwd != "" {
		t.Fatalf("skill target = %q %q %v", skill, cwd, err)
	}
	skill, cwd, err = learnTarget("", true)
	if err != nil || skill != "" || cwd == "" {
		t.Fatalf("memory target = %q %q %v", skill, cwd, err)
	}
}

func TestLearnKeyLine(t *testing.T) {
	got := learnKeyLine(wshrpc.LearnKey{Key: "notes-in-vietnamese", Text: "Write notes in Vietnamese", Notes: 2})
	if got != "notes-in-vietnamese  2×  Write notes in Vietnamese" {
		t.Fatalf("learnKeyLine = %q", got)
	}
}
