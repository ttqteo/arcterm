# Menu Bar and Tray Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An arcterm icon in the macOS menu bar and the Windows tray that shows what waits on you, and whose popover
shows memory, CPU, disk, the heavy-job queue, what waits on you and Claude's 5h window, with Free up and Clean up
subpages that act for real.

**Architecture:** The Tauri host owns the icon and a second webview window (`tray`, loading `tray.html`) that exists
only while the popover is open. The cockpit's main webview is the popover's only data source: a `TrayBridge` in the
cockpit shell builds a plain `TraySnapshot` from the stores it already has, emits it as `tray:snapshot`, and runs the
`tray:act` events the popover sends back; the host handles the acts only it can (close, restart, quit, show log, open
Activity Monitor). Go adds machine stats, a memory-pressure event, each agent's heaviest command on every OS, and a
guarded process stop.

**Tech Stack:** Go (gopsutil v4, x/sys), Rust (Tauri 2.11 `tray-icon`, objc2 AppKit on macOS), React 19 + Tailwind 4
+ jotai, vitest, the CDP scenario harness.

**Spec:** `docs/superpowers/specs/2026-10-15-tray-popover-design.md`

**Verify:** `node scripts/verify.mjs ./pkg/machinestats/... ./pkg/memusage/... ./pkg/wshrpc/... ./pkg/wps/... ./pkg/wconfig/...`
**Check:** `NODE_OPTIONS=--max-old-space-size=4096 task check:ts && go vet ./pkg/machinestats/... ./pkg/memusage/... ./pkg/wshrpc/...`
**Final:** `node scripts/cdp/final-verify.mjs tray-main tray-freeup tray-storage tray-quiet tray-critical tray-paused tray-offline tray-windows tray-actions tray-settings-row`
**Prototype:** .superpowers/design/tray-popover/project/

## Global Constraints

- Platforms: macOS on Apple silicon (13+) and Windows. Linux builds compile but get no tray.
- The popover is 360 px wide; its height follows its content, capped at the monitor's work area minus 16 px.
- Colours come only from `@theme` tokens (`frontend/tailwindsetup.css`): no hex or rgba in components. Inter for all
  text; numbers carry `tabular-nums`. The Rust icon pixels are the exception (they are an image, like `pi/themes/arc.json`).
- Copy is verbatim from the canvas boards (Prototype line). Sentence case.
- Never hand-edit generated files (`frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`,
  `frontend/types/waveevent.d.ts`, `pkg/wshrpc/wshclient/wshclient.go`, `pkg/waveobj/metaconsts.go`,
  `pkg/wconfig/metaconsts.go`): edit Go, run `task generate`.
- On this 8 GB Mac prefix the typecheck and Vite builds with `NODE_OPTIONS=--max-old-space-size=4096`.
- cargo is off the agent PATH on this Mac: run Rust commands with `PATH="/opt/homebrew/opt/rustup/bin:$PATH"`.
- No new npm packages and no new Rust crates. Allowed: the `tray-icon` feature of `tauri`, and features of the
  `objc2-app-kit` and `objc2-foundation` dependencies `src-tauri/Cargo.toml` already has.
- Commits carry no Co-Authored-By or other attribution trailer.

## Review Focus

1. **A Stop on a pid that has exited or been reused by another process** since the Free up list was read: the stop is
   refused with a message and nothing is signalled (Task 2, `TestIsDescendantRefuses`).
2. **The popover opening before the first snapshot, or with wavesrv gone:** it shows the loading or offline page,
   never a blank or a crash (Task 5, `pageState` tests and the `tray-offline` scenario).
3. **Long command lines, item titles and agent names:** they truncate with an ellipsis and the popover stays 360 px
   wide (Task 2, `TestShortCommand`; Task 5, the `main` fixture's long title and `tray-main`'s width step).
4. **Counts of 0 and past 9:** no badge or title at 0; "9+" on the Windows badge (Task 3, `badge_text` and
   `mac_title` tests).
5. **A taskbar at the top or a side, or the icon near a screen edge:** the popover lands inside the work area
   (Task 3, `popover_origin` tests).

---

### Task 1: Machine stats, the memory-pressure event and the `app:tray` setting (Go)

**Depends on:** none
**Files:** `pkg/machinestats/machinestats.go`, `pkg/machinestats/machinestats_test.go`, `pkg/machinestats/volume_darwin.go`, `pkg/machinestats/volume_windows.go`, `pkg/machinestats/volume_other.go`, `pkg/wshrpc/wshrpctypes_machine.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wshrpc/wshserver/wshserver_machine.go`, `pkg/wps/wpstypes.go`, `pkg/tsgen/tsgenevent.go`, `cmd/server/main-server.go`, `pkg/wconfig/settingsconfig.go`, `pkg/wconfig/metaconsts.go`, `schema/settings.json`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `frontend/types/waveevent.d.ts`

**Interfaces:**
- Produces (Go): `machinestats.Read(ctx) (machinestats.Stats, error)`, `machinestats.PressureWord(jobqueue.Pressure) string`
  (`"normal" | "high" | "critical" | ""`), `machinestats.WatchPressure(ctx, read, interval, publish func(string))`.
- Produces (wire): `GetMachineStatsCommand(ctx) (*wshrpc.MachineStatsData, error)`; `wshrpc.MachineStatsData{ MemTotal
  uint64 "memtotal"; MemAvailable uint64 "memavailable"; Pressure string "pressure"; CpuPct float64 "cpupct";
  CpuSamples []float64 "cpusamples"; DiskName string "diskname"; DiskTotal uint64 "disktotal"; DiskFree uint64
  "diskfree" }`; event `memorypressure` carrying `wshrpc.MemoryPressureData{ Level string "level" }`; settings key
  `app:tray` (`*bool`, unset is on).
- Produces (TS, generated): `RpcApi.GetMachineStatsCommand(client)`, types `MachineStatsData`, `MemoryPressureData`,
  `SettingsType["app:tray"]`.

- [ ] **Step 1: Write the failing tests**

Create `pkg/machinestats/machinestats_test.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package machinestats

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jobqueue"
)

func TestPressureWord(t *testing.T) {
	cases := map[jobqueue.Pressure]string{
		jobqueue.PressureUnknown:  "",
		jobqueue.PressureNormal:   "normal",
		jobqueue.PressureWarn:     "high",
		jobqueue.PressureCritical: "critical",
	}
	for p, want := range cases {
		if got := PressureWord(p); got != want {
			t.Errorf("PressureWord(%d) = %q, want %q", p, got, want)
		}
	}
}

func TestSamplerSamplesWhileAskedThenStops(t *testing.T) {
	var mu sync.Mutex
	n := 0.0
	s := NewSampler(func() float64 { mu.Lock(); defer mu.Unlock(); n++; return n }, 10*time.Millisecond, 60*time.Millisecond)
	s.Samples()
	time.Sleep(45 * time.Millisecond)
	got := s.Samples()
	if len(got) < 2 {
		t.Fatalf("after 45ms of asking, %d samples, want at least 2", len(got))
	}
	if got[0] >= got[len(got)-1] {
		t.Fatalf("samples not oldest first: %v", got)
	}
	time.Sleep(150 * time.Millisecond)
	if s.Running() {
		t.Fatal("the sampler still runs 150ms after the last ask (idle stop is 60ms)")
	}
	if got := s.Samples(); len(got) > 1 {
		t.Fatalf("a restarted sampler kept %d old samples", len(got))
	}
}

func TestSamplerKeepsTheLastSixty(t *testing.T) {
	s := NewSampler(func() float64 { return 1 }, time.Millisecond, time.Second)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if len(s.Samples()) == MaxSamples {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	time.Sleep(30 * time.Millisecond)
	if got := len(s.Samples()); got != MaxSamples {
		t.Fatalf("len = %d, want %d", got, MaxSamples)
	}
}

func TestWatchPressurePublishesOnChange(t *testing.T) {
	seq := []jobqueue.Pressure{jobqueue.PressureNormal, jobqueue.PressureNormal, jobqueue.PressureWarn, jobqueue.PressureWarn, jobqueue.PressureCritical}
	var mu sync.Mutex
	i := 0
	read := func(context.Context) jobqueue.Pressure {
		mu.Lock()
		defer mu.Unlock()
		p := seq[min(i, len(seq)-1)]
		i++
		return p
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	got := make(chan string, 10)
	go WatchPressure(ctx, read, 2*time.Millisecond, func(w string) { got <- w })
	var words []string
	for len(words) < 3 {
		select {
		case w := <-got:
			words = append(words, w)
		case <-time.After(2 * time.Second):
			t.Fatalf("published %v, want three changes", words)
		}
	}
	want := []string{"normal", "high", "critical"}
	for k := range want {
		if words[k] != want[k] {
			t.Fatalf("published %v, want %v", words, want)
		}
	}
}

func TestReadReturnsMemoryAndDisk(t *testing.T) {
	st, err := Read(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if st.MemTotal == 0 || st.MemAvailable == 0 || st.MemAvailable > st.MemTotal {
		t.Fatalf("memory %d of %d", st.MemAvailable, st.MemTotal)
	}
	if st.DiskTotal == 0 || st.DiskFree > st.DiskTotal {
		t.Fatalf("disk %d of %d", st.DiskFree, st.DiskTotal)
	}
	if st.DiskName == "" {
		t.Fatal("no disk name")
	}
}
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `go test ./pkg/machinestats/`
Expected: FAIL to build (`undefined: PressureWord`, `NewSampler`, …).

- [ ] **Step 3: Write the package**

Create `pkg/machinestats/machinestats.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package machinestats reads the machine's memory, CPU and system disk for the menu bar / tray popover
// (spec 2026-10-15-tray-popover-design.md). CPU is sampled once a second only while someone keeps asking, and stops
// IdleStop after the last ask, as pkg/resmon's sampler does.
package machinestats

import (
	"context"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/wavetermdev/waveterm/pkg/jobqueue"
)

const (
	SampleInterval = time.Second
	IdleStop       = 10 * time.Second
	MaxSamples     = 60 // the popover's line is the last minute
)

// PressureWord is the popover's word for a pressure level; "" when the OS gave no reading.
func PressureWord(p jobqueue.Pressure) string {
	switch p {
	case jobqueue.PressureNormal:
		return "normal"
	case jobqueue.PressureWarn:
		return "high"
	case jobqueue.PressureCritical:
		return "critical"
	}
	return ""
}

// Sampler keeps the last MaxSamples readings of read, sampling every interval while Samples is called at least once
// per idle.
type Sampler struct {
	read     func() float64
	interval time.Duration
	idle     time.Duration

	mu       sync.Mutex
	running  bool
	lastCall time.Time
	samples  []float64
}

func NewSampler(read func() float64, interval, idle time.Duration) *Sampler {
	return &Sampler{read: read, interval: interval, idle: idle}
}

// Samples returns the readings so far, oldest first, starting the loop when it is not running.
func (s *Sampler) Samples() []float64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastCall = time.Now()
	if !s.running {
		s.running = true
		go s.loop()
	}
	return append([]float64(nil), s.samples...)
}

func (s *Sampler) Running() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.running
}

func (s *Sampler) loop() {
	t := time.NewTicker(s.interval)
	defer t.Stop()
	for {
		v := s.read()
		s.mu.Lock()
		s.samples = append(s.samples, v)
		if len(s.samples) > MaxSamples {
			s.samples = s.samples[len(s.samples)-MaxSamples:]
		}
		s.mu.Unlock()
		<-t.C
		s.mu.Lock()
		if time.Since(s.lastCall) > s.idle {
			// a later ask starts a fresh minute: an old line would draw a gap as if the CPU had idled
			s.running, s.samples = false, nil
			s.mu.Unlock()
			return
		}
		s.mu.Unlock()
	}
}

var cpuSampler = NewSampler(readCPU, SampleInterval, IdleStop)

// readCPU is the whole machine's busy percent since the previous call (0 on the first)
func readCPU() float64 {
	v, err := cpu.Percent(0, false)
	if err != nil || len(v) == 0 {
		return 0
	}
	return v[0]
}

type Stats struct {
	MemTotal     uint64
	MemAvailable uint64
	Pressure     string
	CpuPct       float64
	CpuSamples   []float64
	DiskName     string
	DiskTotal    uint64
	DiskFree     uint64
}

// Read is one reading; it also keeps the CPU sampler going for IdleStop.
func Read(ctx context.Context) (Stats, error) {
	vm, err := mem.VirtualMemoryWithContext(ctx)
	if err != nil {
		return Stats{}, err
	}
	samples := cpuSampler.Samples()
	st := Stats{
		MemTotal:     vm.Total,
		MemAvailable: vm.Available,
		Pressure:     PressureWord(jobqueue.ReadPressure(ctx)),
		CpuSamples:   samples,
		DiskName:     volumeName(),
	}
	if n := len(samples); n > 0 {
		st.CpuPct = samples[n-1]
	}
	if du, err := disk.UsageWithContext(ctx, systemRoot()); err == nil {
		st.DiskTotal, st.DiskFree = du.Total, du.Free
	}
	return st, nil
}

// WatchPressure calls publish with the level's word at start and each time it changes, reading it every interval
// until ctx ends. On macOS a reading is one sysctl.
func WatchPressure(ctx context.Context, read func(context.Context) jobqueue.Pressure, interval time.Duration, publish func(string)) {
	t := time.NewTicker(interval)
	defer t.Stop()
	last, first := "", true
	for {
		if w := PressureWord(read(ctx)); first || w != last {
			publish(w)
			last, first = w, false
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
```

Create `pkg/machinestats/volume_darwin.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build darwin

package machinestats

import (
	"os"
	"path/filepath"
	"sync"
)

func systemRoot() string { return "/" }

var volumeOnce = sync.OnceValue(func() string {
	// /Volumes holds a link to "/" named after the boot volume (Macintosh HD unless renamed)
	entries, err := os.ReadDir("/Volumes")
	if err == nil {
		for _, e := range entries {
			if target, err := os.Readlink(filepath.Join("/Volumes", e.Name())); err == nil && target == "/" {
				return e.Name()
			}
		}
	}
	return "System disk"
})

func volumeName() string { return volumeOnce() }
```

Create `pkg/machinestats/volume_windows.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package machinestats

import (
	"fmt"
	"os"
	"strings"
	"sync"

	"golang.org/x/sys/windows"
)

func systemRoot() string {
	d := os.Getenv("SystemDrive")
	if d == "" {
		d = "C:"
	}
	return d + `\`
}

var volumeOnce = sync.OnceValue(func() string {
	root := systemRoot()
	drive := strings.TrimSuffix(root, `\`)
	label := make([]uint16, windows.MAX_PATH+1)
	p, err := windows.UTF16PtrFromString(root)
	if err == nil && windows.GetVolumeInformation(p, &label[0], uint32(len(label)), nil, nil, nil, nil, 0) == nil {
		if s := windows.UTF16ToString(label); s != "" {
			return fmt.Sprintf("%s (%s)", s, drive)
		}
	}
	return fmt.Sprintf("Local Disk (%s)", drive)
})

func volumeName() string { return volumeOnce() }
```

Create `pkg/machinestats/volume_other.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !darwin && !windows

package machinestats

func systemRoot() string { return "/" }

func volumeName() string { return "System disk" }
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `go test ./pkg/machinestats/`
Expected: PASS.

- [ ] **Step 5: The wire, the event and the setting**

Create `pkg/wshrpc/wshrpctypes_machine.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// MachineCommands back the menu bar / tray popover (spec 2026-10-15-tray-popover-design.md).
type MachineCommands interface {
	GetMachineStatsCommand(ctx context.Context) (*MachineStatsData, error) // memory, its pressure, CPU (sampled while asked) and the system disk
}

type MachineStatsData struct {
	MemTotal     uint64    `json:"memtotal"`
	MemAvailable uint64    `json:"memavailable"`
	Pressure     string    `json:"pressure"`   // "normal", "high", "critical", or "" with no reading
	CpuPct       float64   `json:"cpupct"`     // the latest sample
	CpuSamples   []float64 `json:"cpusamples"` // up to the last 60, one a second, oldest first
	DiskName     string    `json:"diskname"`
	DiskTotal    uint64    `json:"disktotal"`
	DiskFree     uint64    `json:"diskfree"`
}

// MemoryPressureData is the memorypressure event: the level's word each time it changes.
type MemoryPressureData struct {
	Level string `json:"level"`
}
```

In `pkg/wshrpc/wshrpctypes.go`, add `MachineCommands` to the composed interface next to `JobQueueCommands` (around
line 50). Wire it exactly as `JobQueueCommands` is wired (`grep -n JobQueueCommands pkg/wshrpc/*.go` and follow every
hit).

Create `pkg/wshrpc/wshserver/wshserver_machine.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/machinestats"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func (ws *WshServer) GetMachineStatsCommand(ctx context.Context) (*wshrpc.MachineStatsData, error) {
	st, err := machinestats.Read(ctx)
	if err != nil {
		return nil, fmt.Errorf("reading the machine's memory: %w", err)
	}
	return &wshrpc.MachineStatsData{
		MemTotal:     st.MemTotal,
		MemAvailable: st.MemAvailable,
		Pressure:     st.Pressure,
		CpuPct:       st.CpuPct,
		CpuSamples:   st.CpuSamples,
		DiskName:     st.DiskName,
		DiskTotal:    st.DiskTotal,
		DiskFree:     st.DiskFree,
	}, nil
}

// StartMachineWatch publishes memorypressure whenever the level changes: the tray icon's red dot while the popover
// is shut.
func StartMachineWatch(ctx context.Context) {
	go func() {
		defer func() {
			panichandler.PanicHandler("machinestats.WatchPressure", recover())
		}()
		machinestats.WatchPressure(ctx, jobqueue.ReadPressure, 10*time.Second, func(level string) {
			wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_MemoryPressure, Data: wshrpc.MemoryPressureData{Level: level}})
		})
	}()
}
```

In `pkg/wps/wpstypes.go`, add to the const block after `Event_JobQueue` (line 31):

```go
	Event_MemoryPressure   = "memorypressure"   // type: wshrpc.MemoryPressureData
```

and add `Event_MemoryPressure,` to the event list beside `Event_JobQueue,` (line 60).

In `pkg/tsgen/tsgenevent.go`, beside line 37 (`wps.Event_JobQueue: …`):

```go
	wps.Event_MemoryPressure:     reflect.TypeOf(wshrpc.MemoryPressureData{}),
```

In `cmd/server/main-server.go`, after `wshserver.StartKeepAwake(context.Background())` (line 428):

```go
	// the tray icon's red dot when memory pressure turns critical (spec 2026-10-15-tray-popover-design.md)
	wshserver.StartMachineWatch(context.Background())
```

In `pkg/wconfig/settingsconfig.go`, after `AppDisableCtrlShiftDisplay` (line 45):

```go
	AppTray                    *bool `json:"app:tray,omitempty"` // arcterm's icon in the menu bar / tray; unset is on
```

- [ ] **Step 6: Generate, build, vet**

Run: `task generate && go build ./cmd/... ./pkg/... && go vet ./pkg/machinestats/... ./pkg/wshrpc/... && go test ./pkg/wconfig/ -run '^TestSettingsKeysInSync$'`
Expected: no errors. `git diff --stat` shows `frontend/app/store/wshclientapi.ts` with `GetMachineStatsCommand`,
`frontend/types/waveevent.d.ts` with `memorypressure`, `frontend/types/gotypes.d.ts` with `MachineStatsData` and
`"app:tray"`, and `schema/settings.json` with `"app:tray"` (`task generate`'s `build:schema` writes it;
`TestSettingsKeysInSync` fails without it).

- [ ] **Step 7: Commit**

```bash
git add pkg/machinestats pkg/wshrpc/wshrpctypes_machine.go pkg/wshrpc/wshrpctypes.go pkg/wshrpc/wshserver/wshserver_machine.go pkg/wps/wpstypes.go pkg/tsgen/tsgenevent.go cmd/server/main-server.go pkg/wconfig/settingsconfig.go pkg/wconfig/metaconsts.go schema/settings.json pkg/wshrpc/wshclient/wshclient.go frontend/app/store/wshclientapi.ts frontend/types/gotypes.d.ts frontend/types/waveevent.d.ts
git commit -m "feat(tray): machine stats, the memorypressure event and app:tray for the menu bar popover"
```

### Task 2: Each agent's heaviest command and a guarded stop (Go)

**Depends on:** Task 1
**Files:** `pkg/memusage/heaviest.go`, `pkg/memusage/heaviest_test.go`, `pkg/memusage/stop_unix.go`, `pkg/memusage/stop_unix_test.go`, `pkg/wshrpc/wshrpctypes_agents.go`, `pkg/wshrpc/wshserver/wshserver_consumers.go`, `pkg/wshrpc/wshserver/wshserver_stopprocess.go`, `pkg/wshrpc/wshserver/wshserver_stopprocess_unix.go`, `pkg/wshrpc/wshserver/wshserver_stopprocess_windows.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`

**Interfaces:**
- Consumes: `memusage.Table` (`Tree(root) []int32` = root and its descendants; `NewTable(map[int32]int32)`),
  `memusage.Sampler.Footprint`, `GetConsumersCommand` in `wshserver_consumers.go:69`.
- Produces (Go): `memusage.Heaviest(t Table, root int32, footprint func(int32) (uint64, bool)) (pid int32, bytes uint64, ok bool)`,
  `memusage.IsDescendant(t Table, root, pid int32) bool`, `memusage.ShortCommand(args []string) string`,
  `memusage.AgentPid(t Table, root int32, isShell func(pid int32) bool) int32`,
  `memusage.StopTree(t Table, pid int32, grace time.Duration, signal func(int32, syscall.Signal) error, alive func(int32) bool) error` (not Windows).
- Produces (wire): `ConsumerAgent.Heaviest *ConsumerProcess "heaviest"` with `ConsumerProcess{ Pid int32 "pid";
  Command string "command"; Bytes uint64 "bytes" }`; `StopProcessCommand(ctx, CommandStopProcessData{ BlockId string
  "blockid"; Pid int32 "pid" }) error`. TS: `RpcApi.StopProcessCommand(client, { blockid, pid })`.

- [ ] **Step 1: Write the failing tests**

Create `pkg/memusage/heaviest_test.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memusage

import "testing"

// 10 is the agent; 11 and 12 its children; 13 a grandchild under 11; 20 an unrelated process
func heaviestTable() Table {
	return NewTable(map[int32]int32{10: 1, 11: 10, 12: 10, 13: 11, 20: 1})
}

func TestHeaviestPicksTheLargestDescendant(t *testing.T) {
	foot := map[int32]uint64{10: 900, 11: 100, 12: 300, 13: 500, 20: 9000}
	pid, b, ok := Heaviest(heaviestTable(), 10, func(p int32) (uint64, bool) { v, ok := foot[p]; return v, ok })
	if !ok || pid != 13 || b != 500 {
		t.Fatalf("got %d %d %v, want 13 500 true (the agent itself and outsiders are never picked)", pid, b, ok)
	}
}

func TestHeaviestWithNoChildren(t *testing.T) {
	if _, _, ok := Heaviest(heaviestTable(), 12, func(int32) (uint64, bool) { return 1, true }); ok {
		t.Fatal("a process with no descendants has no heaviest command")
	}
}

func TestHeaviestSkipsUnreadable(t *testing.T) {
	pid, _, ok := Heaviest(heaviestTable(), 10, func(p int32) (uint64, bool) { return 7, p == 12 })
	if !ok || pid != 12 {
		t.Fatalf("got %d %v, want 12 true", pid, ok)
	}
}

func TestIsDescendantRefuses(t *testing.T) {
	tb := heaviestTable()
	if !IsDescendant(tb, 10, 13) {
		t.Fatal("13 is under 10")
	}
	for _, pid := range []int32{10, 20, 1, 99} {
		if IsDescendant(tb, 10, pid) {
			t.Fatalf("%d must be refused: the agent itself, an outsider, a parent, or gone", pid)
		}
	}
}

// an agent block runs `$SHELL -c <cmd>`; fish and pwsh do not exec, so 30 is that shell, 31 the agent under it, and
// 32, 33 the agent's commands
func wrappedTable() Table {
	return NewTable(map[int32]int32{30: 1, 31: 30, 32: 31, 33: 32})
}

func TestAgentPidSeesThroughAShellThatDidNotExec(t *testing.T) {
	tb := wrappedTable()
	isShell := func(p int32) bool { return p == 30 }
	agent := AgentPid(tb, 30, isShell)
	if agent != 31 {
		t.Fatalf("AgentPid = %d, want 31: the shell's one child is the agent", agent)
	}
	foot := map[int32]uint64{31: 9000, 32: 100, 33: 500}
	pid, _, ok := Heaviest(tb, agent, func(p int32) (uint64, bool) { v, ok := foot[p]; return v, ok })
	if !ok || pid != 33 {
		t.Fatalf("got %d %v, want 33 true: the agent itself is never offered", pid, ok)
	}
	if IsDescendant(tb, agent, 31) {
		t.Fatal("a stop on the wrapped agent itself must be refused")
	}
}

func TestAgentPidKeepsTheRoot(t *testing.T) {
	// bash and zsh exec the command, so the root is the agent
	if got := AgentPid(heaviestTable(), 10, func(int32) bool { return false }); got != 10 {
		t.Fatalf("a root that is not a shell is the agent: got %d", got)
	}
	// a shell with two children wraps no single agent
	if got := AgentPid(heaviestTable(), 10, func(int32) bool { return true }); got != 10 {
		t.Fatalf("a shell with two children stays the root: got %d", got)
	}
}

func TestShortCommand(t *testing.T) {
	cases := []struct {
		args []string
		want string
	}{
		{[]string{"/usr/local/go/bin/go", "test", "./pkg/orchestrate"}, "go test ./pkg/orchestrate"},
		{[]string{`C:\Program Files\nodejs\node.exe`, "vite"}, "node.exe vite"},
		{nil, ""},
	}
	for _, c := range cases {
		if got := ShortCommand(c.args); got != c.want {
			t.Errorf("ShortCommand(%q) = %q, want %q", c.args, got, c.want)
		}
	}
	long := ShortCommand([]string{"node", "a-very-long-script-name-that-goes-on-and-on-and-on-and-on.js", "--flag"})
	if r := []rune(long); len(r) != 60 || r[59] != '…' {
		t.Fatalf("a long command is cut to 60 runes ending in …: %q (%d)", long, len(r))
	}
}
```

Create `pkg/memusage/stop_unix_test.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package memusage

import (
	"syscall"
	"testing"
	"time"
)

func TestStopTreeTermsThenKillsSurvivors(t *testing.T) {
	tb := heaviestTable()
	alive := map[int32]bool{11: true, 13: true}
	var sent []string
	signal := func(p int32, s syscall.Signal) error {
		sent = append(sent, map[syscall.Signal]string{syscall.SIGTERM: "TERM", syscall.SIGKILL: "KILL"}[s]+":"+string(rune('0'+p%10)))
		if s == syscall.SIGTERM && p == 13 {
			alive[13] = false // 13 exits on TERM; 11 ignores it
		}
		if s == syscall.SIGKILL {
			alive[p] = false
		}
		return nil
	}
	err := StopTree(tb, 11, 150*time.Millisecond, signal, func(p int32) bool { return alive[p] })
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"TERM:3", "TERM:1", "KILL:1"}
	if len(sent) != len(want) {
		t.Fatalf("sent %v, want %v (children first, then KILL only to the survivor)", sent, want)
	}
	for i := range want {
		if sent[i] != want[i] {
			t.Fatalf("sent %v, want %v", sent, want)
		}
	}
}

func TestStopTreeOnAGonePid(t *testing.T) {
	if err := StopTree(heaviestTable(), 99, time.Millisecond, func(int32, syscall.Signal) error { return nil }, func(int32) bool { return false }); err == nil {
		t.Fatal("a pid no longer in the table is an error")
	}
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./pkg/memusage/ -run 'Heaviest|IsDescendant|AgentPid|ShortCommand|StopTree'`
Expected: FAIL to build (`undefined: Heaviest`, …).

- [ ] **Step 3: Write the helpers**

Create `pkg/memusage/heaviest.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memusage

import (
	"path/filepath"
	"slices"
	"strings"
)

const shortCommandRunes = 60

// Heaviest is root's descendant (root left out) with the largest footprint: what the tray's Free up offers to stop
// (spec 2026-10-15-tray-popover-design.md). ok is false when no descendant has a reading.
func Heaviest(t Table, root int32, footprint func(pid int32) (uint64, bool)) (pid int32, bytes uint64, ok bool) {
	for _, p := range t.Tree(root) {
		if p == root {
			continue
		}
		b, read := footprint(p)
		if !read {
			continue
		}
		if !ok || b > bytes {
			pid, bytes, ok = p, b, true
		}
	}
	return pid, bytes, ok
}

// IsDescendant says whether pid is still under root now: never root itself, so a stop cannot end the agent.
func IsDescendant(t Table, root, pid int32) bool {
	return pid != root && slices.Contains(t.Tree(root), pid)
}

// AgentPid is the agent's own process under its block's root. An agent block runs `$SHELL -c <cmd>`
// (pkg/shellexec/shellexec.go): bash and zsh exec the command, so the root is the agent, but fish and pwsh keep the
// shell, and the agent is its one child. Heaviest and IsDescendant take this pid, so Free up never offers the agent
// itself and a stop never ends it.
func AgentPid(t Table, root int32, isShell func(pid int32) bool) int32 {
	if kids := t.children[root]; len(kids) == 1 && isShell(root) {
		return kids[0]
	}
	return root
}

// ShortCommand is a command line as a row shows it: the program's file name, then its arguments, cut to 60 runes.
func ShortCommand(args []string) string {
	if len(args) == 0 {
		return ""
	}
	// filepath.Base does not split a Windows path on a Mac or the other way round
	prog := args[0]
	if i := strings.LastIndexAny(prog, `/\`); i >= 0 {
		prog = prog[i+1:]
	}
	s := strings.Join(append([]string{filepath.Clean(prog)}, args[1:]...), " ")
	if r := []rune(s); len(r) > shortCommandRunes {
		return string(r[:shortCommandRunes-1]) + "…"
	}
	return s
}
```

Create `pkg/memusage/stop_unix.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package memusage

import (
	"fmt"
	"syscall"
	"time"
)

// StopTree ends pid and its descendants: SIGTERM to each, children before their parents so a parent cannot start
// them again, then SIGKILL to whatever is still alive after grace.
func StopTree(t Table, pid int32, grace time.Duration, signal func(pid int32, sig syscall.Signal) error, alive func(pid int32) bool) error {
	if !t.Has(pid) {
		return fmt.Errorf("process %d has already exited", pid)
	}
	tree := t.Tree(pid)
	for i := len(tree) - 1; i >= 0; i-- {
		_ = signal(tree[i], syscall.SIGTERM)
	}
	deadline := time.Now().Add(grace)
	for time.Now().Before(deadline) {
		if !anyAlive(tree, alive) {
			return nil
		}
		time.Sleep(25 * time.Millisecond)
	}
	for i := len(tree) - 1; i >= 0; i-- {
		if alive(tree[i]) {
			_ = signal(tree[i], syscall.SIGKILL)
		}
	}
	return nil
}

func anyAlive(pids []int32, alive func(int32) bool) bool {
	for _, p := range pids {
		if alive(p) {
			return true
		}
	}
	return false
}
```

Check `Table.Tree`'s order in `pkg/memusage/memusage.go:69`: the test above expects it to list a parent before its
children (13 is signalled before 11 because the loop walks the list backwards). If `Tree` is not parent-first, sort
the copy by depth in `StopTree` before signalling, and keep the test.

- [ ] **Step 4: Run them to see them pass**

Run: `go test ./pkg/memusage/`
Expected: PASS.

- [ ] **Step 5: The wire**

In `pkg/wshrpc/wshrpctypes_agents.go`, add after `ConsumerAgent` (line 466) and inside it:

```go
// ConsumerProcess is an agent's heaviest descendant process: what the tray's Free up offers to stop.
type ConsumerProcess struct {
	Pid     int32  `json:"pid"`
	Command string `json:"command"` // memusage.ShortCommand of its command line
	Bytes   uint64 `json:"bytes"`
}

type CommandStopProcessData struct {
	BlockId string `json:"blockid"` // the agent's block: the pid must still be under its process
	Pid     int32  `json:"pid"`
}
```

```go
	Heaviest   *ConsumerProcess `json:"heaviest,omitempty"` // its heaviest descendant; absent when it runs nothing but itself
```

and in the agents command interface beside `GetConsumersCommand` (line 39):

```go
	StopProcessCommand(ctx context.Context, data CommandStopProcessData) error // end one of an agent's descendant processes and its subtree (the tray's Free up)
```

- [ ] **Step 6: Fill Heaviest and add the stop**

In `GetConsumersCommand` (`pkg/wshrpc/wshserver/wshserver_consumers.go:69`), the table and the sampler are scoped
inside the `if` that calls `Measure` (lines 85–89). Hoist them so the agent loop can use them:

```go
	var bd memusage.Breakdown
	table, terr := consumerTable()
	sampler := consumerSampler()
	if terr == nil {
		// wavesrv's parent is the Tauri host, which spawned it
		bd = memusage.Measure(table, sampler, roots, int32(os.Getpid()), int32(os.Getppid()), runtime.GOOS == "darwin")
	}
```

and in the agent loop, after `a.RamBytes = &n` (line 105):

```go
		if root, ok := roots[r.blockId]; ok && terr == nil {
			agent := memusage.AgentPid(table, root, isShellProcess)
			if pid, b, ok := memusage.Heaviest(table, agent, sampler.Footprint); ok {
				a.Heaviest = &wshrpc.ConsumerProcess{Pid: pid, Command: commandOf(ctx, pid), Bytes: b}
			}
		}
```

Add:

```go
// commandOf is a process's command line as a row shows it; its pid when the OS will not say
func commandOf(ctx context.Context, pid int32) string {
	if p, err := process.NewProcessWithContext(ctx, pid); err == nil {
		if args, err := p.CmdlineSliceWithContext(ctx); err == nil && len(args) > 0 {
			return memusage.ShortCommand(args)
		}
	}
	return fmt.Sprintf("process %d", pid)
}
```

   (`process` is `github.com/shirou/gopsutil/v4/process`.)

Create `pkg/wshrpc/wshserver/wshserver_stopprocess.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"strings"

	"github.com/shirou/gopsutil/v4/process"
	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// isShellProcess says whether pid runs a shell: the wrapper an agent block's `$SHELL -c` leaves when the shell does
// not exec its command (memusage.AgentPid).
func isShellProcess(pid int32) bool {
	p, err := process.NewProcess(pid)
	if err != nil {
		return false
	}
	name, err := p.Name()
	if err != nil {
		return false
	}
	name = strings.TrimSuffix(strings.ToLower(name), ".exe")
	return name == "sh" || shellutil.GetShellTypeFromShellPath(name) != shellutil.ShellType_unknown
}

// StopProcessCommand ends one of an agent's descendant processes and its subtree, after checking that the pid is
// still under that agent now: the Free up list can be seconds old, and a pid can exit and be reused meanwhile.
func (ws *WshServer) StopProcessCommand(ctx context.Context, data wshrpc.CommandStopProcessData) error {
	// the same root GetConsumersCommand measures the agent from
	root := consumerBlockPid(data.BlockId)
	if root <= 0 {
		return fmt.Errorf("that agent is no longer running")
	}
	table, err := consumerTable()
	if err != nil {
		return fmt.Errorf("reading the process list: %w", err)
	}
	if !memusage.IsDescendant(table, memusage.AgentPid(table, int32(root), isShellProcess), data.Pid) {
		return fmt.Errorf("process %d is no longer one of that agent's commands", data.Pid)
	}
	return stopProcessTree(ctx, ws, table, data)
}
```

Create `pkg/wshrpc/wshserver/wshserver_stopprocess_unix.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package wshserver

import (
	"context"
	"syscall"
	"time"

	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func stopProcessTree(_ context.Context, _ *WshServer, table memusage.Table, data wshrpc.CommandStopProcessData) error {
	return memusage.StopTree(table, data.Pid, 3*time.Second,
		func(pid int32, sig syscall.Signal) error { return syscall.Kill(int(pid), sig) },
		func(pid int32) bool { return syscall.Kill(int(pid), 0) == nil })
}
```

Create `pkg/wshrpc/wshserver/wshserver_stopprocess_windows.go`. On Windows an agent's processes live in its job
object, and `ResMonKillCommand` (in `pkg/wshrpc/wshserver`, built on `resmon.Kill`) already kills a pid's tree inside
its owner's job. Read that method and call it:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package wshserver

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func stopProcessTree(ctx context.Context, ws *WshServer, _ memusage.Table, data wshrpc.CommandStopProcessData) error {
	// the Resource Manager's tree kill, inside the agent's job (pkg/resmon/kill.go)
	_, err := ws.ResMonKillCommand(ctx, wshrpc.CommandResMonKillData{OwnerId: data.BlockId, Pid: data.Pid, Tree: true})
	return err
}
```

If `ResMonKillCommand` returns an outcome value rather than an error for a refused kill, map a refusal to an error
with its text (`ResMonKillRtnData`'s outcome field) so the tray shows why.

- [ ] **Step 7: Generate, build, test**

Run: `task generate && go build ./cmd/... ./pkg/... && GOOS=windows go build ./pkg/wshrpc/... ./pkg/memusage/... && go test ./pkg/memusage/ ./pkg/wshrpc/...`
Expected: all pass; `frontend/app/store/wshclientapi.ts` has `StopProcessCommand`, `frontend/types/gotypes.d.ts` has
`ConsumerProcess` and `heaviest?: ConsumerProcess` on `ConsumerAgent`.

- [ ] **Step 8: Commit**

```bash
git add pkg/memusage pkg/wshrpc/wshrpctypes_agents.go pkg/wshrpc/wshserver/wshserver_consumers.go pkg/wshrpc/wshserver/wshserver_stopprocess.go pkg/wshrpc/wshserver/wshserver_stopprocess_unix.go pkg/wshrpc/wshserver/wshserver_stopprocess_windows.go pkg/wshrpc/wshclient/wshclient.go frontend/app/store/wshclientapi.ts frontend/types/gotypes.d.ts
git commit -m "feat(tray): each agent's heaviest command on every OS, and StopProcessCommand guarded to that agent's tree"
```

### Task 3: The tray icon's pixels and the popover's place (pure Rust)

**Depends on:** none
**Files:** `src-tauri/src/trayicon.rs`, `src-tauri/src/main.rs`

**Interfaces:**
- Produces: `trayicon::Rgba { width: u32, height: u32, px: Vec<u8> }`; `trayicon::mac_icon(dim: bool) -> Rgba`
  (48×36 black template glyph); `trayicon::win_icon(size: u32, count: u32, alert: bool, dim: bool) -> Rgba`;
  `trayicon::win_icon_size(scale: f64) -> u32`; `trayicon::badge_text(count: u32) -> String`;
  `trayicon::mac_title(count: u32, alert: bool, offline: bool) -> String`; `trayicon::MAC_ALERT` (the `"●"` that
  leads the title at critical pressure);
  `trayicon::tooltip(count: u32, alert: bool, offline: bool) -> String`;
  `trayicon::R { x: f64, y: f64, w: f64, h: f64 }`;
  `trayicon::popover_origin(icon: R, size: (f64, f64), work: R) -> (f64, f64)` (all physical px).

- [ ] **Step 1: Write the module with its tests first failing**

Create `src-tauri/src/trayicon.rs` with only the tests module below and the type stubs `pub struct Rgba`, `pub struct R`
so it compiles to failures. Add `mod trayicon;` beside the other `mod` lines at the top of `src-tauri/src/main.rs`
(and `#[allow(dead_code)]` on it until Task 4 uses it).

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn alpha(img: &Rgba, x: u32, y: u32) -> u8 {
        img.px[((y * img.width + x) * 4 + 3) as usize]
    }

    fn has_color(img: &Rgba, rgb: [u8; 3]) -> bool {
        img.px.chunks(4).any(|p| p[0] == rgb[0] && p[1] == rgb[1] && p[2] == rgb[2] && p[3] > 0)
    }

    #[test]
    fn glyph_is_the_mark_grid() {
        let g = glyph(1, [255, 255, 255, 255]);
        assert_eq!((g.width, g.height), (12, 9));
        assert_eq!(alpha(&g, 1, 1), 255); // the t's stem
        assert_eq!(alpha(&g, 11, 4), 255); // the chevron's point
        assert_eq!(alpha(&g, 0, 0), 0);
        assert_eq!(alpha(&g, 11, 0), 0);
    }

    #[test]
    fn mac_icon_is_a_48_by_36_black_template() {
        let m = mac_icon(false);
        assert_eq!((m.width, m.height), (48, 36));
        assert!(m.px.chunks(4).all(|p| p[3] == 0 || (p[0], p[1], p[2]) == (0, 0, 0)));
        assert!(mac_icon(true).px.chunks(4).all(|p| p[3] <= 115)); // dimmed to 45%
    }

    #[test]
    fn win_icon_is_square_with_a_badge_only_for_a_count() {
        let plain = win_icon(16, 0, false, false);
        assert_eq!((plain.width, plain.height), (16, 16));
        assert!(!has_color(&plain, AMBER));
        assert!(has_color(&win_icon(16, 4, false, false), AMBER));
        assert!(has_color(&win_icon(32, 12, false, false), AMBER));
        assert!(has_color(&win_icon(16, 0, true, false), RED));
        assert!(!has_color(&win_icon(16, 4, false, false), RED));
    }

    #[test]
    fn badge_text_caps_at_nine() {
        assert_eq!(badge_text(0), "");
        assert_eq!(badge_text(4), "4");
        assert_eq!(badge_text(9), "9");
        assert_eq!(badge_text(12), "9+");
    }

    #[test]
    fn win_icon_size_follows_the_scale() {
        assert_eq!(win_icon_size(1.0), 16);
        assert_eq!(win_icon_size(1.25), 20);
        assert_eq!(win_icon_size(1.5), 24);
        assert_eq!(win_icon_size(1.75), 32);
        assert_eq!(win_icon_size(2.0), 32);
    }

    #[test]
    fn mac_title_and_tooltip() {
        assert_eq!(mac_title(0, false, false), "");
        assert_eq!(mac_title(4, false, false), "4");
        assert_eq!(mac_title(12, false, false), "12");
        assert_eq!(mac_title(4, true, false), format!("{MAC_ALERT} 4"));
        assert_eq!(mac_title(0, true, false), MAC_ALERT);
        assert_eq!(mac_title(4, true, true), "");
        assert_eq!(tooltip(0, false, false), "arcterm");
        assert_eq!(tooltip(4, true, false), "arcterm: memory pressure critical, 4 waiting on you");
        assert_eq!(tooltip(1, false, false), "arcterm: 1 waiting on you");
        assert_eq!(tooltip(4, false, true), "arcterm: its server is not answering");
    }

    const MAC_WORK: R = R { x: 0.0, y: 50.0, w: 2880.0, h: 1750.0 }; // below a 50 px (@2x) menu bar
    const WIN_WORK: R = R { x: 0.0, y: 0.0, w: 1920.0, h: 1032.0 }; // above a 48 px taskbar

    #[test]
    fn popover_hangs_under_the_mac_menu_bar() {
        let icon = R { x: 2000.0, y: 0.0, w: 48.0, h: 48.0 };
        let (x, y) = popover_origin(icon, (720.0, 1180.0), MAC_WORK);
        assert_eq!(x, 2024.0 - 360.0);
        assert_eq!(y, 58.0); // inside the work area, 8 px under its top
    }

    #[test]
    fn popover_stands_on_a_bottom_taskbar() {
        let icon = R { x: 1700.0, y: 1040.0, w: 24.0, h: 32.0 };
        let (x, y) = popover_origin(icon, (360.0, 590.0), WIN_WORK);
        assert_eq!(y, 1032.0 - 590.0 - 8.0); // GAP above the work area's bottom, the taskbar's top
        assert_eq!(x, 1712.0 - 180.0);
    }

    #[test]
    fn popover_hangs_from_a_top_taskbar() {
        let work = R { x: 0.0, y: 48.0, w: 1920.0, h: 1032.0 };
        let icon = R { x: 1700.0, y: 8.0, w: 24.0, h: 32.0 };
        let (_, y) = popover_origin(icon, (360.0, 590.0), work);
        assert_eq!(y, 56.0);
    }

    #[test]
    fn popover_sits_beside_a_side_taskbar() {
        let left_work = R { x: 62.0, y: 0.0, w: 1858.0, h: 1080.0 };
        let icon = R { x: 15.0, y: 900.0, w: 32.0, h: 24.0 };
        let (x, y) = popover_origin(icon, (360.0, 590.0), left_work);
        assert_eq!(x, 70.0);
        assert!(y >= 8.0 && y + 590.0 <= 1072.0);
        let right_work = R { x: 0.0, y: 0.0, w: 1858.0, h: 1080.0 };
        let icon = R { x: 1873.0, y: 900.0, w: 32.0, h: 24.0 };
        let (x, _) = popover_origin(icon, (360.0, 590.0), right_work);
        assert_eq!(x, 1858.0 - 360.0 - 8.0);
    }

    #[test]
    fn popover_stays_inside_at_the_screen_edge() {
        let icon = R { x: 1900.0, y: 1040.0, w: 20.0, h: 32.0 };
        let (x, _) = popover_origin(icon, (360.0, 590.0), WIN_WORK);
        assert_eq!(x, 1920.0 - 360.0 - 8.0);
        let tall = popover_origin(icon, (360.0, 5000.0), WIN_WORK);
        assert_eq!(tall.1, 8.0);
    }
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH="/opt/homebrew/opt/rustup/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml trayicon`
Expected: FAIL to compile (`cannot find function glyph`, …).

- [ ] **Step 3: Write the module**

Put this above the tests in `src-tauri/src/trayicon.rs`:

```rust
//! The menu bar / tray icon's pixels and the popover's place (spec 2026-10-15-tray-popover-design.md), pure so they
//! test without a window. The glyph is the "t>" mark's 12x9 cell grid, mirrored from scripts/gen-app-icon.mjs CELLS;
//! drawing it here lets the count badge, the red dot and the dimming compose onto it with no PNG per state.

// [cx, cy, cw, ch] runs of cells: the t (stem, crossbar, hook, base), then the chevron's nine blocks
const CELLS: [(u32, u32, u32, u32); 13] = [
    (1, 1, 1, 6),
    (0, 3, 5, 1),
    (5, 6, 1, 1),
    (2, 7, 3, 1),
    (7, 0, 1, 1),
    (8, 1, 1, 1),
    (9, 2, 1, 1),
    (10, 3, 1, 1),
    (11, 4, 1, 1),
    (10, 5, 1, 1),
    (9, 6, 1, 1),
    (8, 7, 1, 1),
    (7, 8, 1, 1),
];

// the icon is an image, not themed UI: these are the @theme values it mirrors (asking, on-warning, error)
const AMBER: [u8; 3] = [0xff, 0xc1, 0x07];
const ON_AMBER: [u8; 3] = [0x1a, 0x13, 0x01];
const RED: [u8; 3] = [0xff, 0x6b, 0x80];
const WHITE: [u8; 4] = [0xff, 0xff, 0xff, 0xff];
const BLACK: [u8; 4] = [0, 0, 0, 0xff];
const DIM: f32 = 0.45;

// 3x5 digits for the badge, one row per byte, high bit on the left
const DIGITS: [[u8; 5]; 10] = [
    [0b111, 0b101, 0b101, 0b101, 0b111],
    [0b010, 0b110, 0b010, 0b010, 0b111],
    [0b111, 0b001, 0b111, 0b100, 0b111],
    [0b111, 0b001, 0b111, 0b001, 0b111],
    [0b101, 0b101, 0b111, 0b001, 0b001],
    [0b111, 0b100, 0b111, 0b001, 0b111],
    [0b111, 0b100, 0b111, 0b101, 0b111],
    [0b111, 0b001, 0b001, 0b001, 0b001],
    [0b111, 0b101, 0b111, 0b101, 0b111],
    [0b111, 0b101, 0b111, 0b001, 0b111],
];
const PLUS: [u8; 5] = [0b000, 0b010, 0b111, 0b010, 0b000];

pub struct Rgba {
    pub width: u32,
    pub height: u32,
    pub px: Vec<u8>,
}

impl Rgba {
    fn blank(width: u32, height: u32) -> Rgba {
        Rgba { width, height, px: vec![0; (width * height * 4) as usize] }
    }

    fn set(&mut self, x: u32, y: u32, c: [u8; 4]) {
        if x < self.width && y < self.height {
            let i = ((y * self.width + x) * 4) as usize;
            self.px[i..i + 4].copy_from_slice(&c);
        }
    }

    fn blit(&mut self, src: &Rgba, ox: u32, oy: u32) {
        for y in 0..src.height {
            for x in 0..src.width {
                let i = ((y * src.width + x) * 4) as usize;
                if src.px[i + 3] > 0 {
                    self.set(ox + x, oy + y, [src.px[i], src.px[i + 1], src.px[i + 2], src.px[i + 3]]);
                }
            }
        }
    }

    fn disc(&mut self, cx: f32, cy: f32, r: f32, rgb: [u8; 3]) {
        for y in 0..self.height {
            for x in 0..self.width {
                let (dx, dy) = (x as f32 + 0.5 - cx, y as f32 + 0.5 - cy);
                if dx * dx + dy * dy <= r * r {
                    self.set(x, y, [rgb[0], rgb[1], rgb[2], 0xff]);
                }
            }
        }
    }

    fn fade(&mut self, f: f32) {
        for p in self.px.chunks_mut(4) {
            p[3] = (p[3] as f32 * f).round() as u8;
        }
    }
}

/// The mark, `step` px per cell, in `color` on transparent.
pub fn glyph(step: u32, color: [u8; 4]) -> Rgba {
    let mut g = Rgba::blank(12 * step, 9 * step);
    for &(cx, cy, cw, ch) in CELLS.iter() {
        for y in cy * step..(cy + ch) * step {
            for x in cx * step..(cx + cw) * step {
                g.set(x, y, color);
            }
        }
    }
    g
}

/// macOS: the template image, 4 px a cell, which the menu bar shows 18 pt high on a Retina screen.
pub fn mac_icon(dim: bool) -> Rgba {
    let mut g = glyph(4, BLACK);
    if dim {
        g.fade(DIM);
    }
    g
}

/// Windows: the white mark centred in a size x size square, the needs-you badge bottom right with the count, the red
/// dot top right when memory pressure is critical, and the whole faded when wavesrv is gone.
pub fn win_icon(size: u32, count: u32, alert: bool, dim: bool) -> Rgba {
    let mut out = Rgba::blank(size, size);
    let g = glyph((size / 12).max(1), WHITE);
    out.blit(&g, (size - g.width.min(size)) / 2, (size - g.height.min(size)) / 2);
    let s = size as f32;
    if alert {
        out.disc(s - s * 0.19, s * 0.19, s * 0.19, RED);
    }
    let text = badge_text(count);
    if !text.is_empty() {
        let r = s * 0.31;
        let (cx, cy) = (s - r, s - r);
        out.disc(cx, cy, r, AMBER);
        let k = (size / 16).max(1);
        let glyphs: Vec<[u8; 5]> = text
            .chars()
            .map(|c| c.to_digit(10).map(|d| DIGITS[d as usize]).unwrap_or(PLUS))
            .collect();
        let tw = glyphs.len() as u32 * 3 * k + (glyphs.len() as u32 - 1) * k;
        let (ox, oy) = ((cx - tw as f32 / 2.0).round() as u32, (cy - 2.5 * k as f32).round() as u32);
        for (n, rows) in glyphs.iter().enumerate() {
            let gx = ox + n as u32 * 4 * k;
            for (ry, bits) in rows.iter().enumerate() {
                for bx in 0..3u32 {
                    if bits & (0b100 >> bx) != 0 {
                        for yy in 0..k {
                            for xx in 0..k {
                                out.set(gx + bx * k + xx, oy + ry as u32 * k + yy, [ON_AMBER[0], ON_AMBER[1], ON_AMBER[2], 0xff]);
                            }
                        }
                    }
                }
            }
        }
    }
    if dim {
        out.fade(DIM);
    }
    out
}

/// The tray's icon size for a monitor scale: 16 px at 100 %, then 20, 24 and 32.
pub fn win_icon_size(scale: f64) -> u32 {
    let want = (16.0 * scale).round() as u32;
    [16, 20, 24, 32].into_iter().find(|s| want <= *s).unwrap_or(32)
}

pub fn badge_text(count: u32) -> String {
    match count {
        0 => String::new(),
        1..=9 => count.to_string(),
        _ => "9+".to_string(),
    }
}

/// What leads the macOS title at critical memory pressure: a dot Task 4 colours red through the status item's
/// attributed title, or "!" when that cannot be done (the spec's fallback, `! 4`).
pub const MAC_ALERT: &str = "●";

/// The text beside the macOS glyph.
pub fn mac_title(count: u32, alert: bool, offline: bool) -> String {
    match (offline, alert, count) {
        (true, _, _) => String::new(),
        (false, true, 0) => MAC_ALERT.to_string(),
        (false, true, n) => format!("{MAC_ALERT} {n}"),
        (false, false, 0) => String::new(),
        (false, false, n) => n.to_string(),
    }
}

pub fn tooltip(count: u32, alert: bool, offline: bool) -> String {
    if offline {
        return "arcterm: its server is not answering".to_string();
    }
    let mut parts = Vec::new();
    if alert {
        parts.push("memory pressure critical".to_string());
    }
    if count > 0 {
        parts.push(format!("{count} waiting on you"));
    }
    if parts.is_empty() {
        "arcterm".to_string()
    } else {
        format!("arcterm: {}", parts.join(", "))
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct R {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

const GAP: f64 = 8.0;

/// Where the popover's top-left goes, in physical px: centred under the icon when it sits in the top half of the work
/// area (the macOS menu bar, a top taskbar), over it otherwise (a bottom taskbar), beside it on a side taskbar, and
/// always inside the work area by GAP.
pub fn popover_origin(icon: R, size: (f64, f64), work: R) -> (f64, f64) {
    let (w, h) = size;
    let cx = icon.x + icon.w / 2.0;
    let cy = icon.y + icon.h / 2.0;
    let (mut x, mut y) = if icon.x + icon.w <= work.x {
        (work.x + GAP, cy - h / 2.0) // a left taskbar: the work area starts right of it
    } else if icon.x >= work.x + work.w {
        (work.x + work.w - w - GAP, cy - h / 2.0) // a right taskbar
    } else if cy < work.y + work.h / 2.0 {
        (cx - w / 2.0, icon.y + icon.h + GAP)
    } else {
        (cx - w / 2.0, icon.y - h - GAP)
    };
    x = x.min(work.x + work.w - w - GAP).max(work.x + GAP);
    y = y.min(work.y + work.h - h - GAP).max(work.y + GAP);
    (x, y)
}
```

`popover_hangs_under_the_mac_menu_bar` expects `y == 58.0` (the work area's top, 50, plus GAP), because the icon's
own bottom (48) plus GAP (56) is above the work area. Keep the clamp order (min then max) so a popover taller than
the work area pins to its top.

- [ ] **Step 4: Run them to see them pass**

Run: `PATH="/opt/homebrew/opt/rustup/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml trayicon`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/trayicon.rs src-tauri/src/main.rs
git commit -m "feat(tray): the tray icon's pixels (template glyph, Windows badge, red dot, dimming) and the popover's place"
```

### Task 4: The tray icon and its popover window (Tauri host)

**Depends on:** Task 3
**Files:** `src-tauri/src/tray.rs`, `src-tauri/src/main.rs`, `src-tauri/src/macwindow.rs`, `src-tauri/src/applog.rs`, `src-tauri/src/trayicon.rs`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/capabilities/tray.json`, `docs/reference/architecture.md`

**Interfaces:**
- Consumes: everything Task 3 produces.
- Produces: Tauri commands `set_tray_status { count: u32, alert: bool, visible: bool }` and
  `tray_popover_size { height: f64 }`; the `tray` window (label `"tray"`, `tray.html`); events it emits:
  `tray:closed` (to all, no payload) when the popover closes and `tray:offline` (to `tray`, `{}`) when wavesrv is
  gone; `tray:act` handled here for kinds `close`, `restart`, `quit`, `showlog`, `open-monitor`, `hello` (replies
  `tray:offline` when offline), and any kind starting `open-` also closes the popover; the right-click menu's Open
  arcterm emits `tray:act` `{ "kind": "open-arcterm" }` for the cockpit to handle.

- [ ] **Step 1: Turn the feature on**

In `src-tauri/Cargo.toml`: `tauri = { version = "2", features = ["macos-private-api", "tray-icon"] }`. In the macOS
target dependencies, add `"NSPanel"`, `"NSStatusItem"`, `"NSStatusBarButton"`, `"NSColor"`, `"NSFont"` and
`"NSAttributedString"` to `objc2-app-kit`'s features, and `"NSAttributedString"` and `"NSRange"` to
`objc2-foundation`'s (plus any other feature of those two the build asks for).
Run `PATH="/opt/homebrew/opt/rustup/bin:$PATH" cargo build --manifest-path src-tauri/Cargo.toml` so `Cargo.lock`
updates. Expected: builds.

- [ ] **Step 2: The log's path**

In `src-tauri/src/applog.rs`, add:

```rust
/// The current log file, for the tray's Show log; None before init.
pub fn log_path() -> Option<PathBuf> {
    LOG.get().map(|l| l.lock().unwrap().path.clone())
}
```

- [ ] **Step 3: The non-activating panel (macOS)**

In `src-tauri/src/macwindow.rs`'s macOS module, add a panel subclass and `show_as_panel`, following the file's own
`define_class!` and `ns_window` style:

```rust
    define_class!(
        // a panel takes key without making arcterm the active app, so opening the tray popover leaves the cockpit
        // where it is (spec 2026-10-15-tray-popover-design.md); canBecomeKeyWindow lets its webview take keys
        #[unsafe(super(objc2_app_kit::NSPanel))]
        #[thread_kind = MainThreadOnly]
        #[name = "ArcTrayPanel"]
        struct ArcTrayPanel;

        impl ArcTrayPanel {
            #[unsafe(method(canBecomeKeyWindow))]
            fn can_become_key_window(&self) -> bool {
                true
            }
        }
    );

    pub fn show_as_panel(window: &WebviewWindow) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Ok(ns) = ns_window(window, mtm) else {
            return;
        };
        unsafe {
            objc2::ffi::object_setClass(
                (ns as *const NSWindow).cast_mut().cast(),
                ArcTrayPanel::class() as *const _ as *const _,
            );
        }
        ns.setStyleMask(ns.styleMask() | objc2_app_kit::NSWindowStyleMask::NonactivatingPanel);
        ns.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Transient,
        );
        ns.orderFrontRegardless();
        ns.makeKeyWindow();
    }
```

and a public wrapper beside `show_in_mission_control`'s (line 456), with a no-op off macOS:

```rust
#[cfg(target_os = "macos")]
pub fn show_as_panel(window: &WebviewWindow) {
    mac::show_as_panel(window);
}
#[cfg(not(target_os = "macos"))]
pub fn show_as_panel(_window: &WebviewWindow) {}
```

(Use the module's real name in place of `mac::`.) If `object_setClass` makes the window crash or stop drawing, keep
the window's own class and only add the style mask, `orderFrontRegardless` and `makeKeyWindow` (no Tauri `show`, no
`set_focus`, which activate the app), and write in the commit message which one shipped.

- [ ] **Step 3b: The red dot beside the count (macOS)**

The spec's red dot at critical pressure: a template image is tinted whole, so the dot is the title's first character
(`trayicon::MAC_ALERT`, `"●"`), coloured red through the status item's attributed title. tray-icon 0.24.1 (pinned by
Tauri 2.11.3) gives the `NSStatusItem` through `TrayIcon::with_inner_tray_icon(|t| t.ns_status_item())`. In
`macwindow.rs`'s macOS module, beside `show_as_panel`:

```rust
    /// Colours the first character of the status item's title (trayicon::MAC_ALERT) red, keeping the button's own
    /// font, so the red dot shows beside the count at critical memory pressure. Call it after set_title(title).
    pub fn tint_tray_alert(tray: &tauri::tray::TrayIcon, title: String) {
        let _ = tray.with_inner_tray_icon(move |inner| {
            let (Some(item), Some(mtm)) = (inner.ns_status_item(), MainThreadMarker::new()) else {
                return;
            };
            let Some(button) = (unsafe { item.button(mtm) }) else {
                return;
            };
            let text = NSMutableAttributedString::from_nsstring(&NSString::from_str(&title));
            let whole = NSRange::new(0, text.length());
            let dot = NSRange::new(0, "●".encode_utf16().count());
            unsafe {
                if let Some(font) = button.font() {
                    text.addAttribute_value_range(NSFontAttributeName, &font, whole);
                }
                text.addAttribute_value_range(NSForegroundColorAttributeName, &NSColor::systemRedColor(), dot);
            }
            button.setAttributedTitle(&text);
        });
    }
```

and the public wrapper beside `show_as_panel`'s, a no-op off macOS. Follow objc2 0.6.4 / objc2-app-kit 0.3.2's real
names where these differ (`initWithString` for the constructor, the casts `addAttribute_value_range` wants). If it
cannot be built against those crates, set `trayicon::MAC_ALERT` to `"!"` (and nothing calls `tint_tray_alert`), so the
title reads `! 4`, the spec's fallback, and write in the commit message which one shipped. Whether the dot shows red
on a real menu bar is a hand check after the run.

- [ ] **Step 4: tray.rs**

Create `src-tauri/src/tray.rs`:

```rust
//! The menu bar / tray icon and its popover (spec 2026-10-15-tray-popover-design.md). The icon shows what waits on
//! you, from the cockpit (set_tray_status); a left click opens the popover, a second webview window ("tray",
//! tray.html) that lives only while open, since a webview costs 50-100 MB and the popover is an occasional glance; a
//! right click opens Open / Quit. wavesrv's exit dims the icon here, since then no frontend can.

use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Listener, Manager, PhysicalPosition, PhysicalSize, Rect, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

use crate::applog::log_line;
use crate::trayicon::{self, R};

pub const TRAY_LABEL: &str = "tray";
const TRAY_ID: &str = "arc";
const WIDTH: f64 = 360.0;
const FIRST_HEIGHT: f64 = 480.0;
// the click on the icon that blurred the popover shut must not open it again
const REOPEN_GUARD: Duration = Duration::from_millis(250);

#[derive(Clone, Default)]
struct State {
    count: u32,
    alert: bool,
    visible: bool,
    offline: bool,
    icon: Option<R>,
    height: Option<f64>,
    closed_at: Option<Instant>,
    // the click that opened the popover, until its page says hello: the cold open's cost, logged
    opened_at: Option<Instant>,
}

fn state() -> &'static Mutex<State> {
    static S: OnceLock<Mutex<State>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(State::default()))
}

static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let _ = APP.set(app.clone());
    let open = MenuItem::with_id(app, "tray-open", "Open arcterm", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit arcterm", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon_image(app, &State::default()))
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("arcterm")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "tray-open" => {
                let _ = app.emit("tray:act", serde_json::json!({ "kind": "open-arcterm" }));
            }
            "tray-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = ev {
                toggle(tray.app_handle(), rect);
            }
        })
        .build(app)?;
    // hidden until the cockpit reports its first status: app:tray may be off
    tray.set_visible(false)?;
    let handle = app.clone();
    app.listen_any("tray:act", move |ev| {
        let payload = ev.payload().to_string();
        let app = handle.clone();
        let _ = handle.run_on_main_thread(move || on_act(&app, &payload));
    });
    Ok(())
}

fn icon_image(app: &AppHandle, st: &State) -> Image<'static> {
    let img = if cfg!(target_os = "macos") {
        trayicon::mac_icon(st.offline)
    } else {
        let scale = app.primary_monitor().ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0);
        trayicon::win_icon(trayicon::win_icon_size(scale), st.count, st.alert, st.offline)
    };
    Image::new_owned(img.px, img.width, img.height)
}

fn apply(app: &AppHandle, st: &State) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let _ = tray.set_icon(Some(icon_image(app, st)));
    #[cfg(target_os = "macos")]
    {
        let _ = tray.set_icon_as_template(true);
        let title = trayicon::mac_title(st.count, st.alert, st.offline);
        // Some(""), never None: tray-icon 0.24.1's set_title(None) leaves the old title on the button
        let _ = tray.set_title(Some(title.clone()));
        if title.starts_with(trayicon::MAC_ALERT) {
            crate::macwindow::tint_tray_alert(&tray, title);
        }
    }
    let _ = tray.set_tooltip(Some(trayicon::tooltip(st.count, st.alert, st.offline)));
    let _ = tray.set_visible(st.visible || st.offline);
}

#[tauri::command]
pub fn set_tray_status(app: AppHandle, count: u32, alert: bool, visible: bool) {
    let st = {
        let mut s = state().lock().unwrap();
        s.count = count;
        s.alert = alert;
        s.visible = visible;
        s.clone()
    };
    apply(&app, &st);
    if !visible {
        close(&app);
    }
}

#[tauri::command]
pub fn tray_popover_size(app: AppHandle, height: f64) {
    state().lock().unwrap().height = Some(height);
    if let Some(win) = app.get_webview_window(TRAY_LABEL) {
        place(&app, &win);
    }
}

/// wavesrv's stderr closed: dim the icon and tell an open popover. Called from the stderr reader thread.
pub fn wavesrv_gone() {
    let Some(app) = APP.get().cloned() else {
        return;
    };
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        let st = {
            let mut s = state().lock().unwrap();
            s.offline = true;
            s.clone()
        };
        apply(&app2, &st);
        let _ = app2.emit_to(TRAY_LABEL, "tray:offline", serde_json::json!({}));
    });
}

fn toggle(app: &AppHandle, rect: Rect) {
    if app.get_webview_window(TRAY_LABEL).is_some() {
        close(app);
        return;
    }
    {
        let mut s = state().lock().unwrap();
        if s.closed_at.is_some_and(|t| t.elapsed() < REOPEN_GUARD) {
            return;
        }
        let scale = app.primary_monitor().ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0);
        let p = rect.position.to_physical::<f64>(scale);
        let z = rect.size.to_physical::<f64>(scale);
        s.icon = Some(R { x: p.x, y: p.y, w: z.width, h: z.height });
        s.opened_at = Some(Instant::now());
    }
    if let Err(e) = open(app) {
        log_line(&format!("[tray] opening the popover failed: {e}"));
    }
}

fn open(app: &AppHandle) -> tauri::Result<()> {
    let win = WebviewWindowBuilder::new(app, TRAY_LABEL, WebviewUrl::App("tray.html".into()))
        .title("arcterm")
        .inner_size(WIDTH, FIRST_HEIGHT)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .visible(false)
        .focused(false)
        .build()?;
    place(app, &win);
    let handle = app.clone();
    win.on_window_event(move |ev| {
        if let WindowEvent::Focused(false) = ev {
            let app = handle.clone();
            // not inside the window's own event: destroying it there tears down what is dispatching
            let _ = handle.run_on_main_thread(move || close(&app));
        }
    });
    if cfg!(target_os = "macos") {
        crate::macwindow::show_as_panel(&win);
    } else {
        win.show()?;
        win.set_focus()?;
    }
    Ok(())
}

fn place(app: &AppHandle, win: &WebviewWindow) {
    let (icon, height) = {
        let s = state().lock().unwrap();
        (s.icon, s.height.unwrap_or(FIRST_HEIGHT))
    };
    let Some(icon) = icon else {
        return;
    };
    let monitor = app
        .monitor_from_point(icon.x + icon.w / 2.0, icon.y + icon.h / 2.0)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };
    let scale = monitor.scale_factor();
    let wa = monitor.work_area();
    let work = R {
        x: wa.position.x as f64,
        y: wa.position.y as f64,
        w: wa.size.width as f64,
        h: wa.size.height as f64,
    };
    let size = (WIDTH * scale, (height * scale).min(work.h - 16.0 * scale));
    let (x, y) = trayicon::popover_origin(icon, size, work);
    let _ = win.set_size(PhysicalSize::new(size.0.round() as u32, size.1.round() as u32));
    let _ = win.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
}

fn close(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(TRAY_LABEL) {
        let _ = win.destroy();
        state().lock().unwrap().closed_at = Some(Instant::now());
        let _ = app.emit("tray:closed", ());
    }
}

fn on_act(app: &AppHandle, payload: &str) {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) else {
        return;
    };
    let kind = v.get("kind").and_then(|k| k.as_str()).unwrap_or("");
    match kind {
        "hello" => {
            // the spec keeps the window hidden after its first open instead, if this is past 0.5 s on the Mac
            let opened = state().lock().unwrap().opened_at.take();
            if let Some(t) = opened {
                log_line(&format!("[tray] popover ready {} ms after the click", t.elapsed().as_millis()));
            }
            if state().lock().unwrap().offline {
                let _ = app.emit_to(TRAY_LABEL, "tray:offline", serde_json::json!({}));
            }
        }
        "close" => close(app),
        "restart" => app.restart(),
        "quit" => app.exit(0),
        "showlog" => {
            close(app);
            if let Some(path) = crate::applog::log_path() {
                if let Err(e) = open::that(&path) {
                    log_line(&format!("[tray] opening {path:?} failed: {e}"));
                }
            }
        }
        "open-monitor" => {
            close(app);
            let spawned = if cfg!(target_os = "macos") {
                std::process::Command::new("open").args(["-a", "Activity Monitor"]).spawn()
            } else {
                std::process::Command::new("taskmgr").spawn()
            };
            if let Err(e) = spawned {
                log_line(&format!("[tray] opening the OS's monitor failed: {e}"));
            }
        }
        k if k.starts_with("open-") => close(app),
        _ => {}
    }
}
```

If `Monitor::work_area` or `AppHandle::monitor_from_point` is missing in the Tauri version `Cargo.lock` pins (2.11.3),
use `monitor.position()` / `monitor.size()` for the work area, and on macOS take 25 pt off its top for the menu bar.

- [ ] **Step 5: Wire it into main.rs**

In `src-tauri/src/main.rs`:
1. `mod tray;` beside the other `mod` lines, and drop the `#[allow(dead_code)]` Task 3 put on `mod trayicon;`.
2. Add `tray::set_tray_status, tray::tray_popover_size` to `tauri::generate_handler![…]`.
3. In `.setup`, before `Ok(())`, after the child is stored:

```rust
            if let Err(e) = tray::setup(app.handle()) {
                applog::log_line(&format!("[tauri] the tray icon failed: {e}"));
            }
```

4. After `applog::log_line("[tauri] wavesrv stderr closed");` (line 149):

```rust
        tray::wavesrv_gone();
```

- [ ] **Step 6: The tray window's capability**

Create `src-tauri/capabilities/tray.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "tray",
  "description": "The menu bar / tray popover (spec 2026-10-15-tray-popover-design.md): its events, nothing else. Opening the cockpit or a URL goes through tray:act to the main window.",
  "windows": ["tray"],
  "permissions": ["core:event:default"]
}
```

- [ ] **Step 7: The architecture doc**

In `docs/reference/architecture.md` line 10, change "eleven Tauri commands only" to "thirteen Tauri commands only"
and add before the closing parenthesis: `; \`tray.rs\`: \`set_tray_status\` (the menu bar / tray icon's count, red dot
and visibility, from the cockpit) and \`tray_popover_size\` (the popover's height, from the \`tray\` window)`. Add one
sentence after it: "`tray.rs` also owns the tray icon and its popover, a second webview window (`tray.html`) created
on open and destroyed on close; the cockpit feeds it over the `tray:snapshot` / `tray:act` events."

- [ ] **Step 8: Build and test**

Run: `PATH="/opt/homebrew/opt/rustup/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml && PATH="/opt/homebrew/opt/rustup/bin:$PATH" cargo build --manifest-path src-tauri/Cargo.toml`
Expected: tests pass, builds with no warnings from `tray.rs` or `trayicon.rs`.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/tray.rs src-tauri/src/main.rs src-tauri/src/macwindow.rs src-tauri/src/applog.rs src-tauri/src/trayicon.rs src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/capabilities/tray.json docs/reference/architecture.md
git commit -m "feat(tray): the menu bar / tray icon and its popover window, a non-activating panel on macOS"
```

### Task 5: The popover's page (frontend, `tray.html`)

**Depends on:** none
**Files:** `frontend/app/cockpit/traytypes.ts`, `frontend/app/cockpit/trayformat.ts`, `frontend/app/cockpit/trayformat.test.ts`, `frontend/app/cockpit/traypage.tsx`, `frontend/app/cockpit/traysubpages.tsx`, `frontend/tauri/tray.html`, `frontend/tauri/tray.tsx`, `frontend/tauri/trayfixtures.ts`, `frontend/tauri/vite.config.ts`, `frontend/tauri/browsershim/core.ts`, `scripts/cdp/scenarios.mjs`

**Interfaces:**
- Consumes: `formatElapsed(ms)`, `formatLeft(ms)`, `PACE_CHOICES`, `PAUSE_CHOICES` from `frontend/app/cockpit/jobqueue.ts`;
  `useApplyCockpitTheme()` from `frontend/app/view/agents/themestore.ts:27`; `loadFonts()` from `@/util/fontutil`.
- Produces: `traytypes.ts` (`TraySnapshot`, `TrayAct`, `TrayPage`, `TrayLevel` and the row types below), used by
  Task 6; the page's events: it emits `tray:act` and listens to `tray:snapshot` and `tray:offline`; it invokes
  `tray_popover_size { height }`; `tray.html?fixture=<name>` draws a canned snapshot and records acts in
  `window.__trayActs`; DOM hooks `data-tray-page="main|freeup|storage|offline|loading"`, `data-tray-card`,
  `data-tray-job`, `data-tray-wait`, `data-tray-run-now`, `data-tray-skip`, `data-tray-stop`, `data-tray-clean`.

- [ ] **Step 1: The types**

Create `frontend/app/cockpit/traytypes.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the cockpit sends the menu bar / tray popover and what it sends back (spec 2026-10-15-tray-popover-design.md).
// The popover (frontend/tauri/tray.tsx) holds no store of its own: traybridge.tsx builds a TraySnapshot from the
// cockpit's stores and emits it as tray:snapshot; the popover emits each click as a TrayAct on tray:act. Plain data
// only: it crosses a Tauri event.

export type TrayLevel = "normal" | "high" | "critical" | "unknown";
export type TrayPage = "main" | "freeup" | "storage";
export type TrayPlatform = "mac" | "win" | "other";

export interface TrayMachine {
    memTotal: number;
    memAvailable: number;
    pressure: TrayLevel;
    cpuPct: number;
    cpuSamples: number[]; // 0-100, oldest first, up to the last minute
    diskName: string;
    diskTotal: number;
    diskFree: number;
}

export interface TrayJob {
    id: string;
    name: string;
    bytes: number; // its peak RAM
    running: boolean;
    position: number | null; // its place in the queue while queued
    elapsedMs: number; // running for, or waiting for
    source: string; // the agent or run it belongs to
    reason: string; // why a queued job waits; "" while running
    engine: boolean; // the engine's own job: no Skip
    canOpen: boolean;
}

export interface TrayWait {
    key: string;
    kind: string; // briefingmodel kindWord: "ask", "gate", "plan", "rule", …
    ask: boolean;
    title: string;
    tail: string;
}

export interface TrayUsage {
    pct: number;
    elapsedPct: number | null; // how much of the 5-hour window has passed, for the tick
    level: "ok" | "warn" | "hot";
    title: string; // the chip's tooltip: the reset and the week
}

export interface TrayStorageRow {
    category: string;
    title: string;
    bytes: number;
    detail: string;
    action: string | null; // the clean's verb when it cleans in place
    cleanableBytes: number;
    go: "settings" | "gallery" | null; // where it is cleaned one by one
}

export interface TrayStorage {
    arcBytes: number;
    cleanableBytes: number;
    storeBytes: number;
    rows: TrayStorageRow[];
}

export interface TrayConsumerRow {
    blockId: string;
    name: string;
    bytes: number | null;
    heaviest: { pid: number; command: string; bytes: number } | null;
}

export interface TrayConsumers {
    rows: TrayConsumerRow[]; // heaviest first
    ownBytes: number | null; // arcterm's app, server and webview
    arcBytes: number | null; // the agents plus ownBytes
    otherBytes: number | null; // the rest of the used memory
}

export interface TraySnapshot {
    platform: TrayPlatform;
    machine: TrayMachine | null; // null until the first reading
    jobs: TrayJob[];
    jobsMode: string; // jobqueue.ts paceValue
    pausedLeftMs: number | null;
    waits: TrayWait[]; // at most five
    waitsMore: number;
    working: number;
    usage: TrayUsage | null;
    storage: TrayStorage | null; // null until Settings → Storage has scanned once
    consumers: TrayConsumers | null; // read only while Free up shows
    heardAt: number | null; // when the cockpit last got an answer from wavesrv: the offline page's "Last heard"
}

export type TrayAct =
    | { kind: "hello" }
    | { kind: "page"; page: TrayPage }
    | { kind: "close" }
    | { kind: "open-arcterm" }
    | { kind: "open-wait"; key: string }
    | { kind: "open-more" }
    | { kind: "open-job"; id: string }
    | { kind: "open-agent"; blockId: string }
    | { kind: "open-storage-settings" }
    | { kind: "open-gallery" }
    | { kind: "open-tray-settings" }
    | { kind: "open-monitor" }
    | { kind: "run-now"; id: string }
    | { kind: "skip"; id: string }
    | { kind: "slots"; value: string }
    | { kind: "pause"; ms: number | null }
    | { kind: "stop"; blockId: string; pid: number }
    | { kind: "clean"; category: string }
    | { kind: "restart" }
    | { kind: "showlog" }
    | { kind: "quit" };
```

- [ ] **Step 2: Write the failing display-rule tests**

Create `frontend/app/cockpit/trayformat.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fmtSize, levelWord, memoryCaption, pageState, sparkPoints, split, usedPct } from "./trayformat";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

describe("fmtSize", () => {
    it("reads in binary units, one decimal under 100 GB, none when it is .0", () => {
        expect(fmtSize(12 * MIB)).toBe("12 MB");
        expect(fmtSize(1.2 * GIB)).toBe("1.2 GB");
        expect(fmtSize(16 * GIB)).toBe("16 GB");
        expect(fmtSize(127.4 * GIB)).toBe("127 GB");
    });
});

describe("the memory card's words", () => {
    it("names each level, and none with no reading", () => {
        expect(levelWord("normal")).toBe("Normal");
        expect(levelWord("high")).toBe("High");
        expect(levelWord("critical")).toBe("Critical");
        expect(levelWord("unknown")).toBeNull();
    });
    it("says what the queue does at that level", () => {
        expect(memoryCaption("normal", false)).toBe("Jobs start as RAM allows");
        expect(memoryCaption("unknown", false)).toBe("Jobs start as RAM allows");
        expect(memoryCaption("high", false)).toBe("Jobs run one at a time");
        expect(memoryCaption("critical", false)).toBe("No heavy job starts");
        expect(memoryCaption("critical", true)).toBe("Queue paused");
    });
});

describe("bars", () => {
    it("usedPct is whole and clamped", () => {
        expect(usedPct(16 * GIB, 1.2 * GIB)).toBe(93);
        expect(usedPct(0, 0)).toBe(0);
        expect(usedPct(10, 20)).toBe(0);
    });
    it("split keeps arcterm's share inside the used part", () => {
        expect(split(245, 118, 16.4)).toEqual({ arc: 7, other: 41 });
        expect(split(100, 50, 80)).toEqual({ arc: 50, other: 0 });
        expect(split(0, 0, 5)).toEqual({ arc: 0, other: 0 });
    });
});

describe("sparkPoints", () => {
    it("draws oldest left, 100% at the top", () => {
        expect(sparkPoints([0, 100], 140, 34)).toBe("0,34 140,0");
    });
    it("draws one sample as a flat line and none as nothing", () => {
        expect(sparkPoints([50], 140, 34)).toBe("0,17 140,17");
        expect(sparkPoints([], 140, 34)).toBe("");
    });
});

describe("pageState", () => {
    it("offline wins, then loading until the first snapshot", () => {
        expect(pageState(null, true)).toBe("offline");
        expect(pageState({}, true)).toBe("offline");
        expect(pageState(null, false)).toBe("loading");
        expect(pageState({}, false)).toBe("ready");
    });
});
```

Run: `npx vitest run frontend/app/cockpit/trayformat.test.ts`
Expected: FAIL (`Cannot find module './trayformat'`).

- [ ] **Step 3: Write the display rules**

Create `frontend/app/cockpit/trayformat.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The tray popover's display rules (spec 2026-10-15-tray-popover-design.md): sizes, the memory card's words, the
// bars' widths and the CPU line. traypage.tsx and traysubpages.tsx draw them. No React.

import type { TrayLevel } from "./traytypes";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** Binary units, labelled as Activity Monitor and Task Manager label them. */
export function fmtSize(bytes: number): string {
    if (bytes < GIB) {
        return `${Math.round(bytes / MIB)} MB`;
    }
    const g = bytes / GIB;
    return g < 100 ? `${g.toFixed(1).replace(/\.0$/, "")} GB` : `${Math.round(g)} GB`;
}

export function levelWord(level: TrayLevel): string | null {
    switch (level) {
        case "normal":
            return "Normal";
        case "high":
            return "High";
        case "critical":
            return "Critical";
        default:
            return null;
    }
}

/** What the heavy-job queue does at this level (pkg/jobqueue), under the memory figure. */
export function memoryCaption(level: TrayLevel, paused: boolean): string {
    if (paused) {
        return "Queue paused";
    }
    if (level === "critical") {
        return "No heavy job starts";
    }
    return level === "high" ? "Jobs run one at a time" : "Jobs start as RAM allows";
}

/** The whole percent of total in use, 0-100. */
export function usedPct(total: number, free: number): number {
    if (total <= 0) {
        return 0;
    }
    return Math.min(100, Math.max(0, Math.round(((total - free) / total) * 100)));
}

/** A split bar: arcterm's share and the rest of what is used, in whole percent of total. */
export function split(total: number, used: number, arc: number): { arc: number; other: number } {
    if (total <= 0) {
        return { arc: 0, other: 0 };
    }
    const arcPct = Math.round((Math.min(used, Math.max(0, arc)) / total) * 100);
    const usedP = Math.min(100, Math.round((used / total) * 100));
    return { arc: arcPct, other: Math.max(0, usedP - arcPct) };
}

/** The CPU line's points in a w x h box, oldest left, 100 % at the top. */
export function sparkPoints(samples: number[], w = 140, h = 34): string {
    if (samples.length === 0) {
        return "";
    }
    const pts = samples.length === 1 ? [samples[0], samples[0]] : samples;
    const step = w / (pts.length - 1);
    const r = (n: number) => Math.round(n * 10) / 10;
    return pts.map((v, i) => `${r(i * step)},${r(h - (Math.min(100, Math.max(0, v)) / 100) * h)}`).join(" ");
}

export type PageState = "loading" | "offline" | "ready";

export function pageState(snapshot: unknown, offline: boolean): PageState {
    if (offline) {
        return "offline";
    }
    return snapshot == null ? "loading" : "ready";
}

// status colours by level: the word and its dot, and the memory bar
export const LEVEL_TEXT: Record<TrayLevel, string> = {
    normal: "text-working",
    high: "text-asking",
    critical: "text-error",
    unknown: "text-muted",
};
export const LEVEL_DOT: Record<TrayLevel, string> = {
    normal: "bg-working",
    high: "bg-asking",
    critical: "bg-error",
    unknown: "bg-muted",
};
export const LEVEL_BAR: Record<TrayLevel, string> = {
    normal: "bg-muted",
    high: "bg-asking",
    critical: "bg-error",
    unknown: "bg-muted",
};
// the 5h chip, as the app bar's meter colours it (usagemeters.tsx LEVEL_BAR / LEVEL_TXT)
export const USAGE_BAR = { ok: "bg-muted", warn: "bg-warning", hot: "bg-error" } as const;
export const USAGE_TEXT = { ok: "text-primary", warn: "text-warning", hot: "text-error" } as const;
```

Run: `npx vitest run frontend/app/cockpit/trayformat.test.ts`
Expected: PASS.

- [ ] **Step 4: The main page**

Create `frontend/app/cockpit/traypage.tsx`. It draws boards `Main`, `A-Quiet`, `A-Critical`, `A-PausedHot`,
`A-Offline` and `Win-Main` of the Prototype; check each against its board.

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The tray popover's main page, its loading and offline pages, and the parts the subpages share (spec
// 2026-10-15-tray-popover-design.md; boards in .superpowers/design/tray-popover). It draws a TraySnapshot and sends
// TrayActs; frontend/tauri/tray.tsx wires both to the cockpit. traysubpages.tsx draws Free up and Clean up.

import { cn } from "@/util/util";
import { ChevronLeft, Cpu, HardDrive, MemoryStick, Pause, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { formatElapsed, formatLeft, PACE_CHOICES, PAUSE_CHOICES } from "./jobqueue";
import {
    fmtSize,
    LEVEL_BAR,
    LEVEL_DOT,
    LEVEL_TEXT,
    levelWord,
    memoryCaption,
    sparkPoints,
    split,
    USAGE_BAR,
    USAGE_TEXT,
    usedPct,
} from "./trayformat";
import type { TrayAct, TrayJob, TrayLevel, TrayPage, TraySnapshot } from "./traytypes";

export type Send = (act: TrayAct) => void;

export const CARD = "flex min-w-0 flex-col gap-2 rounded border border-edge-mid bg-surface-raised px-3 py-2.5";
export const ROW_BUTTON =
    "cursor-pointer rounded border border-edge-mid px-1.5 py-[1px] text-[11px] text-secondary hover:border-edge-strong hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
export const OPEN_BUTTON =
    "cursor-pointer rounded px-1 text-[12px] text-muted hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const SELECT =
    "h-[22px] cursor-pointer rounded-[7px] border border-border bg-surface px-1 text-[11.5px] text-secondary hover:border-edge-mid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const FOOT_BUTTON =
    "h-7 cursor-pointer rounded border border-edge-mid bg-surface-raised text-[12px] text-secondary hover:border-edge-strong hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function PressureWord({ level, platform }: { level: TrayLevel; platform: TraySnapshot["platform"] }) {
    const word = levelWord(level);
    if (word == null) {
        return null;
    }
    return (
        <span
            data-tray-pressure={level}
            title={
                platform === "win"
                    ? "Windows reads it from the commit charge against the RAM"
                    : "macOS memory pressure, as Activity Monitor reads it"
            }
            className={cn("flex items-center gap-1 text-[11px] font-semibold", LEVEL_TEXT[level])}
        >
            <span className={cn("h-[7px] w-[7px] rounded-full", LEVEL_DOT[level])} />
            {word}
        </span>
    );
}

export function SubHeader({ title, back, right }: { title: string; back: () => void; right?: ReactNode }) {
    return (
        <div className="flex items-center gap-1.5 px-0.5 pt-0.5">
            <button type="button" aria-label="Back" title="Back (Esc)" onClick={back} className={cn(OPEN_BUTTON, "p-1")}>
                <ChevronLeft size={14} className="text-secondary" aria-hidden />
            </button>
            <span className="flex-1 text-[13px] font-semibold text-primary">{title}</span>
            {right}
        </div>
    );
}

function MemoryCard({ s, onFreeUp }: { s: TraySnapshot; onFreeUp: () => void }) {
    const m = s.machine;
    const level = m?.pressure ?? "unknown";
    return (
        <div data-tray-card="memory" className={CARD}>
            <div className="flex items-center gap-1.5">
                <MemoryStick size={13} className="text-muted" aria-hidden />
                <span className="flex-1 text-[12px] font-semibold text-secondary">Memory</span>
                <PressureWord level={level} platform={s.platform} />
            </div>
            <div className="flex items-baseline gap-1.5">
                <span className="text-[20px] font-semibold tabular-nums text-primary">
                    {m ? fmtSize(m.memAvailable) : "—"}
                </span>
                {m ? <span className="text-[11px] text-muted">free of {fmtSize(m.memTotal)}</span> : null}
            </div>
            <div className="h-[5px] overflow-hidden rounded-[3px] bg-background">
                <div
                    className={cn("h-full", LEVEL_BAR[level])}
                    style={{ width: `${m ? usedPct(m.memTotal, m.memAvailable) : 0}%` }}
                />
            </div>
            <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted">
                    {memoryCaption(level, s.pausedLeftMs != null)}
                </span>
                <button
                    type="button"
                    data-tray-freeup
                    title="See what arcterm holds in memory and stop the heaviest"
                    onClick={onFreeUp}
                    className={ROW_BUTTON}
                >
                    Free up
                </button>
            </div>
        </div>
    );
}

function CpuCard({ s }: { s: TraySnapshot }) {
    const m = s.machine;
    return (
        <div data-tray-card="cpu" className={CARD}>
            <div className="flex items-center gap-1.5">
                <Cpu size={13} className="text-muted" aria-hidden />
                <span className="flex-1 text-[12px] font-semibold text-secondary">CPU</span>
            </div>
            <div className="flex items-baseline gap-1.5">
                <span className="text-[20px] font-semibold tabular-nums text-primary">
                    {m ? `${Math.round(m.cpuPct)}%` : "—"}
                </span>
                <span className="text-[11px] text-muted">busy</span>
            </div>
            <svg
                width="100%"
                height="30"
                viewBox="0 0 140 34"
                preserveAspectRatio="none"
                aria-label="CPU over the last minute"
                className="block"
            >
                <line x1="0" y1="33.5" x2="140" y2="33.5" className="stroke-edge-mid" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                <polyline
                    points={sparkPoints(m?.cpuSamples ?? [])}
                    fill="none"
                    className="stroke-ink-mid"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                />
            </svg>
            <span className="text-[10.5px] text-muted">Last minute</span>
        </div>
    );
}

function StorageCard({ s, onCleanUp }: { s: TraySnapshot; onCleanUp: () => void }) {
    const m = s.machine;
    const st = s.storage;
    const bar = m ? split(m.diskTotal, m.diskTotal - m.diskFree, st?.arcBytes ?? 0) : { arc: 0, other: 0 };
    return (
        <div data-tray-card="storage" className={CARD}>
            <div className="flex items-center gap-1.5">
                <HardDrive size={13} className="text-muted" aria-hidden />
                <span className="flex-1 text-[12px] font-semibold text-secondary">Storage</span>
                <span className="truncate text-[11px] text-muted">{m?.diskName ?? ""}</span>
            </div>
            <div className="flex items-baseline gap-1.5">
                <span className="text-[20px] font-semibold tabular-nums text-primary">{m ? fmtSize(m.diskFree) : "—"}</span>
                <span className="flex-1 text-[11px] text-muted">{m ? `free of ${fmtSize(m.diskTotal)}` : ""}</span>
                <button
                    type="button"
                    data-tray-cleanup
                    title="See what arcterm and its agents leave on disk, and clean it"
                    onClick={onCleanUp}
                    className={ROW_BUTTON}
                >
                    Clean up
                </button>
            </div>
            <div className="flex h-[5px] overflow-hidden rounded-[3px] bg-background">
                <div title="arcterm and its agents" className="h-full bg-secondary" style={{ width: `${bar.arc}%` }} />
                <div title="Everything else" className="h-full bg-ink-faint" style={{ width: `${bar.other}%` }} />
            </div>
            <span className="flex items-center gap-1 text-[10.5px] tabular-nums text-muted">
                {st ? (
                    <>
                        <span className="h-[5px] w-2 rounded-[2px] bg-secondary" />
                        arcterm {fmtSize(st.arcBytes)} · {fmtSize(st.cleanableBytes)} can be cleaned
                    </>
                ) : (
                    "Not scanned yet"
                )}
            </span>
        </div>
    );
}

function JobRow({ j, send }: { j: TrayJob; send: Send }) {
    return (
        <div data-tray-job={j.id} data-state={j.running ? "running" : "queued"} className="flex flex-col gap-[2px] py-1">
            <div className="flex items-center gap-2">
                {j.running ? (
                    <span aria-label="running" className="h-[7px] w-[7px] flex-none rounded-full bg-working" />
                ) : (
                    <span
                        title={`Number ${j.position ?? "?"} in the queue`}
                        className="w-[7px] flex-none text-[10.5px] tabular-nums text-muted"
                    >
                        {j.position ?? ""}
                    </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-primary" title={j.name}>
                    {j.name}
                </span>
                <span title="Its peak RAM" className="text-[12px] tabular-nums text-secondary">
                    {fmtSize(j.bytes)}
                </span>
                <span className="whitespace-nowrap text-[12px] tabular-nums text-secondary">
                    {j.running ? formatElapsed(j.elapsedMs) : `waiting ${formatElapsed(j.elapsedMs)}`}
                </span>
                {j.canOpen ? (
                    <button
                        type="button"
                        aria-label={`Open ${j.source} in arcterm`}
                        title={`Open ${j.source}`}
                        onClick={() => send({ kind: "open-job", id: j.id })}
                        className={OPEN_BUTTON}
                    >
                        ↗
                    </button>
                ) : null}
            </div>
            <div className="flex items-center gap-1.5 pl-[15px]">
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
                    {j.source}
                    {!j.running && j.reason ? ` · ${j.reason}` : ""}
                </span>
                {j.running ? null : (
                    <>
                        <button
                            type="button"
                            data-tray-run-now
                            title="Start it now, whatever is running and whatever RAM is free"
                            onClick={() => send({ kind: "run-now", id: j.id })}
                            className={ROW_BUTTON}
                        >
                            Run now
                        </button>
                        {j.engine ? null : (
                            <button
                                type="button"
                                data-tray-skip
                                title="Drop it from the queue; its agent is told it was skipped"
                                onClick={() => send({ kind: "skip", id: j.id })}
                                className={cn(ROW_BUTTON, "text-error")}
                            >
                                Skip
                            </button>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

function JobsCard({ s, send }: { s: TraySnapshot; send: Send }) {
    return (
        <div data-tray-card="jobs" className={cn(CARD, "gap-1")}>
            <div className="flex items-center gap-1.5 pb-0.5">
                <span className="flex-1 text-[12px] font-semibold text-secondary">Heavy jobs</span>
                <select
                    aria-label="Slots"
                    title="How many heavy jobs run at once. Auto starts each as soon as the RAM it needs is free; Off never makes one wait"
                    value={s.jobsMode}
                    onChange={(e) => send({ kind: "slots", value: e.target.value })}
                    className={SELECT}
                >
                    {PACE_CHOICES.map((c) => (
                        <option key={c.value} value={c.value}>
                            {c.label}
                        </option>
                    ))}
                </select>
                {s.pausedLeftMs == null ? (
                    <select
                        aria-label="Pause the queue"
                        title="Start every heavy job at once for a while, whatever RAM is free, then queue them again"
                        value=""
                        onChange={(e) => {
                            const c = PAUSE_CHOICES.find((p) => p.label === e.target.value);
                            if (c) {
                                send({ kind: "pause", ms: c.ms });
                            }
                        }}
                        className={SELECT}
                    >
                        <option value="">Pause…</option>
                        {PAUSE_CHOICES.map((c) => (
                            <option key={c.label} value={c.label}>
                                {c.label}
                            </option>
                        ))}
                    </select>
                ) : null}
            </div>
            {s.pausedLeftMs != null ? (
                <div data-tray-paused className="flex items-center gap-1.5 pb-1 pt-0.5 text-[11.5px] text-muted">
                    <Pause size={11} aria-hidden className="flex-none" />
                    <span className="flex-1 tabular-nums">
                        Paused, {formatLeft(s.pausedLeftMs)} left: every job starts at once
                    </span>
                    <button
                        type="button"
                        title="Queue heavy jobs again"
                        onClick={() => send({ kind: "pause", ms: null })}
                        className={ROW_BUTTON}
                    >
                        Resume
                    </button>
                </div>
            ) : null}
            {s.jobs.length === 0 ? (
                <span className="py-1 text-[12px] text-muted">No heavy jobs running.</span>
            ) : (
                s.jobs.map((j) => <JobRow key={j.id} j={j} send={send} />)
            )}
        </div>
    );
}

function WaitsCard({ s, send }: { s: TraySnapshot; send: Send }) {
    const total = s.waits.length + s.waitsMore;
    return (
        <div data-tray-card="waits" className={cn(CARD, "gap-0.5")}>
            <div className="flex items-center gap-1.5 pb-1">
                <span className="text-[12px] font-semibold text-secondary">Waiting on you</span>
                <span className="flex-1 text-[11px] tabular-nums text-muted">{total > 0 ? total : ""}</span>
                {s.working > 0 ? (
                    <span className="flex items-center gap-1 text-[10.5px] tabular-nums text-muted">
                        <span className="h-1.5 w-1.5 rounded-full bg-working" />
                        {s.working === 1 ? "1 agent working" : `${s.working} agents working`}
                    </span>
                ) : null}
            </div>
            {total === 0 ? <span className="py-1 text-[12px] text-muted">Nothing is waiting on you.</span> : null}
            {s.waits.map((w) => (
                <button
                    key={w.key}
                    type="button"
                    data-tray-wait={w.key}
                    title="Open it in arcterm"
                    onClick={() => send({ kind: "open-wait", key: w.key })}
                    className="flex w-full cursor-pointer items-center gap-2 rounded py-1 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <span className={cn("min-w-8 flex-none text-[11px]", w.ask ? "font-semibold text-asking" : "text-muted")}>
                        {w.kind}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-primary">
                        {w.title} {w.tail ? <span className="text-[11px] text-muted">{w.tail}</span> : null}
                    </span>
                    <span aria-hidden className="text-[12px] text-muted">
                        ↗
                    </span>
                </button>
            ))}
            {s.waitsMore > 0 ? (
                <button
                    type="button"
                    data-tray-more
                    onClick={() => send({ kind: "open-more" })}
                    className="cursor-pointer py-1 text-left text-[11.5px] text-muted hover:text-primary"
                >
                    {s.waitsMore} more
                </button>
            ) : null}
        </div>
    );
}

function Footer({ s, send }: { s: TraySnapshot; send: Send }) {
    const u = s.usage;
    const gear = s.platform === "mac" ? "Menu bar settings" : "Tray settings";
    return (
        <div className="flex items-center gap-2">
            <button type="button" data-tray-open onClick={() => send({ kind: "open-arcterm" })} className={cn(FOOT_BUTTON, "flex-1")}>
                Open arcterm
            </button>
            {u ? (
                <span
                    data-tray-usage
                    title={u.title}
                    className="flex h-7 items-center gap-2 rounded border border-edge-mid bg-surface-raised px-2.5"
                >
                    <span className="text-[11.5px] text-secondary">Claude 5h</span>
                    <span className="relative h-[5px] w-[52px] rounded-[3px] bg-background">
                        <span
                            className={cn("absolute inset-y-0 left-0 rounded-[3px]", USAGE_BAR[u.level])}
                            style={{ width: `${Math.min(100, u.pct)}%` }}
                        />
                        {u.elapsedPct != null ? (
                            <span
                                className="absolute -top-0.5 -ml-px h-[9px] w-0.5 rounded-[1px] bg-ink-hi"
                                style={{ left: `${u.elapsedPct}%` }}
                            />
                        ) : null}
                    </span>
                    <span className={cn("text-[12px] font-semibold tabular-nums", USAGE_TEXT[u.level])}>
                        {Math.round(u.pct)}%
                    </span>
                </span>
            ) : null}
            <button
                type="button"
                aria-label={gear}
                title={gear}
                onClick={() => send({ kind: "open-tray-settings" })}
                className={cn(FOOT_BUTTON, "flex w-7 items-center justify-center")}
            >
                <Settings size={14} className="text-muted" aria-hidden />
            </button>
        </div>
    );
}

export function MainPage({ s, send, setPage }: { s: TraySnapshot; send: Send; setPage: (p: TrayPage) => void }) {
    return (
        <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
                <MemoryCard s={s} onFreeUp={() => setPage("freeup")} />
                <CpuCard s={s} />
            </div>
            <StorageCard s={s} onCleanUp={() => setPage("storage")} />
            <JobsCard s={s} send={send} />
            <WaitsCard s={s} send={send} />
            <Footer s={s} send={send} />
        </div>
    );
}

export function LoadingPage() {
    return (
        <div className={CARD}>
            <span className="text-[12px] text-muted">Reading…</span>
        </div>
    );
}

function clock(ms: number): string {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function OfflinePage({ lastHeard, send }: { lastHeard: number | null; send: Send }) {
    return (
        <div className="flex flex-col gap-2">
            <div role="alert" data-tray-offline className={cn(CARD, "gap-1.5 p-3")}>
                <div className="flex items-center gap-1.5">
                    <span className="h-[7px] w-[7px] rounded-full bg-error" />
                    <span className="text-[12.5px] font-semibold text-primary">arcterm's server is not answering</span>
                </div>
                <span className="text-[11.5px] leading-normal text-muted">
                    Memory, jobs and what waits on you come from it. Restart arcterm to start it again; its last lines
                    are in waveapp.log.
                </span>
                {lastHeard != null ? (
                    <span className="text-[10.5px] tabular-nums text-muted">Last heard {clock(lastHeard)}</span>
                ) : null}
            </div>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    data-tray-restart
                    onClick={() => send({ kind: "restart" })}
                    className="h-7 flex-1 cursor-pointer rounded bg-accent text-[12px] font-semibold text-background shadow-inset-highlight hover:bg-accenthover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    Restart arcterm
                </button>
                <button type="button" onClick={() => send({ kind: "showlog" })} className={cn(FOOT_BUTTON, "px-3")}>
                    Show log
                </button>
                <button type="button" onClick={() => send({ kind: "quit" })} className={cn(FOOT_BUTTON, "px-3")}>
                    Quit
                </button>
            </div>
        </div>
    );
}
```

- [ ] **Step 5: The subpages**

Create `frontend/app/cockpit/traysubpages.tsx` (boards `A-FreeUp` and `A-Storage`):

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The tray popover's two subpages (spec 2026-10-15-tray-popover-design.md): Free up memory, arcterm's agents by
// footprint with Stop on each one's heaviest command, and Clean up storage, Settings → Storage's categories with the
// cleanable ones cleaned in place after a second click.

import { cn } from "@/util/util";
import { useState } from "react";
import { CARD, OPEN_BUTTON, PressureWord, ROW_BUTTON, type Send, SubHeader } from "./traypage";
import { fmtSize, LEVEL_BAR, split } from "./trayformat";
import type { TraySnapshot } from "./traytypes";

export function FreeUpPage({ s, send, back }: { s: TraySnapshot; send: Send; back: () => void }) {
    const m = s.machine;
    const c = s.consumers;
    const level = m?.pressure ?? "unknown";
    const used = m ? m.memTotal - m.memAvailable : 0;
    const bar = m && c?.arcBytes != null ? split(m.memTotal, used, c.arcBytes) : { arc: 0, other: 0 };
    const monitor = s.platform === "win" ? "Open Task Manager ↗" : "Open Activity Monitor ↗";
    return (
        <div className="flex flex-col gap-2">
            <SubHeader title="Free up memory" back={back} right={<PressureWord level={level} platform={s.platform} />} />
            <div className={CARD}>
                <div className="flex items-baseline gap-1.5">
                    <span className="text-[20px] font-semibold tabular-nums text-primary">
                        {m ? fmtSize(m.memAvailable) : "—"}
                    </span>
                    {m ? <span className="text-[11px] text-muted">free of {fmtSize(m.memTotal)}</span> : null}
                </div>
                <div className="flex h-[5px] overflow-hidden rounded-[3px] bg-background">
                    <div title="arcterm and its agents" className={cn("h-full", LEVEL_BAR[level])} style={{ width: `${bar.arc}%` }} />
                    <div title="Other apps" className="h-full bg-ink-faint" style={{ width: `${bar.other}%` }} />
                </div>
                {c?.arcBytes != null && c.otherBytes != null ? (
                    <div className="flex gap-3 text-[10.5px] tabular-nums text-muted">
                        <span className="flex items-center gap-1">
                            <span className={cn("h-[5px] w-2 rounded-[2px]", LEVEL_BAR[level])} />
                            arcterm {fmtSize(c.arcBytes)}
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="h-[5px] w-2 rounded-[2px] bg-ink-faint" />
                            Other apps {fmtSize(c.otherBytes)}
                        </span>
                    </div>
                ) : null}
            </div>
            <div className={cn(CARD, "gap-0 py-1.5")}>
                {c == null ? <span className="py-1.5 text-[12px] text-muted">Reading…</span> : null}
                {c?.rows.map((r) => (
                    <div key={r.blockId} data-tray-consumer={r.blockId} className="flex flex-col gap-[2px] py-1.5">
                        <div className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-[12.5px] text-primary">{r.name}</span>
                            <span className="text-[12px] font-semibold tabular-nums text-secondary">
                                {r.bytes != null ? fmtSize(r.bytes) : "–"}
                            </span>
                            <button
                                type="button"
                                aria-label={`Open ${r.name} in arcterm`}
                                onClick={() => send({ kind: "open-agent", blockId: r.blockId })}
                                className={OPEN_BUTTON}
                            >
                                ↗
                            </button>
                        </div>
                        {r.heaviest ? (
                            <div className="flex items-center gap-1.5">
                                <span className="min-w-0 flex-1 truncate text-[11px] text-muted" title={r.heaviest.command}>
                                    heaviest: {r.heaviest.command}
                                </span>
                                <span className="text-[11px] tabular-nums text-muted">{fmtSize(r.heaviest.bytes)}</span>
                                <button
                                    type="button"
                                    data-tray-stop
                                    title="Stop this command alone; its agent sees it end and carries on"
                                    onClick={() => send({ kind: "stop", blockId: r.blockId, pid: r.heaviest!.pid })}
                                    className={cn(ROW_BUTTON, "text-error")}
                                >
                                    Stop
                                </button>
                            </div>
                        ) : (
                            <span className="text-[11px] text-muted">Nothing heavy running</span>
                        )}
                    </div>
                ))}
                {c != null && c.ownBytes != null ? (
                    <div className="flex items-center gap-2 py-1.5">
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-primary">
                            arcterm <span className="text-[11px] text-muted">app, server and webview</span>
                        </span>
                        <span className="text-[12px] font-semibold tabular-nums text-secondary">{fmtSize(c.ownBytes)}</span>
                    </div>
                ) : null}
            </div>
            <div className="flex items-center gap-2 px-0.5">
                <span className="flex-1 text-[11px] tabular-nums text-muted">
                    {c?.otherBytes != null ? `Other apps hold ${fmtSize(c.otherBytes)}.` : ""}
                </span>
                <button type="button" onClick={() => send({ kind: "open-monitor" })} className={ROW_BUTTON}>
                    {monitor}
                </button>
            </div>
            <span className="px-0.5 text-[10.5px] text-muted">
                {level === "high" || level === "critical"
                    ? "While pressure is high, new heavy jobs wait their turn on their own."
                    : "New heavy jobs start as RAM allows."}
            </span>
        </div>
    );
}

export function StoragePage({ s, send, back }: { s: TraySnapshot; send: Send; back: () => void }) {
    const [armed, setArmed] = useState<string | null>(null);
    const m = s.machine;
    const st = s.storage;
    return (
        <div className="flex flex-col gap-2">
            <SubHeader
                title="Clean up storage"
                back={back}
                right={m ? <span className="text-[11px] tabular-nums text-muted">{fmtSize(m.diskFree)} free</span> : null}
            />
            {st == null ? (
                <div className={CARD}>
                    <span className="text-[12px] text-muted">Not scanned yet.</span>
                </div>
            ) : (
                <>
                    <div className={cn(CARD, "gap-1")}>
                        <div className="flex items-baseline gap-1.5">
                            <span className="text-[20px] font-semibold tabular-nums text-primary">{fmtSize(st.arcBytes)}</span>
                            <span className="text-[11px] text-muted">on disk for arcterm and its agents</span>
                        </div>
                        <span className="text-[10.5px] tabular-nums text-muted">
                            {fmtSize(st.cleanableBytes)} can be cleaned
                        </span>
                    </div>
                    <div className={cn(CARD, "gap-0 py-1.5")}>
                        {st.rows.map((r) => (
                            <div key={r.category} data-tray-storage-row={r.category} className="flex flex-col gap-[2px] py-1.5">
                                <div className="flex items-center gap-2">
                                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-primary">{r.title}</span>
                                    <span className="text-[12px] font-semibold tabular-nums text-secondary">{fmtSize(r.bytes)}</span>
                                    {r.action != null && r.cleanableBytes > 0 ? (
                                        <button
                                            type="button"
                                            data-tray-clean={r.category}
                                            onClick={() => {
                                                if (armed === r.category) {
                                                    setArmed(null);
                                                    send({ kind: "clean", category: r.category });
                                                } else {
                                                    setArmed(r.category);
                                                }
                                            }}
                                            onBlur={() => setArmed((a) => (a === r.category ? null : a))}
                                            className={cn(ROW_BUTTON, armed === r.category && "text-error")}
                                        >
                                            {armed === r.category ? `${r.action} ${fmtSize(r.cleanableBytes)}?` : r.action}
                                        </button>
                                    ) : null}
                                    {r.go != null ? (
                                        <button
                                            type="button"
                                            aria-label={r.go === "gallery" ? "Open the Canvas gallery" : `Open ${r.title} in Settings`}
                                            onClick={() => send({ kind: r.go === "gallery" ? "open-gallery" : "open-storage-settings" })}
                                            className={OPEN_BUTTON}
                                        >
                                            ↗
                                        </button>
                                    ) : null}
                                </div>
                                <span className="truncate text-[11px] text-muted">{r.detail}</span>
                            </div>
                        ))}
                        <div className="flex flex-col gap-[2px] py-1.5">
                            <div className="flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate text-[12.5px] text-primary">arcterm store</span>
                                <span className="text-[12px] font-semibold tabular-nums text-secondary">{fmtSize(st.storeBytes)}</span>
                            </div>
                            <span className="text-[11px] text-muted">Agents, runs and settings. Never cleaned.</span>
                        </div>
                    </div>
                </>
            )}
            <button
                type="button"
                onClick={() => send({ kind: "open-storage-settings" })}
                className="h-7 cursor-pointer rounded border border-edge-mid bg-surface-raised text-[12px] text-secondary hover:border-edge-strong hover:bg-surface-hover"
            >
                Open Settings → Storage
            </button>
        </div>
    );
}
```

- [ ] **Step 6: The entry, its fixtures and the build**

Create `frontend/tauri/tray.html`:

```html
<!doctype html>
<html spellcheck="false">
    <head>
        <meta charset="utf-8" />
        <title>arcterm</title>
    </head>
    <body style="margin: 0; background: transparent">
        <div id="tray"></div>
        <script type="module" src="./tray.tsx"></script>
    </body>
</html>
```

Create `frontend/tauri/tray.tsx`:

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The tray popover's own page (src-tauri/src/tray.rs opens it in the "tray" window): it shows the TraySnapshot the
// cockpit emits as tray:snapshot, the offline page on tray:offline, and emits each click as tray:act. It never boots
// the cockpit, the wsh client or WOS. ?fixture=<name> (trayfixtures.ts) draws a canned snapshot and records the acts
// in window.__trayActs, for the CDP scenarios.

import { LoadingPage, MainPage, OfflinePage } from "@/app/cockpit/traypage";
import { pageState } from "@/app/cockpit/trayformat";
import { FreeUpPage, StoragePage } from "@/app/cockpit/traysubpages";
import type { TrayAct, TrayPage, TraySnapshot } from "@/app/cockpit/traytypes";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { useApplyCockpitTheme } from "@/app/view/agents/themestore";
import { loadFonts } from "@/util/fontutil";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./tailwind.css";
import { TRAY_FIXTURES } from "./trayfixtures";

declare global {
    interface Window {
        __trayActs?: TrayAct[];
    }
}

const fixtureName = new URLSearchParams(location.search).get("fixture");
const fixture = fixtureName != null ? TRAY_FIXTURES[fixtureName] : undefined;

function send(act: TrayAct): void {
    if (fixtureName != null) {
        window.__trayActs = [...(window.__trayActs ?? []), act];
        return;
    }
    void emit("tray:act", act);
}

function TrayRoot() {
    useApplyCockpitTheme();
    const [snap, setSnap] = useState<TraySnapshot | null>(fixture?.snapshot ?? null);
    const [offline, setOffline] = useState(fixture?.offline ?? false);
    // not the last snapshot's arrival: the cockpit keeps sending snapshots after wavesrv has gone
    const lastHeard = snap?.heardAt ?? fixture?.lastHeard ?? null;
    const [page, setPageState] = useState<TrayPage>(fixture?.page ?? "main");
    const rootRef = useRef<HTMLDivElement>(null);
    const setPage = (p: TrayPage) => {
        setPageState(p);
        send({ kind: "page", page: p });
    };

    useEffect(() => {
        if (fixtureName != null) {
            return;
        }
        const unlisten = [
            listen<TraySnapshot>("tray:snapshot", (e) => setSnap(e.payload)),
            listen("tray:offline", () => setOffline(true)),
        ];
        send({ kind: "hello" });
        return () => unlisten.forEach((p) => void p.then((off) => off()));
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") {
                return;
            }
            e.preventDefault();
            if (page !== "main") {
                setPage("main");
            } else {
                send({ kind: "close" });
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [page]);

    useEffect(() => {
        const el = rootRef.current;
        if (fixtureName != null || el == null) {
            return;
        }
        // offsetHeight, not getBoundingClientRect: the reveal's scale must not shrink the window
        const ro = new ResizeObserver(() => {
            void invoke("tray_popover_size", { height: Math.ceil(el.offsetHeight) }).catch(() => {});
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const state = pageState(snap, offline);
    return (
        <div ref={rootRef} role="dialog" aria-label="arcterm" data-tray-page={state === "ready" ? page : state} className="w-[360px]">
        {/* the shared popover reveal (reduced motion respected), from the icon's side; the shadow is the window's own */}
        <PopoverReveal
            open
            origin={snap?.platform === "win" ? "bottom center" : "top center"}
            className="rounded-lg border border-edge-strong bg-surface p-2.5 font-sans"
        >
            {state === "offline" ? (
                <OfflinePage lastHeard={lastHeard} send={send} />
            ) : state === "loading" || snap == null ? (
                <LoadingPage />
            ) : page === "freeup" ? (
                <FreeUpPage s={snap} send={send} back={() => setPage("main")} />
            ) : page === "storage" ? (
                <StoragePage s={snap} send={send} back={() => setPage("main")} />
            ) : (
                <MainPage s={snap} send={send} setPage={setPage} />
            )}
        </PopoverReveal>
        </div>
    );
}

loadFonts();
if (fixtureName != null) {
    // a backdrop for the CDP shots; the real window is transparent around the popover
    document.body.classList.add("bg-background", "p-4");
}
createRoot(document.getElementById("tray")!).render(<TrayRoot />);
```

Create `frontend/tauri/trayfixtures.ts` with one fixture per board. Copy the numbers from the boards (GiB-based sizes:
`GB = 1024 ** 3`):

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Canned snapshots for tray.html?fixture=<name>: one per board of the tray-popover canvas, for the CDP scenarios
// (scripts/cdp/scenarios.mjs tray-*). Not data anyone sees in the app.

import type { TrayPage, TraySnapshot } from "@/app/cockpit/traytypes";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

export interface TrayFixture {
    snapshot: TraySnapshot | null;
    page?: TrayPage;
    offline?: boolean;
    lastHeard?: number;
}

const CPU = [30, 35, 26, 41, 47, 38, 59, 65, 53, 44, 62, 71, 56, 47, 35, 50, 68, 74, 59, 41, 32, 44, 53, 38, 47, 35, 41, 38, 38];

const main: TraySnapshot = {
    platform: "mac",
    machine: {
        memTotal: 16 * GB,
        memAvailable: 1.2 * GB,
        pressure: "high",
        cpuPct: 38,
        cpuSamples: CPU,
        diskName: "Macintosh HD",
        diskTotal: 245 * GB,
        diskFree: 127 * GB,
    },
    jobs: [
        { id: "j1", name: "go test ./pkg/orchestrate", bytes: 2.1 * GB, running: true, position: null, elapsedMs: 72_000, source: "tray-popover", reason: "", engine: false, canOpen: true },
        { id: "j2", name: "task check:ts", bytes: 1.6 * GB, running: false, position: 1, elapsedMs: 40_000, source: "office-pixel-art", reason: "memory pressure high, one at a time", engine: false, canOpen: true },
    ],
    jobsMode: "auto",
    pausedLeftMs: null,
    waits: [
        { key: "ask:1", kind: "ask", ask: true, title: "Second webview or a native menu?", tail: "tray-popover" },
        { key: "ask:2", kind: "ask", ask: true, title: "Keep the 2× sprite scale, or redraw every sprite at 1× for the smaller office canvas?", tail: "office-pixel-art" },
        { key: "plan:1", kind: "plan", ask: false, title: "Menu bar popover", tail: "3 proposed" },
        { key: "rule:1", kind: "rule", ask: false, title: "Never run prettier on scripts/*.mjs", tail: "learned" },
    ],
    waitsMore: 0,
    working: 4,
    usage: { pct: 62, elapsedPct: 64, level: "warn", title: "Claude's 5-hour window: resets in 1h 48m · week 31%" },
    storage: {
        arcBytes: 16.4 * GB,
        cleanableBytes: 6.2 * GB,
        storeBytes: 0.6 * GB,
        rows: [
            { category: "runworktrees", title: "Run worktrees", bytes: 4.1 * GB, detail: "3 trees from finished runs. Their branches stay.", action: "Clean all", cleanableBytes: 4.1 * GB, go: null },
            { category: "sessions", title: "Old Claude sessions", bytes: 1.3 * GB, detail: "Not touched in 30 days. Kept in the trash for 7 days.", action: "Move to trash", cleanableBytes: 1.3 * GB, go: null },
            { category: "housekeeping", title: "Logs, cache and trash", bytes: 0.8 * GB, detail: "Rolled logs, the session trash and the interface cache.", action: "Clean", cleanableBytes: 0.8 * GB, go: null },
            { category: "buildoutput", title: "Build output", bytes: 9.6 * GB, detail: "node_modules, target, dist in 4 projects. Cleaned per project.", action: null, cleanableBytes: 0, go: "settings" },
            { category: "canvases", title: "Design canvases", bytes: 12 * MB, detail: "9 canvases. Cleaned one by one in the gallery.", action: null, cleanableBytes: 0, go: "gallery" },
        ],
    },
    consumers: {
        rows: [
            { blockId: "b1", name: "tray-popover", bytes: 3.0 * GB, heaviest: { pid: 4101, command: "go test ./pkg/orchestrate", bytes: 2.1 * GB } },
            { blockId: "b2", name: "office-pixel-art", bytes: 2.1 * GB, heaviest: { pid: 4202, command: "npm run dev", bytes: 1.4 * GB } },
            { blockId: "b3", name: "notes-cleanup", bytes: 0.4 * GB, heaviest: null },
        ],
        ownBytes: 0.6 * GB,
        arcBytes: 6.1 * GB,
        otherBytes: 8.7 * GB,
    },
    heardAt: null,
};
```

The `main` fixture's usage level is `"warn"` only if `usageLevel(62)` says so (`agentsviewmodel.ts:430`: warn above
60); keep it in step with that function. Then define the others from `main` with spreads, each matching its board:
`quiet` (pressure `"normal"`, 9.4 GB free, CPU 6 % flat, 131 GB disk free, `storage.arcBytes` 12.1 GB and
`cleanableBytes` 0.3 GB, `jobs: []`, `waits: []`, `working: 2`, usage 12 % `"ok"`); `critical` (pressure
`"critical"`, 0.3 GB free, CPU 71 %, three jobs: the running `go test`, then `task check:ts` and `npm run build`
queued with reason `"memory pressure critical"`); `paused` (pressure `"normal"`, 5.8 GB free, CPU 52 %,
`pausedLeftMs: 52 * 60_000`, both jobs running, usage 91 % `"hot"` with title `"Claude's 5-hour window: resets in 22m
· week 78%"`); `freeup` (`main` with `page: "freeup"`); `storage` (`main` with `page: "storage"`); `offline`
(`snapshot: null, offline: true`); `windows` (`main` with `platform: "win"`, `memTotal` 32 GB, `memAvailable`
2.4 GB, `diskName: "Local Disk (C:)"`, 476 GB disk, 312 GB free, storage 19.0 GB / 7.4 GB). Export:

```ts
export const TRAY_FIXTURES: Record<string, TrayFixture> = {
    main: { snapshot: main },
    freeup: { snapshot: main, page: "freeup" },
    storage: { snapshot: main, page: "storage" },
    quiet: { snapshot: quiet },
    critical: { snapshot: critical },
    paused: { snapshot: paused },
    offline: { snapshot: null, offline: true },
    windows: { snapshot: windows },
};
```

In `frontend/tauri/vite.config.ts`, inside `build`, add (two entries, so `tray.html` ships beside `index.html`):

```ts
        rollupOptions: {
            input: {
                main: resolve(__dirname, "index.html"),
                tray: resolve(__dirname, "tray.html"),
            },
        },
```

In `frontend/tauri/browsershim/core.ts`, add `"tray_popover_size"` and `"set_tray_status"` to `NO_OPS` (the browser
app has no tray; `browsershim.test.ts` requires every invoked command to be answered).

- [ ] **Step 7: The scenarios**

In `scripts/cdp/scenarios.mjs`, add before `export const SCENARIOS` a helper and the scenarios, and list all nine
names in `SCENARIOS`:

```js
// The tray popover's page in fixture mode (frontend/tauri/tray.tsx, trayfixtures.ts): this page goes to
// tray.html?fixture=<name> on the cockpit's own origin, runs fn there, then comes back and waits for the cockpit.
// The real popover is a second Tauri window CDP cannot reach on a Mac; its native parts are hand checks.
async function onTrayPage(h, fixture, fn) {
    const back = h.url;
    await h.cdp("Page.navigate", { url: new URL(`tray.html?fixture=${fixture}`, back).href });
    for (let i = 0; i < 60; i++) {
        if (await h.ev(`!!document.querySelector('[data-tray-page]')`).catch(() => false)) break;
        await new Promise((r) => setTimeout(r, 150));
    }
    try {
        return await fn();
    } finally {
        await h.cdp("Page.navigate", { url: back });
        for (let i = 0; i < 120; i++) {
            if (await h.ev(`window.__arcBoot?.phase === "rendered"`).catch(() => false)) break;
            await new Promise((r) => setTimeout(r, 250));
        }
        await new Promise((r) => setTimeout(r, 800));
    }
}

const TRAY_READ = `(() => {
    const p = document.querySelector('[data-tray-page]');
    return { page: p?.getAttribute('data-tray-page') ?? null, width: p ? Math.round(p.getBoundingClientRect().width) : 0, text: p?.innerText ?? '' };
})()`;

function trayScenario(name, fixture, page, checks) {
    return {
        name,
        surface: "agent",
        async arrange() {
            return {};
        },
        async assert(h) {
            return onTrayPage(h, fixture, async () => {
                const r = await h.ev(TRAY_READ);
                const steps = [
                    { step: `1. tray.html?fixture=${fixture} draws its ${page} page, 360 px wide`, ok: r.page === page && r.width === 360, detail: `page=${r.page} width=${r.width}` },
                ];
                checks.forEach(([label, want], i) =>
                    steps.push({ step: `${i + 2}. ${label}`, ok: r.text.includes(want), detail: want })
                );
                await h.shot(`cdp-shots/${name}-popover.png`);
                return steps;
            });
        },
        async teardown() {},
    };
}

const trayMain = trayScenario("tray-main", "main", "main", [
    ["memory pressure reads High", "High"],
    ["the queued job offers Run now and Skip", "Run now"],
    ["Storage names the disk", "Macintosh HD"],
    ["four items wait on you", "Waiting on you"],
    ["the 5h chip shows its percent", "62%"],
]);
const trayFreeup = trayScenario("tray-freeup", "freeup", "freeup", [
    ["the subpage is Free up memory", "Free up memory"],
    ["an agent's heaviest command is offered", "heaviest: go test ./pkg/orchestrate"],
    ["other apps point to Activity Monitor", "Open Activity Monitor"],
]);
const trayStorage = trayScenario("tray-storage", "storage", "storage", [
    ["the subpage is Clean up storage", "Clean up storage"],
    ["run worktrees clean in place", "Clean all"],
    ["the store is never cleaned", "Never cleaned"],
]);
const trayQuiet = trayScenario("tray-quiet", "quiet", "main", [
    ["memory pressure reads Normal", "Normal"],
    ["no heavy jobs", "No heavy jobs running."],
    ["nothing waits", "Nothing is waiting on you."],
]);
const trayCritical = trayScenario("tray-critical", "critical", "main", [
    ["memory pressure reads Critical", "Critical"],
    ["no heavy job starts", "No heavy job starts"],
    ["queued jobs say why", "memory pressure critical"],
]);
const trayPaused = trayScenario("tray-paused", "paused", "main", [
    ["the queue reads paused with time left", "Paused, 52m left"],
    ["Resume is offered", "Resume"],
    ["the 5h chip shows 91%", "91%"],
]);
const trayOffline = trayScenario("tray-offline", "offline", "offline", [
    ["it says the server is not answering", "arcterm's server is not answering"],
    ["Restart arcterm is offered", "Restart arcterm"],
]);
const trayWindows = trayScenario("tray-windows", "windows", "main", [
    ["the disk is Local Disk (C:)", "Local Disk (C:)"],
    ["memory is out of 32 GB", "free of 32 GB"],
]);

const trayActions = {
    name: "tray-actions",
    surface: "agent",
    async arrange() {
        return {};
    },
    async assert(h) {
        return onTrayPage(h, "main", async () => {
            const click = (sel) => h.ev(`document.querySelector(${JSON.stringify(sel)})?.click() ?? null`);
            await click("[data-tray-run-now]");
            await click("[data-tray-skip]");
            await click("[data-tray-freeup]");
            await new Promise((r) => setTimeout(r, 200));
            await click("[data-tray-stop]");
            await h.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
            await new Promise((r) => setTimeout(r, 200));
            await click("[data-tray-cleanup]");
            await new Promise((r) => setTimeout(r, 200));
            await click('[data-tray-clean="runworktrees"]');
            await new Promise((r) => setTimeout(r, 100));
            const armed = await h.ev(`document.querySelector('[data-tray-clean="runworktrees"]')?.textContent ?? ''`);
            await click('[data-tray-clean="runworktrees"]');
            const acts = await h.ev(`JSON.stringify(window.__trayActs ?? [])`);
            const kinds = JSON.parse(acts).map((a) => a.kind + (a.page ? `:${a.page}` : ""));
            const want = ["run-now", "skip", "page:freeup", "stop", "page:main", "page:storage", "clean"];
            await h.shot("cdp-shots/tray-actions-popover.png");
            return [
                { step: "1. a click sends each act, in order", ok: JSON.stringify(kinds) === JSON.stringify(want), detail: kinds.join(", ") },
                { step: "2. the first click on Clean all only arms it", ok: armed === "Clean all 4.1 GB?", detail: armed },
                { step: "3. Stop names the agent and the pid", ok: acts.includes('"blockId":"b1"') && acts.includes('"pid":4101'), detail: acts },
            ];
        });
    },
    async teardown() {},
};
```

In the `main` fixture, keep the long second ask title: `tray-main`'s first step (360 px wide) is Review Focus 3's check.

- [ ] **Step 8: Typecheck, test, look**

Run: `npx vitest run frontend/app/cockpit/trayformat.test.ts frontend/tauri/browsershim/browsershim.test.ts && NODE_OPTIONS=--max-old-space-size=4096 task check:ts`
Expected: PASS, typecheck clean.

Then start the browser app (`task dev:browser`), and run `node --experimental-websocket scripts/cdp/verify.mjs tray-main tray-freeup tray-storage tray-quiet tray-critical tray-paused tray-offline tray-windows tray-actions`
(on node 22+ drop the flag). Expected: all PASS. Open `cdp-shots/index.html` and compare each `*-popover.png` with
its board; fix what differs. Stop the browser app by its PID.

- [ ] **Step 9: Commit**

```bash
git add frontend/app/cockpit/traytypes.ts frontend/app/cockpit/trayformat.ts frontend/app/cockpit/trayformat.test.ts frontend/app/cockpit/traypage.tsx frontend/app/cockpit/traysubpages.tsx frontend/tauri/tray.html frontend/tauri/tray.tsx frontend/tauri/trayfixtures.ts frontend/tauri/vite.config.ts frontend/tauri/browsershim/core.ts scripts/cdp/scenarios.mjs
git commit -m "feat(tray): the popover's page — cards, Free up, Clean up, offline — with fixtures and CDP scenarios"
```

### Task 6: The cockpit's bridge to the popover, the setting, and the changelog

**Depends on:** Task 2, Task 4, Task 5
**Files:** `frontend/app/cockpit/traysnapshot.ts`, `frontend/app/cockpit/traysnapshot.test.ts`, `frontend/app/cockpit/traybridge.tsx`, `frontend/app/view/agents/cockpitshell.tsx`, `frontend/app/view/jarvis/briefingmodel.ts`, `frontend/app/view/jarvis/briefingmodel.test.ts`, `frontend/app/view/agents/settingspages/general.tsx`, `frontend/app/view/agents/settingsmodel.ts`, `frontend/app/view/agents/settingsmodel.test.ts`, `src-tauri/capabilities/default.json`, `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

**Interfaces:**
- Consumes: Task 1's `RpcApi.GetMachineStatsCommand`, `MachineStatsData`, `MemoryPressureData`, the `memorypressure`
  event, `"app:tray"`; Task 2's `RpcApi.StopProcessCommand`, `ConsumerAgent.heaviest`; Task 4's `set_tray_status`,
  `tray:act`, `tray:closed`; Task 5's `traytypes.ts`.
  Existing: `queueRows(items, agents, messages): PeekRow[]` (`view/jarvis/petpeekmodel.ts:129`), `runAct(model, act)`
  (`view/jarvis/petactrun.ts:127`), `attentionAtom` (`view/agents/attentionstore.ts:16`), `channelMessagesAtom`
  (`view/agents/channelsstore.ts:26`), `jobQueueAtom` (`cockpit/jobqueuestore.ts:18`), `ordered`, `sourceLabel`,
  `openTargetFor`, `paceValue`, `pacePatch`, `pauseLeft`, `pausePatch` (`cockpit/jobqueue.ts`), `usePlanDonuts(model)`
  (`view/agents/usagemeters.tsx:56`), `usageLevel` (`view/agents/agentsviewmodel.ts:430`), `windowElapsed`,
  `formatResetShort` (`view/agents/cockpitrailmodel.ts:88,97`), `storageReportAtom` / `useStorageReport` /
  `cleanStorage` (`view/agents/storagestore.ts`), `CARD_ORDER`, `CARD_COPY` (`view/agents/storagemodel.ts`),
  `consumersReadingAtom`, `useConsumersPoll`, `loadConsumers` (`view/agents/consumersstore.ts`), `openTarget`
  (`view/jarvis/openref.ts:105`), `openSettingsSection(model, id)` (`view/agents/settingsstore.ts:24`),
  `floatMiniAtom`, `restoreFromSprout(model)` (`view/agents/floatstore.ts`), `isMacOS`, `isWindows`
  (`@/util/platformutil`).
- Produces: `traySnapshot(input: TraySnapshotInput): TraySnapshot`, `trayBadge(rows: PeekRow[], pressure: string):
  { count: number; alert: boolean }`, `kindWord(wireKind: string, retry?: boolean)` in `briefingmodel.ts`.

- [ ] **Step 1: The short kind word, shared**

In `frontend/app/view/jarvis/briefingmodel.ts`, move `queueKindLabel`'s switch (line 350) into an exported
`kindWord(wireKind: string, retry = false)` with the same return type, and make `queueKindLabel(row)` return
`kindWord(row.wireKind, row.retry)`. Add to `briefingmodel.test.ts`:

```ts
describe("kindWord", () => {
    it("is the Brief's short kind for a wire kind", () => {
        expect(kindWord("ask")).toBe("ask");
        expect(kindWord("escalation")).toBe("ask");
        expect(kindWord("dag-gate")).toBe("gate");
        expect(kindWord("plan-review")).toBe("plan");
        expect(kindWord("learn-proposal")).toBe("rule");
        expect(kindWord("dag-blocked", true)).toBe("failed");
        expect(kindWord("dag-blocked")).toBe("blocked");
    });
});
```

(Import `kindWord` beside the file's existing imports from `./briefingmodel`.) Run
`npx vitest run frontend/app/view/jarvis/briefingmodel.test.ts`; expected PASS.

- [ ] **Step 2: Write the failing snapshot tests**

Create `frontend/app/cockpit/traysnapshot.test.ts`. Build inputs with plain objects cast to the input types (as other
model tests in `frontend/app/cockpit/` do); the cases:

```ts
import { describe, expect, it } from "vitest";
import { trayBadge, traySnapshot, type TraySnapshotInput } from "./traysnapshot";

const GB = 1024 ** 3;
const NOW = 1_800_000_000_000;

function row(key: string, kind: string, source: string, detail: string | null): any {
    return { key, kind, source, detail, waitingsince: 0, primary: null, links: [], answers: [], form: null };
}

function input(over: Partial<TraySnapshotInput> = {}): TraySnapshotInput {
    return {
        platform: "mac",
        machine: { memtotal: 16 * GB, memavailable: 1.2 * GB, pressure: "high", cpupct: 38, cpusamples: [30, 38], diskname: "Macintosh HD", disktotal: 245 * GB, diskfree: 127 * GB } as any,
        jobQueue: {
            slots: 1,
            mode: "auto",
            jobs: [
                { id: "j2", name: "task check:ts", bytes: 1.6 * GB, position: 1, reason: "memory pressure high, one at a time", queuedts: NOW - 40_000, blockid: "b2" },
                { id: "j1", name: "go test ./pkg/orchestrate", bytes: 2.1 * GB, running: true, queuedts: NOW - 90_000, startedts: NOW - 72_000, blockid: "b1" },
            ],
        } as any,
        agents: [
            { id: "a1", name: "tray-popover", blockId: "b1", state: "working" },
            { id: "a2", name: "office-pixel-art", blockId: "b2", state: "asking" },
            { id: "a3", name: "notes", blockId: "b3", state: "working" },
        ] as any,
        peekRows: [
            row("ask:1", "ask", "tray-popover", "Second webview or a native menu?"),
            row("plan:1", "plan-review", "Menu bar popover", null),
        ],
        donuts: [{ provider: "claude", fivehour: { pct: 62, reset: NOW / 1000 + 6480 }, week: { pct: 31 } }] as any,
        storage: {
            scannedts: NOW,
            scanning: false,
            storebytes: 0.6 * GB,
            categories: [
                { category: "runworktrees", bytes: 4.1 * GB, cleanablebytes: 4.1 * GB, items: [] },
                { category: "buildoutput", bytes: 9.6 * GB, cleanablebytes: 9.6 * GB, items: [] },
            ],
        } as any,
        consumers: null,
        heardAt: NOW - 3_000,
        now: NOW,
        ...over,
    };
}

describe("traySnapshot", () => {
    it("reads the machine and orders the jobs running first", () => {
        const s = traySnapshot(input());
        expect(s.machine?.pressure).toBe("high");
        expect(s.machine?.cpuSamples).toEqual([30, 38]);
        expect(s.heardAt).toBe(NOW - 3_000);
        expect(s.jobs.map((j) => j.id)).toEqual(["j1", "j2"]);
        expect(s.jobs[0]).toMatchObject({ running: true, elapsedMs: 72_000, source: "tray-popover", reason: "" });
        expect(s.jobs[1]).toMatchObject({ running: false, position: 1, elapsedMs: 40_000, reason: "memory pressure high, one at a time" });
    });
    it("turns peek rows into waits: the question as title, its asker as tail", () => {
        const s = traySnapshot(input());
        expect(s.waits[0]).toEqual({ key: "ask:1", kind: "ask", ask: true, title: "Second webview or a native menu?", tail: "tray-popover" });
        expect(s.waits[1]).toEqual({ key: "plan:1", kind: "plan", ask: false, title: "Menu bar popover", tail: "" });
        expect(s.working).toBe(2);
    });
    it("caps waits at five and counts the rest", () => {
        const rows = Array.from({ length: 7 }, (_, i) => row(`k${i}`, "ask", "a", `q${i}`));
        const s = traySnapshot(input({ peekRows: rows }));
        expect(s.waits).toHaveLength(5);
        expect(s.waitsMore).toBe(2);
    });
    it("reads Claude's 5h window, and leaves the chip out with no reading", () => {
        const s = traySnapshot(input());
        expect(s.usage?.pct).toBe(62);
        expect(s.usage?.elapsedPct).toBeCloseTo(64, 5); // 1h48m left of 5h: a percent, not windowElapsed's fraction
        expect(s.usage?.level).toBe("warn");
        expect(s.usage?.title).toContain("week 31%");
        expect(traySnapshot(input({ donuts: [] })).usage).toBeNull();
    });
    it("sums storage: arcterm is every category plus the store; only in-place cleans count as cleanable", () => {
        const s = traySnapshot(input());
        expect(s.storage?.arcBytes).toBeCloseTo(14.3 * GB, -3);
        expect(s.storage?.cleanableBytes).toBeCloseTo(4.1 * GB, -3);
        expect(s.storage?.rows.find((r) => r.category === "buildoutput")).toMatchObject({ action: null, go: "settings" });
        expect(traySnapshot(input({ storage: null })).storage).toBeNull();
    });
    it("names consumers from the roster, heaviest first, and splits off other apps", () => {
        const consumers = {
            totalbytes: 16 * GB,
            availablebytes: 1.2 * GB,
            windowms: 0,
            agents: [
                { tabid: "", blockid: "b2", rambytes: 2.1 * GB, tokensread: false, heaviest: { pid: 4202, command: "npm run dev", bytes: 1.4 * GB } },
                { tabid: "", blockid: "b1", rambytes: 3.0 * GB, tokensread: false },
            ],
            interfacebytes: 0.3 * GB,
            serverbytes: 0.2 * GB,
            hostbytes: 0.1 * GB,
        } as any;
        const s = traySnapshot(input({ consumers }));
        expect(s.consumers?.rows.map((r) => r.name)).toEqual(["tray-popover", "office-pixel-art"]);
        expect(s.consumers?.rows[1].heaviest).toEqual({ pid: 4202, command: "npm run dev", bytes: 1.4 * GB });
        expect(s.consumers?.ownBytes).toBeCloseTo(0.6 * GB, -3);
        expect(s.consumers?.arcBytes).toBeCloseTo(5.7 * GB, -3);
        expect(s.consumers?.otherBytes).toBeCloseTo(9.1 * GB, -3);
    });
});

describe("trayBadge", () => {
    it("counts what waits and raises the dot only at critical", () => {
        expect(trayBadge([row("a", "ask", "x", "q")], "critical")).toEqual({ count: 1, alert: true });
        expect(trayBadge([], "high")).toEqual({ count: 0, alert: false });
    });
});
```

Run: `npx vitest run frontend/app/cockpit/traysnapshot.test.ts`
Expected: FAIL (`Cannot find module './traysnapshot'`).

- [ ] **Step 3: Write the builder**

Create `frontend/app/cockpit/traysnapshot.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Builds the tray popover's TraySnapshot from the cockpit's own stores (spec 2026-10-15-tray-popover-design.md), and
// the icon's badge. The waits are the rows Sprout wears (petpeekmodel.ts queueRows), so the tray and Sprout never
// disagree about what waits on you. Pure: traybridge.tsx feeds it and sends the result.

import { usageLevel, type AgentVM } from "@/app/view/agents/agentsviewmodel";
import { formatResetShort, windowElapsed } from "@/app/view/agents/cockpitrailmodel";
import type { ProviderDonuts } from "@/app/view/agents/ratelimitstore";
import { CARD_COPY, CARD_ORDER } from "@/app/view/agents/storagemodel";
import { kindWord } from "@/app/view/jarvis/briefingmodel";
import type { PeekRow } from "@/app/view/jarvis/petpeekmodel";
import { openTargetFor, ordered, paceValue, pauseLeft, sourceLabel } from "./jobqueue";
import type { TrayLevel, TrayPlatform, TraySnapshot, TrayStorageRow } from "./traytypes";

const MAX_WAITS = 5;
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const IN_PLACE = new Set(["runworktrees", "sessions", "housekeeping"]);

export interface TraySnapshotInput {
    platform: TrayPlatform;
    machine: MachineStatsData | null;
    jobQueue: JobQueueData | null;
    agents: readonly AgentVM[];
    peekRows: PeekRow[];
    donuts: ProviderDonuts[];
    storage: StorageReport | null;
    consumers: CommandGetConsumersRtnData | null;
    heardAt: number | null; // the bridge's last answered GetMachineStatsCommand
    now: number;
}

function level(word: string | undefined): TrayLevel {
    return word === "normal" || word === "high" || word === "critical" ? word : "unknown";
}

function firstSentence(s: string): string {
    const i = s.indexOf(". ");
    return i < 0 ? s : s.slice(0, i + 1);
}

export function traySnapshot(i: TraySnapshotInput): TraySnapshot {
    const m = i.machine;
    const jobs = ordered(i.jobQueue?.jobs ?? []).map((j) => ({
        id: j.id,
        name: j.name,
        bytes: j.bytes,
        running: j.running === true,
        position: j.running ? null : (j.position ?? null),
        elapsedMs: i.now - (j.running ? (j.startedts ?? j.queuedts) : j.queuedts),
        source: sourceLabel(j, i.agents),
        reason: j.running ? "" : (j.reason ?? ""),
        engine: j.engine === true,
        canOpen: openTargetFor(j, i.agents) != null,
    }));
    const waits = i.peekRows.slice(0, MAX_WAITS).map((r) => ({
        key: r.key,
        kind: kindWord(r.kind),
        ask: r.kind === "ask" || r.kind === "escalation",
        title: r.detail ?? r.source,
        tail: r.detail != null ? r.source : "",
    }));
    const claude = i.donuts.find((d) => d.provider === "claude");
    const pct = claude?.fivehour.pct;
    const elapsed = claude == null ? undefined : windowElapsed(claude.fivehour.reset, FIVE_HOURS_MS, i.now);
    const usage =
        claude == null || pct == null
            ? null
            : {
                  pct,
                  elapsedPct: elapsed == null ? null : elapsed * 100, // windowElapsed is a 0-1 fraction
                  level: usageLevel(pct),
                  title:
                      "Claude's 5-hour window: " +
                      (claude.fivehour.reset ? `resets in ${formatResetShort(claude.fivehour.reset, i.now)}` : "no reset yet") +
                      (claude.week.pct != null ? ` · week ${Math.round(claude.week.pct)}%` : ""),
              };
    let storage: TraySnapshot["storage"] = null;
    if (i.storage != null && i.storage.scannedts > 0) {
        const cats = i.storage.categories ?? [];
        const rows: TrayStorageRow[] = CARD_ORDER.map((c) => {
            const cat = cats.find((x) => x.category === c);
            const inPlace = IN_PLACE.has(c);
            return {
                category: c,
                title: CARD_COPY[c].title,
                bytes: cat?.bytes ?? 0,
                detail: firstSentence(CARD_COPY[c].blurb),
                action: inPlace ? CARD_COPY[c].action : null,
                cleanableBytes: inPlace ? (cat?.cleanablebytes ?? 0) : 0,
                go: c === "canvases" ? "gallery" : inPlace ? null : "settings",
            };
        });
        storage = {
            arcBytes: cats.reduce((n, c) => n + c.bytes, 0) + (i.storage.storebytes ?? 0),
            cleanableBytes: rows.reduce((n, r) => n + r.cleanableBytes, 0),
            storeBytes: i.storage.storebytes ?? 0,
            rows,
        };
    }
    let consumers: TraySnapshot["consumers"] = null;
    if (i.consumers != null) {
        const c = i.consumers;
        const rows = (c.agents ?? [])
            .map((a) => ({
                blockId: a.blockid,
                name: i.agents.find((x) => x.blockId === a.blockid)?.name ?? "agent",
                bytes: a.rambytes ?? null,
                heaviest: a.heaviest ? { pid: a.heaviest.pid, command: a.heaviest.command, bytes: a.heaviest.bytes } : null,
            }))
            .sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
        const own = [c.interfacebytes, c.serverbytes, c.hostbytes].reduce<number | null>(
            (n, b) => (b == null ? n : (n ?? 0) + b),
            null
        );
        const agentBytes = rows.reduce((n, r) => n + (r.bytes ?? 0), 0);
        const arc = agentBytes + (own ?? 0);
        consumers = {
            rows,
            ownBytes: own,
            arcBytes: arc,
            otherBytes: Math.max(0, c.totalbytes - c.availablebytes - arc),
        };
    }
    return {
        platform: i.platform,
        machine:
            m == null
                ? null
                : {
                      memTotal: m.memtotal,
                      memAvailable: m.memavailable,
                      pressure: level(m.pressure),
                      cpuPct: m.cpupct,
                      cpuSamples: m.cpusamples ?? [],
                      diskName: m.diskname,
                      diskTotal: m.disktotal,
                      diskFree: m.diskfree,
                  },
        jobs,
        jobsMode: paceValue(i.jobQueue),
        pausedLeftMs: pauseLeft(i.jobQueue, i.now),
        waits,
        waitsMore: Math.max(0, i.peekRows.length - MAX_WAITS),
        working: i.agents.filter((a) => a.state === "working").length,
        usage,
        storage,
        consumers,
        heardAt: i.heardAt,
    };
}

export function trayBadge(rows: PeekRow[], pressure: string): { count: number; alert: boolean } {
    return { count: rows.length, alert: pressure === "critical" };
}
```

`MachineStatsData`, `JobQueueData`, `StorageReport` and `CommandGetConsumersRtnData` need no import: the generated
`frontend/types/gotypes.d.ts` declares them globally. Run the tests; expected PASS.

- [ ] **Step 4: The bridge**

Create `frontend/app/cockpit/traybridge.tsx`:

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cockpit's side of the menu bar / tray popover (spec 2026-10-15-tray-popover-design.md): it keeps the icon's
// count and red dot current (set_tray_status), and while the popover is open it sends it a TraySnapshot built from
// the cockpit's own stores and runs the TrayActs it sends back. The host (src-tauri/src/tray.rs) handles close,
// restart, quit, show log and the OS's monitor itself. Mounted once in the cockpit shell, which lives as long as
// arcterm does, folded into Sprout or not.

import { getSettingsKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { attentionAtom } from "@/app/view/agents/attentionstore";
import { channelMessagesAtom } from "@/app/view/agents/channelsstore";
import { consumersReadingAtom, loadConsumers, useConsumersPoll } from "@/app/view/agents/consumersstore";
import { floatMiniAtom, restoreFromSprout } from "@/app/view/agents/floatstore";
import { showCanvases } from "@/app/view/agents/agentcenter";
import { openSettingsSection } from "@/app/view/agents/settingsstore";
import { DEFAULT_SESSION_DAYS } from "@/app/view/agents/storagemodel";
import { cleanStorage, storageReportAtom, useStorageReport } from "@/app/view/agents/storagestore";
import { usePlanDonuts } from "@/app/view/agents/usagemeters";
import { openTarget } from "@/app/view/jarvis/openref";
import { runAct } from "@/app/view/jarvis/petactrun";
import { queueRows } from "@/app/view/jarvis/petpeekmodel";
import { isMacOS, isWindows } from "@/util/platformutil";
import { fireAndForget } from "@/util/util";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { openTargetFor, pacePatch, pausePatch } from "./jobqueue";
import { jobQueueAtom } from "./jobqueuestore";
import { trayBadge, traySnapshot } from "./traysnapshot";
import type { TrayAct, TrayPage } from "./traytypes";

const MACHINE_POLL_MS = 1000;

async function showMain(model: AgentsViewModel): Promise<void> {
    if (globalStore.get(floatMiniAtom)) {
        await restoreFromSprout(model);
    }
    const win = getCurrentWindow();
    try {
        await win.unminimize();
        await win.show();
        await win.setFocus();
    } catch {
        // the browser app has no window to raise
    }
}

export function TrayBridge({ model }: { model: AgentsViewModel }) {
    const items = useAtomValue(attentionAtom);
    const agents = useAtomValue(model.agentsAtom);
    const messages = useAtomValue(channelMessagesAtom);
    const peekRows = useMemo(() => queueRows(items, agents, messages), [items, agents, messages]);
    const trayOn = (useAtomValue(getSettingsKeyAtom("app:tray")) as boolean | undefined) ?? true;
    const [pressure, setPressure] = useState("");
    const [open, setOpen] = useState(false);
    const [page, setPage] = useState<TrayPage>("main");
    const [machine, setMachine] = useState<MachineStatsData | null>(null);
    // when wavesrv last answered: the popover's offline page shows it, frozen once wavesrv has gone
    const [heardAt, setHeardAt] = useState<number | null>(null);
    const jobQueue = useAtomValue(jobQueueAtom);
    const donuts = usePlanDonuts(model);
    const storage = useStorageReport(false);
    const consumers = useAtomValue(consumersReadingAtom).data;
    const now = useAtomValue(model.nowAtom);
    useConsumersPoll(open && page === "freeup");

    // the icon's red dot: one reading at start, then each change wavesrv publishes
    useEffect(() => {
        RpcApi.GetMachineStatsCommand(TabRpcClient)
            .then((m) => {
                setPressure(m.pressure);
                setHeardAt(Date.now());
            })
            .catch(() => {});
        return waveEventSubscribeSingle({
            eventType: "memorypressure",
            handler: (e) => setPressure((e.data as MemoryPressureData)?.level ?? ""),
        });
    }, []);

    const badge = trayBadge(peekRows, pressure);
    useEffect(() => {
        void invoke("set_tray_status", { count: badge.count, alert: badge.alert, visible: trayOn }).catch(() => {});
    }, [badge.count, badge.alert, trayOn]);

    useEffect(() => {
        if (!open) {
            return;
        }
        let live = true;
        const read = () =>
            RpcApi.GetMachineStatsCommand(TabRpcClient)
                .then((m) => {
                    if (live) {
                        setMachine(m);
                        setPressure(m.pressure);
                        setHeardAt(Date.now());
                    }
                })
                .catch(() => {});
        void read();
        const t = setInterval(read, MACHINE_POLL_MS);
        return () => {
            live = false;
            clearInterval(t);
        };
    }, [open]);

    const platform = isMacOS() ? "mac" : isWindows() ? "win" : "other";
    const snapshot = useMemo(
        () => traySnapshot({ platform, machine, jobQueue, agents, peekRows, donuts, storage, consumers, heardAt, now }),
        [platform, machine, jobQueue, agents, peekRows, donuts, storage, consumers, heardAt, now]
    );
    useEffect(() => {
        if (open) {
            void emit("tray:snapshot", snapshot).catch(() => {});
        }
    }, [open, snapshot]);

    // the act handler reads the latest rows and jobs through a ref, so the listener is registered once
    const latest = useRef({ peekRows, agents, jobQueue });
    latest.current = { peekRows, agents, jobQueue };
    useEffect(() => {
        const act = (a: TrayAct) => {
            const { peekRows, agents, jobQueue } = latest.current;
            switch (a.kind) {
                case "hello":
                    setOpen(true);
                    setPage("main");
                    return;
                case "page":
                    setPage(a.page);
                    return;
                case "open-arcterm":
                    fireAndForget(() => showMain(model));
                    return;
                case "open-wait": {
                    const row = peekRows.find((r) => r.key === a.key);
                    const escort = [row?.primary, ...(row?.links ?? [])].find((x) => x?.verb === "open");
                    fireAndForget(async () => {
                        await showMain(model);
                        if (escort != null) {
                            await runAct(model, escort);
                        }
                    });
                    return;
                }
                case "open-more":
                    fireAndForget(async () => {
                        await showMain(model);
                        globalStore.set(model.surfaceAtom, "jarvis");
                    });
                    return;
                case "open-job": {
                    const job = jobQueue?.jobs.find((j) => j.id === a.id);
                    const target = job ? openTargetFor(job, agents) : null;
                    fireAndForget(async () => {
                        await showMain(model);
                        if (target != null) {
                            await openTarget(model, target);
                        }
                    });
                    return;
                }
                case "open-agent": {
                    const agent = agents.find((x) => x.blockId === a.blockId);
                    fireAndForget(async () => {
                        await showMain(model);
                        if (agent != null) {
                            await runAct(model, { id: `tray:${agent.id}`, verb: "open", label: "Open", target: { kind: "oref", ref: `agent:${agent.id}` } });
                        }
                    });
                    return;
                }
                case "open-storage-settings":
                    fireAndForget(async () => {
                        await showMain(model);
                        openSettingsSection(model, "storage");
                    });
                    return;
                case "open-tray-settings":
                    fireAndForget(async () => {
                        await showMain(model);
                        openSettingsSection(model, "general");
                    });
                    return;
                case "open-gallery":
                    fireAndForget(async () => {
                        await showMain(model);
                        showCanvases(model);
                    });
                    return;
                case "run-now":
                    fireAndForget(() => RpcApi.JobQueueRunNowCommand(TabRpcClient, { id: a.id }));
                    return;
                case "skip":
                    fireAndForget(() => RpcApi.JobQueueSkipCommand(TabRpcClient, { id: a.id }));
                    return;
                case "slots":
                    fireAndForget(() => RpcApi.SetConfigCommand(TabRpcClient, pacePatch(a.value)));
                    return;
                case "pause":
                    fireAndForget(() => RpcApi.SetConfigCommand(TabRpcClient, pausePatch(a.ms, Date.now())));
                    return;
                case "stop":
                    fireAndForget(async () => {
                        await RpcApi.StopProcessCommand(TabRpcClient, { blockid: a.blockId, pid: a.pid });
                        await loadConsumers();
                    });
                    return;
                case "clean": {
                    // what Settings → Storage's card cleans (settingspages/storage.tsx runClean): the category's
                    // cleanable, unguarded items; the server re-checks each, and its rescan updates storageReportAtom
                    const cat = globalStore.get(storageReportAtom)?.categories?.find((c) => c.category === a.category);
                    const ids = (cat?.items ?? []).filter((it) => it.cleanable && !it.guarded).map((it) => it.id);
                    fireAndForget(() =>
                        cleanStorage(a.category, ids, {
                            olderthandays: a.category === "sessions" ? Number(DEFAULT_SESSION_DAYS) : undefined,
                        })
                    );
                    return;
                }
                default:
                    return; // close, restart, quit, showlog, open-monitor: the host's
            }
        };
        const offs = [
            listen<TrayAct>("tray:act", (e) => act(e.payload)),
            listen("tray:closed", () => setOpen(false)),
        ];
        return () => offs.forEach((p) => void p.then((off) => off()));
    }, [model]);

    return null;
}
```

If `queueRows`, `runAct`, `restoreFromSprout` or `floatMiniAtom` import a module the browser shim cannot load, the
CDP scenarios will show it; the cockpit already imports all of them.

- [ ] **Step 5: Mount it**

In `frontend/app/view/agents/cockpitshell.tsx`, beside `<StorageNudge model={model} />` (line 183):

```tsx
            {/* the menu bar / tray icon's count and its popover's feed: what waits can change while any surface shows */}
            <TrayBridge model={model} />
```

with `import { TrayBridge } from "@/app/cockpit/traybridge";`.

- [ ] **Step 6: The setting**

In `frontend/app/view/agents/settingspages/general.tsx`, beside the `window.autosprout` row (lines 142–148):

```tsx
            <SettingRow id="app.tray">
                <Toggle
                    on={trayOn}
                    onToggle={() => writeConfig({ "app:tray": !trayOn })}
                    label={isMacOS() ? "Show arcterm in the menu bar" : "Show arcterm in the tray"}
                />
            </SettingRow>
```

with `const trayOn = (useAtomValue(getSettingsKeyAtom("app:tray")) as boolean | undefined) ?? true;` beside
`autoSprout` (line 104). Register the row in `frontend/app/view/agents/settingsmodel.ts`'s General → Window card,
after `window.autosprout` (around line 187):

```ts
                        {
                            id: "app.tray",
                            title: "Menu bar icon",
                            desc: "arcterm's icon beside the clock: what waits on you, memory, CPU and disk, a click away.",
                            key: "app:tray",
                            scope: "synced",
                            config: true,
                        },
```

It is a config row in the Window card, so `frontend/app/view/agents/settingsmodel.test.ts`'s exact lists change: in
"marks exactly the wconfig-backed rows as config rows" (around line 200) add `"app:tray"` right after
`"window:autosprout"`, and in "puts each row in the card the spec names" (line 307) make `cards["general/window"]`
`["window.minimize", "window.sproutcorner", "window.autosprout", "app.tray"]`.

- [ ] **Step 7: The main window may raise itself**

In `src-tauri/capabilities/default.json`, add to `permissions`: `"core:window:allow-show"`,
`"core:window:allow-set-focus"`, `"core:window:allow-unminimize"` (the popover's Open arcterm brings the cockpit
forward from the main window's own code).

- [ ] **Step 8: The settings scenario**

In `scripts/cdp/scenarios.mjs`, add and list in `SCENARIOS`:

```js
const traySettingsRow = {
    name: "tray-settings-row",
    surface: "settings",
    async arrange() {
        return {};
    },
    async assert(h) {
        const text = await h.ev(`document.body.innerText`);
        const ok = text.includes("Show arcterm in the menu bar") || text.includes("Show arcterm in the tray");
        await h.shot("cdp-shots/tray-settings-row.png");
        return [{ step: "1. Settings → General offers the menu bar icon's toggle", ok, detail: "" }];
    },
    async teardown() {},
};
```

- [ ] **Step 9: The changelog**

In `CHANGELOG.md`'s top section (open `## Unreleased` above it if it has a date), under `Added`:

```markdown
- arcterm in the menu bar (the tray on Windows): see memory, CPU and disk, free them up, run or skip a queued job, and open what waits on you, without bringing the window forward. <!-- big -->
```

- [ ] **Step 10: Test, typecheck, look**

Run: `npx vitest run frontend/app/cockpit/ frontend/app/view/jarvis/briefingmodel.test.ts frontend/app/view/agents/settingsmodel.test.ts frontend/tauri/browsershim/browsershim.test.ts && NODE_OPTIONS=--max-old-space-size=4096 task check:ts`
Expected: PASS, typecheck clean. Then with `task dev:browser` running:
`node --experimental-websocket scripts/cdp/verify.mjs tray-settings-row tray-main surface-smoke` — all PASS.

- [ ] **Step 11: Commit**

```bash
git add frontend/app/cockpit/traysnapshot.ts frontend/app/cockpit/traysnapshot.test.ts frontend/app/cockpit/traybridge.tsx frontend/app/view/agents/cockpitshell.tsx frontend/app/view/jarvis/briefingmodel.ts frontend/app/view/jarvis/briefingmodel.test.ts frontend/app/view/agents/settingspages/general.tsx frontend/app/view/agents/settingsmodel.ts frontend/app/view/agents/settingsmodel.test.ts src-tauri/capabilities/default.json scripts/cdp/scenarios.mjs CHANGELOG.md
git commit -m "feat(tray): the cockpit feeds the popover and the icon's count, Settings → General turns it off"
```

## After the run: hand checks on the Mac

The Final scenarios cover the popover's page, and only it. The icon is drawn by the host and the window's behaviour
is the host's, and on a Mac the Final runs in headless Chrome with no Tauri host, so the spec leaves these as hand
checks the run reports unverified. Their logic is unit-tested (Task 3: the title and badge per count, the red dot,
the dimming, the popover's place). These need the real app (`task dev`, then the installed build):

1. The icon's states, one per board: the template glyph on a light and a dark menu bar; the count beside it
   (`Main`); no count at 0 (`A-Quiet`); the red dot before the count at critical pressure (`A-Critical`;
   `memory_pressure -S -l critical` in a terminal simulates it), or `! N` if Task 4 shipped the fallback; the dimmed
   glyph with no count while wavesrv is gone (`A-Offline`, step 5).
2. A click opens the popover under the icon, on a full-screen Space too, and **the cockpit does not come forward**.
3. The cold open: `waveapp.log`'s `[tray] popover ready N ms after the click` lines. Past 500 ms on the Mac, the
   spec's fallback (keep the window hidden after its first open) becomes a follow-up.
4. A click outside closes it; a second click on the icon closes it without reopening.
5. Free up's Stop ends a real `sleep 600` started from an agent's shell, and the agent carries on.
6. Kill wavesrv by its PID: the icon dims, the popover shows the offline page with the time wavesrv last answered,
   Restart arcterm brings it back.
7. Settings → General's toggle hides and shows the icon; the popover's gear opens Settings → General.

Windows (no machine now): the tray icon, its badge (`Win-Main`), and the popover above the taskbar go unverified.
