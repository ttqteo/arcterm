// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memusage

import (
	"path/filepath"
	"slices"
	"strings"
)

const shortCommandRunes = 60

// Heaviest is root's descendant (root left out) with the largest footprint: what the tray's Free up offers to stop
// (spec 2026-10-15-tray-popover-design.md). ok is false when no descendant has a reading.
func Heaviest(t Table, root int32, footprint func(pid int32) (uint64, bool)) (pid int32, bytes uint64, ok bool) {
	for _, p := range t.Tree(root) {
		if p == root {
			continue
		}
		b, read := footprint(p)
		if !read {
			continue
		}
		if !ok || b > bytes {
			pid, bytes, ok = p, b, true
		}
	}
	return pid, bytes, ok
}

// IsDescendant says whether pid is still under root now: never root itself, so a stop cannot end the agent.
func IsDescendant(t Table, root, pid int32) bool {
	return pid != root && slices.Contains(t.Tree(root), pid)
}

// AgentPid is the agent's own process under its block's root. An agent block runs `$SHELL -c <cmd>`
// (pkg/shellexec/shellexec.go): bash and zsh exec the command, so the root is the agent, but fish and pwsh keep the
// shell, and the agent is its one child. Heaviest and IsDescendant take this pid, so Free up never offers the agent
// itself and a stop never ends it.
func AgentPid(t Table, root int32, isShell func(pid int32) bool) int32 {
	if kids := t.children[root]; len(kids) == 1 && isShell(root) {
		return kids[0]
	}
	return root
}

// ShortCommand is a command line as a row shows it: the program's file name, then its arguments, cut to 60 runes.
func ShortCommand(args []string) string {
	if len(args) == 0 {
		return ""
	}
	// filepath.Base does not split a Windows path on a Mac or the other way round
	prog := args[0]
	if i := strings.LastIndexAny(prog, `/\`); i >= 0 {
		prog = prog[i+1:]
	}
	s := strings.Join(append([]string{filepath.Clean(prog)}, args[1:]...), " ")
	if r := []rune(s); len(r) > shortCommandRunes {
		return string(r[:shortCommandRunes-1]) + "…"
	}
	return s
}
