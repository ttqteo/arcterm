// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package devservers

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// ServerOwner kinds: an arcterm agent's or terminal's block, another running app, or a chain that broke.
const (
	OwnerAgent    = "agent"
	OwnerTerminal = "terminal"
	OwnerApp      = "app"
	OwnerDetached = "detached"
)

// ServerOwner is what holds a listening process (docs/superpowers/specs/2026-10-08-machine-servers-design.md).
type ServerOwner struct {
	Kind    string `json:"kind"`
	BlockId string `json:"blockid,omitempty"`
	TabId   string `json:"tabid,omitempty"`
	Name    string `json:"name,omitempty"` // the tab's name for an agent or terminal, the exe for an app
	Harness string `json:"harness,omitempty"`
}

// sessionRoots start apps rather than run them: a chain that reaches one intact belongs to the process below it
var sessionRoots = map[string]bool{
	"explorer.exe": true, "services.exe": true, "svchost.exe": true, "wininit.exe": true, "winlogon.exe": true,
	"sihost.exe": true, "launchd": true, "systemd": true, "init": true,
}

// OwnerOf walks pid's parents and names what holds it. procs is what was read of the listener and its ancestors,
// alive whether a pid was in the snapshot, holders the arcterm blocks' shell pids. The launcher it returns is, for
// an agent, the command line of the process the nearest claude started (what a background task ran); for a detached
// chain, the command line of its highest ancestor still alive; otherwise "".
func OwnerOf(pid int32, procs map[int32]Proc, alive func(int32) bool, holders map[int32]ServerOwner) (ServerOwner, string) {
	seen := map[int32]bool{}
	var below Proc    // the chain's process under cur
	launcher := ""    // the highest live ancestor's command line
	underClaude := "" // the command line of the process the nearest claude started
	app := func() (ServerOwner, string) { return ServerOwner{Kind: OwnerApp, Name: below.Name}, "" }
	cur := pid
	for hops := 0; hops <= maxAncestorHops; hops++ {
		if h, ok := holders[cur]; ok {
			if h.Kind == OwnerAgent {
				return h, underClaude
			}
			return h, ""
		}
		if cur == 0 || seen[cur] {
			return app()
		}
		seen[cur] = true
		if !alive(cur) {
			return ServerOwner{Kind: OwnerDetached}, launcher
		}
		p, ok := procs[cur]
		if !ok {
			// running but unreadable: the system or another user started what is below it
			return app()
		}
		if cur != pid {
			if p.CreateMs > 0 && below.CreateMs > 0 && p.CreateMs > below.CreateMs {
				// a parent newer than its child holds a reused pid: the real parent is gone
				return ServerOwner{Kind: OwnerDetached}, launcher
			}
			if sessionRoots[strings.ToLower(p.Name)] {
				return app()
			}
			if isClaudeProc(p.Name) && underClaude == "" {
				underClaude = below.Cmdline
			}
		}
		launcher = p.Cmdline
		below = p
		if p.Ppid == cur {
			return app()
		}
		cur = p.Ppid
	}
	return app()
}

// repoFinderMax bounds the cache; past it the cache starts over
const repoFinderMax = 4096

// repoFinder answers which git repo holds a directory: the nearest directory at or above it with a .git entry (a
// directory, or the file a worktree has). Every directory it walked is cached with its answer.
type repoFinder struct {
	mu    sync.Mutex
	cache map[string]string
}

func newRepoFinder() *repoFinder { return &repoFinder{cache: map[string]string{}} }

func (f *repoFinder) find(dir string) string {
	if dir == "" {
		return ""
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.cache) > repoFinderMax {
		f.cache = map[string]string{}
	}
	var walked []string
	repo := ""
	for d := filepath.Clean(dir); ; {
		if r, ok := f.cache[d]; ok {
			repo = r
			break
		}
		walked = append(walked, d)
		if _, err := os.Stat(filepath.Join(d, ".git")); err == nil {
			repo = d
			break
		}
		parent := filepath.Dir(d)
		if parent == d {
			break
		}
		d = parent
	}
	for _, d := range walked {
		f.cache[d] = repo
	}
	return repo
}
