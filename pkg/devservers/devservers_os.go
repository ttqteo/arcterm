// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package devservers

import (
	"context"
	"fmt"

	"github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/process"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
)

// List returns the servers listening in the project at cwd, and those started by the agent in block blockId. An
// empty cwd falls back to the agent process's cwd. A process the OS won't describe (another user's, say) is read as
// far as it allows: one whose cwd can't be read just isn't in the project.
func List(ctx context.Context, cwd, blockId string) ([]Server, error) {
	conns, err := net.ConnectionsWithContext(ctx, "tcp")
	if err != nil {
		return nil, err
	}
	var listeners []Listener
	for _, c := range conns {
		if c.Status == "LISTEN" && c.Pid > 0 {
			listeners = append(listeners, Listener{Pid: c.Pid, Port: c.Laddr.Port})
		}
	}
	if len(listeners) == 0 {
		return []Server{}, nil
	}
	root := cwd
	var agentPid int32
	if blockId != "" {
		// an enumerate error leaves the agent unknown: the listing still goes by cwd
		if agents, err := agentobserve.EnumerateAgents(); err == nil {
			want := agentobserve.NormalizeBlockID(blockId)
			for _, a := range agents {
				if a.BlockID != want {
					continue
				}
				agentPid = a.Pid
				if root == "" {
					root = a.Cwd
				}
				break
			}
		}
	}
	procs, err := readProcs(ctx, listeners)
	if err != nil {
		return nil, err
	}
	return Select(root, agentPid, procs, listeners), nil
}

// readProcs reads every listener's process and its ancestors, up to maxAncestorHops above each. A process is read
// once however many chains pass through it; one that can't be opened is left out.
func readProcs(ctx context.Context, listeners []Listener) (map[int32]Proc, error) {
	procs := map[int32]Proc{}
	unreadable := map[int32]bool{}
	for _, l := range listeners {
		pid := l.Pid
		for hops := 0; hops <= maxAncestorHops && pid > 0; hops++ {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			p, ok := procs[pid]
			if !ok {
				if unreadable[pid] {
					break
				}
				if p, ok = readProc(ctx, pid); !ok {
					unreadable[pid] = true
					break
				}
				procs[pid] = p
			}
			pid = p.Ppid
		}
	}
	return procs, nil
}

// readProc reads one process; false when it can't be opened. A field that fails to read stays empty.
func readProc(ctx context.Context, pid int32) (Proc, bool) {
	p, err := process.NewProcessWithContext(ctx, pid)
	if err != nil {
		return Proc{}, false
	}
	out := Proc{Pid: pid}
	out.Name, _ = p.NameWithContext(ctx)
	out.Cmdline, _ = p.CmdlineWithContext(ctx)
	out.Cwd, _ = p.CwdWithContext(ctx)
	out.CreateMs, _ = p.CreateTimeWithContext(ctx)
	out.Ppid, _ = p.PpidWithContext(ctx)
	return out, true
}

// Stop kills the server at pid and everything it started: the process and every descendant, deepest first and the
// listener last. createMs is the create time the listing showed; a PID the OS has since given to another process is
// refused. The listener's kill error is the result; an ancestor is never touched.
func Stop(ctx context.Context, pid int32, createMs int64) error {
	root, err := process.NewProcessWithContext(ctx, pid)
	if err != nil {
		return fmt.Errorf("process %d is not running", pid)
	}
	actual, err := root.CreateTimeWithContext(ctx)
	if err != nil {
		return fmt.Errorf("cannot read when process %d started: %w", pid, err)
	}
	if err := CheckStop(createMs, actual); err != nil {
		return err
	}
	tree := processTree(ctx, root)
	for i := len(tree) - 1; i > 0; i-- {
		_ = tree[i].KillWithContext(ctx)
	}
	return root.KillWithContext(ctx)
}

// processTree is root and every descendant in breadth-first order, so the reverse is deepest first. gopsutil lists
// only direct children. A process met twice is kept once: a reused PID can make a tree loop.
func processTree(ctx context.Context, root *process.Process) []*process.Process {
	tree := []*process.Process{root}
	seen := map[int32]bool{root.Pid: true}
	for i := 0; i < len(tree); i++ {
		children, err := tree[i].ChildrenWithContext(ctx)
		if err != nil {
			continue
		}
		for _, c := range children {
			if !seen[c.Pid] {
				seen[c.Pid] = true
				tree = append(tree, c)
			}
		}
	}
	return tree
}
