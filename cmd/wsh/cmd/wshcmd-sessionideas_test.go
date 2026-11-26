// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestSessionIdeasCmdRegistered(t *testing.T) {
	if !hasSub(rootCmd, "sessionideas") {
		t.Fatal("`sessionideas` is not registered on the root command")
	}
	for _, want := range []string{"list", "keep", "drop"} {
		if !hasSub(sessionIdeasCmd, want) {
			t.Fatalf("`sessionideas %s` subcommand is not registered", want)
		}
	}
	if sessionIdeasKeepCmd.Flags().Lookup("label") == nil {
		t.Fatal("`sessionideas keep --label` is not registered")
	}
	if sessionIdeasListCmd.Flags().Lookup("json") == nil {
		t.Fatal("`sessionideas list --json` is not registered")
	}
}

func TestSessionIdeasCmdArgs(t *testing.T) {
	if err := sessionIdeasListCmd.Args(sessionIdeasListCmd, []string{"extra"}); err == nil {
		t.Fatal("`sessionideas list` takes no arguments")
	}
	for name, run := range map[string]func(args []string) error{
		"keep": func(args []string) error { return sessionIdeasKeepCmd.Args(sessionIdeasKeepCmd, args) },
		"drop": func(args []string) error { return sessionIdeasDropCmd.Args(sessionIdeasDropCmd, args) },
	} {
		if err := run(nil); err == nil {
			t.Fatalf("`sessionideas %s` needs the idea's id", name)
		}
		if err := run([]string{"a", "b"}); err == nil {
			t.Fatalf("`sessionideas %s` takes one id, not two", name)
		}
		if err := run([]string{"a"}); err != nil {
			t.Fatalf("`sessionideas %s <id>` must be accepted: %v", name, err)
		}
	}
}

func TestSessionIdeasCmdLine(t *testing.T) {
	cases := []struct {
		name string
		in   wshrpc.SessionIdea
		want string
	}{
		{"on an initiative",
			wshrpc.SessionIdea{ID: "i1", State: "review", Gist: "Let the wall filter by project", EffortOID: "e1", EffortTitle: "Sidecar", Project: "arcterm"},
			"i1\treview\tLet the wall filter by project\tSidecar"},
		{"a new idea in a project",
			wshrpc.SessionIdea{ID: "i2", State: "kept", Gist: "Cache the digest", Project: "arcterm"},
			"i2\tkept\tCache the digest\tnew idea · arcterm"},
		{"a new idea with no project",
			wshrpc.SessionIdea{ID: "i3", State: "dropped", Gist: "Cache the digest"},
			"i3\tdropped\tCache the digest\tnew idea"},
	}
	for _, c := range cases {
		if got := sessionIdeaLine(c.in); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}
