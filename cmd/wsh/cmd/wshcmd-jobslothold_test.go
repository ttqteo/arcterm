// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import "testing"

func TestJobslotHoldTargetSkipsTheForkedShell(t *testing.T) {
	procs := map[int32]jobslotProc{
		100: {parent: 50, image: "claude.exe"},
		200: {parent: 100, image: "bash.exe"}, // the Bash tool's shell
		300: {parent: 200, image: "bash.exe"}, // the copy it forked to start wsh
		400: {parent: 100, image: "node.exe"},
	}
	cases := []struct {
		name  string
		ppid  int32
		procs map[int32]jobslotProc
		want  int32
	}{
		{"no table (macOS, Linux)", 300, nil, 300},
		{"a forked copy holds its shell", 300, procs, 200},
		{"the shell itself, its parent another image", 200, procs, 200},
		{"a parent of another image than its own", 400, procs, 400},
		{"a parent not in the table", 999, procs, 999},
		{"a parent whose own parent is gone", 300, map[int32]jobslotProc{300: {parent: 200, image: "bash.exe"}}, 300},
		{"image names differ only in case", 300, map[int32]jobslotProc{200: {parent: 1, image: "BASH.EXE"}, 300: {parent: 200, image: "bash.exe"}}, 200},
	}
	for _, c := range cases {
		if got := jobslotHoldTarget(c.ppid, c.procs); got != c.want {
			t.Errorf("%s: got %d, want %d", c.name, got, c.want)
		}
	}
}
