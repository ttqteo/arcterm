// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"os"
	"strings"
)

// jobslotProc is one process as the hold reads it: its parent and its image's base name.
type jobslotProc struct {
	parent int32
	image  string
}

// jobslotHoldTarget is the process whose life holds a --hold-parent slot: the shell that runs the command. That is
// wsh's parent, except under Git Bash (any MSYS or Cygwin shell) on Windows, where the parent of a native program is
// a copy the shell forked to start it, which exits with wsh; the shell is that copy's parent, the same image. Seen
// 2026-11-14 on Windows: every background command's slot went one poll (2 s) after it started, the command still
// running. procs is nil where no such fork sits between (macOS, Linux): the parent is the shell.
func jobslotHoldTarget(ppid int32, procs map[int32]jobslotProc) int32 {
	p, ok := procs[ppid]
	if !ok || p.image == "" || p.parent <= 0 {
		return ppid
	}
	g, ok := procs[p.parent]
	if !ok || !strings.EqualFold(g.image, p.image) {
		return ppid
	}
	return p.parent
}

func jobslotHoldPid() int32 {
	return jobslotHoldTarget(int32(os.Getppid()), jobslotProcs())
}
