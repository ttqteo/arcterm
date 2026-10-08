// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package devservers

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/memusage"
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

// machineLister reads every listening process for ListAll. Between polls it keeps what it read of each process,
// keyed by pid and checked against the create time, so a steady poll reads only the TCP table, one process
// snapshot and each chain's create times. One read runs at a time; a call that arrives during it gets its result.
type machineLister struct {
	listeners func(context.Context) ([]Listener, error)
	table     func() (memusage.Table, error)
	createMs  func(context.Context, int32) (int64, bool)
	detail    func(context.Context, int32) (Proc, bool) // name, command line, cwd
	repos     *repoFinder

	mu       sync.Mutex
	inflight *machineFlight
	joined   int            // calls that have waited on a read in flight; the tests count them
	cache    map[int32]Proc // touched only by the read in flight
}

type machineSnapshot struct {
	ports map[int32][]int
	procs map[int32]Proc
	table memusage.Table
}

type machineFlight struct {
	done chan struct{}
	snap *machineSnapshot
	err  error
}

func (m *machineLister) joinedForTest() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.joined
}

func (m *machineLister) list(ctx context.Context, holders map[int32]ServerOwner) ([]Server, error) {
	snap, err := m.snapshot(ctx)
	if err != nil {
		return nil, err
	}
	alive := snap.table.Has
	out := []Server{}
	for pid, ports := range snap.ports {
		p, ok := snap.procs[pid]
		// a command line that can't be read is another user's or the system's; claude's IDE port is no server
		if !ok || p.Cmdline == "" || isClaudeProc(p.Name) {
			continue
		}
		owner, launcher := OwnerOf(pid, snap.procs, alive, holders)
		out = append(out, Server{
			Pid:             pid,
			CreateMs:        p.CreateMs,
			Ports:           sortedUnique(append([]int(nil), ports...)), // the snapshot is shared: sort a copy
			Name:            p.Name,
			Cmdline:         p.Cmdline,
			Cwd:             p.Cwd,
			LauncherCmdline: launcher,
			Repo:            m.repos.find(p.Cwd),
			Owner:           &owner,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Ports[0] != out[j].Ports[0] {
			return out[i].Ports[0] < out[j].Ports[0]
		}
		return out[i].Pid < out[j].Pid
	})
	return out, nil
}

func (m *machineLister) snapshot(ctx context.Context) (*machineSnapshot, error) {
	for {
		m.mu.Lock()
		f := m.inflight
		if f == nil {
			f = &machineFlight{done: make(chan struct{})}
			m.inflight = f
			m.mu.Unlock()
			m.run(ctx, f)
			return f.snap, f.err
		}
		m.joined++
		m.mu.Unlock()
		select {
		case <-f.done:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		// the call that was reading gave up (its context ended), which says nothing about this call's: read again
		if f.err != nil && ctx.Err() == nil && (errors.Is(f.err, context.Canceled) || errors.Is(f.err, context.DeadlineExceeded)) {
			continue
		}
		return f.snap, f.err
	}
}

// run is the one read in flight. Whatever happens in it, the flight ends, so a panic can't leave later calls waiting.
func (m *machineLister) run(ctx context.Context, f *machineFlight) {
	defer func() {
		if f.snap == nil && f.err == nil {
			f.err = errors.New("reading the machine's listening processes failed")
		}
		m.mu.Lock()
		m.inflight = nil
		m.mu.Unlock()
		close(f.done)
	}()
	f.snap, f.err = m.read(ctx)
}

func (m *machineLister) read(ctx context.Context) (*machineSnapshot, error) {
	ls, err := m.listeners(ctx)
	if err != nil {
		return nil, err
	}
	table, err := m.table()
	if err != nil {
		return nil, err
	}
	snap := &machineSnapshot{ports: map[int32][]int{}, procs: map[int32]Proc{}, table: table}
	for _, l := range ls {
		if l.Pid > 0 {
			snap.ports[l.Pid] = append(snap.ports[l.Pid], int(l.Port))
		}
	}
	for pid := range snap.ports {
		cur := pid
		for hops := 0; hops <= maxAncestorHops && cur > 0; hops++ {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			if _, done := snap.procs[cur]; done {
				break
			}
			ppid, ok := table.Parent(cur)
			if !ok {
				break
			}
			p, ok := m.proc(ctx, cur)
			if !ok {
				break
			}
			p.Ppid = ppid
			snap.procs[cur] = p
			if ppid == cur {
				break
			}
			cur = ppid
		}
	}
	// keep what this read saw; a pid that left the snapshot is forgotten
	next := make(map[int32]Proc, len(snap.procs))
	for pid, p := range snap.procs {
		next[pid] = p
	}
	m.cache = next
	return snap, nil
}

// proc is pid's details: the cached ones while its create time still matches, else a fresh read
func (m *machineLister) proc(ctx context.Context, pid int32) (Proc, bool) {
	ct, ok := m.createMs(ctx, pid)
	if !ok {
		return Proc{}, false
	}
	if c, hit := m.cache[pid]; hit && c.CreateMs == ct {
		return c, true
	}
	p, ok := m.detail(ctx, pid)
	if !ok {
		return Proc{}, false
	}
	p.Pid, p.CreateMs = pid, ct
	return p, true
}
