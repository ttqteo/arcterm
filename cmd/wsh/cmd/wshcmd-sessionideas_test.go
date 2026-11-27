// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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

func TestSessionIdeasForProject(t *testing.T) {
	if sessionIdeasListCmd.Flags().Lookup("project") == nil {
		t.Fatal("`sessionideas list --project` is not registered")
	}
	main := t.TempDir()
	git := func(dir string, args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	git(main, "init", "-q")
	git(main, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
	sub := filepath.Join(main, "pkg", "x")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	wt := filepath.Join(t.TempDir(), "wt")
	git(main, "worktree", "add", "-q", wt)

	ideas := []wshrpc.SessionIdea{
		{ID: "here", ProjectPath: strings.ToUpper(main[:1]) + main[1:]},
		{ID: "other", ProjectPath: t.TempDir()},
		{ID: "none"},
	}
	for name, dir := range map[string]string{"the main checkout": main, "a subfolder": sub, "a linked worktree": wt} {
		got := ideasForProject(ideas, dir)
		if len(got) != 1 || got[0].ID != "here" {
			t.Errorf("%s: got %v, want only the idea of its project", name, got)
		}
	}
	if got := ideasForProject(ideas, t.TempDir()); len(got) != 0 {
		t.Errorf("a folder of no project's ideas: got %v, want none", got)
	}
}
