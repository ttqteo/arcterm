// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memusage

import "testing"

// 10 is the agent; 11 and 12 its children; 13 a grandchild under 11; 20 an unrelated process
func heaviestTable() Table {
	return NewTable(map[int32]int32{10: 1, 11: 10, 12: 10, 13: 11, 20: 1})
}

func TestHeaviestPicksTheLargestDescendant(t *testing.T) {
	foot := map[int32]uint64{10: 900, 11: 100, 12: 300, 13: 500, 20: 9000}
	pid, b, ok := Heaviest(heaviestTable(), 10, func(p int32) (uint64, bool) { v, ok := foot[p]; return v, ok })
	if !ok || pid != 13 || b != 500 {
		t.Fatalf("got %d %d %v, want 13 500 true (the agent itself and outsiders are never picked)", pid, b, ok)
	}
}

func TestHeaviestWithNoChildren(t *testing.T) {
	if _, _, ok := Heaviest(heaviestTable(), 12, func(int32) (uint64, bool) { return 1, true }); ok {
		t.Fatal("a process with no descendants has no heaviest command")
	}
}

func TestHeaviestSkipsUnreadable(t *testing.T) {
	pid, _, ok := Heaviest(heaviestTable(), 10, func(p int32) (uint64, bool) { return 7, p == 12 })
	if !ok || pid != 12 {
		t.Fatalf("got %d %v, want 12 true", pid, ok)
	}
}

func TestIsDescendantRefuses(t *testing.T) {
	tb := heaviestTable()
	if !IsDescendant(tb, 10, 13) {
		t.Fatal("13 is under 10")
	}
	for _, pid := range []int32{10, 20, 1, 99} {
		if IsDescendant(tb, 10, pid) {
			t.Fatalf("%d must be refused: the agent itself, an outsider, a parent, or gone", pid)
		}
	}
}

// an agent block runs `$SHELL -c <cmd>`; fish and pwsh do not exec, so 30 is that shell, 31 the agent under it, and
// 32, 33 the agent's commands
func wrappedTable() Table {
	return NewTable(map[int32]int32{30: 1, 31: 30, 32: 31, 33: 32})
}

func TestAgentPidSeesThroughAShellThatDidNotExec(t *testing.T) {
	tb := wrappedTable()
	isShell := func(p int32) bool { return p == 30 }
	agent := AgentPid(tb, 30, isShell)
	if agent != 31 {
		t.Fatalf("AgentPid = %d, want 31: the shell's one child is the agent", agent)
	}
	foot := map[int32]uint64{31: 9000, 32: 100, 33: 500}
	pid, _, ok := Heaviest(tb, agent, func(p int32) (uint64, bool) { v, ok := foot[p]; return v, ok })
	if !ok || pid != 33 {
		t.Fatalf("got %d %v, want 33 true: the agent itself is never offered", pid, ok)
	}
	if IsDescendant(tb, agent, 31) {
		t.Fatal("a stop on the wrapped agent itself must be refused")
	}
}

func TestAgentPidKeepsTheRoot(t *testing.T) {
	// bash and zsh exec the command, so the root is the agent
	if got := AgentPid(heaviestTable(), 10, func(int32) bool { return false }); got != 10 {
		t.Fatalf("a root that is not a shell is the agent: got %d", got)
	}
	// a shell with two children wraps no single agent
	if got := AgentPid(heaviestTable(), 10, func(int32) bool { return true }); got != 10 {
		t.Fatalf("a shell with two children stays the root: got %d", got)
	}
}

func TestShortCommand(t *testing.T) {
	cases := []struct {
		args []string
		want string
	}{
		{[]string{"/usr/local/go/bin/go", "test", "./pkg/orchestrate"}, "go test ./pkg/orchestrate"},
		{[]string{`C:\Program Files\nodejs\node.exe`, "vite"}, "node.exe vite"},
		{nil, ""},
	}
	for _, c := range cases {
		if got := ShortCommand(c.args); got != c.want {
			t.Errorf("ShortCommand(%q) = %q, want %q", c.args, got, c.want)
		}
	}
	long := ShortCommand([]string{"node", "a-very-long-script-name-that-goes-on-and-on-and-on-and-on.js", "--flag"})
	if r := []rune(long); len(r) != 60 || r[59] != '…' {
		t.Fatalf("a long command is cut to 60 runes ending in …: %q (%d)", long, len(r))
	}
}
