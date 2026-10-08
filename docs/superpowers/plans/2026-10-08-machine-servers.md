# Servers on this machine — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (or executing-plans) to implement this plan task-by-task.

**Goal:** A footer chip and popover listing every listening process on the machine, grouped by git repo, each with a badge naming what owns it (an agent, a terminal, an app, or nothing), with Open / Log / Copy / Stop.

**Spec:** `docs/superpowers/specs/2026-10-08-machine-servers-design.md` — read it first.

**Architecture:** `pkg/devservers` gains a pure owner walk (`OwnerOf`), a repo finder, and a `machineLister` that reads the TCP table plus one process snapshot per poll, caches process details by (pid, create time) and shares one read between concurrent callers. A new RPC `ListAllDevServersCommand` feeds it the arcterm blocks' shell pids. The frontend has a pure model (`machineservers.ts`) that groups rows and resolves detached rows against agents' running background tasks, a poll store, a chip in `FooterStatus` and a popover mounted beside `ConsumersPanel`.

**Tech Stack:** Go (gopsutil v4, `pkg/memusage`), wshrpc + `task generate`, React 19 + jotai + Tailwind 4, vitest, CDP scenarios.

**Verify:** `node scripts/verify.mjs ./pkg/devservers ./pkg/memusage ./pkg/wshrpc/...`

**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: machine-servers needs CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs machine-servers`

Conventions for every task: work on `main`; commit only the files the task names (`git commit -- <paths>`; other sessions have uncommitted work in this tree); no `Co-Authored-By` trailer; check formatting only on touched files (`gofmt -l <files>`, `npx prettier --check <files>`; never `--write` a file whose HEAD was already unformatted, and never prettier `scripts/*.mjs`); colors only from `@theme` tokens.

---

### Task 1: `memusage.Table.Parent`

**Depends on:** none

**Files:**
- Modify: `pkg/memusage/memusage.go` (after `Has`)
- Test: `pkg/memusage/memusage_test.go`

**Step 1: failing test** — append to `memusage_test.go`:

```go
func TestTableParent(t *testing.T) {
	tb := NewTable(map[int32]int32{1: 0, 5: 1})
	if p, ok := tb.Parent(5); !ok || p != 1 {
		t.Fatalf("Parent(5) = %d, %v; want 1, true", p, ok)
	}
	if _, ok := tb.Parent(9); ok {
		t.Fatal("Parent(9) found a pid that was not running")
	}
}
```

**Step 2:** `go test ./pkg/memusage -run '^TestTableParent$'` → FAIL (`tb.Parent undefined`).

**Step 3:** add to `memusage.go` below `Has`:

```go
// Parent is pid's parent; false when pid was not running when the table was read.
func (t Table) Parent(pid int32) (int32, bool) {
	p, ok := t.parent[pid]
	return p, ok
}
```

**Step 4:** rerun → PASS. **Step 5:** commit `pkg/memusage/memusage.go pkg/memusage/memusage_test.go` — `feat(memusage): Table.Parent`.

---

### Task 2: owner walk and repo finder (pure)

**Depends on:** none

**Files:**
- Modify: `pkg/devservers/devservers.go` (the `Server` struct)
- Create: `pkg/devservers/machine.go`
- Test: `pkg/devservers/machine_test.go`

**Step 1: extend `Server`** — add two fields at the end of the struct (List leaves them empty, so the rail is unchanged):

```go
	Repo  string       `json:"repo,omitempty"`  // ListAll: the git repo holding Cwd
	Owner *ServerOwner `json:"owner,omitempty"` // ListAll: what holds the process
```

**Step 2: failing tests** — create `machine_test.go`. `procMap` already exists in `devservers_test.go`.

```go
package devservers

import (
	"os"
	"path/filepath"
	"testing"
)

func aliveIn(pids ...int32) func(int32) bool {
	set := map[int32]bool{}
	for _, p := range pids {
		set[p] = true
	}
	return func(p int32) bool { return set[p] }
}

// the 2026-10-08 :8100 chain: python <- uvicorn <- bash (Claude's wrapper) <- claude.exe <- powershell (the block's shell)
func TestOwnerOfAgentThroughItsShell(t *testing.T) {
	procs := procMap(
		Proc{Pid: 50, Ppid: 40, Name: "python.exe", Cmdline: "python -m uvicorn app.main:app", CreateMs: 900},
		Proc{Pid: 40, Ppid: 30, Name: "bash.exe", Cmdline: `bash -c "uv run uvicorn app.main:app --port 8100"`, CreateMs: 800},
		Proc{Pid: 30, Ppid: 20, Name: "claude.exe", Cmdline: "claude", CreateMs: 700},
		Proc{Pid: 20, Ppid: 10, Name: "powershell.exe", Cmdline: "powershell", CreateMs: 600},
	)
	holders := map[int32]ServerOwner{20: {Kind: OwnerAgent, BlockId: "b1", TabId: "t1", Name: "portal", Harness: "claude"}}
	o, launcher := OwnerOf(50, procs, aliveIn(50, 40, 30, 20, 10), holders)
	if o.Kind != OwnerAgent || o.TabId != "t1" {
		t.Fatalf("owner = %+v; want the agent", o)
	}
	if launcher != `bash -c "uv run uvicorn app.main:app --port 8100"` {
		t.Fatalf("launcher = %q; want the process claude started", launcher)
	}
}

func TestOwnerOfTerminal(t *testing.T) {
	procs := procMap(
		Proc{Pid: 50, Ppid: 20, Name: "node.exe", Cmdline: "node vite", CreateMs: 900},
		Proc{Pid: 20, Ppid: 10, Name: "pwsh.exe", Cmdline: "pwsh", CreateMs: 600},
	)
	holders := map[int32]ServerOwner{20: {Kind: OwnerTerminal, TabId: "t2", Name: "dev"}}
	if o, l := OwnerOf(50, procs, aliveIn(50, 20, 10), holders); o.Kind != OwnerTerminal || o.TabId != "t2" || l != "" {
		t.Fatalf("owner = %+v, %q; want the terminal and no launcher", o, l)
	}
}

func TestOwnerOfAppIsTheHighestBelowTheSessionRoot(t *testing.T) {
	procs := procMap(
		Proc{Pid: 50, Ppid: 40, Name: "Code.exe", Cmdline: "Code.exe --type=utility", CreateMs: 900},
		Proc{Pid: 40, Ppid: 4, Name: "Code.exe", Cmdline: "Code.exe", CreateMs: 800},
		Proc{Pid: 4, Ppid: 1, Name: "explorer.exe", Cmdline: "explorer.exe", CreateMs: 100},
	)
	if o, l := OwnerOf(50, procs, aliveIn(50, 40, 4, 1), nil); o.Kind != OwnerApp || o.Name != "Code.exe" || l != "" {
		t.Fatalf("owner = %+v, %q; want app Code.exe", o, l)
	}
}

// a parent that is running but could not be read (the system's) started an app
func TestOwnerOfUnreadableLiveParentIsAnApp(t *testing.T) {
	procs := procMap(Proc{Pid: 50, Ppid: 9, Name: "com.docker.backend.exe", Cmdline: "com.docker.backend services", CreateMs: 900})
	if o, _ := OwnerOf(50, procs, aliveIn(50, 9), nil); o.Kind != OwnerApp || o.Name != "com.docker.backend.exe" {
		t.Fatalf("owner = %+v; want app com.docker.backend.exe", o)
	}
}

// the 2026-10-08 :4310 chain: Claude's wrapper exited, sh -> pnpm -> node lives on
func TestOwnerOfDetachedWhenAParentIsGone(t *testing.T) {
	sh := `"C:\Program Files\Git\usr\bin\sh.exe" /c/nvm4w/nodejs/pnpm run start`
	procs := procMap(
		Proc{Pid: 50, Ppid: 40, Name: "node.exe", Cmdline: "node ./dist/server/entry.mjs", CreateMs: 900},
		Proc{Pid: 40, Ppid: 30, Name: "sh.exe", Cmdline: sh, CreateMs: 800},
	)
	o, launcher := OwnerOf(50, procs, aliveIn(50, 40), nil)
	if o.Kind != OwnerDetached || launcher != sh {
		t.Fatalf("owner = %+v, %q; want detached with the sh launcher", o, launcher)
	}
}

func TestOwnerOfDetachedWhenTheParentPidWasReused(t *testing.T) {
	procs := procMap(
		Proc{Pid: 50, Ppid: 40, Name: "node.exe", Cmdline: "node astro dev", CreateMs: 900},
		Proc{Pid: 40, Ppid: 4, Name: "notepad.exe", Cmdline: "notepad", CreateMs: 5000}, // newer than its "child"
	)
	if o, l := OwnerOf(50, procs, aliveIn(50, 40, 4), nil); o.Kind != OwnerDetached || l != "node astro dev" {
		t.Fatalf("owner = %+v, %q; want detached, launcher the listener itself", o, l)
	}
}

func TestRepoFinder(t *testing.T) {
	root := t.TempDir()
	repo := filepath.Join(root, "repo")
	wt := filepath.Join(root, "wt")
	for _, d := range []string{filepath.Join(repo, ".git"), filepath.Join(repo, "web", "src"), filepath.Join(wt, "api"), filepath.Join(root, "plain")} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(wt, ".git"), []byte("gitdir: x"), 0o644); err != nil {
		t.Fatal(err)
	}
	f := newRepoFinder()
	if got := f.find(filepath.Join(repo, "web", "src")); got != repo {
		t.Fatalf("find(repo/web/src) = %q; want %q", got, repo)
	}
	if got := f.find(filepath.Join(wt, "api")); got != wt {
		t.Fatalf("find(worktree/api) = %q; want %q (a .git file counts)", got, wt)
	}
	if got := f.find(filepath.Join(root, "plain")); got != "" {
		t.Fatalf("find(plain) = %q; want none", got)
	}
	if got := f.find(""); got != "" {
		t.Fatalf("find(\"\") = %q; want none", got)
	}
}
```

**Step 3:** `go test ./pkg/devservers -run 'OwnerOf|RepoFinder'` → FAIL (undefined).

**Step 4: implement** `machine.go`:

```go
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
	var below Proc   // the chain's process under cur
	launcher := ""   // the highest live ancestor's command line
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
```

**Step 5:** rerun the tests → PASS; also `go test ./pkg/devservers` (the existing `Select` tests still pass). `gofmt -l pkg/devservers`.

**Step 6:** commit `pkg/devservers/devservers.go pkg/devservers/machine.go pkg/devservers/machine_test.go` — `feat(devservers): who owns a listening process, and which repo holds it`.

---

### Task 3: `machineLister` — cache and single-flight; `ListAll`

**Depends on:** Task 1, Task 2

**Files:**
- Modify: `pkg/devservers/machine.go` (append)
- Modify: `pkg/devservers/devservers_os.go` (extract `readListeners`, add `ListAll`)
- Test: `pkg/devservers/machine_test.go` (append)

**Step 1: failing tests** — append (add imports `context`, `sync`, `sync/atomic`, and `github.com/wavetermdev/waveterm/pkg/memusage`):

```go
type fakeOS struct {
	listeners []Listener
	parents   map[int32]int32
	procs     map[int32]Proc
	details   atomic.Int32 // detail reads
	gate      chan struct{} // when set, listeners() waits on it
}

func (f *fakeOS) lister() *machineLister {
	return &machineLister{
		listeners: func(ctx context.Context) ([]Listener, error) {
			if f.gate != nil {
				<-f.gate
			}
			return f.listeners, nil
		},
		table: func() (memusage.Table, error) { return memusage.NewTable(f.parents), nil },
		createMs: func(_ context.Context, pid int32) (int64, bool) {
			p, ok := f.procs[pid]
			return p.CreateMs, ok
		},
		detail: func(_ context.Context, pid int32) (Proc, bool) {
			f.details.Add(1)
			p, ok := f.procs[pid]
			return p, ok
		},
		repos: newRepoFinder(),
	}
}

func machineFixture() *fakeOS {
	return &fakeOS{
		listeners: []Listener{{Pid: 50, Port: 4321}, {Pid: 50, Port: 4321}, {Pid: 60, Port: 135}},
		parents:   map[int32]int32{50: 40, 40: 4, 4: 1, 60: 1},
		procs: map[int32]Proc{
			50: {Pid: 50, Name: "node.exe", Cmdline: "node astro dev", Cwd: "", CreateMs: 900},
			40: {Pid: 40, Name: "sh.exe", Cmdline: "sh pnpm dev", CreateMs: 800},
			4:  {Pid: 4, Name: "explorer.exe", Cmdline: "explorer.exe", CreateMs: 100},
			60: {Pid: 60, Name: "svchost.exe", CreateMs: 50}, // its command line can't be read
		},
	}
}

func TestListAllListsReadableListenersOnce(t *testing.T) {
	f := machineFixture()
	got, err := f.lister().list(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Pid != 50 || len(got[0].Ports) != 1 || got[0].Owner == nil || got[0].Owner.Kind != OwnerApp {
		t.Fatalf("got %+v; want only node, one port, owned by the app below explorer", got)
	}
}

func TestListAllReadsAProcessOnceAndDropsGonePids(t *testing.T) {
	f := machineFixture()
	m := f.lister()
	if _, err := m.list(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	first := f.details.Load()
	if _, err := m.list(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	if f.details.Load() != first {
		t.Fatalf("second poll read %d details; want 0 (cached by pid and create time)", f.details.Load()-first)
	}
	// pid 40 exits and its pid comes back as another process: read again, and the old entry is gone
	f.procs[40] = Proc{Pid: 40, Name: "notepad.exe", Cmdline: "notepad", CreateMs: 5000}
	if got, _ := m.list(context.Background(), nil); got[0].Owner.Kind != OwnerDetached {
		t.Fatalf("owner = %+v; want detached after the parent pid was reused", got[0].Owner)
	}
	delete(f.parents, 40)
	delete(f.procs, 40)
	m.list(context.Background(), nil)
	if _, kept := m.cache[40]; kept {
		t.Fatal("cache kept a pid that left the snapshot")
	}
}

func TestListAllSharesOneReadBetweenConcurrentCalls(t *testing.T) {
	f := machineFixture()
	f.gate = make(chan struct{})
	m := f.lister()
	var reads atomic.Int32
	inner := m.listeners
	m.listeners = func(ctx context.Context) ([]Listener, error) {
		reads.Add(1)
		return inner(ctx)
	}
	var wg sync.WaitGroup
	for i := 0; i < 3; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); m.list(context.Background(), nil) }()
	}
	for m.inflightForTest() == nil {
	}
	close(f.gate)
	wg.Wait()
	if reads.Load() != 1 {
		t.Fatalf("%d reads for three concurrent calls; want 1", reads.Load())
	}
}
```

Note: `TestListAllSharesOneReadBetweenConcurrentCalls` may let a late goroutine start a second read after the first finished; if it flakes, have each goroutine signal before calling and wait for all three to be blocked on the flight (e.g. count waiters in the lister behind a test hook) rather than loosening the assertion.

**Step 2:** `go test ./pkg/devservers -run ListAll` → FAIL.

**Step 3: implement** — append to `machine.go` (imports `context`, `sort`, `memusage`):

```go
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

func (m *machineLister) inflightForTest() *machineFlight {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.inflight
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
	m.mu.Lock()
	if f := m.inflight; f != nil {
		m.mu.Unlock()
		select {
		case <-f.done:
			return f.snap, f.err
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	f := &machineFlight{done: make(chan struct{})}
	m.inflight = f
	m.mu.Unlock()
	f.snap, f.err = m.read(ctx)
	m.mu.Lock()
	m.inflight = nil
	m.mu.Unlock()
	close(f.done)
	return f.snap, f.err
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
```

Then in `devservers_os.go`: move the TCP loop at the top of `List` into

```go
// readListeners is every listening TCP socket with a known pid.
func readListeners(ctx context.Context) ([]Listener, error) {
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
	return listeners, nil
}
```

and have `List` call it. Add:

```go
// machine is ListAll's reader; it keeps its cache between polls
var machine = &machineLister{
	listeners: readListeners,
	table:     memusage.ReadTable,
	createMs: func(ctx context.Context, pid int32) (int64, bool) {
		ct, err := (&process.Process{Pid: pid}).CreateTimeWithContext(ctx)
		return ct, err == nil
	},
	detail: func(ctx context.Context, pid int32) (Proc, bool) {
		p := &process.Process{Pid: pid}
		name, err := p.NameWithContext(ctx)
		if err != nil {
			return Proc{}, false
		}
		out := Proc{Pid: pid, Name: name}
		out.Cmdline, _ = p.CmdlineWithContext(ctx)
		out.Cwd, _ = p.CwdWithContext(ctx)
		return out, true
	},
	repos: newRepoFinder(),
}

// ListAll is every listening process the account can read, with its repo and owner. holders maps arcterm blocks'
// shell pids to their blocks.
func ListAll(ctx context.Context, holders map[int32]ServerOwner) ([]Server, error) {
	return machine.list(ctx, holders)
}
```

(`&process.Process{Pid: pid}` skips gopsutil's existence check, which on Windows costs a snapshot per call; the parent comes from the one toolhelp snapshot, never `Ppid`.)

**Step 4:** `go test ./pkg/devservers -race` → PASS. `gofmt -l pkg/devservers`.

**Step 5:** commit the three files — `feat(devservers): ListAll reads every listener, cached by pid and create time, one read at a time`.

---

### Task 4: RPC `ListAllDevServersCommand`

**Depends on:** Task 3

**Files:**
- Modify: `pkg/wshrpc/wshrpctypes_devservers.go`
- Modify: `pkg/wshrpc/wshserver/wshserver_devservers.go`
- Test: `pkg/wshrpc/wshserver/wshserver_devservers_test.go` (create)
- Generated (by `task generate`, never by hand): `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `pkg/wshrpc/wshclient/wshclient.go`

**Step 1:** add to the `DevServerCommands` interface:

```go
	// ListAllDevServersCommand is every listening process on the machine with its repo and owner (the footer's Servers)
	ListAllDevServersCommand(ctx context.Context) (*CommandListDevServersRtnData, error)
```

**Step 2: failing test** — `wshserver_devservers_test.go` scripts `loadAgentRosterFacts` and `consumerBlockPid` (both are vars; see `wshserver_agentmsg_test.go`'s `agentFacts` helper for building `agentTabFacts`):

```go
func TestMachineHoldersNamesAgentsAndTerminals(t *testing.T) {
	agent := agentFacts("tab-a", "portal", "blk-a", "claude", "working")
	term := agentFacts("tab-t", "dev", "blk-t", "", "")
	stopped := agentFacts("tab-s", "old", "blk-s", "", "")
	stopped.ShellRunning = false
	restoreFacts := loadAgentRosterFacts
	restorePid := consumerBlockPid
	t.Cleanup(func() { loadAgentRosterFacts = restoreFacts; consumerBlockPid = restorePid })
	loadAgentRosterFacts = func(context.Context) (*agentRosterFacts, error) {
		return &agentRosterFacts{Tabs: []agentTabFacts{agent, term, stopped}}, nil
	}
	consumerBlockPid = func(blockId string) int { return map[string]int{"blk-a": 20, "blk-t": 30, "blk-s": 40}[blockId] }
	holders, err := readMachineHolders(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if h := holders[20]; h.Kind != devservers.OwnerAgent || h.TabId != "tab-a" || h.Name != "portal" || h.Harness != "claude" {
		t.Fatalf("holders[20] = %+v; want the claude agent", h)
	}
	if h := holders[30]; h.Kind != devservers.OwnerTerminal || h.TabId != "tab-t" || h.Name != "dev" {
		t.Fatalf("holders[30] = %+v; want the terminal", h)
	}
	if _, ok := holders[40]; ok {
		t.Fatal("a tab whose shell stopped holds nothing")
	}
}
```

Check `agentFacts`'s signature and whether it sets `ShellRunning: true`; adapt the fixture to it rather than changing the helper.

**Step 3:** `go test ./pkg/wshrpc/wshserver -run '^TestMachineHolders'` → FAIL.

**Step 4: implement** in `wshserver_devservers.go` (add `log` import):

```go
// machineHolders is the arcterm blocks that can hold a server, by shell pid. A var so tests need no store.
var machineHolders = readMachineHolders

func readMachineHolders(ctx context.Context) (map[int32]devservers.ServerOwner, error) {
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return nil, err
	}
	agents := map[string]agentRow{}
	for _, r := range buildAgentRoster(facts) {
		agents[r.blockId] = r
	}
	holders := map[int32]devservers.ServerOwner{}
	for _, tf := range facts.Tabs {
		if !tf.ShellRunning {
			continue
		}
		pid := consumerBlockPid(tf.BlockId)
		if pid <= 0 {
			continue
		}
		o := devservers.ServerOwner{Kind: devservers.OwnerTerminal, BlockId: tf.BlockId, TabId: tf.Tab.OID, Name: tf.Tab.Name}
		if r, ok := agents[tf.BlockId]; ok {
			o.Kind, o.Harness = devservers.OwnerAgent, r.Harness
		}
		holders[int32(pid)] = o
	}
	return holders, nil
}

func (ws *WshServer) ListAllDevServersCommand(ctx context.Context) (*wshrpc.CommandListDevServersRtnData, error) {
	holders, err := machineHolders(ctx)
	if err != nil {
		// without the roster every server still lists, owned by an app or detached
		log.Printf("devservers: reading arcterm's blocks: %v", err)
	}
	servers, err := devservers.ListAll(ctx, holders)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandListDevServersRtnData{Servers: servers}, nil
}
```

**Step 5:** `task generate`, then confirm `RpcApi.ListAllDevServersCommand` exists in `frontend/app/store/wshclientapi.ts` (command string `listalldevservers`) and `ServerOwner` / `Server.owner` / `Server.repo` in `frontend/types/gotypes.d.ts`. `go build ./...`; `go test ./pkg/wshrpc/wshserver -run '^TestMachineHolders'` → PASS.

**Step 6:** commit the two Go files, the test and the generated files — `feat(wshrpc): ListAllDevServers, every listener on the machine with its owner`.

---

### Task 5: frontend model `machineservers.ts`

**Depends on:** none (types are local; Task 4 only adds the RPC)

**Files:**
- Modify: `frontend/app/view/agents/devserversmodel.ts` (row type; export a launcher matcher)
- Create: `frontend/app/view/agents/machineservers.ts`
- Test: `frontend/app/view/agents/machineservers.test.ts`, `frontend/app/view/agents/devserversmodel.test.ts` (unchanged; must still pass)

**Step 1:** in `devserversmodel.ts`, extend `DevServerRow` and split `matchLogTask`:

```ts
// the JSON shape of the Go devservers.ServerOwner
export interface DevServerOwner {
    kind: "agent" | "terminal" | "app" | "detached";
    blockid?: string;
    tabid?: string;
    name?: string;
    harness?: string;
}
```

add to `DevServerRow`: `repo?: string; owner?: DevServerOwner;`. Replace the body of `matchLogTask` so it delegates:

```ts
// The running background task whose command a launcher command line holds: the task that started that process.
export function matchLauncherTask<T extends { command?: string; status: string; outputFile?: string }>(
    launcherCmdline: string | undefined,
    tasks: T[]
): T | undefined {
    if (!launcherCmdline) {
        return undefined;
    }
    const launcher = normalizeCommand(launcherCmdline);
    return tasks.find((t) => {
        if (t.status !== "running" || !t.outputFile || !t.command) {
            return false;
        }
        const cmd = normalizeCommand(t.command);
        return cmd !== "" && launcher.includes(cmd);
    });
}

export function matchLogTask<T extends { command?: string; status: string; outputFile?: string }>(
    row: DevServerRow,
    tasks: T[]
): T | undefined {
    return row.byagent ? matchLauncherTask(row.launchercmdline, tasks) : undefined;
}
```

(keep `matchLogTask`'s existing doc comment). Run `npx vitest run frontend/app/view/agents/devserversmodel.test.ts` → PASS.

**Step 2: failing tests** — `machineservers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { DevServerRow } from "./devserversmodel";
import { buildMachineServers, machinePollMs } from "./machineservers";
import type { BackgroundTask } from "./transcriptprojection";

const row = (o: Partial<DevServerRow>): DevServerRow => ({
    pid: 1,
    createms: 1,
    ports: [3000],
    name: "node.exe",
    cmdline: "node server.js",
    cwd: "",
    byagent: false,
    ...o,
});
const agents = [
    { id: "tab-p", name: "portal", agent: "claude" },
    { id: "tab-t", name: "dev", kind: "terminal" as const },
];
const pnpmTask: BackgroundTask = {
    toolUseId: "u1",
    label: "Restart built portal on 4310",
    command: "pnpm run start",
    status: "running",
    outputFile: "C:\\tmp\\bp9.output",
};

describe("buildMachineServers", () => {
    const astro = row({ pid: 29308, ports: [4321], cmdline: "node astro.mjs dev --port 4321", repo: "D:\\Workspace\\SIEM\\apps\\website", owner: { kind: "detached" }, launchercmdline: "sh /c/nvm4w/nodejs/pnpm dev --port 4321" });
    const portal = row({ pid: 456720, ports: [4310], cmdline: "node ./dist/server/entry.mjs", repo: "D:\\Workspace\\SIEM\\apps\\portal", owner: { kind: "detached" }, launchercmdline: '"C:\\Program Files\\Git\\usr\\bin\\sh.exe" /c/nvm4w/nodejs/pnpm run start' });
    const uvicorn = row({ pid: 291124, ports: [8100], cmdline: "python -m uvicorn app.main:app", repo: "D:\\Workspace\\SIEM\\apps\\portal", owner: { kind: "agent", tabid: "tab-p", name: "portal", harness: "claude" } });
    const vite = row({ pid: 456180, ports: [5174], cmdline: "node vite", repo: "D:\\work\\arcterm", owner: { kind: "terminal", tabid: "tab-t", name: "dev" } });
    const code = row({ pid: 41656, ports: [58921], name: "Code.exe", cmdline: "Code.exe", owner: { kind: "app", name: "Code.exe" } });
    const docker = row({ pid: 32444, ports: [5432], name: "com.docker.backend.exe", cmdline: "com.docker.backend services", owner: { kind: "app", name: "com.docker.backend.exe" } });

    it("a detached server a running background task launched belongs to that agent, with its log", () => {
        const v = buildMachineServers([portal], agents, { "tab-p": [pnpmTask] });
        const r = v.groups[0].rows[0];
        expect(r.badge).toEqual({ kind: "agent", text: "claude · portal", tabId: "tab-p" });
        expect(r.log).toEqual({ agentId: "tab-p", task: pnpmTask });
        expect(v.noOwnerCount).toBe(0);
    });

    it("a detached server no running task matches has no owner", () => {
        const v = buildMachineServers([portal], agents, { "tab-p": [{ ...pnpmTask, status: "stopped" }] });
        expect(v.groups[0].rows[0].badge).toEqual({ kind: "noowner", text: "no owner" });
        expect(v.noOwnerCount).toBe(1);
    });

    it("groups by repo, no-owner groups first, then by name; the rest go to Other", () => {
        const v = buildMachineServers([vite, uvicorn, astro, code, docker], agents, {});
        expect(v.groups.map((g) => g.title)).toEqual(["SIEM/apps/website", "SIEM/apps/portal", "work/arcterm"]);
        expect(v.repoCount).toBe(3);
        expect(v.other.map((r) => r.server.pid)).toEqual([41656, 32444]);
        expect(v.otherNames).toBe("Code, com.docker.backend");
    });

    it("badges an agent, a terminal and an app", () => {
        const v = buildMachineServers([uvicorn, vite, code], agents, {});
        const byPid = Object.fromEntries([...v.groups.flatMap((g) => g.rows), ...v.other].map((r) => [r.server.pid, r]));
        expect(byPid[291124].badge).toEqual({ kind: "agent", text: "claude · portal", tabId: "tab-p" });
        expect(byPid[456180].badge).toEqual({ kind: "terminal", text: "terminal · dev", tabId: "tab-t" });
        expect(byPid[41656].badge).toEqual({ kind: "app", text: "Code" });
    });

    it("Stop on an app's server names the app", () => {
        const v = buildMachineServers([code, uvicorn], agents, {});
        expect(v.other[0].stopConfirm).toBe("Stop Code?");
        expect(v.groups[0].rows[0].stopConfirm).toBe("Stop?");
    });

    it("an agent's server shows Log only when its launcher matches a running task", () => {
        const launched = { ...uvicorn, launchercmdline: 'bash -c "pnpm run start"' };
        expect(buildMachineServers([launched], agents, { "tab-p": [pnpmTask] }).groups[0].rows[0].log?.task).toBe(pnpmTask);
        expect(buildMachineServers([uvicorn], agents, { "tab-p": [pnpmTask] }).groups[0].rows[0].log).toBeUndefined();
    });
});

describe("machinePollMs", () => {
    it("polls fast while the popover is open", () => {
        expect(machinePollMs(true)).toBe(3000);
        expect(machinePollMs(false)).toBe(15000);
    });
});
```

**Step 3:** `npx vitest run frontend/app/view/agents/machineservers.test.ts` → FAIL.

**Step 4: implement** `machineservers.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The footer's Servers popover as pure functions (docs/superpowers/specs/2026-10-08-machine-servers-design.md): every
// listening process grouped by repo, each row's owner badge, the log a background task wrote for it, its Stop
// confirm, and the chip's counts. machineserversstore.ts polls; machineserverspanel.tsx draws.

import { matchLauncherTask, serverLabel, type DevServerRow } from "./devserversmodel";
import type { BackgroundTask } from "./transcriptprojection";

export type BadgeKind = "agent" | "terminal" | "app" | "noowner";

export interface MachineBadge {
    kind: BadgeKind;
    text: string;
    tabId?: string; // an agent's or terminal's tab, which a click opens
}

export interface MachineRow {
    key: string; // pid:createms
    server: DevServerRow;
    label: string;
    badge: MachineBadge;
    log?: { agentId: string; task: BackgroundTask };
    stopConfirm: string;
}

export interface MachineGroup {
    repo: string;
    title: string;
    rows: MachineRow[];
}

export interface MachineView {
    groups: MachineGroup[];
    other: MachineRow[];
    otherNames: string; // "Code, com.docker.backend"
    repoCount: number; // the chip's number: servers inside a repo
    noOwnerCount: number;
}

// what the model needs of a roster entry (AgentVM fits)
export interface MachineAgent {
    id: string; // tab id
    name: string;
    agent?: string; // harness
    kind?: "agent" | "terminal" | "background";
}

const NO_OWNER: MachineBadge = { kind: "noowner", text: "no owner" };

// "D:\Workspace\SIEM\apps\portal" -> "SIEM/apps/portal": the last three segments
export function repoTitle(repo: string): string {
    return repo.split(/[\\/]/).filter((s) => s !== "").slice(-3).join("/");
}

function exeName(name: string | undefined): string {
    return (name ?? "").replace(/\.exe$/i, "");
}

function resolveRow(s: DevServerRow, agents: MachineAgent[], bgTasks: Record<string, BackgroundTask[]>): MachineRow {
    const base = { key: `${s.pid}:${s.createms}`, server: s, label: serverLabel(s), stopConfirm: "Stop?" };
    const agentBadge = (tabId: string, fallback?: string, harness?: string): MachineBadge => {
        const a = agents.find((x) => x.id === tabId);
        return { kind: "agent", text: `${harness ?? a?.agent ?? "agent"} · ${a?.name ?? fallback ?? tabId}`, tabId };
    };
    const o = s.owner;
    switch (o?.kind) {
        case "agent": {
            const tabId = o.tabid ?? "";
            const task = matchLauncherTask(s.launchercmdline, bgTasks[tabId] ?? []);
            return { ...base, badge: agentBadge(tabId, o.name, o.harness), log: task ? { agentId: tabId, task } : undefined };
        }
        case "terminal":
            return { ...base, badge: { kind: "terminal", text: `terminal · ${o.name || "Terminal"}`, tabId: o.tabid } };
        case "app":
            return { ...base, badge: { kind: "app", text: exeName(o.name) }, stopConfirm: `Stop ${exeName(o.name)}?` };
        default:
            for (const [agentId, tasks] of Object.entries(bgTasks)) {
                const task = matchLauncherTask(s.launchercmdline, tasks);
                if (task) {
                    return { ...base, badge: agentBadge(agentId), log: { agentId, task } };
                }
            }
            return { ...base, badge: NO_OWNER };
    }
}

export function buildMachineServers(
    servers: DevServerRow[],
    agents: MachineAgent[],
    bgTasks: Record<string, BackgroundTask[]>
): MachineView {
    const byRepo = new Map<string, MachineRow[]>();
    const other: MachineRow[] = [];
    for (const s of servers) {
        const r = resolveRow(s, agents, bgTasks);
        if (s.repo) {
            byRepo.set(s.repo, [...(byRepo.get(s.repo) ?? []), r]);
        } else {
            other.push(r);
        }
    }
    const hasNoOwner = (g: MachineGroup) => g.rows.some((r) => r.badge.kind === "noowner");
    const groups = [...byRepo].map(([repo, rows]) => ({ repo, title: repoTitle(repo), rows }));
    groups.sort((a, b) => Number(hasNoOwner(b)) - Number(hasNoOwner(a)) || a.title.localeCompare(b.title));
    const inRepo = groups.flatMap((g) => g.rows);
    return {
        groups,
        other,
        otherNames: [...new Set(other.map((r) => exeName(r.server.name)))].join(", "),
        repoCount: inRepo.length,
        noOwnerCount: inRepo.filter((r) => r.badge.kind === "noowner").length,
    };
}

// how often the footer asks for every listener: fast while the popover is open
export function machinePollMs(open: boolean): number {
    return open ? 3000 : 15000;
}
```

Note the "groups" test expects `SIEM/apps/website` (no owner) first, then `SIEM/apps/portal`, then `work/arcterm`; `localeCompare` puts "SIEM…" before "work…".

**Step 5:** run both vitest files → PASS. `npx eslint` and `npx prettier --check` on the three files.

**Step 6:** commit — `feat(agents): a pure model for every server on the machine`.

---

### Task 6: store, chip, popover

**Depends on:** Task 4, Task 5

**Files:**
- Create: `frontend/app/view/agents/machineserversstore.ts`
- Create: `frontend/app/view/agents/machineserverschip.tsx`
- Create: `frontend/app/view/agents/machineserverspanel.tsx`
- Modify: `frontend/app/view/agents/railservers.tsx` (export the Stop button and the action-button class)
- Modify: `frontend/app/view/agents/consumersstore.ts` (`toggleConsumers` closes Servers)
- Modify: `frontend/app/cockpit/footerstatus.tsx` (chip before `WorkerCapacityChip`)
- Modify: `frontend/app/cockpit/cockpit-root.tsx` (mount the panel beside `ConsumersPanel`)
- Modify: `CHANGELOG.md` (one `Added` line in the top `Unreleased` section; stage only that hunk if other sessions have edits there)

**Step 1: store** — `machineserversstore.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The footer's Servers state: whether the popover is open and the last ListAllDevServers reading. The panel, mounted
// once in cockpit-root, polls: slowly for the chip, fast while open, never while the window is hidden.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom, type PrimitiveAtom } from "jotai";
import { useEffect } from "react";
import type { DevServerRow } from "./devserversmodel";
import { machinePollMs } from "./machineservers";

export const machineServersOpenAtom = atom(false) as PrimitiveAtom<boolean>;

export interface MachineServersReading {
    servers: DevServerRow[] | null; // null until the first reading
    failed: boolean; // the last poll failed; servers is the reading before it
}

export const machineServersReadingAtom = atom<MachineServersReading>({ servers: null, failed: false }) as PrimitiveAtom<MachineServersReading>;

let inflight = false;

export async function loadMachineServers(
    read: () => Promise<CommandListDevServersRtnData> = () => RpcApi.ListAllDevServersCommand(TabRpcClient)
): Promise<void> {
    if (inflight) {
        return;
    }
    inflight = true;
    try {
        const rtn = await read();
        globalStore.set(machineServersReadingAtom, { servers: (rtn.servers ?? []) as DevServerRow[], failed: false });
    } catch {
        globalStore.set(machineServersReadingAtom, (prev) => ({ ...prev, failed: true }));
    } finally {
        inflight = false;
    }
}

export function useMachineServersPoll(open: boolean): void {
    useEffect(() => {
        const poll = () => {
            if (!document.hidden) {
                fireAndForget(loadMachineServers);
            }
        };
        poll();
        const timer = setInterval(poll, machinePollMs(open));
        return () => clearInterval(timer);
    }, [open]);
}

// drops a stopped server's row at once; the next poll confirms
export function forgetMachineServer(row: DevServerRow): void {
    globalStore.set(machineServersReadingAtom, (prev) => ({
        ...prev,
        servers: prev.servers?.filter((s) => !(s.pid === row.pid && s.createms === row.createms)) ?? null,
    }));
}
```

In `consumersstore.ts`, `toggleConsumers` also sets `machineServersOpenAtom` to false (import it from `./machineserversstore`; that store must not import `consumersstore`).

**Step 2: shared Stop** — in `railservers.tsx`, export `ACTION_BTN` and move the confirm-twice logic out of `DevServerItem` into

```tsx
export function ServerStopButton({ confirmLabel, onStop }: { confirmLabel: string; onStop: () => void }) { ... }
```

carrying the `confirming` state, the 3 s timer, `STOP_BTN` / the confirm style and the `data-dev-server-stop` attribute exactly as today (`confirmLabel` replaces the literal `"Stop?"`). It must also tell its parent when it is confirming, because `DevServerItem` keeps the actions visible while confirming: give it an `onConfirmingChange?: (c: boolean) => void` prop, or keep the visibility rule with CSS `focus-within` (the button keeps focus after the first click). `DevServerItem` uses it with `confirmLabel="Stop?"` and `onStop={() => fireAndForget(() => stopDevServer(row))}`. Run `npx vitest run frontend/app/view/agents` and the `rail-servers` CDP scenario later (Task 7's verify run) to confirm the rail is unchanged.

**Step 3: chip** — `machineserverschip.tsx`. Reads `machineServersReadingAtom`, the roster (`model.agentsAtom`, `model.terminalsAtom`) and `backgroundTasksByIdAtom`, builds the view with `buildMachineServers`, and renders a button styled like `WorkerCapacityChip` (`text-[11.5px] font-semibold tabular-nums`, `hover:bg-surface-hover`), with `data-machine-servers-chip`, `aria-haspopup="dialog"`, the lucide `Network` icon, then:
- no reading yet: nothing (like the RAM chip);
- `failed` with no servers: the icon and `?`, `text-muted`;
- `repoCount === 0`: the icon alone, `text-muted`;
- else `{repoCount}` and, when `noOwnerCount > 0`, ` · {noOwnerCount} no owner` in a `text-warning` span.

`title`: the repo servers' `portsLabel(ports)` joined by spaces. Click: `globalStore.set(consumersOpenAtom, null)`, then toggle `machineServersOpenAtom`. Takes `{ model }`; `FooterStatus` already has it, so render `<MachineServersChip model={model} />` before `<WorkerCapacityChip />`.

**Step 4: panel** — `machineserverspanel.tsx`, mounted in `cockpit-root.tsx` right after `<ConsumersPanel model={model} />`. Copy `ConsumersPanel`'s frame: the `fixed inset-0 z-50` backdrop that closes it, `PopoverReveal` with `origin="bottom right"` and `className="fixed bottom-[42px] right-4 z-[60] w-[520px] max-h-[60vh] overflow-y-auto rounded-lg border border-edge-strong bg-surface-raised shadow-popover"`, and the capture-phase `Escape` listener that yields to open modals. It calls `useMachineServersPoll(open)` unconditionally (the panel is always mounted, so this is the one poll for chip and popover).

Content, inside `<div data-machine-servers-panel role="dialog" aria-label="Servers on this machine">`:
- header row: `Servers on this machine` (`text-[12px] text-secondary`) and the total count on the right;
- when `failed`: `<div data-machine-servers-failed className="px-3 py-1.5 text-[11.5px] text-warning">Could not read listening ports</div>` above the last rows, which render with `opacity-60`;
- each group: a `text-[11px] text-muted` title row (`data-machine-servers-group={title}`), then its rows;
- **Other**: a button row `Other ({n}) {otherNames}` (`data-machine-servers-other`, `aria-expanded`), collapsed by default (`useState(false)`; the panel never unmounts, so it keeps its state), expanding to its rows.

A row (`data-machine-server={pid}`), laid out like `DevServerItem`: the success dot, each port as a button opening `serverUrl(port)` via `getApi().openExternal`, the label (`title={cmdline}`), uptime (`uptimeLabel`, with a `now` from a 30 s `useState` ticker while open); second line `PID {pid}` then the badge, then the hover actions:
- badge: a `rounded-[4px] px-1 text-[10.5px]` chip with `data-machine-server-badge={kind}`; `noowner` uses `text-warning` and `title="Still running. No agent, terminal or open app holds it."`; agent and terminal badges are buttons calling `openTarget(model, { kind: "agent", tabId })` and closing the panel; app badges are plain text in `text-muted`;
- **Log** (only with `row.log`): `openFileInPanel(model, log.agentId, { abs: log.task.outputFile!, root: null, reread: Date.now(), live: true, title: `${portsLabel(ports)} ${label}` })`, then `openTarget(model, { kind: "agent", tabId: log.agentId })`, then close;
- **Copy**: `copyText(row.server)` to the clipboard;
- **Stop**: `<ServerStopButton confirmLabel={row.stopConfirm} onStop={...} />`, where onStop awaits `RpcApi.StopDevServerCommand(TabRpcClient, { pid, createms })`, then `forgetMachineServer(row.server)`; on error `pushToast` (see how `consumerspanel.tsx` calls it) with "That process already exited" when the error text mentions the PID was reused or the process is not running, else the error's text, and `fireAndForget(loadMachineServers)`.

**Step 5:** `task check:ts` (give it a 4-minute timeout; the baseline is clean) and `npx vitest run frontend/app/view/agents` → clean. `npx eslint` + `npx prettier --check` on the touched files. With `task dev` running, open the footer chip in the dev app and look at it (HMR; no build).

**Step 6:** CHANGELOG `Added` line, e.g.: "The footer has a **Servers** chip: how many servers run inside your repos, and how many nothing holds any more. Click it to see every listening process on the machine, grouped by repo, with what each belongs to (an agent, a terminal, an app, or no owner), and open, read the log of, copy or stop it." Commit the named files — `feat(cockpit): Servers on this machine, a footer chip and popover`.

---

### Task 7: CDP scenario `machine-servers`

**Depends on:** Task 6

**Files:**
- Modify: `scripts/cdp/scenarios.mjs` (hand-formatted, 4-space; never run prettier on it)

**Step 1:** add a scenario modelled on `consumers-popover` (search `CONSUMERS_MOCK_KEY`): install a mock RPC client with `api.setMockRpcClient` that answers `listalldevservers` from a fixture (modes `ok`, `fail`, `empty`) and records `stopdevserver` calls without stopping anything, passing every other command through. Fixture rows (`repo`, `owner`, `launchercmdline` set as in Task 5's tests): `:4321 astro` detached in `D:/fx/website` (no owner), `:8100 uvicorn` owned by an agent, `:5174 vite` owned by a terminal, `Code.exe` and `com.docker.backend.exe` as apps with no repo. Use a fixture roster the way `consumers-popover` does if the agent badge must show a name; otherwise assert the badge falls back to the owner's name.

Steps, each with a screenshot and an assertion:
1. the chip reads `3 · 1 no owner` (`[data-machine-servers-chip]` text);
2. click it: `[data-machine-servers-panel]` is open; group titles in order, `website` group first;
3. Other is collapsed and lists `Code, com.docker.backend`; click it: its two rows show;
4. each badge kind is present (`[data-machine-server-badge="noowner"|"agent"|"terminal"|"app"]`), and the no-owner badge carries its tooltip;
5. hover the astro row: Copy and Stop show; click Stop once: it reads `Stop?`; again: a `stopdevserver` call with astro's pid and createms is recorded and the row is gone;
6. hover the Code row and click Stop once: it reads `Stop Code?`; press Esc: the panel closes and nothing was stopped;
7. mode `fail`, reopen: `[data-machine-servers-failed]` shows over the last rows; the chip still shows the last count;
8. a click on the backdrop closes it; opening Consumers from the RAM chip closes it and vice versa;
9. teardown restores the RPC client.

**Step 2:** with the dev app running (`task dev`), `task verify:ui -- machine-servers rail-servers consumers-popover` → all PASS (rail-servers proves Task 6's Stop refactor left the rail alone).

**Step 3:** commit `scripts/cdp/scenarios.mjs` — `test(cdp): machine-servers scenario`.

---

### Task 8: docs

**Depends on:** Task 7

**Files:**
- Modify: `docs/superpowers/specs/2026-10-08-machine-servers-design.md` (Status line: shipped, date, and anything not verified)
- Modify: `docs/superpowers/plans/2026-10-08-machine-servers.md` → delete it once shipped (AGENTS.md: a plan is deleted when it ships)

Commit — `docs: Servers on this machine shipped`.
