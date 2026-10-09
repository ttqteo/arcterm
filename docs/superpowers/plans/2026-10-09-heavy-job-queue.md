# Heavy Job Queue Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Heavy shell jobs from every agent and engine run wait in one wavesrv queue and start one at a time (setting `jobs:slots`), shown in an app-bar Jobs chip with a popover.

**Architecture:** `pkg/jobqueue` is an in-process FIFO with a pure admission function (slots, then RAM). Agents reach it through a streaming RPC held open by a `wsh jobslot` child that the Claude mod / pi extension keep alive while the command runs; the engine calls it in-process around every plan command. wavesrv publishes a `jobqueue` event; the cockpit renders it.

**Tech Stack:** Go (wavesrv, wsh, wshrpc codegen), TypeScript (Claude mod hooks, pi extension), React 19 + jotai + Tailwind 4.

Spec: `docs/superpowers/specs/2026-10-09-heavy-job-queue-design.md`.

**Verify:** `node scripts/verify.mjs ./pkg/jobqueue ./pkg/memgate ./pkg/orchestrate ./pkg/wshutil ./pkg/wshrpc/... ./cmd/wsh/...`

**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: jobqueue-chip needs CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs jobqueue-chip`

Ground rules for every task:

- Never hand-edit generated files (`frontend/types/gotypes.d.ts`, `frontend/types/waveevent.d.ts`, `frontend/app/store/wshclientapi.ts`, `pkg/wshrpc/wshclient/wshclient.go`, `pkg/wconfig/metaconsts.go`). Change Go, run `task generate`.
- Never edit `cmd/wsh/cmd/claude-mod/**` or `cmd/wsh/cmd/pi-*-extension.ts`: they are copies of `claude/arc-mod/` and `pi/extensions/`, synced by every build.
- `gofmt -l` / `npx prettier --check` only the files you touched. Never prettier a `scripts/*.mjs`.
- Commit with a pathspec (`git commit -m "…" -- <paths>`): other sessions share the index.

Deviations from the spec, decided while planning:

- The engine's **Setup and Check** queue only when `memgate.Classify` calls the command heavy (this repo's `.arc/setup` only makes junctions); **Verify and Final** always queue.
- `agy` (`wsh agy-hook`) has no "command finished" event: it waits its turn, then releases at once (a start gate). Same for a Claude command run with `run_in_background`.
- The ask's `Hold` flag stays (unused after this plan); removing it is a separate cleanup.

---

### Task 1: `pkg/jobqueue` — the queue and its admission rule

**Depends on:** none

**Files:**
- Create: `pkg/jobqueue/jobqueue.go`
- Create: `pkg/jobqueue/jobqueue_test.go`
- Modify: `pkg/memgate/memgate.go` (add `LongRunning`)

**Step 1: Write the failing tests** in `pkg/jobqueue/jobqueue_test.go`:

```go
package jobqueue

import (
	"context"
	"errors"
	"testing"
	"time"
)

const gb = uint64(1) << 30

var t0 = time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)

func TestPlan(t *testing.T) {
	run := func(id string, bytes uint64, started time.Time) Job {
		return Job{Id: id, Request: Request{Name: id, Bytes: bytes}, Running: true, StartedAt: started}
	}
	wait := func(id string, bytes uint64) Job { return Job{Id: id, Request: Request{Name: id, Bytes: bytes}} }
	old := t0.Add(-2 * RampUp)
	cases := []struct {
		name      string
		jobs      []Job
		slots     int
		available uint64
		start     []string
		reason    string
	}{
		{"empty", nil, 1, 8 * gb, nil, ""},
		{"head starts on a free slot", []Job{wait("a", gb)}, 1, 8 * gb, []string{"a"}, ""},
		{"slot busy", []Job{run("r", gb, old), wait("a", gb)}, 1, 8 * gb, nil, "slot busy"},
		{"two slots start two", []Job{wait("a", gb), wait("b", gb)}, 2, 8 * gb, []string{"a", "b"}, ""},
		{"RAM short", []Job{wait("a", 3 * gb)}, 1, 2 * gb, nil, "needs 3 GB, 2 GB free"},
		{"no overtaking", []Job{wait("big", 6 * gb), wait("small", gb)}, 2, 4 * gb, nil, "needs 6 GB, 4 GB free"},
		{"a ramping job counts its peak", []Job{run("r", 3 * gb, t0), wait("a", 3 * gb)}, 2, 6 * gb, nil, "needs 3 GB, 3 GB free"},
		{"a ramped job does not", []Job{run("r", 3 * gb, old), wait("a", 3 * gb)}, 2, 6 * gb, []string{"a"}, ""},
		{"forced starts past both gates", []Job{run("r", gb, old), {Id: "f", Request: Request{Name: "f", Bytes: 9 * gb}, Forced: true}}, 1, gb, []string{"f"}, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			start, reason := plan(c.jobs, c.slots, c.available, t0)
			if len(start) != len(c.start) {
				t.Fatalf("start = %v, want %v", start, c.start)
			}
			for i := range start {
				if start[i] != c.start[i] {
					t.Fatalf("start = %v, want %v", start, c.start)
				}
			}
			if reason != c.reason {
				t.Fatalf("reason = %q, want %q", reason, c.reason)
			}
		})
	}
}

func newTestQueue(slots int) *Queue {
	return New(Config{
		Slots:     func() int { return slots },
		Available: func(context.Context) (uint64, error) { return 64 * gb, nil },
	})
}

func TestAcquireIsFIFOOneAtATime(t *testing.T) {
	q := newTestQueue(1)
	ctx := context.Background()
	first, err := q.Acquire(ctx, Request{Name: "a", Bytes: gb}, nil)
	if err != nil {
		t.Fatal(err)
	}
	waits := make(chan Wait, 4)
	got := make(chan *Slot, 1)
	go func() {
		s, _ := q.Acquire(ctx, Request{Name: "b", Bytes: gb}, func(w Wait) { waits <- w })
		got <- s
	}()
	w := <-waits
	if w.Position != 1 || w.Behind != "a" || w.Reason != "slot busy" {
		t.Fatalf("wait = %+v", w)
	}
	select {
	case <-got:
		t.Fatal("b started while a held the only slot")
	case <-time.After(50 * time.Millisecond):
	}
	first.Release()
	select {
	case s := <-got:
		s.Release()
	case <-time.After(time.Second):
		t.Fatal("b never started after a released")
	}
	if n := len(q.Snapshot().Jobs); n != 0 {
		t.Fatalf("%d jobs left", n)
	}
}

func TestSkipAndRunNow(t *testing.T) {
	q := newTestQueue(1)
	ctx := context.Background()
	held, _ := q.Acquire(ctx, Request{Name: "a", Bytes: gb}, nil)
	defer held.Release()
	errs := make(chan error, 2)
	ids := make(chan string, 2)
	for i, name := range []string{"b", "c"} {
		go func() {
			s, err := q.Acquire(ctx, Request{Name: name, Bytes: gb}, func(w Wait) {})
			if s != nil {
				ids <- name
				s.Release()
			}
			errs <- err
		}()
		// one at a time, so b is queued ahead of c
		waitFor(t, func() bool { return len(q.Snapshot().Jobs) == 2+i })
	}
	jobs := q.Snapshot().Jobs
	if !q.Skip(jobs[1].Id) || !q.RunNow(jobs[2].Id) {
		t.Fatal("skip or run now refused a queued job")
	}
	e1, e2 := <-errs, <-errs
	if !errors.Is(e1, ErrSkipped) && !errors.Is(e2, ErrSkipped) {
		t.Fatalf("errs = %v, %v; want one ErrSkipped", e1, e2)
	}
	if name := <-ids; name != "c" {
		t.Fatalf("started %q, want c", name)
	}
}

func TestSkipRefusesEngineAndRunning(t *testing.T) {
	q := newTestQueue(1)
	held, _ := q.Acquire(context.Background(), Request{Name: "a", Bytes: gb}, nil)
	defer held.Release()
	go q.Acquire(context.Background(), Request{Name: "v", Bytes: gb, Engine: true}, nil)
	waitFor(t, func() bool { return len(q.Snapshot().Jobs) == 2 })
	jobs := q.Snapshot().Jobs
	if q.Skip(jobs[0].Id) || q.Skip(jobs[1].Id) {
		t.Fatal("skipped a running job or an engine job")
	}
}

func TestCancelledWaiterLeaves(t *testing.T) {
	q := newTestQueue(1)
	held, _ := q.Acquire(context.Background(), Request{Name: "a", Bytes: gb}, nil)
	defer held.Release()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, err := q.Acquire(ctx, Request{Name: "b", Bytes: gb}, nil); done <- err }()
	waitFor(t, func() bool { return len(q.Snapshot().Jobs) == 2 })
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	if n := len(q.Snapshot().Jobs); n != 1 {
		t.Fatalf("%d jobs, want 1", n)
	}
}

func TestReclaimFreesAnAgentSlotHeldTooLong(t *testing.T) {
	now := t0
	q := New(Config{
		Slots:     func() int { return 1 },
		Available: func(context.Context) (uint64, error) { return 64 * gb, nil },
		Now:       func() time.Time { return now },
	})
	engine, _ := q.Acquire(context.Background(), Request{Name: "v", Bytes: gb, Engine: true}, nil)
	agentCh := make(chan *Slot, 1)
	go func() { s, _ := q.Acquire(context.Background(), Request{Name: "a", Bytes: gb}, nil); agentCh <- s }()
	waitFor(t, func() bool { return len(q.Snapshot().Jobs) == 2 })
	q.RunNow(q.Snapshot().Jobs[1].Id)
	agent := <-agentCh
	now = now.Add(MaxHold + time.Second)
	q.Reclaim()
	select {
	case <-agent.Reclaimed():
	default:
		t.Fatal("agent slot not reclaimed")
	}
	select {
	case <-engine.Reclaimed():
		t.Fatal("engine slot reclaimed")
	default:
	}
	if n := len(q.Snapshot().Jobs); n != 1 {
		t.Fatalf("%d jobs, want the engine's alone", n)
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition never held")
		}
		time.Sleep(5 * time.Millisecond)
	}
}
```

**Step 2: Run to see them fail**

Run: `go test ./pkg/jobqueue`
Expected: FAIL, undefined `plan`, `New`, `Request`…

**Step 3: Implement `pkg/jobqueue/jobqueue.go`**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package jobqueue holds the heavy shell jobs of every agent and engine run on this machine (builds, the
// typecheck, whole test suites) to a few at a time, so concurrent runs stop starving each other of CPU and
// disk. One FIFO: the head starts when a slot is free and its RAM peak fits; no job overtakes another.
package jobqueue

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/memgate"
)

const (
	DefaultSlots = 1
	MaxSlots     = 4
	// RampUp is how long a started job counts its whole peak against the free RAM: one just started has not
	// reached its peak, so the reading still shows that RAM as free.
	RampUp = 60 * time.Second
	// MaxHold is how long an agent's job may hold a slot: past it the slot is taken back (a wsh that outlived
	// its command). Engine jobs live by their ctx and are never reclaimed.
	MaxHold = 60 * time.Minute
	// Tick paces Run: a fresh RAM reading and the reclaim check.
	Tick = 5 * time.Second
)

// ErrSkipped is Acquire's error when the person skipped the job from the cockpit.
var ErrSkipped = errors.New("skipped from the job queue")

// Source is who asked: an agent's block (and its tab, for the cockpit to open), or an engine run's step.
type Source struct {
	BlockId string
	TabId   string
	RunId   string
	Label   string // "Verify · Task 3"; empty for an agent
	// Always queues an engine step that memgate does not call heavy (Verify, Final)
	Always bool
}

type Request struct {
	Name   string // memgate's job name, or the engine step
	Bytes  uint64 // rough RAM peak
	Engine bool   // an engine step: no Skip, never reclaimed
	Source Source
}

// Job is one queued or running job as the cockpit sees it.
type Job struct {
	Id string
	Request
	Running   bool
	Forced    bool
	Position  int    // 1-based among the queued; 0 when running
	Reason    string // why a queued job waits
	QueuedAt  time.Time
	StartedAt time.Time
}

type Snapshot struct {
	Slots int
	Jobs  []Job // running first, then the queue in order
}

// Wait is a queued job's place, handed to Acquire's wait callback whenever it changes.
type Wait struct {
	Position int
	Behind   string // the job just ahead, or the running job for the head
	Reason   string
}

type Config struct {
	Slots     func() int
	Available func(context.Context) (uint64, error)
	OnChange  func(Snapshot) // after every change, outside the lock
	Now       func() time.Time
}

// Slot is a started job's hold on the queue.
type Slot struct {
	q       *Queue
	e       *entry
	once    sync.Once
	reclaim chan struct{}
}

// Release frees the slot; twice is once.
func (s *Slot) Release() {
	s.once.Do(func() {
		s.q.remove(s.e)
		s.q.evaluate(context.Background())
	})
}

// Reclaimed closes when the queue took the slot back (an agent job held past MaxHold).
func (s *Slot) Reclaimed() <-chan struct{} { return s.reclaim }

type entry struct {
	Job
	admitted chan struct{}
	skipped  chan struct{}
	reclaim  chan struct{}
	wait     func(Wait)
	lastWait Wait
}

type Queue struct {
	cfg     Config
	mu      sync.Mutex
	seq     int
	entries []*entry
}

// Default is wavesrv's queue; nil (tests, wsh) means no queue: Hold runs at once.
var Default *Queue

func New(cfg Config) *Queue {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.Slots == nil {
		cfg.Slots = func() int { return DefaultSlots }
	}
	return &Queue{cfg: cfg}
}

// ClampSlots reads the jobs:slots setting: unset or out of range is the default or the bound.
func ClampSlots(v *int) int {
	switch {
	case v == nil || *v < 1:
		return DefaultSlots
	case *v > MaxSlots:
		return MaxSlots
	}
	return *v
}

// plan picks the queued jobs that start now, in queue order: a forced job always; otherwise the head while
// fewer than slots run and its peak fits the free RAM less the peaks of jobs still ramping up. It stops at the
// first job that cannot start, and returns why the rest wait.
func plan(jobs []Job, slots int, available uint64, now time.Time) ([]string, string) {
	running := 0
	var ramping uint64
	for _, j := range jobs {
		if j.Running {
			running++
			if now.Sub(j.StartedAt) < RampUp {
				ramping += j.Bytes
			}
		}
	}
	free := sub(available, ramping)
	var start []string
	reason := ""
	for _, j := range jobs {
		if j.Running {
			continue
		}
		if j.Forced {
			start = append(start, j.Id)
			continue
		}
		if reason != "" {
			continue
		}
		switch {
		case running >= slots:
			reason = "slot busy"
		case !memgate.Fits(memgate.Job{Name: j.Name, Bytes: j.Bytes}, free):
			reason = fmt.Sprintf("needs %s, %s free", memgate.FormatGB(j.Bytes), memgate.FormatGB(free))
		default:
			start = append(start, j.Id)
			running++
			free = sub(free, j.Bytes)
		}
	}
	return start, reason
}

func sub(a, b uint64) uint64 {
	if a < b {
		return 0
	}
	return a - b
}
```

The "RAM short" case expects `needs 3 GB, 2 GB free` with 2 GB available: `memgate.Fits` adds the 512 MB headroom, so the reason shows the free figure, not free-minus-headroom. Keep that.

Then the methods (write them; behaviour pinned by the tests):

- `Acquire(ctx, req, wait func(Wait)) (*Slot, error)`: append an entry (`Id` = `fmt.Sprintf("j%d", seq)`, `QueuedAt` = now), `evaluate(ctx)`, then `select` on `admitted` (return a `Slot` whose `reclaim` is the entry's), `skipped` (remove, evaluate, `ErrSkipped`), `ctx.Done()` (remove, evaluate, `ctx.Err()`).
- `evaluate(ctx)`: read `Available` outside the lock (an error reads as `math.MaxUint64`: a broken reading never blocks); under the lock call `plan` on the jobs in order, mark each started entry `Running`, `StartedAt` = now, `Forced` kept, close `admitted`; give each queued entry its `Position`, `Reason` and `Behind` (the job ahead, or the oldest running job's name for the head); collect the `wait` callbacks whose `Wait` changed and the snapshot; after unlocking call them, then `OnChange`.
- `remove(e)`: drop the entry from `entries`.
- `Snapshot()`: `Slots` from config, the jobs running first (by `StartedAt`), then queued in order.
- `RunNow(id) bool`: a queued entry gets `Forced = true`, then `evaluate`; false for unknown or running.
- `Skip(id) bool`: a queued, non-`Engine` entry: close `skipped`; false otherwise.
- `Reclaim()`: each running non-`Engine` entry with `now - StartedAt > MaxHold`: close its `reclaim` once and remove it, then evaluate.
- `Run(ctx)`: every `Tick`, `Reclaim()` then `evaluate(ctx)`, until ctx ends.
- `Hold(ctx, req) (release func(), err error)` (package func): `Default == nil` returns a no-op release; else `Acquire(ctx, req, nil)` and `slot.Release`.
- `WithSource(ctx, Source) context.Context` / `SourceFrom(ctx) Source`: a ctx value for the engine's call sites.

**Step 4: Add `LongRunning` to `pkg/memgate/memgate.go`**, below `Fits`:

```go
// LongRunning says the job is a dev server: it runs until stopped, so it never holds a queue slot.
func (j Job) LongRunning() bool {
	return j == jobDev
}
```

Add a case to `pkg/memgate/memgate_test.go`: `Classify("task dev")` and `Classify("cargo tauri dev")` are `LongRunning`, `Classify("task check:ts")` is not.

**Step 5: Run the tests**

Run: `go test ./pkg/jobqueue ./pkg/memgate` (add `-race` once; it is light)
Expected: PASS

**Step 6: Commit**

```bash
git add pkg/jobqueue pkg/memgate/memgate.go pkg/memgate/memgate_test.go
git commit -m "feat(jobqueue): one FIFO for heavy jobs, a slot at a time and only when the RAM fits" -- pkg/jobqueue pkg/memgate/memgate.go pkg/memgate/memgate_test.go
```

---

### Task 2: a closed domain-socket link cancels its streams

**Depends on:** none

`wsh` in a terminal talks to wavesrv over the domain socket. When it disconnects, `handleDomainSocketClient` (`pkg/wshutil/wshutil.go:180`) unregisters the link but never cancels the streaming handlers that entered on it, which `pkg/web/ws.go:235,258` does for a websocket. A held slot would outlive its `wsh jobslot`.

**Files:**
- Modify: `pkg/wshutil/wshutil.go` (teardown in `handleDomainSocketClient`, ~line 199)
- Modify: `cmd/server/main-server.go` (~line 164, after `rpc := wshserver.GetMainRpcClient()`)
- Test: `pkg/wshutil/wshutil_domainlink_test.go`

**Step 1: Failing test.** With `net.Pipe()`, call `handleDomainSocketClient(serverEnd, nil)`, set `DomainLinkClosedHook` to record the link id it gets, close `clientEnd`, and assert the hook ran once with a non-`baseds.NoLinkId` id (poll up to 1 s). Restore the hook with `t.Cleanup`. Check how `readCallback` is used: pass a no-op if nil panics.

**Step 2:** `go test ./pkg/wshutil -run TestDomainLinkClosedHook`: FAIL (undefined).

**Step 3: Implement.** In `pkg/wshutil/wshutil.go`:

```go
// DomainLinkClosedHook runs once a domain-socket link is unregistered. wavesrv sets it to cancel the streaming
// RPCs that entered on the link (a held job slot, an agent's control stream), as pkg/web/ws.go does for a
// websocket; without it they live until their timeout.
var DomainLinkClosedHook func(baseds.LinkId)
```

and in the teardown, right after `DefaultRouter.UnregisterLink(linkId)`:

```go
			if DomainLinkClosedHook != nil {
				DomainLinkClosedHook(linkId)
			}
```

In `cmd/server/main-server.go`, after `rpc := wshserver.GetMainRpcClient()`:

```go
	wshutil.DomainLinkClosedHook = rpc.CancelRequestsForLink // a dead wsh's streams end with it (a held job slot)
```

**Step 4:** `go test ./pkg/wshutil`: PASS. `go build ./cmd/server`: OK.

**Step 5: Commit**

```bash
git commit -m "fix(wshutil): a wsh that disconnects from the domain socket ends its streams" -- pkg/wshutil/wshutil.go pkg/wshutil/wshutil_domainlink_test.go cmd/server/main-server.go
```

---

### Task 3: the RPCs, the event, the setting, and `wsh jobslot`

**Depends on:** Task 1, Task 2

**Files:**
- Create: `pkg/wshrpc/wshrpctypes_jobqueue.go`
- Modify: `pkg/wshrpc/wshrpctypes.go` (embed `JobQueueCommands` beside `DagCommands`, line ~45)
- Create: `pkg/wshrpc/wshserver/wshserver_jobqueue.go`, `wshserver_jobqueue_test.go`
- Modify: `pkg/wps/wpstypes.go`, `pkg/tsgen/tsgenevent.go`
- Modify: `pkg/wconfig/settingsconfig.go` (+ `schema/settings.json` if `task generate` does not write it)
- Modify: `cmd/server/main-server.go`
- Create: `cmd/wsh/cmd/wshcmd-jobslot.go`
- Modify: `cmd/wsh/cmd/wshcmd-agyhook.go:144`
- Delete: `cmd/wsh/cmd/wshcmd-memgate.go`, `cmd/wsh/cmd/wshcmd-memgate-decide.go`, `pkg/memgate/card.go`, `pkg/memgate/card_test.go`

**Step 1: Wire types** — `pkg/wshrpc/wshrpctypes_jobqueue.go`:

```go
package wshrpc

import "context"

// JobQueueCommands is the heavy-job queue (pkg/jobqueue): agents hold a slot through JobSlot, the cockpit reads
// and steers the queue.
type JobQueueCommands interface {
	JobSlotCommand(ctx context.Context, data CommandJobSlotData) chan RespOrErrorUnion[JobSlotUpdate] // wait for a slot for one shell command and hold it while the stream lives
	GetJobQueueCommand(ctx context.Context) (*JobQueueData, error)                                     // the running and queued heavy jobs
	JobQueueRunNowCommand(ctx context.Context, data CommandJobQueueActData) error                       // start a queued job past both gates
	JobQueueSkipCommand(ctx context.Context, data CommandJobQueueActData) error                         // refuse a queued agent job
}

type CommandJobSlotData struct {
	Command string `json:"command"`
	BlockId string `json:"blockid,omitempty"`
}

// JobSlotUpdate is one line of `wsh jobslot`: a queued place while it waits, then run true (held) or false
// with the reason the agent reads.
type JobSlotUpdate struct {
	Queued int    `json:"queued,omitempty"`
	Behind string `json:"behind,omitempty"`
	Why    string `json:"why,omitempty"`
	Run    *bool  `json:"run,omitempty"`
	Reason string `json:"reason,omitempty"`
}

type JobQueueJob struct {
	Id        string `json:"id"`
	Name      string `json:"name"`
	Bytes     uint64 `json:"bytes"`
	Running   bool   `json:"running,omitempty"`
	Forced    bool   `json:"forced,omitempty"`
	Engine    bool   `json:"engine,omitempty"`
	Position  int    `json:"position,omitempty"`
	Reason    string `json:"reason,omitempty"`
	QueuedTs  int64  `json:"queuedts"`
	StartedTs int64  `json:"startedts,omitempty"`
	BlockId   string `json:"blockid,omitempty"`
	TabId     string `json:"tabid,omitempty"`
	RunId     string `json:"runid,omitempty"`
	Label     string `json:"label,omitempty"`
}

type JobQueueData struct {
	Slots int           `json:"slots"`
	Jobs  []JobQueueJob `json:"jobs"`
}

type CommandJobQueueActData struct {
	Id string `json:"id"`
}
```

**Step 2: Event and setting.**
- `pkg/wps/wpstypes.go`: `Event_JobQueue = "jobqueue" // type: wshrpc.JobQueueData`, added to the const block and `AllEvents`.
- `pkg/tsgen/tsgenevent.go`: `wps.Event_JobQueue: reflect.TypeOf(wshrpc.JobQueueData{}),`.
- `pkg/wconfig/settingsconfig.go`, a new group near the `usage:` key: `JobsSlots *int \`json:"jobs:slots,omitempty"\` // heavy jobs run at once (pkg/jobqueue), 1–4; unset is 1`.

**Step 3: Failing server test** — `wshserver_jobqueue_test.go`. Set `jobqueue.Default = jobqueue.New(...)` with 1 slot (restore with `t.Cleanup`), then:
- `JobSlotCommand` for `"echo hi"` sends one update with `Run` true and closes.
- For `"task dev"` likewise (long-running is never queued).
- Two `"task check:ts"` streams: the first sends `Run` true and stays open; the second sends `Queued: 1, Behind: "task check:ts", Why: "slot busy"`. Cancel the first stream's ctx and the second sends `Run` true.
- `JobQueueSkipCommand` on a queued job makes its stream send `Run` false with a reason containing `Do not retry`.
- `GetJobQueueCommand` lists the jobs with `QueuedTs`/`StartedTs` in Unix ms.

**Step 4: Implement `wshserver_jobqueue.go`.** Follow `AgentControlCommand` (`wshserver_agents.go:304`): a buffered channel, a goroutine with `panichandler` and `defer close(ch)`, every send in a `select` with `<-ctx.Done()`.

```go
func (ws *WshServer) JobSlotCommand(ctx context.Context, data wshrpc.CommandJobSlotData) chan wshrpc.RespOrErrorUnion[wshrpc.JobSlotUpdate] {
	ch := make(chan wshrpc.RespOrErrorUnion[wshrpc.JobSlotUpdate], 4)
	go func() {
		defer func() { panichandler.PanicHandler("JobSlotCommand", recover()) }()
		defer close(ch)
		send := func(u wshrpc.JobSlotUpdate) bool {
			select {
			case ch <- wshrpc.RespOrErrorUnion[wshrpc.JobSlotUpdate]{Response: u}:
				return true
			case <-ctx.Done():
				return false
			}
		}
		yes, no := true, false
		job, heavy := memgate.Classify(data.Command)
		q := jobqueue.Default
		if !heavy || job.LongRunning() || q == nil {
			send(wshrpc.JobSlotUpdate{Run: &yes})
			return
		}
		src := jobqueue.Source{BlockId: data.BlockId}
		if data.BlockId != "" {
			if tabId, err := wstore.DBFindTabForBlockId(ctx, data.BlockId); err == nil {
				src.TabId = tabId
			}
		}
		slot, err := q.Acquire(ctx, jobqueue.Request{Name: job.Name, Bytes: job.Bytes, Source: src}, func(w jobqueue.Wait) {
			send(wshrpc.JobSlotUpdate{Queued: w.Position, Behind: w.Behind, Why: w.Reason})
		})
		if errors.Is(err, jobqueue.ErrSkipped) {
			send(wshrpc.JobSlotUpdate{Run: &no, Reason: fmt.Sprintf(
				"Not run: the person skipped `%s` from arcterm's job queue. "+
					"Do not retry it; carry on without it and say in your report that it was skipped.", job.Name)})
			return
		}
		if err != nil {
			return
		}
		defer slot.Release()
		if !send(wshrpc.JobSlotUpdate{Run: &yes}) {
			return
		}
		select {
		case <-ctx.Done():
		case <-slot.Reclaimed():
			log.Printf("jobqueue: reclaimed %q (block %s) after %v", job.Name, data.BlockId, jobqueue.MaxHold)
		}
	}()
	return ch
}
```

The `wait` callback runs outside the queue lock (Task 1), so a blocking `send` cannot deadlock the queue; the buffer of 4 absorbs the rest.

Add `GetJobQueueCommand` (convert `jobqueue.Snapshot` to `wshrpc.JobQueueData`; times as `UnixMilli`, zero time as 0; an empty queue or nil `Default` is `{Slots: …, Jobs: []}`, never null), and `JobQueueRunNowCommand` / `JobQueueSkipCommand` (an unknown id or a refused skip is an error naming the id). Export the converter as `JobQueueData(jobqueue.Snapshot) wshrpc.JobQueueData` for main-server.

**Step 5: Start the queue in wavesrv** — `cmd/server/main-server.go`, beside the Task 2 line:

```go
	jobqueue.Default = jobqueue.New(jobqueue.Config{
		Slots: func() int { return jobqueue.ClampSlots(wconfig.GetWatcher().GetFullConfig().Settings.JobsSlots) },
		Available: func(ctx context.Context) (uint64, error) {
			vm, err := mem.VirtualMemoryWithContext(ctx)
			if err != nil {
				return 0, err
			}
			return vm.Available, nil
		},
		OnChange: func(s jobqueue.Snapshot) {
			wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_JobQueue, Data: wshserver.JobQueueData(s)})
		},
	})
	go jobqueue.Default.Run(context.Background())
```

**Step 6: `task generate`.** Then `git status`: the generated TS/Go files, `metaconsts.go` and (likely) `schema/settings.json` change. If the schema does not list `jobs:slots`, add it beside `usage:insightslang` by hand (`"type": "integer", "minimum": 1, "maximum": 4`).

**Step 7: `wsh jobslot`** — `cmd/wsh/cmd/wshcmd-jobslot.go`, modelled on `wshcmd-agentctl.go`:

```go
// the Claude mod and the pi extension run this before every shell command an agent runs, and keep it alive
// while the command runs: it waits for a slot in arcterm's heavy-job queue, prints one JSON line per state
// ({"queued":2,"behind":…,"why":…} while queued, then {"run":true} or {"run":false,"reason":…}), and holds the
// slot until it is killed. Any error exits non-zero with no verdict line, and the hooks run the command.
var jobslotCmd = &cobra.Command{
	Use:                   "jobslot -- <command>",
	Short:                 "wait for and hold a slot in arcterm's heavy-job queue (agent hooks)",
	Args:                  cobra.ExactArgs(1),
	RunE:                  jobslotRun,
	PreRunE:               preRunSetupRpcClient,
	Hidden:                true,
	DisableFlagsInUseLine: true,
}
```

`jobslotRun` resolves the block like the deleted `memgateDecide` did (`resolveBlockArg()`, then `statusTarget(oref)` when `blockArg == ""`; on `drop` or any error send an empty `BlockId`), calls `wshclient.JobSlotCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: (24 * time.Hour).Milliseconds()})`, and `json.NewEncoder(os.Stdout).Encode`s every `msg.Response` until the channel closes; a `msg.Error` returns it.

Also export the waiting part for agy:

```go
// jobslotTurn waits for the command's turn and returns the verdict; returning ends the stream, so the slot is
// released at once (agy has no "command finished" event: the queue only orders its starts).
func jobslotTurn(ctx context.Context, command string) (run bool, reason string, err error)
```

and use it in `wshcmd-agyhook.go:144` in place of `memgateDecide(ctx, em.Command, func(any) {})`, keeping that call site's existing handling of a refusal (`run == false` → `reason`) and of an error (the command runs).

**Step 8: Delete** `cmd/wsh/cmd/wshcmd-memgate.go`, `cmd/wsh/cmd/wshcmd-memgate-decide.go`, `pkg/memgate/card.go`, `pkg/memgate/card_test.go`. Check nothing else used `memgate.Question/Asking/Waiting/Choice/Wait/Skipped/TimedOut/Verdict/Hold`.

**Step 9: Tests and build**

Run: `go test ./pkg/wshrpc/wshserver -run 'JobSlot|JobQueue' ./pkg/memgate ./pkg/jobqueue` then `go build ./cmd/server ./cmd/wsh`, `go vet ./cmd/wsh/cmd ./pkg/jobqueue`.
Expected: PASS, builds.

**Step 10: Commit** (pathspec: every file above plus the generated ones `git status` lists).

```bash
git commit -m "feat(jobqueue): wsh jobslot holds a queue slot over a stream; the cockpit gets the queue as an event" -- <paths>
```

---

### Task 4: the engine's plan commands take a slot

**Depends on:** Task 1

Every Setup, Check, Verify, Final and land check runs through `execPlanCommandEnv` (`pkg/orchestrate/plancmd.go:194`; `runPlanCommand` is a var tests replace, `runFinalCommand` calls `execPlanCommandEnv` directly).

**Files:**
- Modify: `pkg/orchestrate/plancmd.go`
- Modify the call sites to label the job: `final.go:309` (Check), `final.go:325` (Verify, final stage), `final.go:344` (Final), `verify.go:371` and `verify.go:452` (Verify at a merge), `engine.go:636` and `final.go:730` (Setup), `basecheck.go:106` (Setup) and `:116` (Check), `land.go:334` (land check)
- Test: `pkg/orchestrate/plancmd_jobqueue_test.go`

**Step 1: Failing test.** Set `jobqueue.Default` to a 1-slot queue (restore after). Hold its slot with an `Acquire` from the test. Run `execPlanCommandEnv(jobqueue.WithSource(ctx, jobqueue.Source{Label: "Verify", Always: true}), t.TempDir(), "echo ok", nil, time.Minute, nil)` in a goroutine; assert it has not returned after 100 ms and the snapshot shows it queued with `Engine` true and label `Verify`; release the test slot; assert it returns `ok`. A second case: `"echo light"` with no `Always` source runs at once while the slot is held.

**Step 2:** `go test ./pkg/orchestrate -run TestPlanCommandQueues`: FAIL.

**Step 3: Implement** at the top of `execPlanCommandEnv`, **before** `context.WithTimeout`, so time spent queued never counts against `VerifyTimeout`:

```go
	if release, err := holdPlanSlot(ctx, command); err != nil {
		return "", err
	} else {
		defer release()
	}
```

```go
// engineStepBytes is the RAM a Verify or Final claims when memgate does not know its command: verify.mjs's peak.
const engineStepBytes = 2560 << 20

// holdPlanSlot waits for a slot in the heavy-job queue for a plan command memgate calls heavy, or for any
// Verify or Final (Source.Always). A light Setup (this repo's .arc/setup only makes junctions) runs at once.
func holdPlanSlot(ctx context.Context, command string) (func(), error) {
	src := jobqueue.SourceFrom(ctx)
	job, heavy := memgate.Classify(command)
	if (!heavy || job.LongRunning()) && !src.Always {
		return func() {}, nil
	}
	name, bytes := job.Name, job.Bytes
	if !heavy || job.LongRunning() {
		name, bytes = src.Label, engineStepBytes
	}
	return jobqueue.Hold(ctx, jobqueue.Request{Name: name, Bytes: bytes, Engine: true, Source: src})
}
```

`jobqueue.Hold` with a nil `Default` is a no-op, so every existing engine test is unaffected.

At each call site wrap the ctx: `jobqueue.WithSource(ctx, jobqueue.Source{RunId: <run id>, Label: "<Step> · <task title or id>", Always: <true for Verify and Final>})`. Use whatever run id and task id are in scope (`runID` at `verify.go:452`; read each function's parameters for the others — the dag's run is on `g`/`run`/`owner`); when a task is not in scope the label is the step alone. Keep the wrap on the line that calls, not in a shared helper.

**Step 4:** `ARC_VERIFY_CHANGED=<file listing your changed paths> node scripts/verify.mjs ./pkg/orchestrate`
Expected: PASS (under 2 min).

**Step 5: Commit**

```bash
git commit -m "feat(orchestrate): Verify, Final and heavy Setup wait their turn in the job queue" -- pkg/orchestrate
```

---

### Task 5: the Claude mod and the pi extension hold a slot around the command

**Depends on:** Task 3

**Files:**
- Rename: `claude/arc-mod/hooks/memgate-core.ts` → `jobslot-core.ts`, `memgate-core.test.ts` → `jobslot-core.test.ts`
- Modify: `claude/arc-mod/hooks/register.ts` (`ramHold` ~line 98, `shellRefusal` ~131, the Bash/PowerShell `tool.call` hooks ~203–211)
- Modify: `pi/extensions/waveterm-tools-core.ts`, `pi/extensions/waveterm-tools-core.test.ts`, `pi/extensions/waveterm-tools.ts` (~line 129)

**Step 1: Failing tests** for the pure core, `claude/arc-mod/hooks/jobslot-core.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { jobslotArgs, jobslotLine } from "./jobslot-core";

describe("jobslot", () => {
    it("passes the command as one argument after --", () => {
        expect(jobslotArgs("-rf x")).toEqual(["jobslot", "--", "-rf x"]);
    });
    it("reads a queued place as a hold line", () => {
        expect(jobslotLine('{"queued":2,"behind":"task check:ts","why":"slot busy"}')).toEqual({
            hold: "Queued #2, waiting behind `task check:ts` (slot busy).",
        });
    });
    it("reads run true as no refusal, run false as the reason", () => {
        expect(jobslotLine('{"run":true}')).toEqual({ refusal: null });
        expect(jobslotLine('{"run":false,"reason":"Not run: skipped"}')).toEqual({ refusal: "Not run: skipped" });
    });
    it("ignores anything else", () => {
        for (const line of ["", "nope", "{}", '{"run":false}', "[1]"]) {
            expect(jobslotLine(line)).toBeNull();
        }
    });
});
```

Mirror the same cases for pi in `waveterm-tools-core.test.ts` (rename `memgateArgs`/`memgateRefusal` to `jobslotArgs`/`jobslotLine` there too; pi's core may share the exact code).

**Step 2:** `npx vitest run claude/arc-mod/hooks/jobslot-core.test.ts pi/extensions/waveterm-tools-core.test.ts`: FAIL.

**Step 3: Implement the core** (`jobslot-core.ts`): `memgate-core.ts`'s parser with the `hold` field replaced by the queued shape, rendering `Queued #${queued}, waiting behind \`${behind}\` (${why}).` (omit the parenthesis when `why` is empty).

**Step 4: The Claude mod.** `$.process.spawn` returns a stream whose loop is the child's life: `return()` on it kills the child, and nothing else does (`process.spawn` doc in the mod API types). So hold the iterator open across `next(e)`:

```ts
// a heavy command waits for its turn in arcterm's job queue, and holds the slot while it runs: `wsh jobslot`
// stays alive until this ends its stream, which kills it and frees the slot. its queued lines show here
// meanwhile. any failure of wsh's lets the command run
async function withJobSlot<T>($: EngineInterface, command: string, run: () => Promise<T>): Promise<T | { deny: string }> {
    if (!active) {
        return run();
    }
    const stream = $.process.spawn({ argv: [WSH, ...jobslotArgs(command)] });
    const it = stream[Symbol.asyncIterator]();
    let buffered = "";
    let refusal: string | null = null;
    try {
        wait: for (;;) {
            const step = await it.next();
            if (step.done) {
                break;
            }
            if (step.value.stream !== "stdout") {
                continue;
            }
            const taken = takeLines(buffered + step.value.text);
            buffered = taken.rest;
            for (const line of taken.lines) {
                const read = jobslotLine(line);
                if (read && "hold" in read) {
                    $.ui.log(`arc: ${read.hold}`);
                } else if (read) {
                    refusal = read.refusal;
                    break wait;
                }
            }
        }
    } catch (err) {
        $.ui.log(`arc: wsh jobslot failed: ${String(err)}`, { to: "debug" });
    }
    try {
        return refusal !== null ? { deny: refusal } : await run();
    } finally {
        await it.return?.(undefined);
    }
}
```

Delete `ramHold`. `shellRefusal` becomes the guard alone (`refusal($, command)`); keep its comment accurate. The two hooks:

```ts
    on("tool.call", { tool: "Bash" }, async ($, e, next) => {
        const why = await refusal($, e.command);
        return why === null ? withJobSlot($, e.command, () => next(e)) : { deny: why };
    });
```

and the same for PowerShell. Type-check against the mod API (`claude plugin validate claude/arc-mod`); if `it.return` or the `deny` union needs a cast, match how the file already types `{ deny }`.

**Step 5: pi.** In `waveterm-tools.ts` keep a `Map<string, ChildProcess>` of held slots by `event.toolCallId`. On `tool_call` (bash, inside a block): `spawn(wshPath, jobslotArgs(cmd))`, read stdout lines with `readline` until a verdict: a refusal kills the child and returns `{ block: true, reason }`; `run` stores the child under the tool call id and returns `undefined`; a queued line goes to the status bar if the handler's `ctx.ui.setStatus` exists (check the pi API in `node_modules/@mariozechner/pi-coding-agent`; skip it if not); the child exiting or erroring before a verdict lets the command run. On `tool_result` with a stored id: kill the child and delete it (follow the `mirroredToolCalls` pattern at `pi/extensions/waveterm-ask.ts:100`). On `session_shutdown`: kill every stored child.

**Step 6:** `npx vitest run claude/arc-mod pi/extensions` and `claude plugin validate claude/arc-mod`
Expected: PASS, valid.

**Step 7: Commit**

```bash
git commit -m "feat(agents): an agent's heavy command waits in the job queue and holds its slot while it runs" -- claude/arc-mod/hooks pi/extensions
```

---

### Task 6: the Jobs chip and popover

**Depends on:** Task 3

Read `DESIGN.md` (popovers, chips, tokens) before styling. Colors from `@theme` tokens only.

**Files:**
- Create: `frontend/app/cockpit/jobqueue.ts`, `jobqueue.test.ts`, `jobqueuestore.ts`, `jobqueuechip.tsx`, `jobqueuepanel.tsx`
- Modify: `frontend/app/cockpit/app-bar.tsx:79` (the chip between `<VersionMismatchPill />` and `<WorkerCapacityChip />`)
- Modify: `frontend/app/cockpit/cockpit-root.tsx:163` (mount `<JobQueuePanel model={model} />` beside `<ConsumersPanel />`)
- Modify: `scripts/cdp/scenarios.mjs` (scenario `jobqueue-chip`)

**Step 1: Failing tests** — `jobqueue.test.ts` for the pure helpers:

```ts
import { describe, expect, it } from "vitest";
import { chipLabel, formatElapsed, LONG_WAIT_MS, longWait, ordered, sourceLabel } from "./jobqueue";

const job = (o: Partial<JobQueueJob>): JobQueueJob => ({ id: "j1", name: "task check:ts", bytes: 3 << 30, queuedts: 0, ...o });

describe("jobqueue", () => {
    it("hides the chip when nothing runs or waits", () => {
        expect(chipLabel({ slots: 1, jobs: [] })).toBeNull();
    });
    it("counts running and queued", () => {
        expect(chipLabel({ slots: 1, jobs: [job({ running: true })] })).toBe("1 running");
        expect(chipLabel({ slots: 1, jobs: [job({ running: true }), job({ id: "j2" }), job({ id: "j3" })] })).toBe("1 · 2 queued");
        expect(chipLabel({ slots: 1, jobs: [job({ id: "j2" })] })).toBe("1 queued");
    });
    it("warns once a job has waited past LONG_WAIT_MS", () => {
        const d = { slots: 1, jobs: [job({ queuedts: 1_000 })] };
        expect(longWait(d, 1_000 + LONG_WAIT_MS - 1)).toBe(false);
        expect(longWait(d, 1_000 + LONG_WAIT_MS + 1)).toBe(true);
        expect(longWait({ slots: 1, jobs: [job({ running: true, queuedts: 0 })] }, LONG_WAIT_MS * 2)).toBe(false);
    });
    it("formats elapsed time", () => {
        expect(formatElapsed(20_000)).toBe("20s");
        expect(formatElapsed(134_000)).toBe("2m 14s");
        expect(formatElapsed(3_720_000)).toBe("1h 2m");
    });
    it("orders running first, then by queue position", () => {
        const out = ordered([job({ id: "q2", position: 2 }), job({ id: "r", running: true }), job({ id: "q1", position: 1 })]);
        expect(out.map((j) => j.id)).toEqual(["r", "q1", "q2"]);
    });
    it("names the source: an engine step with its run, or the agent", () => {
        expect(sourceLabel(job({ runid: "700db4a1-xx", label: "Verify · Task 3" }), [])).toBe("Run 700db4 · Verify · Task 3");
        expect(sourceLabel(job({ blockid: "b1" }), [{ blockId: "b1", name: "fix-footer" }])).toBe("fix-footer");
        expect(sourceLabel(job({ blockid: "b9" }), [])).toBe("an agent");
    });
});
```

Check the agent roster's field names in `model.agentsAtom` (the block id and display name) and shape `sourceLabel`'s second parameter to match; the test above uses `{ blockId, name }` as a placeholder.

**Step 2:** `npx vitest run frontend/app/cockpit/jobqueue.test.ts`: FAIL.

**Step 3: Implement `jobqueue.ts`** (pure): `LONG_WAIT_MS = 5 * 60_000`, `chipLabel`, `longWait`, `formatElapsed`, `ordered`, `sourceLabel`, and `openTargetFor(job, agents): OpenTarget | null` (`{ kind: "run", runId }` for a run; `{ kind: "agent", tabId }` for an agent with a tab id; else null). `OpenTarget` is in `frontend/app/view/jarvis/address.ts`.

**Step 4: The store** — `jobqueuestore.ts`: `jobQueueAtom` (`JobQueueData | null`), `jobQueueOpenAtom` (boolean), `jobQueueOpenerAtom` (`Element | null`), `toggleJobQueue(opener)` (closes `machineServersOpenAtom` and `consumersOpenAtom` first, as `toggleConsumers` does), and `useJobQueueFeed()`: one `RpcApi.GetJobQueueCommand(TabRpcClient)` load, then `waveEventSubscribeSingle({ eventType: "jobqueue", handler: (e) => globalStore.set(jobQueueAtom, e.data as JobQueueData) })` (the pattern at `frontend/app/view/jarvis/petsources.tsx:184`); unsubscribe on unmount. The feed runs in `JobQueuePanel`, which is always mounted.

**Step 5: The chip** — `jobqueuechip.tsx`, styled exactly like `WorkerCapacityChip` (`frontend/app/view/agents/workercapacitychip.tsx`): `data-job-queue-chip`, `aria-haspopup="dialog"`, a lucide `Layers` icon (`TriangleAlert` once `longWait`), `chipLabel` text, `text-warning` once `longWait`, else `text-muted`; `null` when `chipLabel` is null. While anything is queued, re-render every 15 s (`useEffect` interval) so the warning tone arrives without an event. Title: `Heavy jobs: N running, M queued (one at a time; set in the popover)`.

**Step 6: The popover** — `jobqueuepanel.tsx`, the Consumers panel's shell (`frontend/app/view/agents/consumerspanel.tsx:170-230`): backdrop `fixed inset-0 z-50` closing it, `PopoverReveal` placed with `panelPlacement` from `jobQueueOpenerAtom`, Esc closes unless `modalsModel.hasOpenModals()`, `role="dialog" aria-label="Heavy jobs"`, `data-job-queue-panel`. Content:

- Header: `Heavy jobs` and a Slots select (1–4, `data-job-queue-slots`) writing `RpcApi.SetConfigCommand(TabRpcClient, { "jobs:slots": n })` (the pattern at `frontend/app/view/agents/settingsui.tsx:71`).
- One row per job in `ordered` order (`data-job-row={id}`, `data-state="running"|"queued"`): a running dot or the queue position, the name, `memgate`-style GB (`(bytes / 2**30).toFixed(1)` without `.0`), elapsed (running: since `startedts`; queued: `waiting` since `queuedts`, ticking each second while open), and a second line with `sourceLabel` and, when queued, the reason. ↗ (`data-job-open`) calls `openTarget(model, target)` after closing, when `openTargetFor` gives one.
- Queued rows: **Run now** (`data-job-run-now`) → `RpcApi.JobQueueRunNowCommand(TabRpcClient, { id })`; **Skip** (`data-job-skip`, not on `engine` rows) → `JobQueueSkipCommand`. Button styling as the Consumers panel's row buttons (`consumerspanel.tsx:152,162`).
- Empty: `No heavy jobs running.` (the panel can be open when the last job ends).

**Step 7: The CDP scenario** `jobqueue-chip` in `scripts/cdp/scenarios.mjs` (4-space indent, never prettier it):

- arrange: `h.rpc("setconfig", { "jobs:slots": 1 })`; then hold three slots from the page itself:
  ```js
  await h.ev(`(() => {
      window.__jq = ["task check:ts", "go test ./...", "npx vitest run"].map((command) => {
          const g = window.TabRpcClient.wshRpcStream("jobslot", { command }, { timeout: 600000 });
          g.next();
          return g;
      });
      return true;
  })()`);
  ```
  wait ~1 s.
- assert: `[data-job-queue-chip]` exists and its text contains `1 · 2 queued`; click it; `[data-job-queue-panel]` shows 3 `[data-job-row]`, the first `data-state="running"` named `task check:ts`; the queued rows say `slot busy` and have Run now and Skip. Shot. Click Skip on the last row: it disappears. Shot.
- teardown: `location.reload()` through `h.ev` (the page's websocket closes and wavesrv cancels its streams, freeing the slots); restore `jobs:slots` to what arrange read.

**Step 8: Checks**

Run: `npx vitest run frontend/app/cockpit/jobqueue.test.ts`, `npx eslint frontend/app/cockpit/jobqueue*.ts* frontend/app/cockpit/app-bar.tsx frontend/app/cockpit/cockpit-root.tsx`, `npx prettier --check` on the same files, and `task check:ts` (~2 min; give it a longer timeout).
Expected: PASS, clean.

**Step 9: Commit**

```bash
git commit -m "feat(cockpit): a Jobs chip in the app bar shows the heavy-job queue, with Run now and Skip" -- frontend/app/cockpit scripts/cdp/scenarios.mjs
```

---

### Task 7: docs

**Depends on:** Task 4, Task 5, Task 6

**Files:**
- Modify: `AGENTS.md` (the gotcha "A heavy shell command can come back "Not run: …" while RAM is short")
- Modify: `CHANGELOG.md` (top section)

**Step 1:** Rewrite the AGENTS.md gotcha for the queue: before every Bash command an agent runs, the Claude mod and the pi extension call `wsh jobslot`; a heavy command (the table in `pkg/memgate/memgate.go`; dev servers excluded) waits its turn in wavesrv's queue (`pkg/jobqueue`) — `jobs:slots` at once, default 1, and only when its RAM fits — and holds the slot while it runs; the engine's Verify, Final and heavy Setup queue too. A command the person skipped from the Jobs popover comes back "Not run: …": don't retry it, carry on and report it skipped. A single test file or `-run` filter is light and never queues.

**Step 2:** CHANGELOG, under `Added` in the top section (open `## Unreleased` above it if the top section has a date): `Builds, typechecks and whole test suites from every agent and run now wait their turn in one queue, one at a time by default, so several runs no longer stall the machine; the new Jobs chip in the app bar shows what runs and what waits, with Run now and Skip.` Under `Changed`: `The Low RAM card is gone: a heavy command waits in the job queue instead.`

**Step 3: Commit**

```bash
git commit -m "docs: the heavy-job queue replaces the Low RAM card" -- AGENTS.md CHANGELOG.md
```
