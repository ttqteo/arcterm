// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

func TestIdeaSubcommandsRegistered(t *testing.T) {
	for _, want := range []string{"add", "list", "update", "tick"} {
		if !hasSub(ideaCmd, want) {
			t.Fatalf("`idea %s` subcommand is not registered", want)
		}
	}
	if ideaCmd.PersistentFlags().Lookup("session") == nil {
		t.Fatal("missing --session flag")
	}
	for _, name := range []string{"kind", "by", "topic", "json"} {
		if ideaAddCmd.Flags().Lookup(name) == nil {
			t.Fatalf("`idea add` is missing --%s", name)
		}
	}
	if ideaListCmd.Flags().Lookup("json") == nil {
		t.Fatal("`idea list` is missing --json")
	}
	for _, name := range []string{"kind", "text", "topic", "drop", "restore", "merge"} {
		if ideaUpdateCmd.Flags().Lookup(name) == nil {
			t.Fatalf("`idea update` is missing --%s", name)
		}
	}
}

// updateCmd is a command with the update flags, parsed from args: the package's own command keeps a flag's
// "changed" state across tests.
func updateCmd(t *testing.T, args ...string) *cobra.Command {
	t.Helper()
	c := &cobra.Command{Use: "update"}
	addIdeaUpdateFlags(c)
	if err := c.ParseFlags(args); err != nil {
		t.Fatalf("parse %v: %v", args, err)
	}
	return c
}

func TestIdeaUpdateWantsExactlyOneAction(t *testing.T) {
	ids := []string{"i1", "i2"}
	if _, err := buildIdeaUpdate(updateCmd(t), ids); err == nil || !strings.Contains(err.Error(), "exactly one") {
		t.Fatalf("no action: err = %v, want an exactly-one error", err)
	}
	for _, args := range [][]string{
		{"--drop", "--restore"},
		{"--drop", "--merge"},
		{"--kind", "decision", "--drop"},
		{"--text", "x", "--kind", "idea"},
		{"--text", "x", "--merge"},
		{"--topic", "RAM", "--kind", "idea"},
	} {
		if _, err := buildIdeaUpdate(updateCmd(t, args...), ids); err == nil || !strings.Contains(err.Error(), "exactly one") {
			t.Fatalf("%v: err = %v, want an exactly-one error", args, err)
		}
	}
}

func TestIdeaUpdateBuildsTheOp(t *testing.T) {
	cases := []struct {
		args    []string
		ids     []string
		op      string
		text    string
		newKind string
		topic   string
	}{
		{[]string{"--drop"}, []string{"i1", "i2"}, "drop", "", "", ""},
		{[]string{"--restore"}, []string{"i1"}, "restore", "", "", ""},
		{[]string{"--merge"}, []string{"i1", "i2", "i3"}, "merge", "", "", ""},
		{[]string{"--kind", "decision"}, []string{"i1", "i2"}, "kind", "", "decision", ""},
		{[]string{"--text", "new words"}, []string{"i1"}, "edit", "new words", "", ""},
		{[]string{"--topic", "Part 2"}, []string{"i1", "i2"}, "topic", "", "", "Part 2"},
		{[]string{"--topic", ""}, []string{"i1"}, "topic", "", "", ""},
	}
	for _, c := range cases {
		got, err := buildIdeaUpdate(updateCmd(t, c.args...), c.ids)
		if err != nil {
			t.Fatalf("%v: %v", c.args, err)
		}
		if got.Op != c.op || got.Text != c.text || got.NewKind != c.newKind || got.Topic != c.topic || strings.Join(got.Ids, ",") != strings.Join(c.ids, ",") {
			t.Fatalf("%v: got %+v, want op %s text %q newkind %q topic %q ids %v", c.args, got, c.op, c.text, c.newKind, c.topic, c.ids)
		}
	}
}

func TestIdeaUpdateRejectsBadInput(t *testing.T) {
	if _, err := buildIdeaUpdate(updateCmd(t, "--kind", "thought"), []string{"i1"}); err == nil || !strings.Contains(err.Error(), "thought") {
		t.Fatalf("bad kind: err = %v, want it to name the kind", err)
	}
	if _, err := buildIdeaUpdate(updateCmd(t, "--text", "x"), []string{"i1", "i2"}); err == nil {
		t.Fatal("--text on two ids must be an error: an edit takes one idea")
	}
	if _, err := buildIdeaUpdate(updateCmd(t, "--text", "  "), []string{"i1"}); err == nil {
		t.Fatal("--text with only spaces must be an error")
	}
	if _, err := buildIdeaUpdate(updateCmd(t, "--merge"), []string{"i1"}); err == nil {
		t.Fatal("--merge of one idea must be an error")
	}
	if _, err := buildIdeaUpdate(updateCmd(t, "--drop"), nil); err == nil {
		t.Fatal("an update with no ids must be an error")
	}
}

func TestIdeaKindAndByValidation(t *testing.T) {
	for _, kind := range []string{"idea", "decision", "question"} {
		if err := validateIdeaKind(kind); err != nil {
			t.Fatalf("kind %q: %v", kind, err)
		}
	}
	if err := validateIdeaKind("thought"); err == nil || !strings.Contains(err.Error(), "thought") {
		t.Fatalf("bad kind: err = %v, want it to name the kind", err)
	}
	if err := validateIdeaKind(""); err == nil {
		t.Fatal("an empty kind must be an error")
	}
	for _, by := range []string{"agent", "you"} {
		if err := validateIdeaBy(by); err != nil {
			t.Fatalf("by %q: %v", by, err)
		}
	}
	if err := validateIdeaBy("robot"); err == nil || !strings.Contains(err.Error(), "robot") {
		t.Fatalf("bad author: err = %v, want it to name the author", err)
	}
}

func TestIdeaTargetPrefersSession(t *testing.T) {
	t.Setenv("WAVETERM_BLOCKID", "b0b0b0b0-0000-0000-0000-000000000000")
	got, err := ideaTarget("abc-123")
	if err != nil || got.SessionId != "abc-123" || got.BlockId != "" {
		t.Fatalf("ideaTarget(session) = %+v, %v; want the session id alone", got, err)
	}
	got, err = ideaTarget("")
	if err != nil || got.BlockId != "b0b0b0b0-0000-0000-0000-000000000000" || got.SessionId != "" {
		t.Fatalf("ideaTarget() = %+v, %v; want the block id from the env", got, err)
	}
	t.Setenv("WAVETERM_BLOCKID", "")
	if _, err := ideaTarget(""); err == nil || !strings.Contains(err.Error(), "--session") {
		t.Fatalf("no block and no session: err = %v, want it to point at --session", err)
	}
}

func TestIdeaLine(t *testing.T) {
	if got := ideaLine("i3", "question", "", "who owns\nthe\ttick?"); got != "i3\tquestion\t-\twho owns the tick?" {
		t.Fatalf("ideaLine = %q, want one tab-separated line with - for no topic", got)
	}
	if got := ideaLine("i4", "decision", "Part 2", "coins"); got != "i4\tdecision\tPart 2\tcoins" {
		t.Fatalf("ideaLine = %q, want the topic in its own column", got)
	}
}
