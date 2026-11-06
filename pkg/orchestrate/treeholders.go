// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"log"
	"os"
	"time"

	"github.com/shirou/gopsutil/v4/process"
)

// treeProc is one running process as removeHeldDir sees it.
type treeProc struct {
	Pid  int32
	Name string
	Cwd  string
	Exe  string
}

// listTreeProcs lists every running process with its working directory and executable. A process whose cwd or exe
// cannot be read (another user's, a protected one) comes back with them empty, so it is never picked. A var so tests
// need no live processes.
var listTreeProcs = func(ctx context.Context) ([]treeProc, error) {
	procs, err := process.ProcessesWithContext(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]treeProc, 0, len(procs))
	for _, p := range procs {
		tp := treeProc{Pid: p.Pid}
		tp.Name, _ = p.NameWithContext(ctx)
		tp.Cwd, _ = p.CwdWithContext(ctx)
		tp.Exe, _ = p.ExeWithContext(ctx)
		out = append(out, tp)
	}
	return out, nil
}

// killTreeProc kills one process. A var so tests kill nothing real.
var killTreeProc = func(ctx context.Context, pid int32) error {
	p, err := process.NewProcessWithContext(ctx, pid)
	if err != nil {
		return err
	}
	return p.KillWithContext(ctx)
}

// heldDirRetries and heldDirWait bound how long removeHeldDir waits for Windows to let go of a directory whose
// holders it killed: a killed process's handles close a moment after it exits.
var (
	heldDirRetries = 10
	heldDirWait    = 200 * time.Millisecond
)

// holdersOf picks the processes working in dir (their cwd is it or under it) or run from it (their exe is), never
// self. On Windows a live process's cwd is what keeps a directory from being deleted.
func holdersOf(procs []treeProc, dir string, self int32) []treeProc {
	var out []treeProc
	for _, p := range procs {
		if p.Pid == self || p.Pid <= 0 {
			continue
		}
		if insideAny(p.Cwd, []string{dir}) || insideAny(p.Exe, []string{dir}) {
			out = append(out, p)
		}
	}
	return out
}

// killTreeHolders kills every process holding dir and says how many it killed. The engine's own sessions are stopped
// before this by reapTreeHolders; what is left is what they started and left behind: a dev server a worker's
// final-verify spawned from its tree and was killed before it could stop (runs d39cfe1a and 983dcb44 on 2026-11-05
// each held a merged task's tree with an orphaned vite, and its cleanup failed every 30 s until someone killed it).
func killTreeHolders(ctx context.Context, dir string) int {
	procs, err := listTreeProcs(ctx)
	if err != nil {
		log.Printf("listing processes holding %s: %v", dir, err)
		return 0
	}
	killed := 0
	for _, p := range holdersOf(procs, dir, int32(os.Getpid())) {
		if err := killTreeProc(ctx, p.Pid); err != nil {
			log.Printf("killing %s (pid %d, cwd %s) holding %s: %v", p.Name, p.Pid, p.Cwd, dir, err)
			continue
		}
		log.Printf("killed %s (pid %d, cwd %s, exe %s): it held %s", p.Name, p.Pid, p.Cwd, p.Exe, dir)
		killed++
	}
	return killed
}

// removeHeldDir deletes dir; when the delete fails it kills what holds the directory and tries again. The caller has
// already unlinked dir's junctions, which os.RemoveAll would otherwise follow into their targets.
func removeHeldDir(ctx context.Context, dir string) error {
	err := os.RemoveAll(dir)
	if err == nil {
		return nil
	}
	if killTreeHolders(ctx, dir) == 0 {
		return err
	}
	for range heldDirRetries {
		time.Sleep(heldDirWait)
		if err = os.RemoveAll(dir); err == nil {
			return nil
		}
	}
	return err
}
