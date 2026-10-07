# Consumers Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking the app bar's RAM chip (or the plan-usage meters) opens a panel that ranks every live agent by RAM or by tokens of the last 10 minutes, shows arcterm's own processes, and lets the person Stop an agent or switch a Claude agent on Opus to Sonnet.

**Architecture:** `wavesrv` measures: a new `pkg/memusage` reads the process table once per poll and sums each agent block's process tree (physical footprint on macOS through cgo, RSS elsewhere) plus the interface, server and host; a `usagestats.WindowReader` reads each transcript incrementally and keeps a 10-minute window. One RPC, `GetConsumersCommand`, returns both; `AgentsSetModelCommand` sends `/model <m>` into a session; a new dag action `stop` ends a run worker's task without a retry. The frontend joins the reading with the roster in a pure `consumers.ts` and draws it in `consumerspanel.tsx`.

**Tech Stack:** Go (gopsutil v4, cgo on darwin), React 19 + jotai + Tailwind 4, vitest, the CDP scenario harness.

**Spec:** `docs/superpowers/specs/2026-10-08-consumers-panel-design.md`

**Verify:** `node scripts/verify.mjs ./pkg/memusage/... ./pkg/usagestats/... ./pkg/orchestrate/... ./pkg/wshrpc/...`

**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: consumers-popover needs CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs consumers-popover`

## Global Constraints

- The panel polls `GetConsumersCommand` every **5 s** while it is open and **never** while it is closed.
- Tokens are counted over the last **10 minutes** (`ConsumersTokenWindow`).
- The burn warning goes to the single agent with the most tokens in the window, only when that count passes **500K** (`BURN_WARN_TOKENS`).
- On darwin a process's memory is `proc_pid_rusage(RUSAGE_INFO_V2).ri_phys_footprint`; elsewhere gopsutil's RSS. A value that could not be read is **absent, never zero** (Go: nil pointer or missing map key; TS: `undefined`, drawn as "—").
- arcterm's own rows (**Interface**, **Server**, **Host**) are read-only.
- Colors come from `@theme` tokens only (`frontend/tailwindsetup.css`), the popover from `PopoverReveal` with `shadow-popover`; no raw hex or rgba.
- Never hand-edit generated files (`frontend/types/gotypes.d.ts`, `frontend/app/store/wshclientapi.ts`, `pkg/wshrpc/wshclient/wshclient.go`, …): edit Go, then `task generate`.
- `pkg/memusage` is imported by `pkg/orchestrate`, which `wsh` (built with `CGO_ENABLED=0`) imports: the cgo file is `//go:build darwin && cgo` and the fallback `//go:build !darwin || !cgo`.
- Never run prettier on `scripts/*.mjs`; check only files you touched; never `--write` the tree.
- Typecheck with `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (about 2 minutes; give it a 10-minute timeout).
- `CHANGELOG.md`: one line under `Added` in the top `## Unreleased` section, in the commit that ships the user-visible change.
- Commits carry no `Co-Authored-By` or other attribution lines. Other sessions may have uncommitted files in the checkout: `git add` only the paths your task names.
- `pkg/jarvis` and `cmd/wsh/cmd` have macOS-only baseline test failures (temp-dir `/private/var` symlinks, Windows path fixtures), so the plan's Verify leaves them out; the tasks that touch them run their own targeted tests.

## Review Focus

- **An agent's shell exits between the roster read and the footprint read.** Its row stays, with "—" for RAM, and the reading does not fail. Pinned in Task 2 (`TestMeasureLeavesAnAgentAbsentWhenItsShellIsGone`) and Task 5 (agent C with no pid).
- **A transcript is replaced or truncated mid-session** (a `/clear`, a rewrite). The reader starts that file over instead of reading past its end. Pinned in Task 3 (`TestWindowRereadsATruncatedFile`).
- **The poll fails while the panel is open** (wavesrv restarting). The last reading stays, dimmed, under "Couldn't read usage · last at 12:03". Pinned in Task 6 (`staleLine`) and Task 7 (`loadConsumers keeps the last reading when a poll fails`).
- **Stop on a worker whose task finished a moment ago.** The engine refuses with its reason and the task is untouched. Pinned in Task 4 (`TestStopRefusesATaskWithNoWorker`).
- **→ Sonnet for a pi agent, or a model string that is not one word.** The server refuses and sends nothing; the panel never offers it for pi. Pinned in Task 5 (`TestAgentsSetModelRefusesPi`, `TestAgentsSetModelRefusesAMultiWordModel`) and Task 6 (`offers → Sonnet only to Claude on Opus`).

## File Structure

| File | Responsibility |
|---|---|
| `pkg/memusage/memusage.go` (new) | `Table` (one process-list read, children index, `Tree`), `ProcessTree` (moved from orchestrate) |
| `pkg/memusage/breakdown.go` (new) | `Sampler`, `Live()`, `Breakdown`, `Measure` (agents, interface, server, host) |
| `pkg/memusage/footprint_darwin.go` (new) | cgo: `footprint` via `proc_pid_rusage`, `responsiblePid` |
| `pkg/memusage/footprint_other.go` (new) | `footprint` via gopsutil RSS; `responsiblePid` always false |
| `pkg/memusage/memusage_test.go` (new) | table, tree, measure, live footprint |
| `pkg/orchestrate/liveness.go` | uses `memusage.ProcessTree`; its local `processTree` goes |
| `pkg/usagestats/window.go` (new) | `WindowReader`: incremental per-file read, 10-minute ring, `Forget` |
| `pkg/usagestats/window_test.go` (new) | its tests |
| `pkg/orchestrate/retry.go` | `FailureKindStopped` |
| `pkg/orchestrate/mutation.go` | the `stop` action (prepare + apply) |
| `pkg/orchestrate/mutation_test.go` | stop tests |
| `pkg/jarvis/leadprompt.go` | the lead leaves a stopped task alone |
| `cmd/wsh/cmd/wshcmd-jarvisdag.go` (+ `_test.go`) | `wsh jarvis dag stop`, its done line |
| `pkg/wshrpc/wshrpctypes_dag.go` | `stop` in the Action comment |
| `pkg/wshrpc/wshrpctypes_agents.go` | `GetConsumersCommand`, `AgentsSetModelCommand` and their types |
| `pkg/wshrpc/wshserver/wshserver_consumers.go` (new) | both handlers |
| `pkg/wshrpc/wshserver/wshserver_consumers_test.go` (new) | their tests |
| `frontend/app/view/agents/consumers.ts` (new) | pure model: join, sort, group, warnings, actions, copy |
| `frontend/app/view/agents/consumers.test.ts` (new) | its tests |
| `frontend/app/view/agents/consumersstore.ts` (new) | open/sort atom, reading atom, the poll |
| `frontend/app/view/agents/consumersstore.test.ts` (new) | its tests |
| `frontend/app/view/agents/consumerspanel.tsx` (new) | the popover |
| `frontend/app/view/agents/workercapacitychip.tsx` | the chip becomes a button that opens the panel |
| `frontend/app/view/agents/usagemeters.tsx` | `usePlanDonuts`; the meters open the panel sorted by tokens |
| `frontend/app/cockpit/app-bar.tsx` | mounts the panel under the right-hand group |
| `scripts/cdp/scenarios.mjs` | the `consumers-popover` scenario |
| `docs/orchestrator-guide.md`, `CHANGELOG.md` | the `dag stop` row; the user-facing line |

---

### Task 1: Spike — does `/model` apply inside a running turn?
**Depends on:** none

This answers spec decision 9's open question. It changes no product code: its output is a line in this plan's **Execution notes** (bottom of the file), which Task 7 reads. It needs a Claude Code session the worker can type into; if the worker cannot drive one, it records `unverified` and why.

**Files:**
- Modify: `docs/superpowers/plans/2026-10-08-consumers-panel.md` (the Execution notes section only)

**Interfaces:**
- Consumes: nothing.
- Produces: the Execution notes line `model-switch-midturn: yes|no|unverified — <evidence>`. Task 7 sets `MODEL_SWITCH_APPLIES_MIDTURN` from it (`yes` → `true`; `no` or `unverified` → `false`).

- [ ] **Step 1: Check that tmux and claude are on PATH**

Run: `command -v tmux && command -v claude`
Expected: two paths. If either is missing, go to Step 6 with `unverified — tmux or claude missing`.

- [ ] **Step 2: Start a throwaway Claude session in tmux, on Opus, in a temp directory**

```bash
SPIKE_DIR=$(mktemp -d)
tmux new-session -d -s modelspike -x 200 -y 50 "cd $SPIKE_DIR && claude --model opus"
sleep 8
tmux capture-pane -p -t modelspike | tail -5
```
Expected: the Claude prompt is on screen. If a trust dialog shows, send `tmux send-keys -t modelspike Enter` and capture again.

- [ ] **Step 3: Give it a turn that lasts about a minute**

```bash
tmux send-keys -t modelspike "Run these one at a time with the Bash tool, one call each: sleep 20, then sleep 20, then sleep 20. After each, say which model you are." Enter
sleep 10
```

- [ ] **Step 4: While the turn runs, type `/model sonnet`**

```bash
tmux send-keys -t modelspike "/model sonnet" Enter
sleep 60
tmux capture-pane -p -S -200 -t modelspike > "$SPIKE_DIR/pane.txt"
```

- [ ] **Step 5: Read which model answered each step from the transcript**

```bash
T=$(ls -t ~/.claude/projects/*/*.jsonl | head -1)
grep -o '"model":"[^"]*"' "$T" | uniq -c
grep -n '/model' "$T" | head -5
```
Expected: the assistant messages' `"model"` values in order. If a `claude-sonnet-*` model answers a step **before** the turn's last message, write `yes`; if every message of that turn is `claude-opus-*` and Sonnet appears only in a later turn (or the command waited in the queue until the turn ended), write `no`.

- [ ] **Step 6: Record the result and clean up**

Replace the `model-switch-midturn:` line under **Execution notes** with one of:

```
model-switch-midturn: yes — <transcript path>: opus answered step 1, sonnet answered steps 2–3 of the same turn
model-switch-midturn: no — <transcript path>: the whole turn was opus; /model ran after it ended
model-switch-midturn: unverified — <why the worker could not drive a session>
```

```bash
tmux kill-session -t modelspike 2>/dev/null; rm -rf "$SPIKE_DIR"
git add docs/superpowers/plans/2026-10-08-consumers-panel.md
git commit -m "docs(plan): record whether /model applies inside a running turn"
```

---

### Task 2: `pkg/memusage` — process table, footprint and the breakdown
**Depends on:** none

**Files:**
- Create: `pkg/memusage/memusage.go`, `pkg/memusage/breakdown.go`, `pkg/memusage/footprint_darwin.go`, `pkg/memusage/footprint_other.go`, `pkg/memusage/memusage_test.go`
- Modify: `pkg/orchestrate/liveness.go` (lines 188–223: `sampleChildTree` and `processTree`)

**Interfaces:**
- Consumes: gopsutil `process`.
- Produces:
  - `func NewTable(parent map[int32]int32) Table`, `func ReadTable() (Table, error)`, `func (t Table) Has(pid int32) bool`, `func (t Table) Pids() []int32`, `func (t Table) Tree(root int32) []int32`
  - `func ProcessTree(root *process.Process) []*process.Process`
  - `type Sampler struct { Footprint func(pid int32) (uint64, bool); Responsible func(pid int32) (int32, bool) }`, `func Live() Sampler`
  - `type Breakdown struct { Agents map[string]uint64; Interface, Server, Host *uint64 }`
  - `func Measure(t Table, s Sampler, agents map[string]int32, serverPid, hostPid int32, byResponsibility bool) Breakdown`

- [ ] **Step 1: Write the failing tests**

`pkg/memusage/memusage_test.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memusage

import (
	"os"
	"runtime"
	"slices"
	"testing"
)

const mb uint64 = 1 << 20

// host 10 spawns wavesrv 20, which runs the shells 30 and 40; claude 31 runs under shell 30. 50 and 51 are the
// webview's helpers: launchd's children, which the host is responsible for. 60 is an unrelated app.
func fixtureTable() Table {
	return NewTable(map[int32]int32{
		1:  0,
		10: 1,
		20: 10,
		30: 20,
		31: 30,
		40: 20,
		50: 1,
		51: 1,
		60: 1,
	})
}

func sampler(foot map[int32]uint64, responsible map[int32]int32) Sampler {
	return Sampler{
		Footprint: func(pid int32) (uint64, bool) {
			n, ok := foot[pid]
			return n, ok
		},
		Responsible: func(pid int32) (int32, bool) {
			r, ok := responsible[pid]
			return r, ok
		},
	}
}

func TestTreeIsRootThenEveryDescendant(t *testing.T) {
	got := fixtureTable().Tree(20)
	if !slices.Equal(got, []int32{20, 30, 40, 31}) {
		t.Fatalf("Tree(20) = %v, want [20 30 40 31]", got)
	}
	if fixtureTable().Tree(99) != nil {
		t.Fatal("a pid not in the table has no tree")
	}
}

func TestTreeSurvivesAProcessThatIsItsOwnParent(t *testing.T) {
	tb := NewTable(map[int32]int32{0: 0, 1: 0, 2: 1})
	if got := tb.Tree(0); !slices.Equal(got, []int32{0, 1, 2}) {
		t.Fatalf("Tree(0) = %v, want [0 1 2]", got)
	}
}

func TestMeasureSumsEachAgentsTree(t *testing.T) {
	foot := map[int32]uint64{30: 5 * mb, 31: 300 * mb, 40: 4 * mb}
	b := Measure(fixtureTable(), sampler(foot, nil), map[string]int32{"blk-a": 30, "blk-b": 40}, 20, 10, false)
	if b.Agents["blk-a"] != 305*mb || b.Agents["blk-b"] != 4*mb {
		t.Fatalf("agents = %v", b.Agents)
	}
}

func TestMeasureLeavesAnAgentAbsentWhenItsShellIsGone(t *testing.T) {
	b := Measure(fixtureTable(), sampler(map[int32]uint64{31: mb}, nil), map[string]int32{"gone": 77}, 20, 10, false)
	if _, ok := b.Agents["gone"]; ok {
		t.Fatalf("an agent whose root is not running must be absent, got %v", b.Agents)
	}
}

func TestMeasureReadsServerAndHost(t *testing.T) {
	b := Measure(fixtureTable(), sampler(map[int32]uint64{10: 47 * mb, 20: 121 * mb}, nil), nil, 20, 10, false)
	if b.Server == nil || *b.Server != 121*mb || b.Host == nil || *b.Host != 47*mb {
		t.Fatalf("server %v host %v", b.Server, b.Host)
	}
	if b2 := Measure(fixtureTable(), sampler(nil, nil), nil, 20, 10, false); b2.Server != nil || b2.Host != nil {
		t.Fatal("an unread footprint must be absent, not zero")
	}
}

func TestInterfaceByResponsibilityLeavesOutHostServerAndAgents(t *testing.T) {
	foot := map[int32]uint64{10: 47 * mb, 20: 121 * mb, 30: mb, 31: 300 * mb, 50: 684 * mb, 51: 62 * mb, 60: 900 * mb}
	// every process the host spawned is its responsibility too, wavesrv's tree included
	resp := map[int32]int32{10: 10, 20: 10, 30: 10, 31: 10, 40: 10, 50: 10, 51: 10, 60: 60}
	b := Measure(fixtureTable(), sampler(foot, resp), map[string]int32{"blk-a": 30}, 20, 10, true)
	if b.Interface == nil || *b.Interface != 746*mb {
		t.Fatalf("interface = %v, want 746 MB (50 + 51)", b.Interface)
	}
}

func TestInterfaceByTreeOnOtherPlatforms(t *testing.T) {
	// on Windows the webview's processes are the host's children
	tb := NewTable(map[int32]int32{10: 1, 20: 10, 30: 20, 70: 10, 71: 70})
	foot := map[int32]uint64{70: 400 * mb, 71: 100 * mb, 30: 9 * mb}
	b := Measure(tb, sampler(foot, nil), nil, 20, 10, false)
	if b.Interface == nil || *b.Interface != 500*mb {
		t.Fatalf("interface = %v, want 500 MB", b.Interface)
	}
}

func TestInterfaceAbsentWhenNothingIsFound(t *testing.T) {
	if b := Measure(fixtureTable(), sampler(map[int32]uint64{50: mb}, nil), nil, 20, 10, true); b.Interface != nil {
		t.Fatalf("no responsible process found must leave interface absent, got %v", *b.Interface)
	}
}

func TestLiveFootprintReadsThisProcess(t *testing.T) {
	n, ok := Live().Footprint(int32(os.Getpid()))
	if !ok || n == 0 {
		t.Fatalf("footprint of this test = %d, %v", n, ok)
	}
}

func TestLiveResponsibleOnDarwin(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("responsibility is a darwin call")
	}
	if _, ok := Live().Responsible(int32(os.Getpid())); !ok {
		t.Skip("built without cgo: the fallback has no responsibility call")
	}
}

func TestReadTableFindsThisProcess(t *testing.T) {
	tb, err := ReadTable()
	if err != nil {
		t.Fatal(err)
	}
	if !tb.Has(int32(os.Getpid())) {
		t.Fatal("the process table must list this test")
	}
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./pkg/memusage/`
Expected: FAIL — `undefined: NewTable` (the package has no source yet).

- [ ] **Step 3: Write `pkg/memusage/memusage.go`**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package memusage measures what arcterm's processes hold in memory: each agent's process tree, wavesrv, the
// Tauri host and the webview that draws the cockpit. The figure is the physical footprint on macOS, what
// Activity Monitor shows, and the resident set elsewhere. A value that could not be read is absent, never zero.
package memusage

import (
	"sort"

	"github.com/shirou/gopsutil/v4/process"
)

// Table is one read of the process list: every pid's parent, and the children index built from it.
type Table struct {
	parent   map[int32]int32
	children map[int32][]int32
}

// NewTable indexes a pid -> parent map. A process listed as its own parent (pid 0 on darwin) is no one's child.
func NewTable(parent map[int32]int32) Table {
	children := make(map[int32][]int32, len(parent))
	for pid, ppid := range parent {
		if pid != ppid {
			children[ppid] = append(children[ppid], pid)
		}
	}
	for _, kids := range children {
		sort.Slice(kids, func(i, j int) bool { return kids[i] < kids[j] })
	}
	return Table{parent: parent, children: children}
}

// ReadTable lists every process once. On darwin each gopsutil Children() call lists them all again, so a poll
// that measures several trees reads the list here, once, and walks the index.
func ReadTable() (Table, error) {
	procs, err := process.Processes()
	if err != nil {
		return Table{}, err
	}
	parent := make(map[int32]int32, len(procs))
	for _, p := range procs {
		ppid, err := p.Ppid()
		if err != nil {
			continue // exited mid-read
		}
		parent[p.Pid] = ppid
	}
	return NewTable(parent), nil
}

// Has reports whether pid was running when the table was read.
func (t Table) Has(pid int32) bool {
	_, ok := t.parent[pid]
	return ok
}

// Pids is every pid in the table, ascending.
func (t Table) Pids() []int32 {
	pids := make([]int32, 0, len(t.parent))
	for pid := range t.parent {
		pids = append(pids, pid)
	}
	sort.Slice(pids, func(i, j int) bool { return pids[i] < pids[j] })
	return pids
}

// Tree is root and every descendant, root first, breadth first; nil when root was not running.
func (t Table) Tree(root int32) []int32 {
	if !t.Has(root) {
		return nil
	}
	seen := map[int32]bool{root: true}
	tree := []int32{root}
	for i := 0; i < len(tree); i++ {
		for _, kid := range t.children[tree[i]] {
			if !seen[kid] {
				seen[kid] = true
				tree = append(tree, kid)
			}
		}
	}
	return tree
}

// ProcessTree is root and every descendant, read through gopsutil one process at a time. gopsutil lists only
// direct children, and a test run is a shell, then go, then the compiled test binary. pkg/orchestrate samples
// one worker's tree per tick with it, where reading a whole Table would cost more.
func ProcessTree(root *process.Process) []*process.Process {
	tree := []*process.Process{root}
	for i := 0; i < len(tree); i++ {
		children, err := tree[i].Children()
		if err != nil {
			continue
		}
		tree = append(tree, children...)
	}
	return tree
}
```

- [ ] **Step 4: Write `pkg/memusage/breakdown.go`**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memusage

// Sampler reads one process's memory and, on darwin, the process responsible for it. Funcs, so tests script them.
type Sampler struct {
	Footprint   func(pid int32) (uint64, bool)
	Responsible func(pid int32) (int32, bool)
}

// Live is the sampler for this machine.
func Live() Sampler {
	return Sampler{Footprint: footprint, Responsible: responsiblePid}
}

// Breakdown is what one Measure found. A nil pointer, or an id missing from Agents, is a value it could not read.
type Breakdown struct {
	Agents    map[string]uint64
	Interface *uint64
	Server    *uint64
	Host      *uint64
}

// Measure sums each agent's tree (agents maps an id to its tree's root pid), wavesrv and the host, and the
// webview that draws the cockpit. byResponsibility is darwin's case: the webview's processes are XPC services
// launchd starts, found as the processes the host is responsible for; elsewhere they are the host's tree. Either
// way the host itself, wavesrv's tree (the shells and the agents) and every agent's tree are left out of it.
func Measure(t Table, s Sampler, agents map[string]int32, serverPid, hostPid int32, byResponsibility bool) Breakdown {
	b := Breakdown{Agents: map[string]uint64{}}
	skip := map[int32]bool{hostPid: true}
	for _, pid := range t.Tree(serverPid) {
		skip[pid] = true
	}
	for id, root := range agents {
		tree := t.Tree(root)
		for _, pid := range tree {
			skip[pid] = true
		}
		if sum, ok := sumOf(s, tree); ok {
			b.Agents[id] = sum
		}
	}
	b.Server = one(s, serverPid)
	if hostPid > 1 {
		b.Host = one(s, hostPid)
		b.Interface = interfaceOf(t, s, hostPid, skip, byResponsibility)
	}
	return b
}

func interfaceOf(t Table, s Sampler, hostPid int32, skip map[int32]bool, byResponsibility bool) *uint64 {
	var candidates []int32
	if byResponsibility {
		for _, pid := range t.Pids() {
			if r, ok := s.Responsible(pid); ok && r == hostPid {
				candidates = append(candidates, pid)
			}
		}
	} else {
		candidates = t.Tree(hostPid)
	}
	var kept []int32
	for _, pid := range candidates {
		if !skip[pid] {
			kept = append(kept, pid)
		}
	}
	sum, ok := sumOf(s, kept)
	if !ok {
		return nil
	}
	return &sum
}

// sumOf is the pids' summed footprint, and false when none of them could be read
func sumOf(s Sampler, pids []int32) (uint64, bool) {
	var sum uint64
	read := false
	for _, pid := range pids {
		if n, ok := s.Footprint(pid); ok {
			sum += n
			read = true
		}
	}
	return sum, read
}

func one(s Sampler, pid int32) *uint64 {
	n, ok := s.Footprint(pid)
	if !ok {
		return nil
	}
	return &n
}
```

- [ ] **Step 5: Write the platform files**

`pkg/memusage/footprint_darwin.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build darwin && cgo

package memusage

/*
#include <libproc.h>
#include <sys/resource.h>
extern int responsibility_get_pid_responsible_for_pid(pid_t);
*/
import "C"

import "unsafe"

// footprint is the process's physical footprint, the figure Activity Monitor shows: it counts compressed memory,
// which the resident set misses. It needs no privilege for the user's own processes.
func footprint(pid int32) (uint64, bool) {
	var ri C.struct_rusage_info_v2
	if C.proc_pid_rusage(C.int(pid), C.RUSAGE_INFO_V2, (*C.rusage_info_t)(unsafe.Pointer(&ri))) != 0 {
		return 0, false
	}
	return uint64(ri.ri_phys_footprint), true
}

// responsiblePid is the process macOS holds responsible for pid, the one Activity Monitor groups it under: the
// app for its WebKit XPC services, which launchd starts and so are no child of it.
func responsiblePid(pid int32) (int32, bool) {
	r := C.responsibility_get_pid_responsible_for_pid(C.pid_t(pid))
	if r <= 0 {
		return 0, false
	}
	return int32(r), true
}
```

`pkg/memusage/footprint_other.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !darwin || !cgo

package memusage

import "github.com/shirou/gopsutil/v4/process"

// footprint is the resident set (the working set on Windows): the footprint call is darwin's, and wsh builds
// without cgo.
func footprint(pid int32) (uint64, bool) {
	p, err := process.NewProcess(pid)
	if err != nil {
		return 0, false
	}
	m, err := p.MemoryInfo()
	if err != nil {
		return 0, false
	}
	return m.RSS, true
}

// responsiblePid has no equivalent here: the webview's processes are found as the host's children instead.
func responsiblePid(int32) (int32, bool) {
	return 0, false
}
```

- [ ] **Step 6: Run the tests, with and without cgo**

Run: `go test ./pkg/memusage/ && CGO_ENABLED=0 go test ./pkg/memusage/`
Expected: PASS both times (without cgo `TestLiveResponsibleOnDarwin` skips).

- [ ] **Step 7: Move orchestrate's tree walk onto `memusage.ProcessTree`**

In `pkg/orchestrate/liveness.go`, add the import `"github.com/wavetermdev/waveterm/pkg/memusage"`, change the loop in `sampleChildTree` from `for _, p := range processTree(root) {` to `for _, p := range memusage.ProcessTree(root) {`, and delete the whole `processTree` function with its comment (the lines from `// processTree is root and every descendant.` through its closing brace).

Run: `grep -rn "processTree(" pkg/orchestrate/`
Expected: no output (no other caller, test or not). If a test calls `processTree`, change it to `memusage.ProcessTree`.

- [ ] **Step 8: Build every binary that imports it**

Run: `go build ./cmd/server/ && CGO_ENABLED=0 go build -o /dev/null ./cmd/wsh/ && go vet ./pkg/memusage/ ./pkg/orchestrate/ && gofmt -l pkg/memusage pkg/orchestrate/liveness.go`
Expected: no output from gofmt, no errors.

- [ ] **Step 9: Run the liveness tests**

Run: `go test ./pkg/orchestrate/ -run 'Liveness|Sample|Worker' -count=1`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add pkg/memusage pkg/orchestrate/liveness.go
git commit -m "feat(memusage): measure agents' process trees, the webview, wavesrv and the host"
```

---

### Task 3: `usagestats.WindowReader` — the last 10 minutes of a transcript, read incrementally
**Depends on:** none

**Files:**
- Create: `pkg/usagestats/window.go`, `pkg/usagestats/window_test.go`

**Interfaces:**
- Consumes: the package's `extractClaude`, `filterUsageLines`, `extractPi`, `isPiTranscriptPath`, `subagentsDir`, `dedupe`, `bucket`, `Record`, `Bucket`.
- Produces: `func NewWindowReader() *WindowReader`, `func (w *WindowReader) Window(path string, now time.Time, window time.Duration) ([]Bucket, bool)`, `func (w *WindowReader) Forget(before time.Time)`.

- [ ] **Step 1: Write the failing tests**

`pkg/usagestats/window_test.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package usagestats

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var windowNow = time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

func usageLine(id string, at time.Time, model string, output int) string {
	return fmt.Sprintf(`{"type":"assistant","timestamp":%q,"requestId":"req_%s","message":{"id":"msg_%s","model":%q,"usage":{"input_tokens":0,"output_tokens":%d,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}`,
		at.Format(time.RFC3339), id, id, model, output)
}

func appendLines(t *testing.T, path string, lines ...string) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err := f.WriteString(strings.Join(lines, "\n") + "\n"); err != nil {
		t.Fatal(err)
	}
}

func outputOf(buckets []Bucket) int {
	n := 0
	for _, b := range buckets {
		n += b.Output
	}
	return n
}

func TestWindowCountsOnlyRecordsInsideTheWindow(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.jsonl")
	appendLines(t, path,
		usageLine("old", windowNow.Add(-30*time.Minute), "claude-opus-4-8", 1000),
		usageLine("new", windowNow.Add(-2*time.Minute), "claude-opus-4-8", 40))
	w := NewWindowReader()
	got, ok := w.Window(path, windowNow, 10*time.Minute)
	if !ok || outputOf(got) != 40 {
		t.Fatalf("window = %v, %v; want only the 40 output tokens inside it", got, ok)
	}
}

func TestWindowReadsWhatWasAppended(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.jsonl")
	appendLines(t, path, usageLine("a", windowNow.Add(-time.Minute), "claude-opus-4-8", 10))
	w := NewWindowReader()
	w.Window(path, windowNow, 10*time.Minute)
	appendLines(t, path, usageLine("b", windowNow, "claude-sonnet-4-6", 5))
	got, _ := w.Window(path, windowNow, 10*time.Minute)
	if outputOf(got) != 15 || len(got) != 2 {
		t.Fatalf("after an append = %+v, want 15 output tokens over two models", got)
	}
}

func TestWindowDropsRecordsThatAgeOut(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.jsonl")
	appendLines(t, path, usageLine("a", windowNow.Add(-9*time.Minute), "claude-opus-4-8", 10))
	w := NewWindowReader()
	w.Window(path, windowNow, 10*time.Minute)
	if got, _ := w.Window(path, windowNow.Add(5*time.Minute), 10*time.Minute); outputOf(got) != 0 {
		t.Fatalf("a record older than the window must drop out, got %+v", got)
	}
}

func TestWindowHoldsAPartialLine(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.jsonl")
	line := usageLine("a", windowNow, "claude-opus-4-8", 10)
	if err := os.WriteFile(path, []byte(line[:40]), 0o644); err != nil {
		t.Fatal(err)
	}
	w := NewWindowReader()
	if got, _ := w.Window(path, windowNow, 10*time.Minute); outputOf(got) != 0 {
		t.Fatal("a line still being written must wait")
	}
	f, _ := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	f.WriteString(line[40:] + "\n")
	f.Close()
	if got, _ := w.Window(path, windowNow, 10*time.Minute); outputOf(got) != 10 {
		t.Fatalf("the completed line = %+v, want 10", got)
	}
}

func TestWindowRereadsATruncatedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.jsonl")
	appendLines(t, path,
		usageLine("a", windowNow, "claude-opus-4-8", 10),
		usageLine("b", windowNow, "claude-opus-4-8", 20))
	w := NewWindowReader()
	w.Window(path, windowNow, 10*time.Minute)
	if err := os.WriteFile(path, []byte(usageLine("c", windowNow, "claude-opus-4-8", 7)+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got, _ := w.Window(path, windowNow, 10*time.Minute); outputOf(got) != 7 {
		t.Fatalf("a file that shrank must be read again from the start, got %+v", got)
	}
}

func TestWindowCountsSubagentTranscripts(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "s.jsonl")
	appendLines(t, path, usageLine("a", windowNow, "claude-opus-4-8", 10))
	sub := filepath.Join(dir, "s", "subagents")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	appendLines(t, filepath.Join(sub, "agent-1.jsonl"), usageLine("b", windowNow, "claude-sonnet-4-6", 3))
	if got, _ := NewWindowReader().Window(path, windowNow, 10*time.Minute); outputOf(got) != 13 {
		t.Fatalf("subagents bill like the parent, got %+v", got)
	}
}

func TestWindowOfAMissingFileIsNotRead(t *testing.T) {
	if _, ok := NewWindowReader().Window(filepath.Join(t.TempDir(), "none.jsonl"), windowNow, 10*time.Minute); ok {
		t.Fatal("a missing transcript must report not read")
	}
}

func TestForgetDropsFilesNobodyAskedAbout(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.jsonl")
	appendLines(t, path, usageLine("a", windowNow, "claude-opus-4-8", 10))
	w := NewWindowReader()
	w.Window(path, windowNow, 10*time.Minute)
	w.Forget(windowNow.Add(time.Second))
	if len(w.files) != 0 {
		t.Fatalf("forgotten files = %d, want 0", len(w.files))
	}
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./pkg/usagestats/ -run 'Window|Forget'`
Expected: FAIL — `undefined: NewWindowReader`.

- [ ] **Step 3: Write `pkg/usagestats/window.go`**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package usagestats

import (
	"bytes"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/pisession"
)

// WindowReader keeps, per transcript, how far it has read and the usage records still inside the window, so a
// poll every few seconds parses only what was appended: Claude transcripts and their subagents' are append-only
// JSONL. A file that shrank was replaced and is read again from the start. A pi session is re-read whole when its
// size changes. The records are TranscriptUsage's, so a window counts what the rail counts.
type WindowReader struct {
	mu    sync.Mutex
	files map[string]*windowFile
}

type windowFile struct {
	offset  int64 // Claude: bytes consumed, up to the last complete line
	size    int64 // pi: the size last parsed
	records []Record
	asked   time.Time
}

func NewWindowReader() *WindowReader {
	return &WindowReader{files: map[string]*windowFile{}}
}

// Window is the usage of path, and of the Claude subagent transcripts beside it, timestamped after now-window,
// bucketed as TranscriptUsage buckets it. ok is false when path itself cannot be read.
func (w *WindowReader) Window(path string, now time.Time, window time.Duration) ([]Bucket, bool) {
	if _, err := os.Stat(path); err != nil {
		return nil, false
	}
	cutoff := now.Add(-window)
	w.mu.Lock()
	defer w.mu.Unlock()
	var recs []Record
	for _, p := range windowPaths(path) {
		recs = append(recs, w.read(p, now, cutoff)...)
	}
	return bucket(dedupe(recs)), true
}

// Forget drops what the reader holds for every file no Window call asked about since before.
func (w *WindowReader) Forget(before time.Time) {
	w.mu.Lock()
	defer w.mu.Unlock()
	for p, f := range w.files {
		if f.asked.Before(before) {
			delete(w.files, p)
		}
	}
}

func windowPaths(path string) []string {
	out := []string{path}
	if isPiTranscriptPath(path) {
		return out
	}
	_ = filepath.WalkDir(subagentsDir(path), func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(p, ".jsonl") {
			out = append(out, p)
		}
		return nil
	})
	return out
}

func (w *WindowReader) read(path string, now, cutoff time.Time) []Record {
	f := w.files[path]
	if f == nil {
		f = &windowFile{}
		w.files[path] = f
	}
	f.asked = now
	info, err := os.Stat(path)
	if err == nil {
		switch {
		case isPiTranscriptPath(path):
			if info.Size() != f.size {
				f.records = nil
				if file, perr := pisession.Read(path); perr == nil {
					f.records = extractPi(file, cutoff)
				}
				f.size = info.Size()
			}
		case info.Size() < f.offset:
			// replaced: start over
			lines, consumed := readAppended(path, 0)
			f.offset, f.records = consumed, extractClaude(filterUsageLines(lines))
		case info.Size() > f.offset:
			lines, consumed := readAppended(path, f.offset)
			f.offset += consumed
			f.records = append(f.records, extractClaude(filterUsageLines(lines))...)
		}
	}
	f.records = keepAfter(f.records, cutoff)
	return f.records
}

// readAppended reads path from offset up to its last newline: the complete lines appended since, and how many
// bytes they took. A line still being written stays for the next read.
func readAppended(path string, offset int64) ([]string, int64) {
	file, err := os.Open(path)
	if err != nil {
		return nil, 0
	}
	defer file.Close()
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return nil, 0
	}
	data, err := io.ReadAll(file)
	if err != nil {
		return nil, 0
	}
	end := bytes.LastIndexByte(data, '\n')
	if end < 0 {
		return nil, 0
	}
	var lines []string
	for _, ln := range bytes.Split(data[:end], []byte{'\n'}) {
		if len(bytes.TrimSpace(ln)) > 0 {
			lines = append(lines, string(ln))
		}
	}
	return lines, int64(end + 1)
}

func keepAfter(recs []Record, cutoff time.Time) []Record {
	out := recs[:0]
	for _, r := range recs {
		if r.TS.After(cutoff) {
			out = append(out, r)
		}
	}
	return out
}
```

- [ ] **Step 4: Run the tests**

Run: `go test ./pkg/usagestats/ -count=1 && go vet ./pkg/usagestats/ && gofmt -l pkg/usagestats`
Expected: PASS, no gofmt output.

- [ ] **Step 5: Commit**

```bash
git add pkg/usagestats/window.go pkg/usagestats/window_test.go
git commit -m "feat(usagestats): read a transcript's last minutes incrementally"
```

---

### Task 4: Engine action `stop` — end a worker's task without a retry
**Depends on:** none

The spec (decision 8) says "marks the task Cancelled". The engine forbids that: one Cancelled task turns the whole dag Cancelled (`RecomputeDagStatus`, `pkg/orchestrate/dag.go`), and a task that keeps its cancelled run is mapped back to Cancelled by `DeriveTaskStates`. So `stop` cancels and stops the worker's run exactly as `retry` and `skip` do (`prepareActionLocked` → `cancelTaskRun`, then `stopRunWorkers`), and leaves the task **Failed** with `LastFailureKind = "stopped-by-human"` and no run: the dag holds as Blocked, the scheduler dispatches nothing for it, and `retry`, `skip` and `escalate` all accept a Failed task. The lead is told to leave such a task to the human. A reviewing task has no worker to stop and is refused.

**Files:**
- Modify: `pkg/orchestrate/retry.go` (the first const block), `pkg/orchestrate/mutation.go` (`prepareActionLocked`, `applyActionLocked`), `pkg/orchestrate/mutation_test.go`
- Modify: `pkg/jarvis/leadprompt.go:75`, `pkg/jarvis/leadprompt_test.go`
- Modify: `cmd/wsh/cmd/wshcmd-jarvisdag.go` (`dagDoneLines`, the `jarvisDagCmd.AddCommand` line), `cmd/wsh/cmd/wshcmd-jarvisdag_test.go` (`TestDagDoneLineCoversEveryAction`)
- Modify: `pkg/wshrpc/wshrpctypes_dag.go:86` (the Action comment), `docs/orchestrator-guide.md` (the dag command table, after the `dag retry`/`dag skip` row)

**Interfaces:**
- Consumes: `ApplyAction(ctx, dagID, taskID, action string, target waveobj.RoutePin) error`, `cancelTaskRun`, `stopRunWorkers`, `taskByID`.
- Produces: `const FailureKindStopped = "stopped-by-human"`; the dag action `"stop"` accepted by `DagActionCommand` (it already falls through to `orchestrate.ApplyAction`); `wsh jarvis dag stop <task>`.

- [ ] **Step 1: Write the failing engine tests**

Append to `pkg/orchestrate/mutation_test.go`:

```go
func TestStopEndsARunningTaskWithoutARetry(t *testing.T) {
	ctx, dag, _, child := seedRunningDag(t)
	oldStop := stopRunWorkers
	stopped := false
	stopRunWorkers = func(_ context.Context, run *waveobj.Run) error {
		stopped = run.ID == child.ID
		return nil
	}
	restoreAfterStages(t, func() { stopRunWorkers = oldStop })

	if err := ApplyAction(ctx, dag.OID, dag.Tasks[0].ID, "stop", waveobj.RoutePin{}); err != nil {
		t.Fatal(err)
	}
	gotChild, _ := wstore.GetRun(ctx, dag.ChannelId, child.ID)
	if !stopped || gotChild.Status != jarvis.RunStatus_Cancelled {
		t.Fatalf("worker stop=%v run status=%q, want stopped/cancelled", stopped, gotChild.Status)
	}
	got, _ := wstore.GetDag(ctx, dag.OID)
	task := got.Tasks[0]
	if task.State != TaskState_Failed || task.LastFailureKind != FailureKindStopped || task.RunID != "" {
		t.Fatalf("stopped task = state %q kind %q run %q, want failed/%s/none", task.State, task.LastFailureKind, task.RunID, FailureKindStopped)
	}
	if got.Status == DagStatus_Cancelled {
		t.Fatal("stopping one task must not cancel the dag")
	}
	if err := Schedule(ctx, dag.OID); err != nil {
		t.Fatal(err)
	}
	again, _ := wstore.GetDag(ctx, dag.OID)
	if again.Tasks[0].State != TaskState_Failed || again.Tasks[0].RunID != "" {
		t.Fatalf("after a tick = state %q run %q; a stopped task must not be dispatched again", again.Tasks[0].State, again.Tasks[0].RunID)
	}
}

func TestStopAlsoStopsAStalledTask(t *testing.T) {
	ctx, dag, _, _ := seedRunningDag(t)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].State = TaskState_Stalled
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	oldStop := stopRunWorkers
	stopRunWorkers = func(context.Context, *waveobj.Run) error { return nil }
	restoreAfterStages(t, func() { stopRunWorkers = oldStop })
	if err := ApplyAction(ctx, dag.OID, dag.Tasks[0].ID, "stop", waveobj.RoutePin{}); err != nil {
		t.Fatal(err)
	}
	got, _ := wstore.GetDag(ctx, dag.OID)
	if got.Tasks[0].State != TaskState_Failed {
		t.Fatalf("stalled task after stop = %q, want failed", got.Tasks[0].State)
	}
}

func TestAStoppedTaskCanBeSkipped(t *testing.T) {
	ctx, dag, _, _ := seedRunningDag(t)
	oldStop := stopRunWorkers
	stopRunWorkers = func(context.Context, *waveobj.Run) error { return nil }
	restoreAfterStages(t, func() { stopRunWorkers = oldStop })
	if err := ApplyAction(ctx, dag.OID, dag.Tasks[0].ID, "stop", waveobj.RoutePin{}); err != nil {
		t.Fatal(err)
	}
	if err := ApplyAction(ctx, dag.OID, dag.Tasks[0].ID, "skip", waveobj.RoutePin{}); err != nil {
		t.Fatalf("skip after stop: %v", err)
	}
	got, _ := wstore.GetDag(ctx, dag.OID)
	if got.Tasks[0].State != TaskState_Skipped {
		t.Fatalf("state = %q, want skipped", got.Tasks[0].State)
	}
}

func TestStopRefusesATaskWithNoWorker(t *testing.T) {
	for _, state := range []string{TaskState_Pending, TaskState_Done, TaskState_Skipped, TaskState_Reviewing} {
		t.Run(state, func(t *testing.T) {
			ctx, dag, _, child := seedRunningDag(t)
			if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
				g.Tasks[0].State = state
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			err := ApplyAction(ctx, dag.OID, dag.Tasks[0].ID, "stop", waveobj.RoutePin{})
			if err == nil || !strings.Contains(err.Error(), "cannot be stopped") {
				t.Fatalf("stop from %s = %v, want a refusal", state, err)
			}
			got, _ := wstore.GetDag(ctx, dag.OID)
			gotChild, _ := wstore.GetRun(ctx, dag.ChannelId, child.ID)
			if got.Tasks[0].State != state || gotChild.Status == jarvis.RunStatus_Cancelled {
				t.Fatalf("a refused stop changed the task (%q) or cancelled its run (%q)", got.Tasks[0].State, gotChild.Status)
			}
		})
	}
}

func TestTheLeadIsToldToLeaveAStoppedTask(t *testing.T) {
	if !strings.Contains(jarvis.OrchestrationRules("r1", "", ""), FailureKindStopped) {
		t.Fatalf("the lead's rules must name %q", FailureKindStopped)
	}
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./pkg/orchestrate/ -run 'Stop|StoppedTask' -count=1`
Expected: FAIL — `undefined: FailureKindStopped`.

- [ ] **Step 3: Add the failure kind**

In `pkg/orchestrate/retry.go`, inside the first `const (` block, after `FailureKindUnknown       = "unknown"`:

```go
	// FailureKindStopped is a task the human stopped from the Consumers panel or `dag stop`: its worker was
	// stopped and nothing retries it until the human retries, escalates or skips it.
	FailureKindStopped = "stopped-by-human"
```

- [ ] **Step 4: Validate and prepare `stop` in `prepareActionLocked`**

In `pkg/orchestrate/mutation.go`, change the first line of `prepareActionLocked` from

```go
	if action != "skip" && action != "retry" && action != "escalate" {
```
to
```go
	if action != "skip" && action != "retry" && action != "escalate" && action != "stop" {
```

and add this case to its `switch action {` (before `case "retry":`):

```go
	case "stop":
		// only a task with a live worker has something to stop; a reviewing task's worker already finished
		if !taskActive(task.State) {
			return nil, fmt.Errorf("task %q cannot be stopped from state %q: only a running or stalled task has a worker", taskID, task.State)
		}
```

(The code after the switch already cancels the task's run into `prep.stop`, which `prep.run` stops outside the lock.) Also update the function's comment: `// prepareActionLocked validates a skip, retry, escalate or stop, cancels the run of the worker it will stop and returns`.

- [ ] **Step 5: Record `stop` in `applyActionLocked`**

In the `switch action {` of `applyActionLocked`, add before `default:`:

```go
	case "stop":
		task := taskByID(g, taskID)
		if task == nil {
			return fmt.Errorf("no task %q", taskID)
		}
		// Failed, not Cancelled: a cancelled task cancels its whole dag (RecomputeDagStatus). The run is
		// dropped so DeriveTaskStates cannot map its cancellation back onto the task.
		task.State = TaskState_Failed
		task.LastFailureKind = FailureKindStopped
		task.RunID = ""
```

- [ ] **Step 6: Tell the lead to leave it**

In `pkg/jarvis/leadprompt.go`, after the line that begins `b.WriteString("- task still failing, or worker hung:`, add:

```go
	b.WriteString("- a task failed as stopped-by-human: the human stopped its worker; leave it to them, and don't retry, escalate or skip it unless they ask.\n")
```

- [ ] **Step 7: Run the engine and lead tests**

Run: `go test ./pkg/orchestrate/ -run 'Stop|StoppedTask|Skip|Retry|Escalate' -count=1 && go test ./pkg/jarvis/ -run 'LeadPrompt|Rules' -count=1`
Expected: PASS.

- [ ] **Step 8: Add `wsh jarvis dag stop`**

In `cmd/wsh/cmd/wshcmd-jarvisdag.go`, add to `dagDoneLines` after the `"skip"` entry:

```go
	"stop":              "task {task} stopped; its worker is gone and nothing retries it until you retry, escalate or skip it",
```

and add `dagActionWithin("stop", 60_000)` to the `jarvisDagCmd.AddCommand(` call, after `dagAction("skip")` (stopping a worker waits for it to exit).

In `cmd/wsh/cmd/wshcmd-jarvisdag_test.go`, add `"stop"` to the first action list in `TestDagDoneLineCoversEveryAction`:

```go
	for _, action := range []string{"approve", "retry", "escalate", "skip", "stop", "retry-cleanup", "forward", "amend", "tell", "sendback", "answer", "merge"} {
```

Run: `go test ./cmd/wsh/cmd/ -run TestDagDoneLineCoversEveryAction -count=1`
Expected: PASS.

- [ ] **Step 9: Document it**

In `pkg/wshrpc/wshrpctypes_dag.go`, in the `Action` field's comment of `CommandDagActionData`, insert `stop | ` after `skip | `.

In `docs/orchestrator-guide.md`, after the row ``| `dag retry <task>` / `dag skip <task>` | retry or skip a failed or stalled task |`` add:

```
| `dag stop <task>` | stop a running or stalled task's worker; the task fails as `stopped-by-human` and waits until it is retried, escalated or skipped (the Consumers panel's Stop on a worker) |
```

No `task generate` here: the Action comment does not reach the generated files (checked: `gotypes.d.ts` and `wshclient.go` carry no copy of it), and Task 5 regenerates them in parallel.

- [ ] **Step 10: Format and commit**

```bash
gofmt -l pkg/orchestrate/retry.go pkg/orchestrate/mutation.go pkg/orchestrate/mutation_test.go pkg/jarvis/leadprompt.go cmd/wsh/cmd/wshcmd-jarvisdag.go cmd/wsh/cmd/wshcmd-jarvisdag_test.go pkg/wshrpc/wshrpctypes_dag.go
git add pkg/orchestrate/retry.go pkg/orchestrate/mutation.go pkg/orchestrate/mutation_test.go pkg/jarvis/leadprompt.go cmd/wsh/cmd/wshcmd-jarvisdag.go cmd/wsh/cmd/wshcmd-jarvisdag_test.go pkg/wshrpc/wshrpctypes_dag.go docs/orchestrator-guide.md
git commit -m "feat(orchestrate): dag stop ends a worker's task without a retry"
```
Expected: gofmt prints nothing.

---

### Task 5: RPCs — `GetConsumersCommand` and `AgentsSetModelCommand`
**Depends on:** Task 2, Task 3

**Files:**
- Modify: `pkg/wshrpc/wshrpctypes_agents.go` (the `AgentCommands` interface and new types)
- Create: `pkg/wshrpc/wshserver/wshserver_consumers.go`, `pkg/wshrpc/wshserver/wshserver_consumers_test.go`
- Generated by `task generate`: `frontend/types/gotypes.d.ts`, `frontend/app/store/wshclientapi.ts`, `pkg/wshrpc/wshclient/wshclient.go`

**Interfaces:**
- Consumes: `memusage.ReadTable`, `memusage.Live`, `memusage.Measure`, `memusage.Breakdown` (Task 2); `usagestats.NewWindowReader`, `(*WindowReader).Window`, `.Forget` (Task 3); in package `wshserver`: `loadAgentRosterFacts`, `buildAgentRoster`, `resolveAgentTab`, `agentTranscriptPath`, `askTargetForBlock`, `usageBucketToWire`, `virtualMemory`, `deliverAgentMessage`.
- Produces (Go → TS via generate):
  - `GetConsumersCommand(ctx) (*CommandGetConsumersRtnData, error)` → `RpcApi.GetConsumersCommand(client, opts?)`
  - `AgentsSetModelCommand(ctx, CommandAgentsSetModelData) (*CommandAgentsSetModelRtnData, error)` → `RpcApi.AgentsSetModelCommand(client, data, opts?)`
  - TS: `CommandGetConsumersRtnData { totalbytes; availablebytes; windowms; agents: ConsumerAgent[]; interfacebytes?; serverbytes?; hostbytes? }`, `ConsumerAgent { tabid; blockid; rambytes?; tokensread; tokens?: UsageBucket[]; dag?: ConsumerDag }`, `ConsumerDag { channelid; runid; taskid }`, `CommandAgentsSetModelData { tab; model }`, `CommandAgentsSetModelRtnData { tabid; midturn; overstream }`.

- [ ] **Step 1: Add the types and the interface methods**

In `pkg/wshrpc/wshrpctypes_agents.go`, add to `type AgentCommands interface {` after `AgentsReadCommand`:

```go
	AgentsSetModelCommand(ctx context.Context, data CommandAgentsSetModelData) (*CommandAgentsSetModelRtnData, error)                     // switch a live Claude session's model with its /model command
	GetConsumersCommand(ctx context.Context) (*CommandGetConsumersRtnData, error)                                                          // every live agent's RAM and last-10-minutes tokens, and arcterm's own processes' RAM
```

and append to the file:

```go
type CommandAgentsSetModelData struct {
	Tab   string `json:"tab"`   // a tab id or a unique prefix of one
	Model string `json:"model"` // one word `/model` takes: an alias ("sonnet") or a model id
}

type CommandAgentsSetModelRtnData struct {
	TabId      string `json:"tabid"`
	MidTurn    bool   `json:"midturn"`    // the session was not at its prompt
	OverStream bool   `json:"overstream"` // its mod took the command; else it was typed into the terminal
}

// ConsumerDag is where a run worker's task lives: the dag action that stops it takes these.
type ConsumerDag struct {
	ChannelId string `json:"channelid"`
	RunId     string `json:"runid"` // the owner (orchestrator) run
	TaskId    string `json:"taskid"`
}

// ConsumerAgent is one live agent in a GetConsumers reading. RamBytes is absent when its process tree could
// not be read; Tokens are its transcript's usage buckets inside the window, read only when TokensRead.
type ConsumerAgent struct {
	TabId      string        `json:"tabid"`
	BlockId    string        `json:"blockid"`
	RamBytes   *uint64       `json:"rambytes,omitempty"`
	TokensRead bool          `json:"tokensread"`
	Tokens     []UsageBucket `json:"tokens,omitempty"`
	Dag        *ConsumerDag  `json:"dag,omitempty"`
}

// CommandGetConsumersRtnData is one reading of the Consumers panel. A nil byte count is one that could not be read.
type CommandGetConsumersRtnData struct {
	TotalBytes     uint64          `json:"totalbytes"`
	AvailableBytes uint64          `json:"availablebytes"`
	WindowMs       int64           `json:"windowms"`
	Agents         []ConsumerAgent `json:"agents"`
	InterfaceBytes *uint64         `json:"interfacebytes,omitempty"`
	ServerBytes    *uint64         `json:"serverbytes,omitempty"`
	HostBytes      *uint64         `json:"hostbytes,omitempty"`
}
```

- [ ] **Step 2: Write the failing handler tests**

`pkg/wshrpc/wshserver/wshserver_consumers_test.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/shirou/gopsutil/v4/mem"
	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const consumersMB uint64 = 1 << 20

// scriptConsumers scripts the shell pids, the process table, the sampler, the dag lookup and the system memory.
func scriptConsumers(t *testing.T, pids map[string]int, table memusage.Table, foot map[int32]uint64) {
	t.Helper()
	oldPid, oldTable, oldSampler, oldDag, oldVM := consumerBlockPid, consumerTable, consumerSampler, consumerDagTarget, virtualMemory
	consumerBlockPid = func(blockId string) int { return pids[blockId] }
	consumerTable = func() (memusage.Table, error) { return table, nil }
	consumerSampler = func() memusage.Sampler {
		return memusage.Sampler{
			Footprint: func(pid int32) (uint64, bool) {
				n, ok := foot[pid]
				return n, ok
			},
			Responsible: func(int32) (int32, bool) { return 0, false },
		}
	}
	consumerDagTarget = func(_ context.Context, blockId string) *wshrpc.ConsumerDag {
		if blockId == agentsBlockB {
			return &wshrpc.ConsumerDag{ChannelId: "ch-1", RunId: "run-owner", TaskId: "t-3"}
		}
		return nil
	}
	virtualMemory = func(context.Context) (*mem.VirtualMemoryStat, error) {
		return &mem.VirtualMemoryStat{Total: 8 << 30, Available: 2 << 30}, nil
	}
	t.Cleanup(func() {
		consumerBlockPid, consumerTable, consumerSampler, consumerDagTarget, virtualMemory = oldPid, oldTable, oldSampler, oldDag, oldVM
	})
}

func recentOpusLine(output int) string {
	return fmt.Sprintf(`{"type":"assistant","timestamp":%q,"requestId":"req_c","message":{"id":"msg_c","model":"claude-opus-4-8","usage":{"input_tokens":0,"output_tokens":%d,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}`,
		time.Now().UTC().Format(time.RFC3339), output)
}

func TestGetConsumersReportsEachAgentsRamTokensAndTask(t *testing.T) {
	transcript := filepath.Join(t.TempDir(), "a.jsonl")
	if err := os.WriteFile(transcript, []byte(recentOpusLine(4200)+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	facts := threeAgents()
	facts.Tabs[0].Status.TranscriptPath = transcript
	scriptAgents(t, facts)
	// A's shell 100 runs claude 101; B's shell is 200; C's shell has exited (no pid)
	scriptConsumers(t,
		map[string]int{agentsBlockA: 100, agentsBlockB: 200},
		memusage.NewTable(map[int32]int32{100: 1, 101: 100, 200: 1}),
		map[int32]uint64{100: 5 * consumersMB, 101: 300 * consumersMB, 200: 1024 * consumersMB})

	rtn, err := (&WshServer{}).GetConsumersCommand(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if rtn.TotalBytes != 8<<30 || rtn.AvailableBytes != 2<<30 || rtn.WindowMs != ConsumersTokenWindow.Milliseconds() {
		t.Fatalf("memory/window = %+v", rtn)
	}
	byTab := map[string]wshrpc.ConsumerAgent{}
	for _, a := range rtn.Agents {
		byTab[a.TabId] = a
	}
	a, b, c := byTab[agentsTabA], byTab[agentsTabB], byTab[agentsTabC]
	if a.RamBytes == nil || *a.RamBytes != 305*consumersMB {
		t.Fatalf("A's RAM = %v, want 305 MB (shell + claude)", a.RamBytes)
	}
	if !a.TokensRead || len(a.Tokens) != 1 || a.Tokens[0].Output != 4200 || a.Tokens[0].Model != "claude-opus-4-8" {
		t.Fatalf("A's tokens = %+v (read %v)", a.Tokens, a.TokensRead)
	}
	if b.RamBytes == nil || *b.RamBytes != 1024*consumersMB || b.Dag == nil || b.Dag.TaskId != "t-3" || b.Dag.RunId != "run-owner" {
		t.Fatalf("B = %+v", b)
	}
	if c.TabId != agentsTabC || c.RamBytes != nil {
		t.Fatalf("C's shell is gone: its RAM must be absent, got %+v", c)
	}
}

func TestAgentsSetModelSendsTheSlashCommand(t *testing.T) {
	sent := scriptAgents(t, threeAgents())
	rtn, err := (&WshServer{}).AgentsSetModelCommand(context.Background(), wshrpc.CommandAgentsSetModelData{Tab: agentsTabA, Model: "sonnet"})
	if err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 1 || (*sent)[0].blockId != agentsBlockA || (*sent)[0].text != "/model sonnet" {
		t.Fatalf("sent = %+v, want /model sonnet to block A", *sent)
	}
	if rtn.TabId != agentsTabA || !rtn.MidTurn {
		t.Fatalf("rtn = %+v, want tab A mid-turn (it is working)", rtn)
	}
}

func TestAgentsSetModelRefusesPi(t *testing.T) {
	sent := scriptAgents(t, threeAgents())
	_, err := (&WshServer{}).AgentsSetModelCommand(context.Background(), wshrpc.CommandAgentsSetModelData{Tab: agentsTabC, Model: "sonnet"})
	if err == nil || !strings.Contains(err.Error(), "only a Claude session") || len(*sent) != 0 {
		t.Fatalf("pi: err=%v sent=%v, want a refusal and nothing sent", err, *sent)
	}
}

func TestAgentsSetModelRefusesAMultiWordModel(t *testing.T) {
	sent := scriptAgents(t, threeAgents())
	for _, model := range []string{"", "sonnet; rm -rf ~", "son net"} {
		if _, err := (&WshServer{}).AgentsSetModelCommand(context.Background(), wshrpc.CommandAgentsSetModelData{Tab: agentsTabA, Model: model}); err == nil {
			t.Errorf("model %q accepted", model)
		}
	}
	if len(*sent) != 0 {
		t.Fatalf("a refused model was sent: %v", *sent)
	}
}
```

- [ ] **Step 3: Run them to see them fail**

Run: `go test ./pkg/wshrpc/wshserver/ -run 'Consumers|AgentsSetModel' -count=1`
Expected: FAIL — `undefined: consumerBlockPid` / `GetConsumersCommand`.

- [ ] **Step 4: Write `pkg/wshrpc/wshserver/wshserver_consumers.go`**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"os"
	"regexp"
	"runtime"
	"time"

	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/usagestats"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// ConsumersTokenWindow is how far back a GetConsumers reading counts each agent's tokens.
const ConsumersTokenWindow = 10 * time.Minute

// consumersTokens keeps each transcript's read offset between polls, so a poll parses only what was appended.
var consumersTokens = usagestats.NewWindowReader()

// seams, so tests script the shell pids, the process table, the sampler and a worker's dag task
var (
	consumerBlockPid  = blockcontroller.GetBlockControllerPid
	consumerTable     = memusage.ReadTable
	consumerSampler   = memusage.Live
	consumerDagTarget = readConsumerDag
)

// readConsumerDag is the dag task a run worker's block works on, nil for any other block.
func readConsumerDag(ctx context.Context, blockId string) *wshrpc.ConsumerDag {
	_, target, ok := askTargetForBlock(ctx, waveobj.MakeORef(waveobj.OType_Block, blockId).String(), "")
	if !ok {
		return nil
	}
	return &wshrpc.ConsumerDag{ChannelId: target.ChannelId, RunId: target.RunID, TaskId: target.TaskId}
}

// GetConsumersCommand is one reading of the Consumers panel: every live agent's RAM and its tokens of the last
// ConsumersTokenWindow, and the RAM of the webview, wavesrv and the host. The process list is read once.
func (ws *WshServer) GetConsumersCommand(ctx context.Context) (*wshrpc.CommandGetConsumersRtnData, error) {
	vm, err := virtualMemory(ctx)
	if err != nil {
		return nil, fmt.Errorf("reading system memory: %w", err)
	}
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return nil, err
	}
	rows := buildAgentRoster(facts)
	roots := make(map[string]int32, len(rows))
	for _, r := range rows {
		if pid := consumerBlockPid(r.blockId); pid > 0 {
			roots[r.blockId] = int32(pid)
		}
	}
	var bd memusage.Breakdown
	if table, terr := consumerTable(); terr == nil {
		// wavesrv's parent is the Tauri host, which spawned it
		bd = memusage.Measure(table, consumerSampler(), roots, int32(os.Getpid()), int32(os.Getppid()), runtime.GOOS == "darwin")
	}
	now := time.Now()
	out := &wshrpc.CommandGetConsumersRtnData{
		TotalBytes:     vm.Total,
		AvailableBytes: vm.Available,
		WindowMs:       ConsumersTokenWindow.Milliseconds(),
		Agents:         []wshrpc.ConsumerAgent{},
		InterfaceBytes: bd.Interface,
		ServerBytes:    bd.Server,
		HostBytes:      bd.Host,
	}
	for i := range rows {
		r := &rows[i]
		a := wshrpc.ConsumerAgent{TabId: r.TabId, BlockId: r.blockId, Dag: consumerDagTarget(ctx, r.blockId)}
		if n, ok := bd.Agents[r.blockId]; ok {
			a.RamBytes = &n
		}
		if tpath, terr := agentTranscriptPath(ctx, r); terr == nil && tpath != "" {
			if buckets, ok := consumersTokens.Window(tpath, now, ConsumersTokenWindow); ok {
				a.TokensRead = true
				for _, b := range buckets {
					a.Tokens = append(a.Tokens, usageBucketToWire(b))
				}
			}
		}
		out.Agents = append(out.Agents, a)
	}
	// a transcript no agent named this poll is not polled again; a minute's grace covers a slow roster
	consumersTokens.Forget(now.Add(-time.Minute))
	return out, nil
}

// modelArg is one word `/model` takes: an alias or a model id ("claude-sonnet-4-6[1m]")
var modelArg = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._\[\]-]*$`)

// AgentsSetModelCommand sends `/model <model>` into a live Claude session. Over the mod's control stream the mod
// runs it as the session's own slash command (claude/arc-mod/hooks/control-core.ts deliver); without one it is
// typed into the terminal.
func (ws *WshServer) AgentsSetModelCommand(ctx context.Context, data wshrpc.CommandAgentsSetModelData) (*wshrpc.CommandAgentsSetModelRtnData, error) {
	if !modelArg.MatchString(data.Model) {
		return nil, fmt.Errorf("model %q is not one word /model takes", data.Model)
	}
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return nil, err
	}
	target, err := resolveAgentTab(buildAgentRoster(facts), data.Tab)
	if err != nil {
		return nil, err
	}
	if target.Harness != "claude" {
		return nil, fmt.Errorf("agent %q runs %s; only a Claude session switches its model with /model", target.Name, target.Harness)
	}
	deliverAgentMessage(target.blockId, "/model "+data.Model)
	return &wshrpc.CommandAgentsSetModelRtnData{
		TabId:      target.TabId,
		MidTurn:    target.State != wshrpc.AgentsState_Idle,
		OverStream: target.hasStream,
	}, nil
}
```

- [ ] **Step 5: Regenerate the bindings**

Run: `task generate && grep -n "GetConsumersCommand\|AgentsSetModelCommand" frontend/app/store/wshclientapi.ts && grep -n "type CommandGetConsumersRtnData\|type ConsumerAgent\|type ConsumerDag\|type CommandAgentsSetModel" frontend/types/gotypes.d.ts`
Expected: both RpcApi methods and all five types are present; `rambytes?`, `interfacebytes?`, `serverbytes?`, `hostbytes?`, `tokens?` and `dag?` are optional.

- [ ] **Step 6: Run the tests**

Run: `go test ./pkg/wshrpc/wshserver/ -count=1 && go vet ./pkg/wshrpc/... && gofmt -l pkg/wshrpc`
Expected: PASS; no gofmt output for the files you touched.

- [ ] **Step 7: Commit**

```bash
git add pkg/wshrpc/wshrpctypes_agents.go pkg/wshrpc/wshserver/wshserver_consumers.go pkg/wshrpc/wshserver/wshserver_consumers_test.go frontend/types/gotypes.d.ts frontend/app/store/wshclientapi.ts pkg/wshrpc/wshclient/wshclient.go
git commit -m "feat(wshrpc): GetConsumers reads agents' RAM and recent tokens; AgentsSetModel sends /model"
```

---

### Task 6: `consumers.ts` — the panel's pure model
**Depends on:** Task 5

**Files:**
- Create: `frontend/app/view/agents/consumers.ts`, `frontend/app/view/agents/consumers.test.ts`

**Interfaces:**
- Consumes: generated `CommandGetConsumersRtnData`, `ConsumerAgent`, `ConsumerDag`, `UsageBucket` (Task 5); `AgentVM`, `AgentState` (`agentsviewmodel.ts`); `aggregateSessionUsage` (`sessionusage.ts`); `formatGB` (`workercapacity.ts`); `fmtClock` (`runcompletion.ts`).
- Produces: `type ConsumersSort = "ram" | "tokens"`, `BURN_WARN_TOKENS`, `STATE_DOT`, `interface ConsumerRow`, `interface ConsumerGroup`, `interface OwnUsage`, `interface ConsumersView`, `buildConsumers(data, agents, sort): ConsumersView`, `ramLabel(bytes): string`, `stopWorkerMessage(row): string`, `switchToastText(name, midTurn, appliesMidTurn): string`, `staleLine(lastOkMs): string`.

- [ ] **Step 1: Write the failing tests**

`frontend/app/view/agents/consumers.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    BURN_WARN_TOKENS,
    buildConsumers,
    ramLabel,
    staleLine,
    stopWorkerMessage,
    switchToastText,
    type ConsumerRow,
} from "./consumers";

const MB = 2 ** 20;
const GB = 2 ** 30;

const vm = (id: string, over: Partial<AgentVM> = {}): AgentVM => ({
    id,
    name: `agent ${id}`,
    task: "",
    state: "working",
    agent: "claude",
    model: "sonnet",
    project: "arcterm",
    ...over,
});

const bucket = (model: string, output: number): UsageBucket => ({
    harness: "claude",
    provider: "anthropic",
    model,
    day: "2026-10-08",
    input: 0,
    output,
    reasoning: 0,
    cacheread: 0,
    cachecreate: 0,
    cachecreate1h: 0,
    msgs: 1,
});

const agent = (tabid: string, over: Partial<ConsumerAgent> = {}): ConsumerAgent => ({
    tabid,
    blockid: `blk-${tabid}`,
    tokensread: true,
    ...over,
});

const reading = (agents: ConsumerAgent[], over: Partial<CommandGetConsumersRtnData> = {}): CommandGetConsumersRtnData => ({
    totalbytes: 8 * GB,
    availablebytes: 1.3 * GB,
    windowms: 600_000,
    agents,
    ...over,
});

const ids = (rows: ConsumerRow[]) => rows.map((r) => r.id);

describe("buildConsumers", () => {
    it("joins each reading to its roster agent and drops one the roster does not know", () => {
        const view = buildConsumers(reading([agent("a", { rambytes: 300 * MB }), agent("ghost")]), [vm("a")], "ram");
        expect(view.groups).toHaveLength(1);
        expect(view.groups[0].rows.map((r) => [r.id, r.name, r.ramBytes])).toEqual([["a", "agent a", 300 * MB]]);
        expect(view.freeBytes).toBe(1.3 * GB);
        expect(view.totalBytes).toBe(8 * GB);
    });

    it("sorts by RAM heaviest first, an unread value last", () => {
        const view = buildConsumers(
            reading([agent("a", { rambytes: 100 * MB }), agent("b"), agent("c", { rambytes: 900 * MB })]),
            [vm("a"), vm("b"), vm("c")],
            "ram"
        );
        expect(ids(view.groups[0].rows)).toEqual(["c", "a", "b"]);
    });

    it("sorts by tokens of the window", () => {
        const view = buildConsumers(
            reading([
                agent("a", { rambytes: 900 * MB, tokens: [bucket("claude-sonnet-4-6", 10)] }),
                agent("b", { rambytes: 100 * MB, tokens: [bucket("claude-opus-4-8", 5000)] }),
            ]),
            [vm("a"), vm("b")],
            "tokens"
        );
        expect(ids(view.groups[0].rows)).toEqual(["b", "a"]);
        expect(view.groups[0].rows[0].tokens).toBe(5000);
        expect(view.groups[0].rows[0].spendUsd).toBeGreaterThan(0);
    });

    it("leaves tokens absent when the transcript was not read", () => {
        const view = buildConsumers(reading([agent("a", { tokensread: false })]), [vm("a")], "tokens");
        expect(view.groups[0].rows[0].tokens).toBeUndefined();
        expect(view.groups[0].rows[0].spendUsd).toBeUndefined();
    });

    it("groups a run's workers under their run and orders groups by their heaviest row", () => {
        const dag = { channelid: "ch", runid: "85548d0b-aaaa", taskid: "t-3" };
        const view = buildConsumers(
            reading([
                agent("mine", { rambytes: 300 * MB }),
                agent("w1", { rambytes: 2.5 * GB, dag }),
                agent("w2", { rambytes: 200 * MB, dag: { ...dag, taskid: "t-4" } }),
            ]),
            [vm("mine"), vm("w1"), vm("w2")],
            "ram"
        );
        expect(view.groups.map((g) => [g.key, g.label])).toEqual([
            ["85548d0b-aaaa", "Run 85548d0b"],
            ["agents", undefined],
        ]);
        expect(ids(view.groups[0].rows)).toEqual(["w1", "w2"]);
    });

    it("offers → Sonnet only to Claude on Opus", () => {
        const view = buildConsumers(
            reading([agent("opus"), agent("sonnet"), agent("pi")]),
            [vm("opus", { model: "opus" }), vm("sonnet"), vm("pi", { agent: "pi", model: "opus" })],
            "ram"
        );
        const byId = Object.fromEntries(view.groups[0].rows.map((r) => [r.id, r]));
        expect([byId.opus.opus, byId.opus.canSonnet]).toEqual([true, true]);
        expect([byId.sonnet.opus, byId.sonnet.canSonnet]).toEqual([false, false]);
        expect([byId.pi.opus, byId.pi.canSonnet]).toEqual([false, false]);
    });

    it("warns about the busiest agent only above the threshold", () => {
        const over = buildConsumers(
            reading([
                agent("a", { tokens: [bucket("claude-opus-4-8", BURN_WARN_TOKENS + 1)] }),
                agent("b", { tokens: [bucket("claude-opus-4-8", 10)] }),
            ]),
            [vm("a"), vm("b")],
            "ram"
        );
        expect(over.groups[0].rows.filter((r) => r.burn).map((r) => r.id)).toEqual(["a"]);
        const under = buildConsumers(reading([agent("a", { tokens: [bucket("claude-opus-4-8", 10)] })]), [vm("a")], "ram");
        expect(under.groups[0].rows[0].burn).toBe(false);
    });

    it("lists arcterm's own processes and keeps an unread one absent", () => {
        const view = buildConsumers(reading([], { serverbytes: 121 * MB, hostbytes: 47 * MB }), [], "ram");
        expect(view.own).toEqual([
            { label: "Interface", bytes: undefined },
            { label: "Server", bytes: 121 * MB },
            { label: "Host", bytes: 47 * MB },
        ]);
        expect(view.groups).toEqual([]);
    });
});

describe("copy", () => {
    it("ramLabel shows MB under a gigabyte and GB above", () => {
        expect(ramLabel(300 * MB)).toBe("300 MB");
        expect(ramLabel(2.5 * GB)).toBe("2.5 GB");
    });

    it("stopWorkerMessage names the task and its run", () => {
        const row = { name: "worker t-3", dag: { channelid: "ch", runid: "85548d0b-aaaa", taskid: "t-3" } } as ConsumerRow;
        expect(stopWorkerMessage(row)).toBe(
            "Stop worker t-3 of run 85548d0b? Its task stops and is not retried; tasks after it wait until you Retry or Skip it in the run."
        );
    });

    it("switchToastText says when the switch lands", () => {
        expect(switchToastText("loom", false, false)).toBe("loom switched to Sonnet");
        expect(switchToastText("loom", true, true)).toBe("loom switched to Sonnet");
        expect(switchToastText("loom", true, false)).toBe("loom switches to Sonnet from its next turn");
    });

    it("staleLine names when the last reading landed", () => {
        expect(staleLine(new Date(2026, 9, 8, 12, 3).getTime())).toBe("Couldn't read usage · last at 12:03");
        expect(staleLine(null)).toBe("Couldn't read usage");
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/consumers.test.ts`
Expected: FAIL — `Failed to resolve import "./consumers"`.

- [ ] **Step 3: Write `frontend/app/view/agents/consumers.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: the Consumers panel's rows. Joins a GetConsumersCommand reading with the roster, sorts by RAM or by tokens of
// the window, groups a run's workers under their run, and marks what to warn about and which actions a row offers.
// consumerspanel.tsx draws it. No React, no store.

import type { AgentState, AgentVM } from "./agentsviewmodel";
import { fmtClock } from "./runcompletion";
import { aggregateSessionUsage } from "./sessionusage";
import { formatGB } from "./workercapacity";

export type ConsumersSort = "ram" | "tokens";

// past this many tokens in the window, the busiest agent gets the burn warning
export const BURN_WARN_TOKENS = 500_000;

// the roster's state dots (runstrip.ts SEG_FILL's colors)
export const STATE_DOT: Record<AgentState, string> = {
    working: "bg-accent",
    asking: "bg-warning",
    idle: "bg-muted",
};

export interface ConsumerRow {
    id: string; // tab id
    name: string;
    project?: string;
    state: AgentState;
    model?: string; // short family label ("opus")
    ramBytes?: number;
    tokens?: number; // tokens of the window
    spendUsd?: number; // their client-side cost estimate, as the rail prices it
    opus: boolean; // a Claude agent on Opus
    burn: boolean; // the busiest agent, past BURN_WARN_TOKENS
    canSonnet: boolean;
    dag?: ConsumerDag; // a run worker's task, for Stop
    vm: AgentVM;
}

export interface ConsumerGroup {
    key: string; // the owner run id, or "agents" for the agents you opened
    label?: string; // "Run 85548d0b"
    rows: ConsumerRow[];
}

export interface OwnUsage {
    label: "Interface" | "Server" | "Host";
    bytes?: number;
}

export interface ConsumersView {
    freeBytes: number;
    totalBytes: number;
    groups: ConsumerGroup[];
    own: OwnUsage[];
}

function weight(r: ConsumerRow, sort: ConsumersSort): number | undefined {
    return sort === "ram" ? r.ramBytes : r.tokens;
}

// heaviest first; an unread value after every read one; ties by name
function byWeight(sort: ConsumersSort) {
    return (a: ConsumerRow, b: ConsumerRow): number => {
        const wa = weight(a, sort);
        const wb = weight(b, sort);
        if (wa === undefined || wb === undefined) {
            if (wa !== wb) {
                return wa === undefined ? 1 : -1;
            }
        } else if (wa !== wb) {
            return wb - wa;
        }
        return a.name.localeCompare(b.name);
    };
}

export function buildConsumers(data: CommandGetConsumersRtnData, agents: AgentVM[], sort: ConsumersSort): ConsumersView {
    const byId = new Map(agents.map((a) => [a.id, a]));
    const rows: ConsumerRow[] = [];
    for (const c of data.agents ?? []) {
        const vm = byId.get(c.tabid);
        if (vm == null) {
            continue; // the roster has not seen it yet: nothing to name it by or open
        }
        const usage = c.tokensread ? aggregateSessionUsage(c.tokens ?? []) : undefined;
        const opus = vm.agent === "claude" && vm.model === "opus";
        rows.push({
            id: vm.id,
            name: vm.name,
            project: vm.project,
            state: vm.state,
            model: vm.model,
            ramBytes: c.rambytes,
            tokens: usage?.totalTokens,
            spendUsd: usage?.totalSpendUsd,
            opus,
            burn: false,
            canSonnet: opus,
            dag: c.dag,
            vm,
        });
    }
    const busiest = [...rows].filter((r) => r.tokens !== undefined).sort(byWeight("tokens"))[0];
    if (busiest != null && (busiest.tokens ?? 0) > BURN_WARN_TOKENS) {
        busiest.burn = true;
    }
    const groups = new Map<string, ConsumerGroup>();
    for (const r of rows) {
        const key = r.dag?.runid ?? "agents";
        const g = groups.get(key) ?? { key, label: r.dag ? `Run ${r.dag.runid.slice(0, 8)}` : undefined, rows: [] };
        g.rows.push(r);
        groups.set(key, g);
    }
    const ordered = [...groups.values()];
    for (const g of ordered) {
        g.rows.sort(byWeight(sort));
    }
    ordered.sort((a, b) => byWeight(sort)(a.rows[0], b.rows[0]));
    return {
        freeBytes: data.availablebytes,
        totalBytes: data.totalbytes,
        groups: ordered,
        own: [
            { label: "Interface", bytes: data.interfacebytes },
            { label: "Server", bytes: data.serverbytes },
            { label: "Host", bytes: data.hostbytes },
        ],
    };
}

/** "300 MB" under a gigabyte, "2.5 GB" above. */
export function ramLabel(bytes: number): string {
    return bytes < 2 ** 30 ? `${Math.round(bytes / 2 ** 20)} MB` : formatGB(bytes);
}

/** The confirm a worker's Stop asks (spec decision 8). */
export function stopWorkerMessage(row: ConsumerRow): string {
    const run = row.dag ? ` of run ${row.dag.runid.slice(0, 8)}` : "";
    return `Stop ${row.name}${run}? Its task stops and is not retried; tasks after it wait until you Retry or Skip it in the run.`;
}

/** The toast after → Sonnet: the switch lands now unless the session was mid-turn and /model waits for the turn. */
export function switchToastText(name: string, midTurn: boolean, appliesMidTurn: boolean): string {
    return midTurn && !appliesMidTurn ? `${name} switches to Sonnet from its next turn` : `${name} switched to Sonnet`;
}

/** The line over a dimmed panel whose last poll failed. */
export function staleLine(lastOkMs: number | null): string {
    return lastOkMs == null ? "Couldn't read usage" : `Couldn't read usage · last at ${fmtClock(lastOkMs)}`;
}
```

Note: a worker row's `name` is its tab name (`worker t-3` in the test); the message reads "Stop worker t-3 of run 85548d0b?".

- [ ] **Step 4: Run the tests**

Run: `npx vitest run frontend/app/view/agents/consumers.test.ts && npx prettier --check frontend/app/view/agents/consumers.ts frontend/app/view/agents/consumers.test.ts && npx eslint frontend/app/view/agents/consumers.ts frontend/app/view/agents/consumers.test.ts`
Expected: PASS; prettier and eslint clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/view/agents/consumers.ts frontend/app/view/agents/consumers.test.ts
git commit -m "feat(agents): the Consumers panel's model: rows by RAM or tokens, runs, warnings"
```

---

### Task 7: The panel — store, popover, openers, actions
**Depends on:** Task 1, Task 4, Task 6

**Files:**
- Create: `frontend/app/view/agents/consumersstore.ts`, `frontend/app/view/agents/consumersstore.test.ts`, `frontend/app/view/agents/consumerspanel.tsx`
- Modify: `frontend/app/view/agents/workercapacitychip.tsx`, `frontend/app/view/agents/usagemeters.tsx`, `frontend/app/cockpit/app-bar.tsx`, `CHANGELOG.md`

**Interfaces:**
- Consumes: Task 6's `buildConsumers`, `ramLabel`, `staleLine`, `STATE_DOT`, `stopWorkerMessage`, `switchToastText`, `ConsumerRow`, `ConsumersSort`; Task 5's `RpcApi.GetConsumersCommand`, `RpcApi.AgentsSetModelCommand`; Task 4's dag action `"stop"` through `RpcApi.DagActionCommand`; `confirmCloseSession` (`agentactions.ts`), `openTarget` (`jarvis/openref.ts`), `pushToast` (`cockpit/notificationstore.ts`), `modalsModel.pushModal("ConfirmModal", …)`, `PopoverReveal`, `Segmented`, `SkeletonLine`, `planDonuts` (via `usePlanDonuts`), `fmt`, `usd` (`usagestats.ts`), `formatGB`.
- Produces: `consumersOpenAtom`, `consumersReadingAtom`, `CONSUMERS_POLL_MS`, `loadConsumers`, `toggleConsumers`, `useConsumersPoll`, `ConsumersPanel`, `usePlanDonuts`; DOM hooks for Task 8: `[data-consumers-panel][data-sort]`, `[data-consumer-row]`, `[data-consumer-opus]`, `[data-consumer-burn]`, `[data-consumer-sonnet]`, `[data-consumer-stop]`, `[data-consumers-own]`, `[data-consumers-stale]`, `[data-usage-meters]`, and `[data-worker-capacity]` (kept).

- [ ] **Step 1: Write the failing store tests**

`frontend/app/view/agents/consumersstore.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { GetConsumersCommand: vi.fn() } }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { globalStore } from "@/app/store/jotaiStore";
import { consumersOpenAtom, consumersReadingAtom, loadConsumers, toggleConsumers } from "./consumersstore";

const reading: CommandGetConsumersRtnData = { totalbytes: 8, availablebytes: 2, windowms: 600_000, agents: [] };

describe("loadConsumers", () => {
    beforeEach(() => globalStore.set(consumersReadingAtom, { data: null, lastOkMs: null, failed: false }));

    it("stores a reading with when it landed", async () => {
        await loadConsumers(async () => reading, () => 1000);
        expect(globalStore.get(consumersReadingAtom)).toEqual({ data: reading, lastOkMs: 1000, failed: false });
    });

    it("keeps the last reading when a poll fails", async () => {
        await loadConsumers(async () => reading, () => 1000);
        await loadConsumers(async () => {
            throw new Error("wavesrv restarting");
        });
        expect(globalStore.get(consumersReadingAtom)).toEqual({ data: reading, lastOkMs: 1000, failed: true });
    });
});

describe("toggleConsumers", () => {
    beforeEach(() => globalStore.set(consumersOpenAtom, null));

    it("opens on a sort, closes on the same opener, and switches sort from the other", () => {
        toggleConsumers("ram");
        expect(globalStore.get(consumersOpenAtom)).toBe("ram");
        toggleConsumers("tokens");
        expect(globalStore.get(consumersOpenAtom)).toBe("tokens");
        toggleConsumers("tokens");
        expect(globalStore.get(consumersOpenAtom)).toBeNull();
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/consumersstore.test.ts`
Expected: FAIL — `Failed to resolve import "./consumersstore"`.

- [ ] **Step 3: Write `frontend/app/view/agents/consumersstore.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Consumers panel's state: whether it is open and on which sort, and its last GetConsumers reading. The poll
// runs only while the panel is open.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import { useEffect } from "react";
import type { ConsumersSort } from "./consumers";

export const CONSUMERS_POLL_MS = 5_000;

// null = closed
export const consumersOpenAtom = atom<ConsumersSort | null>(null) as PrimitiveAtom<ConsumersSort | null>;

export interface ConsumersReading {
    data: CommandGetConsumersRtnData | null;
    lastOkMs: number | null;
    failed: boolean; // the last poll failed; data is the reading before it
}

export const consumersReadingAtom = atom<ConsumersReading>({
    data: null,
    lastOkMs: null,
    failed: false,
}) as PrimitiveAtom<ConsumersReading>;

export async function loadConsumers(
    read: () => Promise<CommandGetConsumersRtnData> = () => RpcApi.GetConsumersCommand(TabRpcClient),
    now: () => number = Date.now
): Promise<void> {
    try {
        const data = await read();
        globalStore.set(consumersReadingAtom, { data, lastOkMs: now(), failed: false });
    } catch {
        globalStore.set(consumersReadingAtom, (prev) => ({ ...prev, failed: true }));
    }
}

/** An opener's click: opens on its sort, closes when the panel already shows that sort, else switches to it. */
export function toggleConsumers(sort: ConsumersSort): void {
    globalStore.set(consumersOpenAtom, (cur) => (cur === sort ? null : sort));
}

/** Polls while open: one read at once, then every CONSUMERS_POLL_MS, stopped when the panel closes. */
export function useConsumersPoll(open: boolean): void {
    useEffect(() => {
        if (!open) {
            return;
        }
        void loadConsumers();
        const timer = setInterval(() => void loadConsumers(), CONSUMERS_POLL_MS);
        return () => clearInterval(timer);
    }, [open]);
}
```

Run: `npx vitest run frontend/app/view/agents/consumersstore.test.ts`
Expected: PASS.

- [ ] **Step 4: Share the plan donuts out of the usage meters, and make the meters open the panel**

In `frontend/app/view/agents/usagemeters.tsx`, add `import { toggleConsumers } from "./consumersstore";`, then replace the body of `HeaderUsageMeters` so the reads move into an exported hook:

```tsx
/** The plan windows the app bar shows: every live agent's reading merged over the saved snapshot (planDonuts). */
export function usePlanDonuts(model: AgentsViewModel): ReturnType<typeof planDonuts> {
    const agents = useAtomValue(model.agentsAtom);
    const saved = useAtomValue(savedRateLimitsAtom);
    const activeKey = useAtomValue(activeClaudeKeyAtom);
    const identity = useAtomValue(claudeIdentityAtom);
    const now = useAtomValue(model.nowAtom);
    return planDonuts(agents, saved, activeKey, identity, now);
}

export function HeaderUsageMeters({ model }: { model: AgentsViewModel }) {
    const activeAccount = useAtomValue(activeClaudeAccountAtom);
    const windowTokens = useAtomValue(windowTokensAtom);
    const now = useAtomValue(model.nowAtom);
    const donuts = usePlanDonuts(model);
    const claude = donuts.find((d) => d.provider === "claude");
    useEffect(() => {
        if (claude == null) {
            return;
        }
        fireAndForget(() => loadWindowTokens(claude.fivehour.reset, claude.week.reset));
    }, [claude?.fivehour.reset, claude?.week.reset]);
    return (
        <UsageMeters
            donuts={donuts}
            windowTokens={windowTokens}
            now={now}
            activeAccount={activeAccount}
            onOpen={() => toggleConsumers("tokens")}
        />
    );
}
```

In `UsageMeters`, change the open button's `title` from `[...items.map((m) => m.title), "Open Usage"].join("\n")` to `[...items.map((m) => m.title), "Token use by agent"].join("\n")`, and add `data-usage-meters` and `aria-haspopup="dialog"` to that `<button>`. Remove `globalStore` from the imports if nothing else uses it (eslint will say).

- [ ] **Step 5: Make the RAM chip a button that opens the panel**

Replace the returned element of `WorkerCapacityChip` in `frontend/app/view/agents/workercapacitychip.tsx` (and add `import { toggleConsumers } from "./consumersstore";`):

```tsx
    return (
        <button
            type="button"
            data-worker-capacity
            aria-haspopup="dialog"
            title={capacityTitle(cap)}
            onClick={() => toggleConsumers("ram")}
            className={cn(
                "flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded px-1 py-0.5 text-[11.5px] font-semibold tabular-nums hover:bg-surface-hover",
                low ? "text-warning" : "text-muted"
            )}
        >
            <Icon size={12} aria-hidden />
            {capacityChipLabel(cap)}
        </button>
    );
```

Update its comment: `// The app bar's RAM chip: the free RAM, with how many more workers that holds in the tooltip; a click opens the Consumers panel sorted by RAM. Nothing until there is a reading. When the free RAM is low (lowRam) it takes the warning tone of the version-mismatch pill beside it.` (It is interactive now, so it drops `data-tauri-drag-region`.)

- [ ] **Step 6: Write `frontend/app/view/agents/consumerspanel.tsx`**

Set `MODEL_SWITCH_APPLIES_MIDTURN` from this plan's Execution notes: `true` only if the line reads `model-switch-midturn: yes`.

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Consumers panel (spec 2026-10-08-consumers-panel-design.md): every live agent by RAM or by tokens of the last
// 10 minutes, a run's workers under their run, arcterm's own processes below, and Stop / → Sonnet per row. Opened
// from the RAM chip (sorted by RAM) and the plan-usage meters (sorted by tokens). consumers.ts decides; this draws.

import { pushToast } from "@/app/cockpit/notificationstore";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { Segmented } from "@/app/element/segmented";
import { SkeletonLine } from "@/app/element/skeleton";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { openTarget } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { confirmCloseSession } from "./agentactions";
import type { AgentsViewModel } from "./agents";
import {
    buildConsumers,
    ramLabel,
    STATE_DOT,
    staleLine,
    stopWorkerMessage,
    switchToastText,
    type ConsumerRow,
    type ConsumersSort,
} from "./consumers";
import { consumersOpenAtom, consumersReadingAtom, useConsumersPoll } from "./consumersstore";
import { usePlanDonuts } from "./usagemeters";
import { fmt, usd } from "./usagestats";
import { formatGB } from "./workercapacity";

// whether `/model` switches a Claude session inside a running turn: the consumers-panel plan's Task 1 found it
const MODEL_SWITCH_APPLIES_MIDTURN = false;

// stopping a worker waits for it to exit
const STOP_TIMEOUT_MS = 60_000;

const SORTS: { key: ConsumersSort; label: string }[] = [
    { key: "ram", label: "RAM" },
    { key: "tokens", label: "Tokens" },
];

function close(): void {
    globalStore.set(consumersOpenAtom, null);
}

function stop(row: ConsumerRow, model: AgentsViewModel): void {
    const dag = row.dag;
    if (dag == null) {
        confirmCloseSession(row.vm, model);
        return;
    }
    modalsModel.pushModal("ConfirmModal", {
        title: "Stop worker",
        message: stopWorkerMessage(row),
        confirmLabel: "Stop worker",
        destructive: true,
        onConfirm: () =>
            fireAndForget(async () => {
                try {
                    await RpcApi.DagActionCommand(
                        TabRpcClient,
                        { channelid: dag.channelid, runid: dag.runid, taskid: dag.taskid, action: "stop" },
                        { timeout: STOP_TIMEOUT_MS }
                    );
                    pushToast({ title: `${row.name} stopped`, message: "Its task waits until you retry or skip it.", level: "info" });
                } catch (e) {
                    pushToast({ title: `Couldn't stop ${row.name}`, message: String(e), level: "error" });
                }
            }),
    });
}

function toSonnet(row: ConsumerRow): void {
    fireAndForget(async () => {
        try {
            const rtn = await RpcApi.AgentsSetModelCommand(TabRpcClient, { tab: row.id, model: "sonnet" });
            pushToast({
                title: switchToastText(row.name, rtn.midturn, MODEL_SWITCH_APPLIES_MIDTURN),
                message: "Its model label changes with its next status.",
                level: "info",
            });
        } catch (e) {
            pushToast({ title: `Couldn't switch ${row.name} to Sonnet`, message: String(e), level: "error" });
        }
    });
}

function Row({ row, model }: { row: ConsumerRow; model: AgentsViewModel }) {
    return (
        <div data-consumer-row={row.id} className="flex items-center gap-2 px-3 py-[5px] hover:bg-surface-hover">
            <span className={cn("h-[7px] w-[7px] flex-none rounded-full", STATE_DOT[row.state])} aria-label={row.state} />
            <button
                type="button"
                title={`Open ${row.name}`}
                onClick={() => {
                    close();
                    fireAndForget(() => openTarget(model, { kind: "agent", tabId: row.id }));
                }}
                className="min-w-0 flex-1 cursor-pointer truncate text-left text-[12.5px] text-primary"
            >
                {row.name}
                {row.project ? <span className="ml-1.5 text-[11px] text-muted">{row.project}</span> : null}
            </button>
            {row.model ? (
                <span
                    data-consumer-opus={row.opus ? "" : undefined}
                    title={row.opus ? "Runs on Opus" : undefined}
                    className={cn("text-[11px] font-semibold", row.opus ? "text-warning" : "text-muted")}
                >
                    {row.model}
                </span>
            ) : null}
            <span className="w-[62px] text-right text-[12px] tabular-nums text-secondary">
                {row.ramBytes === undefined ? "—" : ramLabel(row.ramBytes)}
            </span>
            <span className="flex w-[104px] items-center justify-end gap-1 text-[12px] tabular-nums text-secondary">
                {row.burn ? (
                    <TriangleAlert data-consumer-burn size={12} className="text-warning" aria-label="Spending fastest" />
                ) : null}
                {row.tokens === undefined ? "—" : `${fmt(row.tokens)} · ${usd(row.spendUsd ?? 0)}`}
            </span>
            {row.canSonnet ? (
                <button
                    type="button"
                    data-consumer-sonnet
                    title="Switch this session to Sonnet (/model sonnet)"
                    onClick={() => toSonnet(row)}
                    className="cursor-pointer rounded border border-edge-mid px-1.5 py-[1px] text-[11px] text-secondary hover:border-edge-strong hover:bg-surface-hover"
                >
                    → Sonnet
                </button>
            ) : null}
            <button
                type="button"
                data-consumer-stop
                title={row.dag ? "Stop this worker; its task is not retried" : "End this agent's session"}
                onClick={() => stop(row, model)}
                className="cursor-pointer rounded border border-edge-mid px-1.5 py-[1px] text-[11px] text-error hover:border-edge-strong hover:bg-surface-hover"
            >
                Stop
            </button>
        </div>
    );
}

export function ConsumersPanel({ model }: { model: AgentsViewModel }) {
    const sort = useAtomValue(consumersOpenAtom);
    const open = sort != null;
    const reading = useAtomValue(consumersReadingAtom);
    const agents = useAtomValue(model.agentsAtom);
    const fiveHour = usePlanDonuts(model).find((d) => d.provider === "claude")?.fivehour.pct;
    useConsumersPoll(open);
    useEffect(() => {
        if (!open) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                close();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [open]);
    const view = reading.data != null && sort != null ? buildConsumers(reading.data, agents, sort) : null;
    return (
        <>
            {open ? <div className="fixed inset-0 z-50" onClick={close} /> : null}
            <PopoverReveal
                open={open}
                origin="top right"
                className="absolute right-0 top-[calc(100%+7px)] z-[60] w-[520px] overflow-hidden rounded-lg border border-edge-strong bg-surface-raised shadow-popover"
            >
                <div data-consumers-panel data-sort={sort ?? ""} role="dialog" aria-label="Consumers">
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                        <span className="flex-1 text-[12px] text-secondary">
                            {view ? `${formatGB(view.freeBytes)} free of ${formatGB(view.totalBytes)}` : "Reading…"}
                            {fiveHour != null ? ` · 5h quota ${Math.round(fiveHour)}%` : ""}
                        </span>
                        <Segmented
                            value={sort ?? "ram"}
                            options={SORTS}
                            onChange={(v) => globalStore.set(consumersOpenAtom, v)}
                            ariaLabel="Sort by"
                        />
                    </div>
                    {reading.failed ? (
                        <div data-consumers-stale className="px-3 py-1.5 text-[11.5px] text-warning">
                            {staleLine(reading.lastOkMs)}
                        </div>
                    ) : null}
                    <div className={cn("max-h-[56vh] overflow-y-auto py-1", reading.failed && "opacity-60")}>
                        {view == null ? (
                            <div className="flex flex-col gap-2 px-3 py-2">
                                <SkeletonLine className="w-3/4" />
                                <SkeletonLine className="w-2/3" />
                            </div>
                        ) : view.groups.length === 0 ? (
                            <div className="px-3 py-2 text-[12px] text-muted">No agents running.</div>
                        ) : (
                            view.groups.map((g) => (
                                <div key={g.key}>
                                    {g.label ? (
                                        <div className="px-3 pb-0.5 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
                                            {g.label}
                                        </div>
                                    ) : null}
                                    {g.rows.map((r) => (
                                        <Row key={r.id} row={r} model={model} />
                                    ))}
                                </div>
                            ))
                        )}
                    </div>
                    <div className="border-t border-border px-3 py-1.5">
                        <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">arcterm</div>
                        {(view?.own ?? []).map((o) => (
                            <div
                                key={o.label}
                                data-consumers-own={o.label}
                                className="flex items-center justify-between py-[2px] text-[12px] text-secondary"
                            >
                                <span>{o.label}</span>
                                <span className="tabular-nums">{o.bytes === undefined ? "—" : ramLabel(o.bytes)}</span>
                            </div>
                        ))}
                    </div>
                    <div className="flex justify-end border-t border-border px-3 py-1.5">
                        <button
                            type="button"
                            onClick={() => {
                                close();
                                globalStore.set(model.surfaceAtom, "usage");
                            }}
                            className="cursor-pointer text-[11.5px] text-accent hover:underline"
                        >
                            Open Usage
                        </button>
                    </div>
                </div>
            </PopoverReveal>
        </>
    );
}
```

- [ ] **Step 7: Mount it under the app bar's right-hand group**

In `frontend/app/cockpit/app-bar.tsx`, add `import { ConsumersPanel } from "@/app/view/agents/consumerspanel";`, add `relative` to the right-hand group's class (`className="relative flex h-full shrink-0 items-center gap-2.5"`), and render the panel as that group's last child, after `{mac ? null : <WindowControls />}`:

```tsx
                <ConsumersPanel model={model} />
```

- [ ] **Step 8: Add the CHANGELOG line**

In `CHANGELOG.md`, under the top `## Unreleased` → `### Added` (create the subsection if the section has none), add:

```
- Clicking the app bar's RAM chip opens **Consumers**: every running agent with its RAM, model and tokens of the last
  10 minutes, a run's workers under their run, and arcterm's own memory below. **Stop** ends an agent (a worker's task
  is not retried), and an agent on Opus has **→ Sonnet**. The plan-usage meters open it sorted by tokens; **Open
  Usage** at its foot goes to the Usage surface.
```

- [ ] **Step 9: Check types, lint, format and tests**

Run:
```bash
NODE_OPTIONS=--max-old-space-size=4096 task check:ts
npx eslint frontend/app/view/agents/consumerspanel.tsx frontend/app/view/agents/consumersstore.ts frontend/app/view/agents/consumersstore.test.ts frontend/app/view/agents/workercapacitychip.tsx frontend/app/view/agents/usagemeters.tsx frontend/app/cockpit/app-bar.tsx
npx prettier --check frontend/app/view/agents/consumerspanel.tsx frontend/app/view/agents/consumersstore.ts frontend/app/view/agents/consumersstore.test.ts frontend/app/view/agents/workercapacitychip.tsx frontend/app/view/agents/usagemeters.tsx frontend/app/cockpit/app-bar.tsx
npx vitest run frontend/app/view/agents/
```
Expected: check:ts exits 0 (the baseline is clean); eslint and prettier report nothing for these files; vitest PASS.

- [ ] **Step 10: Commit**

```bash
git add frontend/app/view/agents/consumersstore.ts frontend/app/view/agents/consumersstore.test.ts frontend/app/view/agents/consumerspanel.tsx frontend/app/view/agents/workercapacitychip.tsx frontend/app/view/agents/usagemeters.tsx frontend/app/cockpit/app-bar.tsx CHANGELOG.md
git commit -m "feat(agents): the Consumers panel: agents by RAM or tokens, Stop and → Sonnet"
```

---

### Task 8: CDP scenario `consumers-popover`
**Depends on:** Task 7

**Files:**
- Modify: `scripts/cdp/scenarios.mjs` (a new scenario beside `workerCapacity`, its registration in `SCENARIOS`)

**Interfaces:**
- Consumes: Task 7's DOM hooks; the fixture roster file `TREE_RAIL_FIXTURE` (`public/cockpit-fixtures/active.json`); `ahResolveModules`; the `h` harness (`h.rpc`, `h.ev`, `h.shot`).
- Produces: the scenario the plan's Final names, writing `cdp-shots/consumers-ram.png` and `cdp-shots/consumers-tokens.png`.

- [ ] **Step 1: Add the scenario**

In `scripts/cdp/scenarios.mjs`, after the `workerCapacity` scenario's closing `};`, add (4-space indent, matching the file; never run prettier on it):

```js
// --- consumers-popover: the RAM chip opens the Consumers panel (docs/superpowers/specs/2026-10-08-consumers-panel-design.md).
// The roster is a fixture (three agents: one you opened, a run worker on Opus, a pi agent) and GetConsumers is mocked
// with their RAM and tokens, so the panel's order, grouping, warnings and actions are known.
const CONSUMERS_MOCK_KEY = "__arcConsumersMock";
const CONSUMERS_FIXTURE = [
    { id: "fx-consumers-mine", name: "tối ưu RAM", project: "arcterm", task: "", state: "working", agent: "claude", model: "sonnet", blockId: "fx-blk-mine" },
    { id: "fx-consumers-worker", name: "worker t-3", project: "arcterm", task: "", state: "working", agent: "claude", model: "opus", blockId: "fx-blk-worker", runId: "fx-child-run" },
    { id: "fx-consumers-pi", name: "pi scout", project: "arcterm", task: "", state: "idle", agent: "pi", model: "opus", blockId: "fx-blk-pi" },
];
const consumersBucket = (model, output) => ({ harness: "claude", provider: "anthropic", model, day: "2026-10-08", input: 0, output, reasoning: 0, cacheread: 0, cachecreate: 0, cachecreate1h: 0, msgs: 1 });
const CONSUMERS_READING = {
    totalbytes: 8 * 2 ** 30,
    availablebytes: 1.3 * 2 ** 30,
    windowms: 600_000,
    interfacebytes: 684 * 2 ** 20,
    serverbytes: 121 * 2 ** 20,
    hostbytes: 47 * 2 ** 20,
    agents: [
        { tabid: "fx-consumers-mine", blockid: "fx-blk-mine", rambytes: 300 * 2 ** 20, tokensread: true, tokens: [consumersBucket("claude-sonnet-4-6", 80_000)] },
        { tabid: "fx-consumers-worker", blockid: "fx-blk-worker", rambytes: 2.5 * 2 ** 30, tokensread: true, tokens: [consumersBucket("claude-opus-4-8", 1_200_000)], dag: { channelid: "fx-ch", runid: "85548d0b-fx", taskid: "t-3" } },
        { tabid: "fx-consumers-pi", blockid: "fx-blk-pi", rambytes: 200 * 2 ** 20, tokensread: false },
    ],
};

// Answers getconsumers with `reading` through RpcApi's mock client (installCapacityMock's pattern) and passes every
// other command on. A reload drops it, so install it after the scenario's last reload.
async function installConsumersMock(h, reading) {
    const resolved = await ahResolveModules(h);
    if (resolved.error) return `unresolved: ${resolved.error}`;
    return h.ev(`(async () => {
        const api = (await import(${JSON.stringify(resolved.urls.api)})).RpcApi;
        if (!api || typeof api.setMockRpcClient !== "function") return "no-api";
        if (window.${CONSUMERS_MOCK_KEY}) return "already-installed";
        const prev = api.mockClient ?? null;
        const reading = ${JSON.stringify(reading)};
        api.setMockRpcClient({
            mockWshRpcCall(client, command, data, opts) {
                if (command === "getconsumers") return Promise.resolve(reading);
                return prev ? prev.mockWshRpcCall(client, command, data, opts) : client.wshRpcCall(command, data, opts);
            },
            mockWshRpcStream(client, command, data, opts) {
                return prev ? prev.mockWshRpcStream(client, command, data, opts) : client.wshRpcStream(command, data, opts);
            },
        });
        window.${CONSUMERS_MOCK_KEY} = { api, prev };
        return "installed";
    })()`);
}

const removeConsumersMock = (h) =>
    h.ev(`(() => {
        const m = window.${CONSUMERS_MOCK_KEY};
        if (!m) return "absent";
        m.api.setMockRpcClient(m.prev);
        delete window.${CONSUMERS_MOCK_KEY};
        return "restored";
    })()`);

const consumersPopover = {
    name: "consumers-popover",
    surface: "cockpit",
    async arrange(h) {
        const ctx = {};
        try {
            mkdirSync(new URL(".", TREE_RAIL_FIXTURE), { recursive: true });
            writeFileSync(TREE_RAIL_FIXTURE, JSON.stringify(CONSUMERS_FIXTURE, null, 2));
            ctx.wroteFixture = true;
            await h.ev("location.reload()");
            await h.ev("new Promise((r) => setTimeout(r, 2500))");
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const settle = (ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);
        if (ctx.arrangeError != null) {
            rec("0. arrange the fixture roster", false, ctx.arrangeError);
            return steps;
        }

        const live = await h.rpc("getconsumers", null);
        rec(
            "1. GetConsumersCommand reads the machine",
            !!live && live.totalbytes > 0 && Array.isArray(live.agents),
            JSON.stringify(live).slice(0, 300)
        );

        const mocked = await installConsumersMock(h, CONSUMERS_READING);
        await h.ev(`document.querySelector("[data-worker-capacity]")?.click()`);
        let panel = null;
        for (let waited = 0; waited <= 8000; waited += 250) {
            panel = await h.ev(`(() => {
                const p = document.querySelector("[data-consumers-panel]");
                if (!p) return null;
                return {
                    sort: p.dataset.sort,
                    rows: [...p.querySelectorAll("[data-consumer-row]")].map((r) => r.dataset.consumerRow),
                    own: [...p.querySelectorAll("[data-consumers-own]")].map((o) => o.dataset.consumersOwn),
                };
            })()`);
            if (panel && panel.rows.length === 3) break;
            await settle(250);
        }
        await h.shot("cdp-shots/consumers-ram.png");
        rec(
            "2. the RAM chip opens the panel sorted by RAM, the run's worker first",
            mocked === "installed" && !!panel && panel.sort === "ram" && panel.rows[0] === "fx-consumers-worker",
            `mock=${mocked} ${JSON.stringify(panel)}`
        );
        rec(
            "3. arcterm's own processes are listed below",
            !!panel && JSON.stringify(panel.own) === JSON.stringify(["Interface", "Server", "Host"]),
            JSON.stringify(panel?.own)
        );

        const marks = await h.ev(`(() => {
            const row = (id) => document.querySelector('[data-consumer-row="' + id + '"]');
            const w = row("fx-consumers-worker");
            const pi = row("fx-consumers-pi");
            return {
                workerOpus: !!w?.querySelector("[data-consumer-opus]"),
                workerBurn: !!w?.querySelector("[data-consumer-burn]"),
                workerSonnet: !!w?.querySelector("[data-consumer-sonnet]"),
                piSonnet: !!pi?.querySelector("[data-consumer-sonnet]"),
                piStop: !!pi?.querySelector("[data-consumer-stop]"),
                piTokens: pi?.textContent.includes("—") ?? false,
            };
        })()`);
        rec(
            "4. the Opus worker is marked, burns fastest and offers → Sonnet; the pi agent only Stop, its tokens unread",
            marks.workerOpus && marks.workerBurn && marks.workerSonnet && !marks.piSonnet && marks.piStop && marks.piTokens,
            JSON.stringify(marks)
        );

        await h.ev(`[...document.querySelectorAll("[data-consumers-panel] button")].find((b) => b.textContent.trim() === "Tokens")?.click()`);
        await settle(300);
        const tokens = await h.ev(`(() => {
            const p = document.querySelector("[data-consumers-panel]");
            return p ? { sort: p.dataset.sort, first: p.querySelector("[data-consumer-row]")?.dataset.consumerRow } : null;
        })()`);
        await h.shot("cdp-shots/consumers-tokens.png");
        rec("5. the sort toggle ranks by tokens", tokens?.sort === "tokens" && tokens.first === "fx-consumers-worker", JSON.stringify(tokens));

        await h.ev(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
        await settle(500);
        const closed = await h.ev(`!document.querySelector("[data-consumers-panel]")`);
        rec("6. Escape closes it", closed === true, String(closed));

        const meters = await h.ev(`!!document.querySelector("[data-usage-meters]")`);
        if (meters) {
            await h.ev(`document.querySelector("[data-usage-meters]").click()`);
            await settle(500);
            const sort = await h.ev(`document.querySelector("[data-consumers-panel]")?.dataset.sort ?? null`);
            rec("7. the plan-usage meters open it sorted by tokens", sort === "tokens", String(sort));
            await h.ev(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
        } else {
            rec("7. the plan-usage meters open it sorted by tokens", true, "skipped: no plan reading, so the meters are not drawn");
        }
        return steps;
    },
    async teardown(h, ctx) {
        await removeConsumersMock(h);
        if (ctx.wroteFixture) rmSync(TREE_RAIL_FIXTURE, { force: true });
        await h.ev("location.reload()");
    },
};
```

Then add `consumersPopover,` to the `SCENARIOS` array right after `workerCapacity,`.

- [ ] **Step 2: Check the file parses**

Run: `node --check scripts/cdp/scenarios.mjs && node -e "import('./scripts/cdp/scenarios.mjs').then(m => console.log(m.SCENARIOS.some(s => s.name === 'consumers-popover')))"`
Expected: no syntax error, then `true`.

- [ ] **Step 3: Run it where CDP answers**

On Windows (WebView2 answers CDP): start the dev app (`task dev`), then `task verify:ui -- consumers-popover worker-capacity`.
Expected: every step PASS; `cdp-shots/consumers-ram.png` shows the worker row first under `RUN 85548D0B` with its amber `opus`, ⚠ and `→ Sonnet`, and Interface/Server/Host below. On a Mac this step cannot run (WKWebView answers no CDP): say so in the task's report and leave it to the Final.

- [ ] **Step 4: By hand on the Mac (report what you saw)**

With the installed build carrying these changes: open the panel from the RAM chip; compare each agent's RAM and the Interface row with Activity Monitor (Memory column, `wave-tauri`'s WebKit helpers); Stop an idle agent you opened and watch free RAM rise; if a Claude agent runs on Opus, press → Sonnet and read its next status's model. Write the results in the task's report; a worker without a live app reports this step as not done.

- [ ] **Step 5: Commit**

```bash
git add scripts/cdp/scenarios.mjs
git commit -m "test(cdp): consumers-popover opens the panel over a fixture roster"
```

---

## Execution notes

- model-switch-midturn: (Task 1 writes `yes`, `no` or `unverified` here, with its evidence)
