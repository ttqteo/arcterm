// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package devservers finds the processes listening in an agent's project, and stops one. The selection is pure
// (Select, CheckStop); devservers_os.go reads the OS.
package devservers

import (
	"errors"
	"sort"
	"strings"
)

// maxAncestorHops bounds the walk up a process's parents.
const maxAncestorHops = 32

// Proc is one process as a sweep read it.
type Proc struct {
	Pid      int32
	Ppid     int32
	Name     string
	Cmdline  string
	Cwd      string
	CreateMs int64
}

// Listener is one listening TCP socket.
type Listener struct {
	Pid  int32
	Port uint32
}

// Server is one listening process the rail lists. One PID on several ports is one Server.
type Server struct {
	Pid             int32  `json:"pid"`
	CreateMs        int64  `json:"createms"`
	Ports           []int  `json:"ports"`
	Name            string `json:"name"`
	Cmdline         string `json:"cmdline"`
	Cwd             string `json:"cwd"`
	ByAgent         bool   `json:"byagent"`
	LauncherCmdline string `json:"launchercmdline,omitempty"`
}

// Select picks the servers that belong to an agent: a listener whose cwd is inside root, or one that descends from
// agentPid (0: no agent process known). procs must hold every listener's process and its ancestors as far as they
// could be read.
func Select(root string, agentPid int32, procs map[int32]Proc, listeners []Listener) []Server {
	portsByPid := make(map[int32][]int)
	for _, l := range listeners {
		if l.Pid == 0 {
			continue
		}
		portsByPid[l.Pid] = append(portsByPid[l.Pid], int(l.Port))
	}
	out := []Server{}
	for pid, ports := range portsByPid {
		proc, ok := procs[pid]
		if !ok || pid == agentPid || isClaudeProc(proc.Name) {
			continue
		}
		byAgent, launcher := descendsFrom(agentPid, pid, procs)
		if !byAgent && !within(root, proc.Cwd) {
			continue
		}
		s := Server{
			Pid:      pid,
			CreateMs: proc.CreateMs,
			Ports:    sortedUnique(ports),
			Name:     proc.Name,
			Cmdline:  proc.Cmdline,
			Cwd:      proc.Cwd,
			ByAgent:  byAgent,
		}
		if byAgent {
			s.LauncherCmdline = launcher
		}
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Ports[0] != out[j].Ports[0] {
			return out[i].Ports[0] < out[j].Ports[0]
		}
		return out[i].Pid < out[j].Pid
	})
	return out
}

// descendsFrom reports whether agentPid is among pid's ancestors, and the command line of the ancestor (or pid
// itself) that agentPid started. The chain stops at a PID procs lacks, at PID 0, at a repeat and after
// maxAncestorHops.
func descendsFrom(agentPid, pid int32, procs map[int32]Proc) (bool, string) {
	if agentPid == 0 {
		return false, ""
	}
	seen := map[int32]bool{}
	cur := pid
	launcher := ""
	for hops := 0; hops <= maxAncestorHops; hops++ {
		p, ok := procs[cur]
		if !ok || cur == 0 || seen[cur] {
			return false, ""
		}
		seen[cur] = true
		if cur == agentPid {
			return true, launcher
		}
		if p.Ppid == agentPid {
			launcher = p.Cmdline
		}
		cur = p.Ppid
	}
	return false, ""
}

// within reports whether cwd is root or inside it. Paths compare with \ as /, no trailing /, and case folded:
// the Windows and macOS filesystems are case-insensitive.
func within(root, cwd string) bool {
	if root == "" || cwd == "" {
		return false
	}
	r, c := normalizePath(root), normalizePath(cwd)
	return c == r || strings.HasPrefix(c, r+"/")
}

func normalizePath(p string) string {
	return strings.ToLower(strings.TrimRight(strings.ReplaceAll(p, "\\", "/"), "/"))
}

// isClaudeProc reports whether name is the Claude Code binary, which may listen for IDE integration and is never a
// dev server.
func isClaudeProc(name string) bool {
	name = strings.ToLower(name)
	return name == "claude" || name == "claude.exe"
}

func sortedUnique(ports []int) []int {
	sort.Ints(ports)
	out := ports[:0]
	for i, p := range ports {
		if i == 0 || p != ports[i-1] {
			out = append(out, p)
		}
	}
	return out
}

// CheckStop guards a stop against a reused PID: the process must still be the one that was listed.
func CheckStop(listedCreateMs, actualCreateMs int64) error {
	if listedCreateMs != actualCreateMs {
		return errors.New("the process is no longer the server that was listed (its PID was reused)")
	}
	return nil
}
