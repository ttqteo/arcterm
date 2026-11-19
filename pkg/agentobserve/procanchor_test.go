// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentobserve

import "testing"

func TestBlockIDFromEnv(t *testing.T) {
	env := []string{"PATH=/bin", "WAVETERM_BLOCKID=df9292f9-1234", "HOME=/root"}
	if got := blockIDFromEnv(env); got != "df9292f9-1234" {
		t.Fatalf("blockIDFromEnv = %q", got)
	}
	if got := blockIDFromEnv([]string{"PATH=/bin"}); got != "" {
		t.Fatalf("blockIDFromEnv(none) = %q, want empty", got)
	}
}

func TestIsHelperCmdline(t *testing.T) {
	if !isHelperCmdline(`"C:\...\claude.exe" --chrome-native-host`) {
		t.Fatal("chrome-native-host should be a helper")
	}
	if isHelperCmdline(`"C:\...\claude.exe" --dangerously-skip-permissions "goal"`) {
		t.Fatal("a real agent invocation is not a helper")
	}
}

func TestNormalizeBlockID(t *testing.T) {
	if NormalizeBlockID("block:abc") != "abc" {
		t.Fatal("should strip block: prefix")
	}
	if NormalizeBlockID("abc") != "abc" {
		t.Fatal("bare uuid unchanged")
	}
}

func TestIsClaudeProc(t *testing.T) {
	for _, n := range []string{"claude", "claude.exe", "Claude.exe", "CLAUDE"} {
		if !isClaudeProc(n) {
			t.Fatalf("%q should be claude", n)
		}
	}
	for _, n := range []string{"node", "node.exe", "claudia"} {
		if isClaudeProc(n) {
			t.Fatalf("%q should not be claude", n)
		}
	}
}

// the native install on a Mac: ~/.local/bin/claude links to versions/2.1.328, and the OS names the process "2.1.328"
func TestIsClaudeNativeMacInstall(t *testing.T) {
	for _, c := range []struct {
		name, cmdline string
		maybe, is     bool
	}{
		{"claude", "", true, true},
		{"claude.exe", "", true, true},
		{"2.1.328", "claude --resume 7204", true, true},
		{"2.1.328", "/Users/u/.local/bin/claude", true, true},
		{"2.1.328", "python3 -m http.server", true, false},
		{"node", "claude", false, true},
		{"node", "node server.js", false, false},
		{"v2.1", "claude", false, true},
		{"1", "", false, false},
		{"", "", false, false},
	} {
		if got := MaybeClaude(c.name); got != c.maybe {
			t.Errorf("MaybeClaude(%q) = %v, want %v", c.name, got, c.maybe)
		}
		if got := IsClaude(c.name, c.cmdline); got != c.is {
			t.Errorf("IsClaude(%q, %q) = %v, want %v", c.name, c.cmdline, got, c.is)
		}
	}
}
