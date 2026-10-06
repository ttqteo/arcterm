# Worker RAM Capacity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show how much RAM is free and how many more orchestrator workers it holds (an app bar chip), and warn on the three worker steppers when the picked width is more than that.

**Architecture:** A new Go package `pkg/workercap` keeps each live worker's process-tree RSS (fed by the engine's existing liveness sample in `pkg/orchestrate/liveness.go`) and the peaks of the last 10 finished workers, and computes how many more workers fit. One wshrpc command, `GetWorkerCapacityCommand`, reads the OS memory and the tracker. The frontend polls it every 5 s through one shared jotai store and renders a chip on the app bar and a warning triangle beside each worker stepper.

**Tech Stack:** Go 1.25 + gopsutil v4 (`mem`, `process`), wshrpc + `task generate`, React 19 + jotai + Tailwind 4, lucide-react, vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-worker-ram-capacity-design.md`

## Global Constraints

- Show and warn, never block: no stepper, Start or Save is disabled by this feature, and the engine's scheduling is unchanged.
- `DefaultPerWorker = 1536 << 20` (1.5 GiB); `RecentPeaks = 10`; the frontend poll is `5_000` ms.
- Formula: `reserve = Σ max(0, perWorker − rss_i)`; `more = floor((available − reserve) / perWorker)`, never below 0, not capped at `MaxParallelism`.
- Never hand-edit generated files (`frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `pkg/wshrpc/wshclient/wshclient.go`): edit the Go types, then `task generate`.
- Colors only from `@theme` tokens (`text-warning`, `text-muted`, …); never raw hex/rgba in components.
- UI copy is English.
- Typecheck with `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (8 GB Mac; ~2 min, give it a 5-minute timeout). Never `npx tsc`.
- Format-check only the files you touched (`npx prettier --check <files>`, `gofmt -l <files>`); never `--write` the tree, and never run prettier on `scripts/**/*.mjs`.
- Never start a dev app (`task dev`, `cargo tauri dev`) in a task worktree: its `dist/bin` and `src-tauri/target` are symlinks into the main checkout (`.arc/setup`), so a build overwrites the main checkout's binaries, and a launch without `ARC_DEV_NO_GLOBAL_INSTALL=1` replaces `~/.arc/bin/wsh`, which every live agent's hooks run. The rendered UI is checked by the **Final** line's scenarios (`worker-capacity`, `capacity-warn`), which `final-verify.mjs` runs in an isolated dev app on Windows. On macOS (WKWebView, no CDP) Final exits 3 as unverified and the user checks the screenshot after landing. A task's UI acceptance is its scenario steps, which a worker writes and `node --check`s but does not run.

## Review Focus

- Free RAM below the reserve (`available < reserve`, both `uint64`): `more` is 0, never a wrapped huge number. → Task 1 test case "free RAM below the reserve".
- A zero RSS reading (every node of a tree failed to read) or a zero estimate: no division by zero, and the estimate falls back to the default instead of becoming 0. → Task 1 `TestObserveDropsAZeroReading` and the Compute case "a zero estimate falls back to the default".
- A stale wavesrv without the command (the version-mismatch case) or any RPC error: the chip disappears, and the console gets one warning per failure streak, not one every 5 s. → Task 4 store test "warns once per failure streak".
- The launcher's width left unset (`null`), or a live run's new width at or below its running tasks: no warning. → Task 4 `extraWorkers` tests.
- Several consumers mounted at once: one interval, not one per consumer; the poll stops when the last unmounts, and a double release does not drive the count negative. → Task 4 store test "one poll however many users".
- The scenarios' forced over state: the `getworkercapacity` mock goes in after the scenario's last reload (a reload drops it), passes every other command to the previous client, and is removed in teardown even when assert failed. → Task 5 `installCapacityMock` / `removeCapacityMock`, Task 6 `capacity-warn` teardown.

**Verify:** `node scripts/verify.mjs ./pkg/workercap/... ./pkg/orchestrate/... ./pkg/wshrpc/...`
**Final:** `if [ "$(uname)" = Darwin ]; then echo "UI not verified: no CDP on macOS (WKWebView); the user checks the screenshot after landing"; exit 3; fi; node scripts/cdp/final-verify.mjs worker-capacity capacity-warn`

---

### Task 1: `pkg/workercap` — the tracker and the formula

**Depends on:** none

**Files:**
- Create: `pkg/workercap/workercap.go`
- Test: `pkg/workercap/workercap_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `const DefaultPerWorker uint64 = 1536 << 20`, `const RecentPeaks = 10`
  - `func Observe(blockId string, rss uint64)`
  - `func Snapshot(isRunning func(blockId string) bool) (liveRSS []uint64, perWorker uint64, measured bool)`
  - `type Capacity struct { Total, Available, PerWorker, Reserve uint64; Measured bool; LiveWorkers, More int }`
  - `func Compute(total, available, perWorker uint64, liveRSS []uint64) Capacity` (leaves `Measured` false)
  - `func Read(total, available uint64, isRunning func(blockId string) bool) Capacity` (Snapshot + Compute + Measured)

- [ ] **Step 1: Write the failing tests**

Create `pkg/workercap/workercap_test.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package workercap

import (
	"fmt"
	"testing"
)

const gib uint64 = 1 << 30

func resetTracker(t *testing.T) {
	t.Helper()
	wipe := func() {
		mu.Lock()
		live, recent = map[string]sample{}, nil
		mu.Unlock()
	}
	wipe()
	t.Cleanup(wipe)
}

func allRunning(string) bool  { return true }
func noneRunning(string) bool { return false }

func TestCompute(t *testing.T) {
	cases := []struct {
		name      string
		available uint64
		perWorker uint64
		liveRSS   []uint64
		wantPer   uint64
		reserve   uint64
		more      int
	}{
		{"no live workers splits free RAM", 4 * gib, gib, nil, gib, 0, 4},
		{"rounds down", 3*gib + gib/2, gib, nil, gib, 0, 3},
		{"a live worker below the estimate holds its growth room", 4 * gib, 2 * gib, []uint64{gib / 2}, 2 * gib, 3 * gib / 2, 1},
		{"a live worker above the estimate holds nothing", 4 * gib, gib, []uint64{3 * gib}, gib, 0, 4},
		{"free RAM below the reserve is 0, not a wrapped uint64", gib, 2 * gib, []uint64{gib / 4}, 2 * gib, 7 * gib / 4, 0},
		{"a zero estimate falls back to the default", 3 * gib, 0, nil, DefaultPerWorker, 0, 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := Compute(8*gib, tc.available, tc.perWorker, tc.liveRSS)
			if c.Total != 8*gib || c.Available != tc.available || c.PerWorker != tc.wantPer {
				t.Fatalf("passthrough fields wrong: %+v", c)
			}
			if c.Reserve != tc.reserve || c.More != tc.more || c.LiveWorkers != len(tc.liveRSS) {
				t.Fatalf("got reserve %d more %d live %d, want reserve %d more %d live %d",
					c.Reserve, c.More, c.LiveWorkers, tc.reserve, tc.more, len(tc.liveRSS))
			}
		})
	}
}

func TestNoReadingsUseTheDefault(t *testing.T) {
	resetTracker(t)
	liveRSS, per, measured := Snapshot(allRunning)
	if len(liveRSS) != 0 || per != DefaultPerWorker || measured {
		t.Fatalf("got %v %d %v, want no live workers, the default, unmeasured", liveRSS, per, measured)
	}
}

func TestObserveKeepsThePeak(t *testing.T) {
	resetTracker(t)
	Observe("a", 2*gib)
	Observe("a", gib)
	liveRSS, per, measured := Snapshot(allRunning)
	if len(liveRSS) != 1 || liveRSS[0] != gib || per != 2*gib || !measured {
		t.Fatalf("got %v %d %v, want current 1 GiB and peak 2 GiB, measured", liveRSS, per, measured)
	}
}

func TestObserveDropsAZeroReading(t *testing.T) {
	resetTracker(t)
	Observe("a", 0)
	Observe("", gib)
	if _, per, measured := Snapshot(allRunning); per != DefaultPerWorker || measured {
		t.Fatalf("a zero reading or an empty block is not a measurement, got %d %v", per, measured)
	}
}

func TestSnapshotRetiresStoppedBlocks(t *testing.T) {
	resetTracker(t)
	Observe("a", 3*gib)
	Observe("b", gib)
	liveRSS, per, _ := Snapshot(func(id string) bool { return id == "b" })
	if len(liveRSS) != 1 || liveRSS[0] != gib || per != 3*gib {
		t.Fatalf("a stopped worker leaves the live set and keeps its peak, got %v %d", liveRSS, per)
	}
	liveRSS, per, measured := Snapshot(noneRunning)
	if len(liveRSS) != 0 || per != 3*gib || !measured {
		t.Fatalf("finished peaks still set the estimate, got %v %d %v", liveRSS, per, measured)
	}
}

func TestRingKeepsTheLastTen(t *testing.T) {
	resetTracker(t)
	Observe("big", 5*gib)
	Snapshot(noneRunning)
	for i := range RecentPeaks {
		Observe(fmt.Sprint(i), gib)
		Snapshot(noneRunning)
	}
	if _, per, _ := Snapshot(noneRunning); per != gib {
		t.Fatalf("the oldest peak falls out after %d newer ones, got %d", RecentPeaks, per)
	}
}

func TestRead(t *testing.T) {
	resetTracker(t)
	Observe("a", gib)
	c := Read(8*gib, 4*gib, allRunning)
	want := Capacity{Total: 8 * gib, Available: 4 * gib, PerWorker: gib, Reserve: 0, Measured: true, LiveWorkers: 1, More: 4}
	if c != want {
		t.Fatalf("got %+v, want %+v", c, want)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./pkg/workercap/`
Expected: FAIL to compile — `undefined: Compute`, `undefined: mu`, etc.

- [ ] **Step 3: Write the implementation**

Create `pkg/workercap/workercap.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package workercap estimates how many more orchestrator workers the machine's free RAM holds. The engine
// feeds it each live worker's process-tree RSS on its liveness sample (pkg/orchestrate); the app reads it
// through GetWorkerCapacityCommand. The samples live in memory only: workers do not survive a restart either.
package workercap

import "sync"

// DefaultPerWorker is the per-worker estimate before any worker has been sampled: a claude process (~350 MB)
// plus a build or a test run in its tree.
const DefaultPerWorker uint64 = 1536 << 20

// RecentPeaks is how many finished workers' peaks the estimate remembers.
const RecentPeaks = 10

type sample struct {
	rss  uint64
	peak uint64
}

var (
	mu     sync.Mutex
	live   = map[string]sample{} // by worker block id
	recent []uint64              // peaks of the last RecentPeaks finished workers, oldest first
)

// Observe records a live worker's process-tree RSS, keeping its peak. A zero reading (no node of the tree
// could be read) is not a measurement and is dropped, as is an empty block id.
func Observe(blockId string, rss uint64) {
	if blockId == "" || rss == 0 {
		return
	}
	mu.Lock()
	defer mu.Unlock()
	s := live[blockId]
	s.rss = rss
	s.peak = max(s.peak, rss)
	live[blockId] = s
}

// Snapshot retires every live worker whose block no longer runs (its peak joins the recent ones, the oldest
// dropped past RecentPeaks) and returns the live workers' current RSS and the per-worker estimate: the
// highest peak, live or recent. The max, not an average: a worker idles at its prompt and spikes in a build,
// and on a small machine an underestimate is the expensive mistake. With no peak at all it is
// DefaultPerWorker and measured is false.
func Snapshot(isRunning func(blockId string) bool) (liveRSS []uint64, perWorker uint64, measured bool) {
	mu.Lock()
	defer mu.Unlock()
	for id, s := range live {
		if isRunning(id) {
			continue
		}
		delete(live, id)
		recent = append(recent, s.peak)
		if len(recent) > RecentPeaks {
			recent = recent[len(recent)-RecentPeaks:]
		}
	}
	for _, s := range live {
		liveRSS = append(liveRSS, s.rss)
		perWorker = max(perWorker, s.peak)
	}
	for _, p := range recent {
		perWorker = max(perWorker, p)
	}
	if perWorker == 0 {
		return liveRSS, DefaultPerWorker, false
	}
	return liveRSS, perWorker, true
}

// Capacity is how many more workers fit, with the numbers that say why.
type Capacity struct {
	Total       uint64
	Available   uint64
	PerWorker   uint64
	Reserve     uint64 // room the live workers may still grow into
	Measured    bool   // false: PerWorker is DefaultPerWorker
	LiveWorkers int
	More        int
}

// Compute holds back the room every live worker may still grow into (up to perWorker each), then splits what
// is left of available into perWorker slices. Never below 0; not capped at the engine's MaxParallelism,
// because this describes the machine and the steppers cap themselves. A zero perWorker means the default.
func Compute(total, available, perWorker uint64, liveRSS []uint64) Capacity {
	if perWorker == 0 {
		perWorker = DefaultPerWorker
	}
	var reserve uint64
	for _, rss := range liveRSS {
		if rss < perWorker {
			reserve += perWorker - rss
		}
	}
	more := 0
	if available > reserve {
		more = int((available - reserve) / perWorker)
	}
	return Capacity{
		Total:       total,
		Available:   available,
		PerWorker:   perWorker,
		Reserve:     reserve,
		LiveWorkers: len(liveRSS),
		More:        more,
	}
}

// Read is the whole reading: retire stopped workers, estimate, compute.
func Read(total, available uint64, isRunning func(blockId string) bool) Capacity {
	liveRSS, perWorker, measured := Snapshot(isRunning)
	c := Compute(total, available, perWorker, liveRSS)
	c.Measured = measured
	return c
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./pkg/workercap/ -v`
Expected: PASS, every subtest of `TestCompute` and the six tracker tests.

- [ ] **Step 5: Check formatting and commit**

```bash
gofmt -l pkg/workercap
git add pkg/workercap
git commit -m "feat(workercap): estimate how many more workers free RAM holds"
```
`gofmt -l` must print nothing.

---

### Task 2: Feed worker RSS from the engine's liveness sample

**Depends on:** Task 1

**Files:**
- Modify: `pkg/orchestrate/liveness.go` (the `childCPUTime` / `sampleChildCPUTime` block, ~lines 169-189, and `sampleWorkerCPU`, ~lines 236-246)
- Test: `pkg/orchestrate/liveness_test.go` (`stubChildCPU`, ~lines 274-282; add one test)

**Interfaces:**
- Consumes: `workercap.Observe(blockId string, rss uint64)` (Task 1).
- Produces: `var childTreeSample func(blockId string) (treeSample, bool)`, `type treeSample struct { CPUMs int64; RSS uint64 }`, `var observeWorkerRSS func(blockId string, rss uint64)` — all package-private to `orchestrate`.

- [ ] **Step 1: Write the failing test**

In `pkg/orchestrate/liveness_test.go`, replace `stubChildCPU` (keep its name and signature, so its existing callers do not change) with:

```go
func stubChildCPU(t *testing.T, sample func(call int) (int64, bool)) {
	t.Helper()
	prev, calls := childTreeSample, 0
	childTreeSample = func(string) (treeSample, bool) {
		calls++
		cpu, ok := sample(calls)
		return treeSample{CPUMs: cpu}, ok
	}
	t.Cleanup(func() { childTreeSample = prev })
}
```

and add after `TestCPUSampleIsThrottled`:

```go
// The liveness sample is also the worker-capacity reading: the worker's block and its tree's RSS reach
// workercap on the same walk that reads its CPU.
func TestCPUSampleReportsTheTreeRSS(t *testing.T) {
	ctx, g, _ := seedChildWrittenAt(t, "rss-sample", time.Now().Add(-2*time.Minute))
	prevTree := childTreeSample
	childTreeSample = func(string) (treeSample, bool) { return treeSample{CPUMs: 1000, RSS: 700 << 20}, true }
	t.Cleanup(func() { childTreeSample = prevTree })
	var gotBlock string
	var gotRSS uint64
	prevObserve := observeWorkerRSS
	observeWorkerRSS = func(blockId string, rss uint64) { gotBlock, gotRSS = blockId, rss }
	t.Cleanup(func() { observeWorkerRSS = prevObserve })

	tick(t, ctx, g)
	if gotBlock != "worker-block" || gotRSS != 700<<20 {
		t.Fatalf("observeWorkerRSS got (%q, %d), want (\"worker-block\", 700 MiB)", gotBlock, gotRSS)
	}
}
```

(`seedChildWrittenAt` already stubs `workerBlockFn` to return `"worker-block", true`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./pkg/orchestrate/ -run 'CPU|Busy|Stall' `
Expected: FAIL to compile — `undefined: childTreeSample`, `undefined: treeSample`, `undefined: observeWorkerRSS`.

- [ ] **Step 3: Implement**

In `pkg/orchestrate/liveness.go`, replace the `childCPUTime` comment, var and `sampleChildCPUTime` function with:

```go
// treeSample is one reading of a worker's whole process tree: the CPU time (ms) used so far and the resident
// memory now.
type treeSample struct {
	CPUMs int64
	RSS   uint64
}

// childTreeSample reads a block's process tree, and whether a reading exists. A var so tests can script it.
var childTreeSample = sampleChildTree

// observeWorkerRSS feeds the worker-capacity estimate (pkg/workercap). A var so tests can capture it.
var observeWorkerRSS = workercap.Observe

func sampleChildTree(blockId string) (treeSample, bool) {
	pid := blockcontroller.GetBlockControllerPid(blockId)
	if pid <= 0 {
		return treeSample{}, false
	}
	root, err := process.NewProcess(int32(pid))
	if err != nil {
		return treeSample{}, false
	}
	var totalSec float64
	var rss uint64
	// one walk for both: listing the tree is the costly part (on darwin Children() reads every process)
	for _, p := range processTree(root) {
		if times, err := p.Times(); err == nil {
			totalSec += times.User + times.System
		}
		if m, err := p.MemoryInfo(); err == nil {
			rss += m.RSS
		}
	}
	return treeSample{CPUMs: int64(totalSec * 1000), RSS: rss}, true
}
```

Add `"github.com/wavetermdev/waveterm/pkg/workercap"` to the import block (after `pkg/waveobj`, keeping it sorted).

In `sampleWorkerCPU`, replace:

```go
	cpu, ok := childCPUTime(blockId)
	if !ok {
		return cpuNone
	}
```

with:

```go
	s, ok := childTreeSample(blockId)
	if !ok {
		return cpuNone
	}
	observeWorkerRSS(blockId, s.RSS)
	cpu := s.CPUMs
```

Then confirm nothing else names the old symbol: `grep -rn childCPUTime pkg/` must print nothing.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./pkg/orchestrate/`
Expected: PASS (the whole package: the three existing CPU tests through the rewritten stub, and the new one).

- [ ] **Step 5: Check formatting and commit**

HEAD is not gofmt-clean, so never `gofmt -w` an existing file: run `gofmt -d pkg/orchestrate/liveness.go pkg/orchestrate/liveness_test.go` and check that any diff it prints touches only lines you wrote (fix those by hand).

```bash
git add pkg/orchestrate/liveness.go pkg/orchestrate/liveness_test.go
git commit -m "feat(orchestrate): report each worker's tree RSS to workercap"
```

---

### Task 3: `GetWorkerCapacityCommand`

**Depends on:** Task 1

**Files:**
- Modify: `pkg/wshrpc/wshrpctypes_dag.go` (the `DagCommands` interface, lines 14-23; append the return type at the end of the file)
- Create: `pkg/wshrpc/wshserver/wshserver_workercap.go`
- Test: `pkg/wshrpc/wshserver/wshserver_workercap_test.go`
- Regenerated (by `task generate`, never by hand): `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `pkg/wshrpc/wshclient/wshclient.go`

**Interfaces:**
- Consumes: `workercap.Read(total, available uint64, isRunning func(string) bool) workercap.Capacity` (Task 1).
- Produces:
  - Go: `GetWorkerCapacityCommand(ctx context.Context) (*wshrpc.CommandGetWorkerCapacityRtnData, error)`
  - TS (generated): `RpcApi.GetWorkerCapacityCommand(client: WshClient, opts?: RpcOpts): Promise<CommandGetWorkerCapacityRtnData>` and the global type
    `CommandGetWorkerCapacityRtnData = { totalbytes: number; availablebytes: number; perworkerbytes: number; measured: boolean; liveworkers: number; reservebytes: number; moreworkers: number }`
  - RPC wire name: `getworkercapacity`

- [ ] **Step 1: Declare the command and its type**

In `pkg/wshrpc/wshrpctypes_dag.go`, add as the last method of `DagCommands`:

```go
	GetWorkerCapacityCommand(ctx context.Context) (*CommandGetWorkerCapacityRtnData, error)                          // free RAM and how many more workers it holds (pkg/workercap)
```

and append at the end of the file:

```go
// CommandGetWorkerCapacityRtnData is the app bar chip's and the worker steppers' reading (pkg/workercap).
type CommandGetWorkerCapacityRtnData struct {
	TotalBytes     uint64 `json:"totalbytes"`
	AvailableBytes uint64 `json:"availablebytes"` // gopsutil Available: darwin free+inactive, Windows ullAvailPhys
	PerWorkerBytes uint64 `json:"perworkerbytes"`
	Measured       bool   `json:"measured"`    // false: PerWorkerBytes is the default, no worker sampled yet
	LiveWorkers    int    `json:"liveworkers"`
	ReserveBytes   uint64 `json:"reservebytes"` // room the live workers may still grow into
	MoreWorkers    int    `json:"moreworkers"`
}
```

- [ ] **Step 2: Write the failing server tests**

Create `pkg/wshrpc/wshserver/wshserver_workercap_test.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"testing"

	"github.com/shirou/gopsutil/v4/mem"
)

func stubVirtualMemory(t *testing.T, vm *mem.VirtualMemoryStat, err error) {
	t.Helper()
	prev := virtualMemory
	virtualMemory = func(context.Context) (*mem.VirtualMemoryStat, error) { return vm, err }
	t.Cleanup(func() { virtualMemory = prev })
}

func TestWorkerCapacityMapsTheReading(t *testing.T) {
	stubVirtualMemory(t, &mem.VirtualMemoryStat{Total: 8 << 30, Available: 3 << 30}, nil)
	rtn, err := (&WshServer{}).GetWorkerCapacityCommand(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if rtn.TotalBytes != 8<<30 || rtn.AvailableBytes != 3<<30 || rtn.PerWorkerBytes == 0 {
		t.Fatalf("got %+v, want the OS reading passed through and a nonzero estimate", rtn)
	}
	// the tracker is process-wide, so the expected count is derived from what came back
	want := 0
	if rtn.AvailableBytes > rtn.ReserveBytes {
		want = int((rtn.AvailableBytes - rtn.ReserveBytes) / rtn.PerWorkerBytes)
	}
	if rtn.MoreWorkers != want {
		t.Fatalf("MoreWorkers = %d, want %d from %+v", rtn.MoreWorkers, want, rtn)
	}
}

func TestWorkerCapacityReportsAMemoryReadError(t *testing.T) {
	stubVirtualMemory(t, nil, errors.New("host_statistics failed"))
	if _, err := (&WshServer{}).GetWorkerCapacityCommand(context.Background()); err == nil {
		t.Fatal("a failed memory read is an error, not a zero reading")
	}
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `go test ./pkg/wshrpc/wshserver/ -run WorkerCapacity`
Expected: FAIL to compile — `undefined: virtualMemory` and `*WshServer` does not implement `GetWorkerCapacityCommand`.

- [ ] **Step 4: Implement the server command**

Create `pkg/wshrpc/wshserver/wshserver_workercap.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"

	"github.com/shirou/gopsutil/v4/mem"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/workercap"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// virtualMemory is the OS memory reading (host_statistics on darwin, cheap at the chip's 5 s poll). A var so
// tests can script it.
var virtualMemory = mem.VirtualMemoryWithContext

// workerBlockRunning is the tracker's test for retiring a worker into its recent peaks: its block still has a
// running shell.
func workerBlockRunning(blockId string) bool {
	rs := blockcontroller.GetBlockControllerRuntimeStatus(blockId)
	return rs != nil && rs.ShellProcStatus == blockcontroller.Status_Running
}

// GetWorkerCapacityCommand reports free RAM and how many more workers it holds. It only reads: the samples
// come from the engine's liveness tick (pkg/orchestrate/liveness.go).
func (ws *WshServer) GetWorkerCapacityCommand(ctx context.Context) (*wshrpc.CommandGetWorkerCapacityRtnData, error) {
	vm, err := virtualMemory(ctx)
	if err != nil {
		return nil, fmt.Errorf("reading system memory: %w", err)
	}
	c := workercap.Read(vm.Total, vm.Available, workerBlockRunning)
	return &wshrpc.CommandGetWorkerCapacityRtnData{
		TotalBytes:     c.Total,
		AvailableBytes: c.Available,
		PerWorkerBytes: c.PerWorker,
		Measured:       c.Measured,
		LiveWorkers:    c.LiveWorkers,
		ReserveBytes:   c.Reserve,
		MoreWorkers:    c.More,
	}, nil
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `go test ./pkg/wshrpc/wshserver/ -run WorkerCapacity -v`
Expected: PASS, both tests.

- [ ] **Step 6: Regenerate the bindings and build**

Run: `task generate`, then `go build ./...`
Expected: both succeed, and `git status` shows `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts` and `pkg/wshrpc/wshclient/wshclient.go` modified. Confirm:

```bash
grep -n 'GetWorkerCapacityCommand' frontend/app/store/wshclientapi.ts pkg/wshrpc/wshclient/wshclient.go
grep -n 'type CommandGetWorkerCapacityRtnData' -A8 frontend/types/gotypes.d.ts
```

Each grep must find its match, and the TS type must list the seven lowercase fields of the Interfaces block.

- [ ] **Step 7: Run the server package and commit**

`gofmt -l pkg/wshrpc/wshserver/wshserver_workercap.go pkg/wshrpc/wshserver/wshserver_workercap_test.go` must print nothing. For the existing `wshrpctypes_dag.go`, run `gofmt -d` and check that any diff touches only the lines you added (the interface comment column); never `gofmt -w` it. If `git status` shows a changed file other than the three generated ones and your own, stop and report it rather than committing it.

```bash
go test ./pkg/wshrpc/...
git add pkg/wshrpc frontend/app/store/wshclientapi.ts frontend/types/gotypes.d.ts
git commit -m "feat(wshrpc): GetWorkerCapacityCommand reads free RAM and the worker estimate"
```

---

### Task 4: Frontend logic and the shared poll

**Depends on:** Task 3

**Files:**
- Create: `frontend/app/view/agents/workercapacity.ts`
- Create: `frontend/app/view/agents/workercapacitystore.ts`
- Test: `frontend/app/view/agents/workercapacity.test.ts`
- Test: `frontend/app/view/agents/workercapacitystore.test.ts`

**Interfaces:**
- Consumes: the generated `CommandGetWorkerCapacityRtnData` and `RpcApi.GetWorkerCapacityCommand` (Task 3).
- Produces:
  - `type WorkerCapacity = CommandGetWorkerCapacityRtnData`
  - `formatGB(bytes: number): string`
  - `extraWorkers(picked: number | null, running?: number): number`
  - `overCapacity(cap: WorkerCapacity | null, extra: number): boolean`
  - `capacityTitle(cap: WorkerCapacity): string`
  - `capacityWarnTitle(cap: WorkerCapacity): string`
  - `workerCapacityAtom: PrimitiveAtom<WorkerCapacity | null>`
  - `loadWorkerCapacity(read?: () => Promise<WorkerCapacity>): Promise<void>`
  - `acquireCapacityPoll(load?: () => void): () => void` (returns the release)
  - `useWorkerCapacity(): WorkerCapacity | null`
  - `POLL_MS = 5_000`

- [ ] **Step 1: Write the failing logic tests**

Create `frontend/app/view/agents/workercapacity.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    capacityTitle,
    capacityWarnTitle,
    extraWorkers,
    formatGB,
    overCapacity,
    type WorkerCapacity,
} from "./workercapacity";

const GIB = 1024 ** 3;

function cap(over: Partial<WorkerCapacity> = {}): WorkerCapacity {
    return {
        totalbytes: 8 * GIB,
        availablebytes: 1.3 * GIB,
        perworkerbytes: 1.5 * GIB,
        measured: true,
        liveworkers: 2,
        reservebytes: 0,
        moreworkers: 1,
        ...over,
    };
}

describe("formatGB", () => {
    it("shows one decimal and drops a trailing .0", () => {
        expect(formatGB(1.3 * GIB)).toBe("1.3 GB");
        expect(formatGB(8 * GIB)).toBe("8 GB");
        expect(formatGB(0)).toBe("0 GB");
    });
});

describe("extraWorkers", () => {
    it("is the launcher's whole width", () => {
        expect(extraWorkers(3)).toBe(3);
    });
    it("is nothing while the launcher's width is unset", () => {
        expect(extraWorkers(null)).toBe(0);
    });
    it("is the width above the tasks already running on a live run", () => {
        expect(extraWorkers(5, 2)).toBe(3);
    });
    it("is nothing when a live run's width is at or below its running tasks", () => {
        expect(extraWorkers(2, 2)).toBe(0);
        expect(extraWorkers(1, 3)).toBe(0);
    });
});

describe("overCapacity", () => {
    it("is over only past moreworkers", () => {
        expect(overCapacity(cap({ moreworkers: 1 }), 1)).toBe(false);
        expect(overCapacity(cap({ moreworkers: 1 }), 2)).toBe(true);
        expect(overCapacity(cap({ moreworkers: 0 }), 0)).toBe(false);
    });
    it("is never over without a reading", () => {
        expect(overCapacity(null, 8)).toBe(false);
    });
});

describe("tooltips", () => {
    it("the chip's title says one fact per line", () => {
        expect(capacityTitle(cap())).toBe(
            "1.3 GB free of 8 GB\n~1.5 GB per worker (measured)\n2 running · ~1 more fits"
        );
        expect(capacityTitle(cap({ measured: false }))).toContain("(default)");
        expect(capacityTitle(cap({ moreworkers: 0 }))).toContain("~0 more fit");
    });
    it("the stepper warning says how many fit", () => {
        expect(capacityWarnTitle(cap({ moreworkers: 1 }))).toBe("~1 more fits in RAM (1.3 GB free)");
        expect(capacityWarnTitle(cap({ moreworkers: 0 }))).toBe("~0 more fit in RAM (1.3 GB free)");
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run frontend/app/view/agents/workercapacity.test.ts`
Expected: FAIL — cannot resolve `./workercapacity`.

- [ ] **Step 3: Implement the logic**

Create `frontend/app/view/agents/workercapacity.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// How many more workers the machine's free RAM holds, as the app bar chip and the worker steppers say it. The
// formula is the backend's (pkg/workercap); this file decides what a pick adds and how to word it.

export type WorkerCapacity = CommandGetWorkerCapacityRtnData;

const GIB = 1024 ** 3;

/** "1.3 GB", "8 GB": GiB to one decimal, a trailing .0 dropped. */
export function formatGB(bytes: number): string {
    return `${Number((bytes / GIB).toFixed(1))} GB`;
}

/** How many new workers a pick adds: the launcher's whole width (nothing while it is unset and the lead
 * decides), or on a live run the width above the tasks already running. */
export function extraWorkers(picked: number | null, running = 0): number {
    return picked == null ? 0 : Math.max(0, picked - running);
}

/** Whether a pick adds more workers than fit. Never without a reading: no number, no warning. */
export function overCapacity(cap: WorkerCapacity | null, extra: number): boolean {
    return cap != null && extra > cap.moreworkers;
}

function moreFit(n: number): string {
    return `~${n} more ${n === 1 ? "fits" : "fit"}`;
}

/** The app bar chip's tooltip, one fact per line. */
export function capacityTitle(cap: WorkerCapacity): string {
    return [
        `${formatGB(cap.availablebytes)} free of ${formatGB(cap.totalbytes)}`,
        `~${formatGB(cap.perworkerbytes)} per worker (${cap.measured ? "measured" : "default"})`,
        `${cap.liveworkers} running · ${moreFit(cap.moreworkers)}`,
    ].join("\n");
}

/** The worker stepper's warning tooltip. */
export function capacityWarnTitle(cap: WorkerCapacity): string {
    return `${moreFit(cap.moreworkers)} in RAM (${formatGB(cap.availablebytes)} free)`;
}
```

- [ ] **Step 4: Run the logic tests to verify they pass**

Run: `npx vitest run frontend/app/view/agents/workercapacity.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing store tests**

Create `frontend/app/view/agents/workercapacitystore.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { GetWorkerCapacityCommand: vi.fn() } }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { globalStore } from "@/app/store/jotaiStore";
import type { WorkerCapacity } from "./workercapacity";
import { POLL_MS, acquireCapacityPoll, loadWorkerCapacity, workerCapacityAtom } from "./workercapacitystore";

const reading: WorkerCapacity = {
    totalbytes: 8,
    availablebytes: 4,
    perworkerbytes: 1,
    measured: true,
    liveworkers: 0,
    reservebytes: 0,
    moreworkers: 4,
};

describe("loadWorkerCapacity", () => {
    afterEach(() => vi.restoreAllMocks());

    it("stores a reading", async () => {
        await loadWorkerCapacity(async () => reading);
        expect(globalStore.get(workerCapacityAtom)).toEqual(reading);
    });

    it("clears the reading on a failure and warns once per failure streak", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await loadWorkerCapacity(async () => reading);
        const fail = async (): Promise<WorkerCapacity> => {
            throw new Error("no such command");
        };
        await loadWorkerCapacity(fail);
        expect(globalStore.get(workerCapacityAtom)).toBeNull();
        await loadWorkerCapacity(fail);
        expect(warn).toHaveBeenCalledTimes(1);
        await loadWorkerCapacity(async () => reading);
        await loadWorkerCapacity(fail);
        expect(warn).toHaveBeenCalledTimes(2);
    });
});

describe("acquireCapacityPoll", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("runs one poll however many users, and stops with the last", () => {
        const load = vi.fn();
        const releaseA = acquireCapacityPoll(load);
        const releaseB = acquireCapacityPoll(load);
        expect(load).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(POLL_MS);
        expect(load).toHaveBeenCalledTimes(2);

        releaseA();
        releaseA(); // a second release of the same user is a no-op
        vi.advanceTimersByTime(POLL_MS);
        expect(load).toHaveBeenCalledTimes(3);

        releaseB();
        vi.advanceTimersByTime(POLL_MS * 3);
        expect(load).toHaveBeenCalledTimes(3);
    });

    it("starts again for a user after the last one left", () => {
        const load = vi.fn();
        acquireCapacityPoll(load)();
        const release = acquireCapacityPoll(load);
        expect(load).toHaveBeenCalledTimes(2);
        release();
    });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run frontend/app/view/agents/workercapacitystore.test.ts`
Expected: FAIL — cannot resolve `./workercapacitystore`.

- [ ] **Step 7: Implement the store**

Create `frontend/app/view/agents/workercapacitystore.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The worker-capacity reading, shared by the app bar chip and the worker steppers: one poll however many of
// them are mounted, started by the first and stopped by the last.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { useEffect } from "react";
import type { WorkerCapacity } from "./workercapacity";

export const POLL_MS = 5_000;

// null until the first reading and after a failed one: a stale "+2" is worse than no chip
export const workerCapacityAtom = atom<WorkerCapacity | null>(null) as PrimitiveAtom<WorkerCapacity | null>;

let failing = false;

export async function loadWorkerCapacity(
    read: () => Promise<WorkerCapacity> = () => RpcApi.GetWorkerCapacityCommand(TabRpcClient)
): Promise<void> {
    try {
        globalStore.set(workerCapacityAtom, await read());
        failing = false;
    } catch (e) {
        globalStore.set(workerCapacityAtom, null);
        // once per failure streak: a wavesrv without the command fails every poll
        if (!failing) {
            console.warn("worker capacity:", e);
        }
        failing = true;
    }
}

let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/** Joins the shared poll; the first user starts it (loading at once), the returned release leaves it, and the
 * last release stops it. Releasing twice counts once. */
export function acquireCapacityPoll(load: () => void = () => void loadWorkerCapacity()): () => void {
    users++;
    if (timer == null) {
        load();
        timer = setInterval(load, POLL_MS);
    }
    let released = false;
    return () => {
        if (released) {
            return;
        }
        released = true;
        users--;
        if (users === 0 && timer != null) {
            clearInterval(timer);
            timer = null;
        }
    };
}

export function useWorkerCapacity(): WorkerCapacity | null {
    useEffect(() => acquireCapacityPoll(), []);
    return useAtomValue(workerCapacityAtom);
}
```

- [ ] **Step 8: Run both test files to verify they pass**

Run: `npx vitest run frontend/app/view/agents/workercapacity.test.ts frontend/app/view/agents/workercapacitystore.test.ts`
Expected: PASS.

- [ ] **Step 9: Typecheck, format-check and commit**

```bash
NODE_OPTIONS=--max-old-space-size=4096 task check:ts
npx prettier --check frontend/app/view/agents/workercapacity.ts frontend/app/view/agents/workercapacity.test.ts frontend/app/view/agents/workercapacitystore.ts frontend/app/view/agents/workercapacitystore.test.ts
git add frontend/app/view/agents/workercapacity.ts frontend/app/view/agents/workercapacity.test.ts frontend/app/view/agents/workercapacitystore.ts frontend/app/view/agents/workercapacitystore.test.ts
git commit -m "feat(agents): worker capacity logic and a shared 5s poll"
```
`check:ts` must exit 0 (its baseline is clean). Give it a 5-minute timeout.

---

### Task 5: The app bar chip

**Depends on:** Task 4

**Files:**
- Create: `frontend/app/view/agents/workercapacitychip.tsx`
- Modify: `frontend/app/cockpit/app-bar.tsx` (imports, lines 3-16; the right-hand group, line ~75, before `<HeaderUsageMeters model={model} />`)
- Modify: `scripts/cdp/scenarios.mjs` (add the capacity mock helpers and the `workerCapacity` scenario before `export const SCENARIOS`, and append it to that array)

**Interfaces:**
- Consumes: `useWorkerCapacity()`, `capacityTitle(cap)` (Task 4); in `scenarios.mjs`, the existing `ahResolveModules(h)` (~line 7855; resolves the url the app loads `wshclientapi.ts` by).
- Produces: `WorkerCapacityChip()` (no props); DOM hook `[data-worker-capacity]` on the chip; scenario name `worker-capacity`; in `scenarios.mjs`: `CAPACITY_FULL` (a reading with `moreworkers: 0`), `installCapacityMock(h, reading)` (resolves `"installed"`, or a reason), `removeCapacityMock(h)`.

**Acceptance (UI):** the `worker-capacity` scenario's steps, run by Final: "2. the app bar chip shows +N" (the chip renders), "3. its tooltip carries free RAM and the per-worker estimate", and "4. at +0 the chip turns amber with a TriangleAlert" (the chip's warning state, forced by the mock).

- [ ] **Step 1: Write the chip**

Create `frontend/app/view/agents/workercapacitychip.tsx`:

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { MemoryStick, TriangleAlert } from "lucide-react";
import { capacityTitle } from "./workercapacity";
import { useWorkerCapacity } from "./workercapacitystore";

// The app bar's RAM chip: how many more workers fit, the numbers behind it in the tooltip. Nothing until there
// is a reading. At +0 it takes the warning tone of the version-mismatch pill beside it. A drag region like the
// bar's other non-interactive pieces (app-bar.tsx explains why each one carries its own).
export function WorkerCapacityChip() {
    const cap = useWorkerCapacity();
    if (cap == null) {
        return null;
    }
    const full = cap.moreworkers === 0;
    const Icon = full ? TriangleAlert : MemoryStick;
    return (
        <span
            data-tauri-drag-region
            data-worker-capacity
            title={capacityTitle(cap)}
            className={cn(
                "flex shrink-0 items-center gap-1 whitespace-nowrap text-[11.5px] font-semibold tabular-nums",
                full ? "text-warning" : "text-muted"
            )}
        >
            <Icon size={12} aria-hidden />+{cap.moreworkers}
        </span>
    );
}
```

- [ ] **Step 2: Mount it on the app bar**

In `frontend/app/cockpit/app-bar.tsx`, add the import beside the other `@/app/view/agents/...` imports:

```tsx
import { WorkerCapacityChip } from "@/app/view/agents/workercapacitychip";
```

and in the right-hand group change:

```tsx
                <VersionMismatchPill />
                <HeaderUsageMeters model={model} />
```

to:

```tsx
                <VersionMismatchPill />
                <WorkerCapacityChip />
                <HeaderUsageMeters model={model} />
```

- [ ] **Step 3: Add the CDP scenario**

In `scripts/cdp/scenarios.mjs`, add before `export const SCENARIOS = [` (do not run prettier on this file):

```js
// A worker-capacity reading with no room left, for the scenarios that force the over-capacity state.
const CAPACITY_FULL = {
    totalbytes: 8 * 2 ** 30,
    availablebytes: 2 ** 30,
    perworkerbytes: 1.5 * 2 ** 30,
    measured: false,
    liveworkers: 0,
    reservebytes: 0,
    moreworkers: 0,
};
const CAPACITY_MOCK_KEY = "__arcCapacityMock";

// Answers getworkercapacity with `reading` from the page, through RpcApi's mock client (installAhMock's pattern),
// and passes every other command to what was there. Writing workerCapacityAtom would not hold: globalStore is
// not on window, and the 5 s poll would overwrite it; the mock is what the poll itself reads. A reload drops it,
// so install it after the scenario's last reload.
async function installCapacityMock(h, reading) {
    const resolved = await ahResolveModules(h);
    if (resolved.error) return `unresolved: ${resolved.error}`;
    return h.ev(`(async () => {
        const api = (await import(${JSON.stringify(resolved.urls.api)})).RpcApi;
        if (!api || typeof api.setMockRpcClient !== "function") return "no-api";
        if (window.${CAPACITY_MOCK_KEY}) return "already-installed";
        const prev = api.mockClient ?? null;
        const reading = ${JSON.stringify(reading)};
        api.setMockRpcClient({
            mockWshRpcCall(client, command, data, opts) {
                if (command === "getworkercapacity") return Promise.resolve(reading);
                return prev ? prev.mockWshRpcCall(client, command, data, opts) : client.wshRpcCall(command, data, opts);
            },
            mockWshRpcStream(client, command, data, opts) {
                return prev ? prev.mockWshRpcStream(client, command, data, opts) : client.wshRpcStream(command, data, opts);
            },
        });
        window.${CAPACITY_MOCK_KEY} = { api, prev };
        return "installed";
    })()`);
}

const removeCapacityMock = (h) =>
    h.ev(`(() => {
        const m = window.${CAPACITY_MOCK_KEY};
        if (!m) return "absent";
        m.api.setMockRpcClient(m.prev);
        delete window.${CAPACITY_MOCK_KEY};
        return "restored";
    })()`);

// The app bar's worker-capacity chip: wavesrv answers GetWorkerCapacityCommand and the chip shows its "+N"
// with the numbers in its tooltip. The machine's real RAM decides whether that is +0, so step 4 forces +0 with
// a mocked reading to see the warning tone.
const workerCapacity = {
    name: "worker-capacity",
    surface: "cockpit",
    async arrange() {
        return {};
    },
    async assert(h) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const settle = (ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);

        const cap = await h.rpc("getworkercapacity", null);
        rec(
            "1. GetWorkerCapacityCommand reads the machine",
            !!cap && cap.totalbytes > 0 && cap.perworkerbytes > 0 && cap.moreworkers >= 0,
            JSON.stringify(cap)
        );

        let chip = null;
        for (let waited = 0; waited <= 10000 && !chip; waited += 250) {
            chip = await h.ev(
                `(() => { const c = document.querySelector("[data-worker-capacity]"); return c ? { text: c.textContent, title: c.title } : null; })()`
            );
            if (!chip) await settle(250);
        }
        rec("2. the app bar chip shows +N", !!chip && /^\+\d+$/.test(chip.text.trim()), chip ? chip.text : "no chip after 10s");
        rec(
            "3. its tooltip carries free RAM and the per-worker estimate",
            !!chip && chip.title.includes("free of") && chip.title.includes("per worker"),
            chip ? chip.title : ""
        );

        const mocked = await installCapacityMock(h, CAPACITY_FULL);
        let full = null;
        for (let waited = 0; waited <= 8000; waited += 250) {
            full = await h.ev(
                `(() => { const c = document.querySelector("[data-worker-capacity]"); return c ? { text: c.textContent.trim(), amber: c.classList.contains("text-warning"), triangle: !!c.querySelector("svg.lucide-triangle-alert") } : null; })()`
            );
            if (full && full.text === "+0") break;
            await settle(250);
        }
        await h.shot("cdp-shots/worker-capacity-full.png");
        rec(
            "4. at +0 the chip turns amber with a TriangleAlert",
            mocked === "installed" && !!full && full.text === "+0" && full.amber && full.triangle,
            `mock=${mocked} ${JSON.stringify(full)}`
        );
        return steps;
    },
    async teardown(h) {
        await removeCapacityMock(h);
    },
};
```

and append `workerCapacity,` as the last entry of the `SCENARIOS` array (after `agentRailTabs,`).

(lucide-react 0.542 renders `TriangleAlert` as `svg.lucide-triangle-alert` and `MemoryStick` as `svg.lucide-memory-stick`.)

- [ ] **Step 4: Typecheck, lint and format-check**

```bash
NODE_OPTIONS=--max-old-space-size=4096 task check:ts
npx eslint frontend/app/view/agents/workercapacitychip.tsx frontend/app/cockpit/app-bar.tsx
npx prettier --check frontend/app/view/agents/workercapacitychip.tsx frontend/app/cockpit/app-bar.tsx
node --check scripts/cdp/scenarios.mjs
```
Expected: all exit 0.

Do not start a dev app to look at it (Global Constraints): Final runs `worker-capacity`. In your report, list the UI as not verified by you, naming the scenario steps above that check it.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/view/agents/workercapacitychip.tsx frontend/app/cockpit/app-bar.tsx scripts/cdp/scenarios.mjs
git commit -m "feat(cockpit): app bar chip for how many more workers fit in RAM"
```

---

### Task 6: Over-capacity warning on the three worker steppers

**Depends on:** Task 4, Task 5

**Files:**
- Create: `frontend/app/view/agents/capacitywarn.tsx`
- Modify: `frontend/app/view/agents/runlauncher.tsx` (`ShapeCards`, ~lines 75-110; `WorkerStepper`, ~lines 218-265)
- Modify: `frontend/app/view/jarvis/newruncontrol.tsx` (`NewRunModal` body near `const parallelism = useAtomValue(parallelismAtom);` ~line 299; the "Workers at once" row ~lines 476-479)
- Modify: `frontend/app/view/agents/leadcard.tsx` (the hooks at the top of `LeadCard`, ~lines 121-133; the "Worker parallelism" panel, ~lines 538-556)
- Modify: `docs/orchestrator-guide.md` (after the + Run control table, ~line 160)
- Modify: `scripts/cdp/scenarios.mjs` (add the `capacityWarn` scenario after Task 5's `workerCapacity`, and append it to `SCENARIOS` after `workerCapacity,`)

**Interfaces:**
- Consumes: `useWorkerCapacity()`, `extraWorkers(picked, running?)`, `overCapacity(cap, extra)`, `capacityWarnTitle(cap)`, `type WorkerCapacity` (Task 4); `runningCount(rows)` (existing, `leadcardmodel.ts:281`, already used in `leadcard.tsx`); in `scenarios.mjs`: `CAPACITY_FULL`, `installCapacityMock(h, reading)`, `removeCapacityMock(h)` (Task 5), and the existing `arrangeFixtureRun`, `teardownFixtureRun`, `RUN_SHEET_POLISH_TASKS`, `COCKPIT_LEAD_CARD`, `NEW_RUN`, `polishWaitFor`, `polishNap`.
- Produces: `CapacityWarn({ cap, extra }: { cap: WorkerCapacity | null; extra: number })`; `WorkerStepper` gains an optional `warn?: boolean` (default `false`); DOM hook `[data-capacity-warn]`; scenario name `capacity-warn`.

**Acceptance (UI):** the `capacity-warn` scenario's steps, run by Final with the capacity mocked to `moreworkers: 0`: "1. the mocked reading reaches the chip (+0)", "2. New run's Workers at once warns: amber number and ⚠ with its tooltip", "3. the Brief launcher's workers stepper warns", "4. a live run's Adjust → Worker parallelism warns above its running tasks". Each one checks the number's `text-warning`, the `[data-capacity-warn]` right after its `+` button, and the tooltip `~0 more fit in RAM (1 GB free)`.

- [ ] **Step 1: Write the warning component**

Create `frontend/app/view/agents/capacitywarn.tsx`:

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TriangleAlert } from "lucide-react";
import { capacityWarnTitle, overCapacity, type WorkerCapacity } from "./workercapacity";

// A worker stepper's over-capacity mark: nothing while the pick fits in RAM, a warning triangle with the reason
// in its tooltip when it does not. It disables nothing; the user decides.
export function CapacityWarn({ cap, extra }: { cap: WorkerCapacity | null; extra: number }) {
    if (cap == null || !overCapacity(cap, extra)) {
        return null;
    }
    return (
        <span data-capacity-warn title={capacityWarnTitle(cap)} className="flex shrink-0 text-warning">
            <TriangleAlert size={12} aria-label="More workers than fit in RAM" />
        </span>
    );
}
```

- [ ] **Step 2: Let `WorkerStepper` show a warned number**

In `frontend/app/view/agents/runlauncher.tsx`, extend `WorkerStepper`'s props:

```tsx
export function WorkerStepper({
    value,
    onStep,
    disabled = false,
    unsetLabel = "–",
    warn = false,
}: {
    value: number | null;
    onStep: (delta: number) => void;
    disabled?: boolean;
    // what a null value reads as: the launcher's dash, or the profile's "auto"
    unsetLabel?: string;
    // the pick is more workers than fit in RAM (CapacityWarn says why)
    warn?: boolean;
}) {
```

and change the value span's class from:

```tsx
                    value == null ? "text-ink-mid" : "text-primary"
```

to:

```tsx
                    value == null ? "text-ink-mid" : warn ? "text-warning" : "text-primary"
```

- [ ] **Step 3: Warn in the launcher's `ShapeCards`**

In `runlauncher.tsx`, add imports:

```tsx
import { CapacityWarn } from "./capacitywarn";
import { extraWorkers, overCapacity } from "./workercapacity";
import { useWorkerCapacity } from "./workercapacitystore";
```

In `ShapeCards`, after `const par = useAtomValue(parallelismAtom);` add:

```tsx
    const cap = useWorkerCapacity();
    const extra = extraWorkers(par);
```

and change:

```tsx
                        <WorkerStepper value={par} onStep={stepParallelism} />
```

to:

```tsx
                        <WorkerStepper value={par} onStep={stepParallelism} warn={overCapacity(cap, extra)} />
                        <CapacityWarn cap={cap} extra={extra} />
```

- [ ] **Step 4: Warn in the New run modal's "Workers at once"**

In `frontend/app/view/jarvis/newruncontrol.tsx`, add imports:

```tsx
import { CapacityWarn } from "../agents/capacitywarn";
import { extraWorkers, overCapacity } from "../agents/workercapacity";
import { useWorkerCapacity } from "../agents/workercapacitystore";
```

In `NewRunModal`, after `const parallelism = useAtomValue(parallelismAtom);` add:

```tsx
    const cap = useWorkerCapacity();
    const extra = extraWorkers(parallelism);
```

and change:

```tsx
                                        <WorkerStepper value={parallelism} onStep={stepParallelism} />
```

to:

```tsx
                                        <WorkerStepper
                                            value={parallelism}
                                            onStep={stepParallelism}
                                            warn={overCapacity(cap, extra)}
                                        />
                                        <CapacityWarn cap={cap} extra={extra} />
```

- [ ] **Step 5: Warn on the lead card's "Worker parallelism"**

In `frontend/app/view/agents/leadcard.tsx`, add imports:

```tsx
import { CapacityWarn } from "./capacitywarn";
import { extraWorkers, overCapacity } from "./workercapacity";
import { useWorkerCapacity } from "./workercapacitystore";
```

In `LeadCard`, add with the other hooks at the top of the body (after `const telling = useAtomValue(tellingRowAtom);`, before any conditional return):

```tsx
    const cap = useWorkerCapacity();
```

After `const parValue = par ?? run.dag?.parallelism ?? 1;` add:

```tsx
    // a live run's new width only adds the workers above the tasks already running
    const parExtra = extraWorkers(parValue, runningCount(vm.rows));
```

In the `panel === "adjust"` block, change the value span:

```tsx
                            <span className="min-w-[14px] text-center text-[12px] font-semibold tabular-nums text-primary">
                                {parValue}
                            </span>
```

to:

```tsx
                            <span
                                className={cn(
                                    "min-w-[14px] text-center text-[12px] font-semibold tabular-nums",
                                    overCapacity(cap, parExtra) ? "text-warning" : "text-primary"
                                )}
                            >
                                {parValue}
                            </span>
```

and insert right after the `+` button's closing `</button>` (before the `applies to new dispatches` span):

```tsx
                            <CapacityWarn cap={cap} extra={parExtra} />
```

- [ ] **Step 6: Document it**

In `docs/orchestrator-guide.md`, after the + Run control table (the row ending `| **Goal** | What the lead starts from. |`) and its blank line, add:

```markdown
**RAM.** The chip left of the usage donuts in the top bar reads `+N`: how many more workers this machine's free
RAM holds. Its tooltip gives free RAM, the per-worker estimate and how many workers run now. The estimate is
the highest process-tree peak among the live workers and the last 10 finished ones (1.5 GB until one has been
measured), and each live worker keeps room to grow to it: `more = (free − reserve) ÷ per-worker`, rounded
down. When a width you pick on + Run, or on a live run's **Adjust → Worker parallelism**, adds more workers
than that, the number turns amber with a ⚠ whose tooltip says how many fit. It only warns; the run starts as
picked. The chip turns amber at `+0`.
```

- [ ] **Step 7: Typecheck, lint, format-check and run the frontend tests**

```bash
NODE_OPTIONS=--max-old-space-size=4096 task check:ts
npx eslint frontend/app/view/agents/capacitywarn.tsx frontend/app/view/agents/runlauncher.tsx frontend/app/view/jarvis/newruncontrol.tsx frontend/app/view/agents/leadcard.tsx
npx prettier --check frontend/app/view/agents/capacitywarn.tsx frontend/app/view/agents/runlauncher.tsx frontend/app/view/jarvis/newruncontrol.tsx frontend/app/view/agents/leadcard.tsx
npx vitest run frontend/app/view/agents
```
Expected: all exit 0.

- [ ] **Step 8: Add the `capacity-warn` scenario**

In `scripts/cdp/scenarios.mjs`, after Task 5's `workerCapacity` (do not run prettier on this file), add a scenario that forces the over state with Task 5's mock and checks all three steppers. With `moreworkers: 0`, any width of 1 or more is over, and the launcher's width defaults to `DEFAULT_PARALLELISM` (3), so New run and the launcher need no stepping.

Read the three steppers through one page expression keyed by the stepper's `+` button. `WorkerStepper` renders `−`, the number span, then `+` (`aria-label="More concurrent workers"`), and `CapacityWarn` comes right after `+`. The lead card's panel has the same order, with an unlabelled `+`:

```js
// a worker stepper read from its "+" button: the number before it and the CapacityWarn right after it
const stepperWarnExpr = (plusExpr) => `(() => {
    const plus = ${plusExpr};
    if (!plus) return null;
    const num = plus.previousElementSibling;
    const next = plus.nextElementSibling;
    const warn = next && next.matches("[data-capacity-warn]") ? next : null;
    return { value: num ? num.textContent.trim() : null, amber: !!num && num.classList.contains("text-warning"), warn: !!warn, title: warn ? warn.title : null };
})()`;
const CAPACITY_WARN_TITLE = "~0 more fit in RAM (1 GB free)";
const stepperWarned = (s) => !!s && s.amber && s.warn && s.title === CAPACITY_WARN_TITLE;
```

The scenario, `name: "capacity-warn"`, `surface: "cockpit"`:

- **arrange** (a throw lands in `ctx.arrangeError` and still returns `ctx`, as every fixture scenario does). Make a temp dir. Run `arrangeFixtureRun(h, ctx, "capacity-warn", "capacity-warn lead")`, then `dagsubmit` with `parallelism: 1` and `RUN_SHEET_POLISH_TASKS`, as `arrangeTreeRail` does: `runAdjustable` shows Adjust only for a run with a DAG. That dispatches one real worker, which `teardownFixtureRun` deletes. Also `createchannel` a second channel on the temp dir with no run, `ctx.launcherChannelId`. A channel without a run opens the Brief sheet on its launcher (`briefsheetmodel.ts:27`, `body: "launcher"`). Then reload and wait for `nav button`: the fixture roster and the Brief's channel list are read at boot. Only after that last reload, call `installCapacityMock(h, CAPACITY_FULL)` and keep its result on `ctx.mock`.
- **assert**, recording a step even when a lookup comes back null:
  1. `"1. the mocked reading reaches the chip (+0)"`: `ctx.mock === "installed"`, and within 8 s `[data-worker-capacity]` reads `+0`.
  2. `"2. New run's Workers at once warns: amber number and ⚠ with its tooltip"`: open New run as `new-run-window` does (`[data-new-run]` click, wait for `NEW_RUN`), pick the `orchestrator` shape (its `button[aria-pressed]` whose first child reads `orchestrator`), then `stepperWarned` on `stepperWarnExpr` of the `button[aria-label="More concurrent workers"]` inside `NEW_RUN` (the modal's only one: its Shape cards hide their own stepper). `h.shot("cdp-shots/capacity-warn-new-run.png")`, then close the dialog with Escape.
  3. `"3. the Brief launcher's workers stepper warns"`: go to `jarvis` and open the launcher channel with `window.__openAddress("channel:<launcherChannelId>")`, as `arrangeSheetDagRun` opens a run. If that address does not open the channel's Brief sheet, open it the way the existing Brief-sheet scenarios do, around the `[data-jarvis-brief-sheet="channel"]` checks. Pick `orchestrator` in its Shape cards, then `stepperWarned` on the `button[aria-label="More concurrent workers"]` inside `[data-jarvis-brief-sheet="channel"]`. Take `h.shot("cdp-shots/capacity-warn-launcher.png")`.
  4. `"4. a live run's Adjust → Worker parallelism warns above its running tasks"`: go to `cockpit`. Wait up to 15 s for `COCKPIT_LEAD_CARD` to show an `Adjust` button, click it, then click the panel's `+` once. Find that `+` as the button reading `+` whose parent's text includes `Worker parallelism`. After one step the width is at least 1 above the running tasks, whether or not t-1 is still running. Check `stepperWarned` on that `+` and take `h.shot("cdp-shots/capacity-warn-adjust.png")`. Never click Save: the change must stay local.
- **teardown(h, ctx)**: `removeCapacityMock(h)`, then `deletechannel` on `ctx.launcherChannelId` (best-effort), then `teardownFixtureRun(h, ctx, "capacity-warn")`, which deletes the fixture roster, the run's worker and its channel, reloads, and removes the temp dir.

Append `capacityWarn,` to `SCENARIOS` after `workerCapacity,`. Then:

```bash
node --check scripts/cdp/scenarios.mjs
```

Expected: exit 0. Do not start a dev app to run it (Global Constraints): Final runs `capacity-warn`. In your report, list the UI as not verified by you, naming the four steps.

- [ ] **Step 9: Commit**

```bash
git add frontend/app/view/agents/capacitywarn.tsx frontend/app/view/agents/runlauncher.tsx frontend/app/view/jarvis/newruncontrol.tsx frontend/app/view/agents/leadcard.tsx docs/orchestrator-guide.md scripts/cdp/scenarios.mjs
git commit -m "feat(agents): warn when a worker width is more than fits in RAM"
```
